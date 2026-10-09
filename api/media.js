// Server function: searches GIFs (GIPHY) and movie and TV quote clips (Yarn) for the chat's fun picker.
// GET /api/media?src=gif&q=cats  or  /api/media?src=yarn&q=i am your father
// Needs GIPHY_API_KEY in Vercel for GIFs and KLIPY_API_KEY for movie clips. Without KLIPY it falls back to Yarn.

const SB_URL = "https://vogxdikogfaxhwcgajfg.supabase.co";
const APP_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"];
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36";

function findUrls(o, out){
  if (!o) return out;
  if (typeof o === "string"){ if (/^https:\/\//.test(o)) out.push(o); return out; }
  if (typeof o === "object") for (const k of Object.keys(o)) findUrls(o[k], out);
  return out;
}
async function klipyClips(q, uid){
  const key = process.env.KLIPY_API_KEY;
  const base = "https://api.klipy.com/api/v1/" + key + "/clips/";
  const u = (q ? base + "search?q=" + encodeURIComponent(q) + "&" : base + "trending?") + "page=1&per_page=24&customer_id=" + encodeURIComponent(uid);
  const r = await fetch(u, { headers: { Accept: "application/json" } });
  if (!r.ok) return { error: "Clip search isn't answering right now (" + r.status + ")." };
  const j = await r.json();
  const list = (j && j.data && (Array.isArray(j.data) ? j.data : j.data.data)) || [];
  const items = [];
  for (const c of list){
    if (!c || c.type === "ad") continue;
    const urls = findUrls(c.file || c, []);
    const mp4 = urls.find(x => /\.mp4(\?|$)/i.test(x));
    const prev = urls.find(x => /\.(gif|webp|jpe?g|png)(\?|$)/i.test(x));
    if (mp4) items.push({ id: String(c.id || c.slug || mp4), title: c.title || "", preview: prev || "", url: mp4.split("?")[0] });
  }
  return { items };
}

async function member(token){
  const key = process.env.SUPABASE_SECRET_KEY;
  const ur = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: key, Authorization: "Bearer " + token } });
  if (!ur.ok) return false;
  const u = await ur.json();
  const r = await fetch(SB_URL + "/rest/v1/chat_members?select=user_id&user_id=eq." + u.id, { headers: { apikey: key, Authorization: "Bearer " + key } });
  const j = r.ok ? await r.json() : [];
  return j.length > 0 ? u.id : false;
}

async function gifs(q){
  const key = process.env.GIPHY_API_KEY;
  if (!key) return { error: "GIFs aren't set up on the server yet." };
  const u = q
    ? "https://api.giphy.com/v1/gifs/search?api_key=" + key + "&q=" + encodeURIComponent(q) + "&limit=30&rating=r"
    : "https://api.giphy.com/v1/gifs/trending?api_key=" + key + "&limit=30&rating=r";
  const r = await fetch(u);
  if (!r.ok) return { error: "GIF search isn't answering right now." };
  const j = await r.json();
  return { items: (j.data || []).map(g => {
    const im = g.images || {};
    const send = im.fixed_height || im.downsized || im.original || {};
    const prev = im.fixed_width_small || im.fixed_width || send;
    return { id: g.id, title: g.title || "", preview: prev.url, url: (send.url || "").split("?")[0], w: Number(send.width) || 0, h: Number(send.height) || 0 };
  }).filter(x => x.url && x.preview) };
}

const YARN_HOSTS = ["https://www.yarn.co", "https://yarn.co", "https://getyarn.io"];
const BROWSER = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none", "Upgrade-Insecure-Requests": "1"
};
async function yarn(q){
  if (!q) return { items: [] };
  const codes = [];
  for (const host of YARN_HOSTS){
    try{
      const r = await fetch(host + "/yarn-find?text=" + encodeURIComponent(q), { headers: BROWSER, redirect: "follow" });
      if (!r.ok){ codes.push(r.status); continue; }
      const html = await r.text();
      const ids = [];
      const re = /yarn-clip\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
      let m;
      while ((m = re.exec(html)) && ids.length < 24){ const id = m[1].toLowerCase(); if (!ids.includes(id)) ids.push(id); }
      if (!ids.length && /captcha|cloudflare|challenge/i.test(html)){ codes.push("check"); continue; }
      return { items: ids.map(id => ({ id, preview: "https://y.yarn.co/" + id + "_text.gif", url: "https://y.yarn.co/" + id + ".mp4" })) };
    }catch(e){ codes.push("net"); }
  }
  return { error: "Yarn isn't answering right now (" + codes.join(", ") + ")." };
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || "";
  if (APP_ORIGINS.includes(origin)){
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  try{
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const uid = token ? await member(token) : false;
    if (!uid) return res.status(401).json({ error: "Only members can search." });
    const src = String(req.query.src || "gif");
    const q = String(req.query.q || "").trim().slice(0, 100);
    const out = src === "yarn" ? (process.env.KLIPY_API_KEY ? await klipyClips(q, uid) : await yarn(q)) : await gifs(q);
    res.setHeader("Cache-Control", "private, max-age=120");
    return res.status(out.error ? 502 : 200).json(out);
  }catch(e){
    return res.status(500).json({ error: "Search failed. Try again." });
  }
};
