// src/supabase.js

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let _session = null;
let _refreshTimer = null;

function authHeaders() {
  const token = _session ? _session.access_token : SUPABASE_ANON_KEY;
  return {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": "Bearer " + token,
  };
}

function saveSession(data) {
  _session = data;
  localStorage.setItem("sb_session", JSON.stringify(data));
  scheduleRefresh(data);
}

function scheduleRefresh(session) {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  if (!session || !session.expires_at) return;
  const expiresIn = (session.expires_at * 1000) - Date.now();
  const refreshIn = Math.max(expiresIn - 60000, 10000); // renova 1 min antes de expirar
  _refreshTimer = setTimeout(function() {
    auth.refreshSession().catch(function() {});
  }, refreshIn);
}

export const auth = {
  async signUp(email, password) {
    const res = await fetch(SUPABASE_URL + "/auth/v1/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
      body: JSON.stringify({ email: email, password: password }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || data.msg || "Erro ao criar conta");
    if (data.access_token) saveSession(data);
    return data;
  },

  async signIn(email, password) {
    const res = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
      body: JSON.stringify({ email: email, password: password }),
    });
    const data = await res.json();
    if (data.error || data.error_code) throw new Error(data.error_description || data.msg || "Email ou senha incorretos");
    saveSession(data);
    return data;
  },

  async refreshSession() {
    try {
      const saved = localStorage.getItem("sb_session");
      if (!saved) return null;
      const s = JSON.parse(saved);
      if (!s.refresh_token) return null;
      const res = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
        body: JSON.stringify({ refresh_token: s.refresh_token }),
      });
      const data = await res.json();
      if (data.access_token) {
        saveSession(data);
        return data;
      }
    } catch(e) {}
    return null;
  },

  async signOut() {
    if (_refreshTimer) clearTimeout(_refreshTimer);
    if (_session) {
      await fetch(SUPABASE_URL + "/auth/v1/logout", {
        method: "POST",
        headers: authHeaders(),
      }).catch(function() {});
    }
    _session = null;
    localStorage.removeItem("sb_session");
  },

  async restoreSession() {
    try {
      const saved = localStorage.getItem("sb_session");
      if (!saved) return null;
      const s = JSON.parse(saved);
      if (!s.expires_at) return null;
      // Token ainda válido
      if (Date.now() / 1000 < s.expires_at - 60) {
        _session = s;
        scheduleRefresh(s);
        return s;
      }
      // Token expirado — tentar renovar com refresh_token
      if (s.refresh_token) {
        const refreshed = await auth.refreshSession();
        if (refreshed) return refreshed;
      }
      localStorage.removeItem("sb_session");
    } catch(e) {}
    return null;
  },

  getSession() { return _session; },
  getUserId() { return _session ? _session.user.id : null; },
  getUserEmail() { return _session ? _session.user.email : null; },
};

export const db = {
  async select(table, options) {
    let url = SUPABASE_URL + "/rest/v1/" + table + "?order=created_at.asc";
    if (options && options.filter) url += "&" + options.filter;
    const res = await fetch(url, { headers: authHeaders() });
    if (res.status === 401) {
      const refreshed = await auth.refreshSession();
      if (refreshed) {
        const res2 = await fetch(url, { headers: authHeaders() });
        if (res2.ok) return res2.json();
      }
      throw new Error("Sessao expirada");
    }
    if (!res.ok) throw new Error("Supabase select error: " + res.statusText);
    return res.json();
  },

  async upsert(table, data) {
    const uid = auth.getUserId();
    const rows = Array.isArray(data) ? data : [data];
    const body = rows.map(function(row) {
      return Object.assign({}, row, uid ? { user_id: uid } : {});
    });
    const doRequest = function(headers) {
      return fetch(SUPABASE_URL + "/rest/v1/" + table, {
        method: "POST",
        headers: Object.assign({}, headers, { "Prefer": "resolution=merge-duplicates" }),
        body: JSON.stringify(body),
      });
    };
    let res = await doRequest(authHeaders());
    if (res.status === 401) {
      const refreshed = await auth.refreshSession();
      if (refreshed) {
        res = await doRequest(authHeaders());
      }
    }
    if (!res.ok) throw new Error("Supabase upsert error: " + res.statusText);
    return res.json().catch(function() { return null; });
  },

  async delete(table, id) {
    const doRequest = function(headers) {
      return fetch(SUPABASE_URL + "/rest/v1/" + table + "?id=eq." + id, {
        method: "DELETE",
        headers: headers,
      });
    };
    let res = await doRequest(authHeaders());
    if (res.status === 401) {
      const refreshed = await auth.refreshSession();
      if (refreshed) res = await doRequest(authHeaders());
    }
    if (!res.ok) throw new Error("Supabase delete error: " + res.statusText);
  },

  async update(table, id, data) {
    const doRequest = function(headers) {
      return fetch(SUPABASE_URL + "/rest/v1/" + table + "?id=eq." + id, {
        method: "PATCH",
        headers: headers,
        body: JSON.stringify(data),
      });
    };
    let res = await doRequest(authHeaders());
    if (res.status === 401) {
      const refreshed = await auth.refreshSession();
      if (refreshed) res = await doRequest(authHeaders());
    }
    if (!res.ok) throw new Error("Supabase update error: " + res.statusText);
    return res.json().catch(function() { return null; });
  }
};
