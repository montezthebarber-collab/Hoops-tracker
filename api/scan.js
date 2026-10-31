// Vercel serverless function — holds your Anthropic key securely on the server.
// Set ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables (NOT prefixed with VITE_).

export const config = { maxDuration: 60 };

const SYSTEM = `You are a basketball scoresheet OCR engine. Return ONLY a raw JSON array (no markdown, no explanation).
Each element: {"name":"","number":"","pts":0,"fgm":0,"fga":0,"tpm":0,"tpa":0,"ftm":0,"fta":0,"oreb":0,"dreb":0,"ast":0,"stl":0,"blk":0,"tov":0,"pf":0,"illegible":false}
Use 0 for blank/illegible fields. Set illegible:true if any field was unreadable.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY (add it in Vercel settings, then redeploy)." });

  const { image, mime } = req.body || {};
  if (!image) return res.status(400).json({ error: "No image received." });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.SCAN_MODEL || "claude-sonnet-5-5",
        max_tokens: 4000,
        system: SYSTEM,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mime || "image/jpeg", data: image } },
          { type: "text", text: "Extract all player stats from this scoresheet." },
        ] }],
      }),
    });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(502).json({ error: `Anthropic API error ${r.status}: ${detail.slice(0, 200)}` });
    }
    const data = await r.json();
    const text = (data.content || []).map(c => c.text || "").join("") || "[]";
    const stats = JSON.parse(text.replace(/```json|```/g, "").trim());
    return res.status(200).json({ stats });
  } catch (e) {
    return res.status(500).json({ error: "Could not read the scoresheet: " + e.message });
  }
}
