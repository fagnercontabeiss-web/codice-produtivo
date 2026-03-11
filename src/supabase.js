// src/supabase.js

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let _session = null;

function authHeaders() {
  const token = _session ? _session.access_token : SUPABASE_ANON_KEY;
  return {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": "Bearer " + token,
  };
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
    if (data.access_token) _session = data;
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
    _session = data;
    localStorage.setItem("sb_session", JSON.stringify(data));
    return data;
  },

  async signOut() {
    if (_session) {
      await fetch(SUPABASE_URL + "/auth/v1/logout", {
        method: "POST",
        headers: authHeaders(),
      }).catch(function() {});
    }
    _session = null;
    localStorage.removeItem("sb_session");
  },

  restoreSession() {
    try {
      const saved = localStorage.getItem("sb_session");
      if (saved) {
        const s = JSON.parse(saved);
        if (s.expires_at && Date.now() / 1000 < s.expires_at) {
          _session = s;
          return s;
        } else {
          localStorage.removeItem("sb_session");
        }
      }
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
    if (!res.ok) throw new Error("Supabase select error: " + res.statusText);
    return res.json();
  },

  async upsert(table, data) {
    const uid = auth.getUserId();
    const rows = Array.isArray(data) ? data : [data];
    const body = rows.map(function(row) {
      return Object.assign({}, row, uid ? { user_id: uid } : {});
    });
    const res = await fetch(SUPABASE_URL + "/rest/v1/" + table, {
      method: "POST",
      headers: Object.assign({}, authHeaders(), { "Prefer": "resolution=merge-duplicates" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Supabase upsert error: " + res.statusText);
    return res.json().catch(function() { return null; });
  },

  async delete(table, id) {
    const res = await fetch(SUPABASE_URL + "/rest/v1/" + table + "?id=eq." + id, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Supabase delete error: " + res.statusText);
  },

  async update(table, id, data) {
    const res = await fetch(SUPABASE_URL + "/rest/v1/" + table + "?id=eq." + id, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Supabase update error: " + res.statusText);
    return res.json().catch(function() { return null; });
  }
};
