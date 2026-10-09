// Server function: answers @Claude mentions in the chat.
// Runs on Vercel. Needs ANTHROPIC_API_KEY and SUPABASE_SECRET_KEY set in Vercel.

const crypto = require("crypto");
const SB_URL = "https://vogxdikogfaxhwcgajfg.supabase.co";
function padFor(text){
  const used = Buffer.byteLength(text || "");
  let bucket = 4096; while (bucket < used + 64) bucket *= 2;
  return crypto.randomBytes(bucket).toString("base64url").slice(0, bucket - used);
}
const BOT_ID = "c1a0de00-0000-4000-8000-000000000001";
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const PER_PERSON_PER_DAY = 30;
const EVERYONE_PER_DAY = 300;
const CONTEXT_MESSAGES = 50;
const TIMEZONE = process.env.CHAT_TIMEZONE || "America/Phoenix";
const MAX_SEARCHES = 3;

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

function send(res, code, obj){ res.status(code).json(obj); }

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  try{
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return send(res, 401, { error: "Not signed in" });

    const ur = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: process.env.SUPABASE_SECRET_KEY, Authorization: "Bearer " + token } });
    if (!ur.ok) return send(res, 401, { error: "Sign in expired. Reload the chat." });
    const user = await ur.json();
    const uid = user.id;

    const mem = await db("chat_members?select=joined_at&user_id=eq." + uid);
    if (!mem || !mem.length) return send(res, 403, { error: "Only members can ask Claude." });
    const joined = mem[0].joined_at;

    const mid = Number(req.body && req.body.message_id);
    if (!mid) return send(res, 400, { error: "Missing message" });
    const rows = await db("chat_messages?select=*&id=eq." + mid);
    const msg = rows && rows[0];
    if (!msg || msg.sender !== uid || msg.deleted_at) return send(res, 400, { error: "That message can't be answered." });
    if (!/@claude\b/i.test(msg.body || "")) return send(res, 400, { error: "That message doesn't mention @Claude." });
    if (Date.now() - new Date(msg.created_at).getTime() > 5 * 60 * 1000) return send(res, 400, { error: "That message is too old to answer." });
    const already = await db("chat_messages?select=id&sender=eq." + BOT_ID + "&reply_to=eq." + mid);
    if (already && already.length) return send(res, 200, { ok: true, already: true });

    const day = new Date().toISOString().slice(0, 10);
    const usage = await db("chat_bot_usage?select=user_id,count&day=eq." + day) || [];
    const total = usage.reduce((s, r) => s + r.count, 0);
    const mine = (usage.find(r => r.user_id === uid) || {}).count || 0;
    if (mine >= PER_PERSON_PER_DAY) return send(res, 429, { error: "You've hit today's limit of " + PER_PERSON_PER_DAY + " Claude replies. It resets at midnight UTC." });
    if (total >= EVERYONE_PER_DAY) return send(res, 429, { error: "Claude has hit the chat's daily limit. It resets at midnight UTC." });
    await db("chat_bot_usage?on_conflict=user_id,day", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: uid, day, count: mine + 1 })
    });

    let q = "chat_messages?select=id,sender,body,file_name,created_at,reply_to&deleted_at=is.null&id=lte." + mid + "&order=id.desc&limit=" + CONTEXT_MESSAGES;
    if (joined && joined !== "-infinity") q += "&created_at=gte." + encodeURIComponent(joined);
    const recent = (await db(q) || []).reverse();
    const names = await db("chat_names?select=id,name") || [];
    const nameOf = id => id === BOT_ID ? "Claude" : ((names.find(n => n.id === id) || {}).name || "").trim() || "Someone";
    const settings = await db("chat_settings?select=bot_note&id=eq.1") || [];
    const note = settings[0] && settings[0].bot_note;

    const lines = recent.map(m => {
      const content = (m.body || "").trim() || (m.file_name ? "[shared a file: " + m.file_name + "]" : "[empty]");
      return nameOf(m.sender) + ": " + content;
    });
    const asker = nameOf(uid);
    const system =
      "You are Claude, an AI made by Anthropic, taking part in a small private group chat called Cat Command Chat. " +
      "Members mention @Claude when they want you. Reply as a chat message: short and natural, usually one to four sentences, " +
      "unless someone asks for more detail. Use plain text with no markdown headings or tables. Be warm and a little playful; " +
      "an occasional cat joke fits the room, but don't force it. You only see the last few messages, so say so if you're missing context. " +
      "If asked, be open that you're an AI. " +
      "It is now " + new Date().toLocaleString("en-US", { timeZone: TIMEZONE, dateStyle: "full", timeStyle: "short" }) + " in the chat's home time zone (" + TIMEZONE + "). " +
      "You have a web search tool. Use it whenever the question depends on current or local information, like events, news, prices, hours, weather or schedules, " +
      "and don't use it for things you already know well. Keep search-based answers short and name the source in a few words." +
      (note ? "\n\nNotes from the chat owner about how to behave here:\n" + note : "");
    const prompt =
      "Recent messages in the chat, oldest first:\n\n" + lines.join("\n") +
      "\n\n" + asker + " just mentioned you in their latest message. Write your reply to " + asker + ". Output only the reply text.";

    const messages = [{ role: "user", content: prompt }];
    const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES, user_location: { type: "approximate", timezone: TIMEZONE } }];
    let aj = null, blocks = [];
    for (let round = 0; round < 4; round++){
      const ar = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 1000, system, messages, tools })
      });
      aj = await ar.json();
      if (!ar.ok){
        await db("chat_bot_usage?on_conflict=user_id,day", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ user_id: uid, day, count: mine }) });
        return send(res, 502, { error: "Claude couldn't answer: " + ((aj && aj.error && aj.error.message) || ar.status) });
      }
      blocks = blocks.concat(aj.content || []);
      if (aj.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: aj.content });
    }
    const sources = [];
    for (const b of blocks){
      if (b.type === "text" && Array.isArray(b.citations)){
        for (const c of b.citations){ if (c.url && !sources.includes(c.url)) sources.push(c.url); }
      }
    }
    let text = blocks.filter(c => c.type === "text").map(c => c.text).join("").trim();
    if (sources.length) text += "\n\nSources: " + sources.slice(0, 3).join("  ");
    text = text.slice(0, 4000) || "Hmm, I lost my train of thought. Try again?";
    await db("chat_messages", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ sender: BOT_ID, body: text, reply_to: mid, pad: padFor(text) }) });
    return send(res, 200, { ok: true });
  }catch(e){
    return send(res, 500, { error: "Something went wrong on the server. " + String(e.message || e).slice(0, 160) });
  }
};

module.exports.config = { maxDuration: 60 };
