// Daily ping so the free Supabase project never auto-pauses from inactivity.
export default async function handler(req, res) {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return res.status(500).json({ ok: false, error: "Supabase env vars missing" });
  try {
    const r = await fetch(`${url}/rest/v1/players?select=id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    const body = r.ok ? "" : (await r.text()).slice(0, 200);
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, detail: body });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message });
  }
}
