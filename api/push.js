// Server function: sends phone notifications for new chat messages.
// Supabase calls POST here for every new message. The app calls GET to learn the public key.
// Android app subscribers get a generic alert through ntfy, with no names or message text.
// Needs VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and SUPABASE_SECRET_KEY set in Vercel.

const webpush = require("web-push");
const SB_URL = "https://vogxdikogfaxhwcgajfg.supabase.co";
const BOT_ID = "c1a0de00-0000-4000-8000-000000000001";

async function db(path, opts = {}){
  const key = process.env.SUPABASE_SECRET_KEY;
  const r = await fetch(SB_URL + "/rest/v1/" + path, {
    ...opts,
    headers: { apikey: key, "Content-Type": "application/json", Prefer: "return=representation", ...(opts.headers || {}) }
  });
  const t = await r.text();
  let j = null; try{ j = t ? JSON.parse(t) : null; }catch(e){}
  if (!r.ok) throw new Error("database " + r.status + " " + t.slice(0, 200));
  return j;
}

const APP_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"];
module.exports = async (req, res) => {
  const origin = req.headers.origin || "";
  if (APP_ORIGINS.includes(origin)){
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") return res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  try{
    const id = Number(req.body && req.body.id);
    if (!id) return res.status(400).json({ error: "missing id" });
    const rows = await db("chat_messages?select=*&id=eq." + id);
    const msg = rows && rows[0];
    if (!msg || msg.deleted_at) return res.status(200).json({ skipped: "no message" });
    if (Date.now() - new Date(msg.created_at).getTime() > 120000) return res.status(200).json({ skipped: "too old" });
    const logged = await db("chat_push_log?on_conflict=message_id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ message_id: id })
    });
    if (!logged || !logged.length) return res.status(200).json({ skipped: "already sent" });

    const [names, subs, members] = await Promise.all([
      db("chat_names?select=id,name"),
      db("chat_push?select=endpoint,user_id,p256dh,auth,mode"),
      db("chat_members?select=user_id")
    ]);
    const nameOf = uid => uid === BOT_ID ? "Claude" : ((names.find(n => n.id === uid) || {}).name || "").trim() || "Someone";
    const memberSet = new Set(members.map(m => m.user_id));
    let replyTo = null;
    if (msg.reply_to){
      const r = await db("chat_messages?select=sender&id=eq." + msg.reply_to);
      replyTo = r && r[0] ? r[0].sender : null;
    }
    const text = (msg.body || "").trim();
    const type = msg.file_type || "";
    const body = text ? (text.length > 140 ? text.slice(0, 140) + "..." : text)
      : type.startsWith("image/") ? "sent a picture"
      : type.startsWith("audio/") ? "sent a voice note"
      : type.startsWith("video/") ? "sent a video"
      : "shared a file";
    const lower = text.toLowerCase();

    webpush.setVapidDetails("https://" + (req.headers.host || "localhost"), process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const base = { title: nameOf(msg.sender), body, tag: "kat-chat", url: "/" };
    const used = Buffer.byteLength(JSON.stringify({ ...base, p: "" }));
    const payload = JSON.stringify({ ...base, p: require("crypto").randomBytes(1536).toString("base64url").slice(0, Math.max(0, 1536 - used)) });

    const targets = subs.filter(s => {
      if (s.user_id === msg.sender || !memberSet.has(s.user_id)) return false;
      if (s.mode === "all") return true;
      const myName = nameOf(s.user_id).toLowerCase();
      const mentioned = myName !== "someone" && lower.includes("@" + myName);
      return mentioned || replyTo === s.user_id;
    });
    let sent = 0;
    await Promise.all(targets.map(async s => {
      if (s.endpoint.startsWith("ntfy:")){
        const url = s.endpoint.slice(5);
        if (!/^https:\/\/ntfy\.sh\/kc-[A-Za-z0-9_-]{24}$/.test(url)) return;
        const direct = s.mode !== "all" || replyTo === s.user_id;
        try{
          const r = await fetch(url, {
            method: "POST",
            headers: { Title: "Cat Command Chat", Tags: "cat", Click: "catchat://open", Priority: direct ? "high" : "default" },
            body: direct ? "Someone mentioned you or replied to you" : "New message"
          });
          if (r.ok) sent++;
        }catch(e){}
        return;
      }
      try{
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 });
        sent++;
      }catch(e){
        if (e.statusCode === 404 || e.statusCode === 410){
          await db("chat_push?endpoint=eq." + encodeURIComponent(s.endpoint), { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => {});
        }
      }
    }));
    return res.status(200).json({ ok: true, sent });
  }catch(e){
    return res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  }
};

module.exports.config = { maxDuration: 30 };
