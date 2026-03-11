// src/supabase.js

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY=import.meta.env.VITE_SUPABASE_ANON_KEY;

let _session = null;

função authHeaders() {
  const token = _session ? _session.access_token : SUPABASE_ANON_KEY;
  retornar {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
    "Autorização": "Portador" + token,
  };
}

exportar const auth = {
  signUp(email, senha) assíncrono {
    const res = await fetch(SUPABASE_URL + "/auth/v1/signup", {
      método: "POST",
      cabeçalhos: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
      corpo: JSON.stringify({ email: email, password: password }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || data.msg || "Erro ao criar conta");
    se (data.access_token) _session = data;
    retornar dados;
  },

  signIn assíncrono(email, senha) {
    const res = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=password", {
      método: "POST",
      cabeçalhos: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
      corpo: JSON.stringify({ email: email, password: password }),
    });
    const data = await res.json();
    if (data.error || data.error_code) throw new Error(data.error_description || data.msg || "Email ou senha incorretas");
    _sessão = dados;
    localStorage.setItem("sb_session", JSON.stringify(data));
    retornar dados;
  },

  signOut assíncrono() {
    se (_sessão) {
      aguardar fetch(SUPABASE_URL + "/auth/v1/logout", {
        método: "POST",
        cabeçalhos: authHeaders(),
      }).catch(function() {});
    }
    _session = nulo;
    localStorage.removeItem("sb_session");
  },

  restaurarSessão() {
    tentar {
      const saved = localStorage.getItem("sb_session");
      se (salvo) {
        const s = JSON.parse(saved);
        se (s.expires_at && Date.now() / 1000 < s.expires_at) {
          _sessão = s;
          retornar s;
        } outro {
          localStorage.removeItem("sb_session");
        }
      }
    } catch(e) {}
    retornar nulo;
  },

  getSession() { return _session; },
  getUserId() { return _session ? _session.user.id : null; },
  getUserEmail() { return _session ? _session.user.email : null; },
};

exportar const db = {
  async select(tabela, opções) {
    let url = SUPABASE_URL + "/rest/v1/" + tabela + "?order=created_at.asc";
    se (opções && opções.filtro) url += "&" + opções.filtro;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error("Erro de seleção do Supabase: " + res.statusText);
    retornar res.json();
  },

  async upsert(tabela, dados) {
    const uid = auth.getUserId();
    const rows = Array.isArray(data) ? data : [data];
    const body = rows.map(function(row) {
      return Object.assign({}, row, uid ? { user_id: uid } : {});
    });
    const res = await fetch(SUPABASE_URL + "/rest/v1/" + table, {
      método: "POST",
      cabeçalhos: Object.assign({}, authHeaders(), { "Prefer": "resolution=merge-duplicates" }),
      corpo: JSON.stringify(corpo),
    });
    if (!res.ok) throw new Error("Erro de upsert do Supabase: " + res.statusText);
    return res.json().catch(function() { return null; });
  },

  async delete(table, id) {
    const res = await fetch(SUPABASE_URL + "/rest/v1/" + table + "?id=eq." + id, {
      método: "EXCLUIR",
      cabeçalhos: authHeaders(),
    });
    if (!res.ok) throw new Error("Erro ao excluir o Supabase: " + res.statusText);
  },

  atualização assíncrona(tabela, id, dados) {
    const res = await fetch(SUPABASE_URL + "/rest/v1/" + table + "?id=eq." + id, {
      método: "PATCH",
      cabeçalhos: authHeaders(),
      corpo: JSON.stringify(dados),
    });
    if (!res.ok) throw new Error("Erro de atualização do Supabase: " + res.statusText);
    return res.json().catch(function() { return null; });
  }
};
