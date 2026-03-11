// src/supabase.js

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

function headers() {
  return {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": "Bearer " + SUPABASE_ANON_KEY,
  };
}

export const db = {
  async select(table, options) {
    let url = SUPABASE_URL + "/rest/v1/" + table + "?order=created_at.asc";
    if (options && options.filter) url += "&" + options.filter;
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error("Supabase select error: " + res.statusText);
    return res.json();
  },

  async upsert(table, data) {
    const body = Array.isArray(data) ? data : [data];
    const res = await fetch(SUPABASE_URL + "/rest/v1/" + table, {
      method: "POST",
      headers: Object.assign({}, headers(), { "Prefer": "resolution=merge-duplicates" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Supabase upsert error: " + res.statusText);
    return res.json().catch(function() { return null; });
  },

  async delete(table, id) {
    const res = await fetch(SUPABASE_URL + "/rest/v1/" + table + "?id=eq." + id, {
      method: "DELETE",
      headers: headers(),
    });
    if (!res.ok) throw new Error("Supabase delete error: " + res.statusText);
  },

  async update(table, id, data) {
    const res = await fetch(SUPABASE_URL + "/rest/v1/" + table + "?id=eq." + id, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Supabase update error: " + res.statusText);
    return res.json().catch(function() { return null; });
  }
};
