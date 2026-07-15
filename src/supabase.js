// src/supabase.js — versão robusta com sessão persistente e retry automático

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const SESSION_KEY = "sb_session";

let _session = null;
let _refreshTimer = null;
let _onSessionExpired = null; // callback para forçar logout na UI

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
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch(e) {}
  scheduleRefresh(data);
}

function scheduleRefresh(session) {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  if (!session || !session.expires_at) return;
  const expiresIn = (session.expires_at * 1000) - Date.now();
  // Renovar 2 minutos antes de expirar, mínimo 10s
  const refreshIn = Math.max(expiresIn - 120000, 10000);
  _refreshTimer = setTimeout(async function() {
    const refreshed = await auth.refreshSession().catch(() => null);
    if (!refreshed) {
      console.warn("[supabase] Sessão expirada e refresh falhou");
      if (_onSessionExpired) _onSessionExpired();
    }
  }, refreshIn);
}

export const auth = {
  onSessionExpired(cb) { _onSessionExpired = cb; },

  async signIn(email, password) {
    const res = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (data.error || data.error_code) throw new Error(data.error_description || data.msg || "Email ou senha incorretos");
    saveSession(data);
    return data;
  },

  async signUp(email, password) {
    const res = await fetch(SUPABASE_URL + "/auth/v1/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "Erro ao criar conta");
    if (data.access_token) saveSession(data);
    return data;
  },

  async refreshSession() {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
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
        console.log("[supabase] Sessão renovada com sucesso");
        return data;
      }
      console.warn("[supabase] Refresh falhou:", data.error_description || data.msg);
    } catch(e) {
      console.warn("[supabase] Erro no refresh:", e.message);
    }
    return null;
  },

  async restoreSession() {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (!saved) return null;
      const s = JSON.parse(saved);
      if (!s.access_token || !s.expires_at) return null;

      const now = Date.now() / 1000;
      // Token ainda válido (com margem de 2 min)
      if (now < s.expires_at - 120) {
        _session = s;
        scheduleRefresh(s);
        console.log("[supabase] Sessão restaurada do localStorage — expira em", Math.round(s.expires_at - now), "s");
        return s;
      }

      // Token expirado — tentar renovar
      if (s.refresh_token) {
        console.log("[supabase] Token expirado — tentando renovar...");
        const refreshed = await auth.refreshSession();
        if (refreshed) return refreshed;
      }

      // Sessão totalmente expirada
      console.warn("[supabase] Sessão expirada e sem refresh_token válido — limpando");
      localStorage.removeItem(SESSION_KEY);
      _session = null;
    } catch(e) {
      console.error("[supabase] Erro ao restaurar sessão:", e.message);
    }
    return null;
  },

  async signOut() {
    if (_refreshTimer) clearTimeout(_refreshTimer);
    if (_session) {
      await fetch(SUPABASE_URL + "/auth/v1/logout", {
        method: "POST",
        headers: authHeaders(),
      }).catch(() => {});
    }
    _session = null;
    try { localStorage.removeItem(SESSION_KEY); } catch(e) {}
  },

  getSession() { return _session; },
  getUserId() { return _session ? _session.user.id : null; },
  getUserEmail() { return _session ? _session.user.email : null; },
  isAuthenticated() { return !!_session && !!_session.access_token; },
};

// Função auxiliar para fazer request com retry automático de auth
async function withAuth(requestFn) {
  let res = await requestFn(authHeaders());

  if (res.status === 401) {
    console.warn("[supabase] 401 — tentando renovar sessão...");
    const refreshed = await auth.refreshSession();
    if (refreshed) {
      res = await requestFn(authHeaders());
    } else {
      if (_onSessionExpired) _onSessionExpired();
      throw new Error("Sessão expirada — faça login novamente");
    }
  }

  return res;
}

export const db = {
  async select(table, options) {
    let url = SUPABASE_URL + "/rest/v1/" + table + "?order=created_at.asc";
    if (options && options.filter) url += "&" + options.filter;

    const res = await withAuth(headers => fetch(url, { headers }));
    if (!res.ok) throw new Error("Supabase select error [" + table + "]: " + res.statusText);

    const data = await res.json();
    if (Array.isArray(data) && data.length === 0 && !auth.isAuthenticated()) {
      console.warn("[supabase] select(" + table + ") retornou [] sem autenticação — possível sessão inválida");
    }
    return data;
  },

  async upsert(table, data) {
    const uid = auth.getUserId();
    const rows = Array.isArray(data) ? data : [data];
    const body = rows.map(row => ({ ...row, ...(uid ? { user_id: uid } : {}) }));

    const res = await withAuth(headers => fetch(SUPABASE_URL + "/rest/v1/" + table, {
      method: "POST",
      headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify(body),
    }));

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error("Supabase upsert error [" + table + "]: " + errText);
    }
    return res.json().catch(() => null);
  },

  async delete(table, id) {
    const res = await withAuth(headers => fetch(
      SUPABASE_URL + "/rest/v1/" + table + "?id=eq." + id,
      { method: "DELETE", headers }
    ));
    if (!res.ok) throw new Error("Supabase delete error [" + table + "]: " + res.statusText);
  },

  async update(table, id, data) {
    const res = await withAuth(headers => fetch(
      SUPABASE_URL + "/rest/v1/" + table + "?id=eq." + id,
      { method: "PATCH", headers, body: JSON.stringify(data) }
    ));
    if (!res.ok) throw new Error("Supabase update error [" + table + "]: " + res.statusText);
    return res.json().catch(() => null);
  },
};
