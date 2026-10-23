// Mantém o projeto Supabase ativo (o plano gratuito pausa após ~7 dias sem uso).
// Executado diariamente pelo Vercel Cron (ver vercel.json).
export default async function handler(req, res) {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return res.status(500).json({ ok: false, error: "Variáveis do Supabase ausentes" });
  try {
    const r = await fetch(url + "/rest/v1/categories?select=id&limit=1", {
      headers: { apikey: key, Authorization: "Bearer " + key },
    });
    return res.status(200).json({ ok: r.ok, status: r.status, at: new Date().toISOString() });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String(e) });
  }
}
