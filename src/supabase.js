// src/supabase.js
// Substitua os valores abaixo pelas suas credenciais do Supabase
// Encontre em: Supabase → Configurações → API

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
exportar const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

// Cliente Supabase leve (sem biblioteca externa)
exportar const db = {
  async select(table, options = {}) {
    let url = `${SUPABASE_URL}/rest/v1/${table}?`;
    se (options.filter) url += `${options.filter}&`;
    url += "order=created_at.asc";
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error(`Erro de seleção do Supabase: ${res.statusText}`);
    retornar res.json();
  },

  async upsert(tabela, dados) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      método: "POST",
      cabeçalhos: { ...cabeçalhos(), "Preferir": "resolução=mesclar duplicados" },
      corpo: JSON.stringify(Array.isArray(dados) ? dados : [dados]),
    });
    if (!res.ok) throw new Error(`Supabase upsert error: ${res.statusText}`);
    return res.json().catch(() => null);
  },

  async delete(table, id) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      método: "EXCLUIR",
      cabeçalhos: cabeçalhos(),
    });
    if (!res.ok) throw new Error(`Erro ao excluir do Supabase: ${res.statusText}`);
  },

  atualização assíncrona(tabela, id, dados) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      método: "PATCH",
      cabeçalhos: cabeçalhos(),
      corpo: JSON.stringify(dados),
    });
    if (!res.ok) throw new Error(`Erro de atualização do Supabase: ${res.statusText}`);
    return res.json().catch(() => null);
  }
};

função headers() {
  retornar {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
    "Autorização": `Portador ${SUPABASE_ANON_KEY}`,
  };
}
