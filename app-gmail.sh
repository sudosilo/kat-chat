set -e
cat > $HOME/.kc-pair.js <<'PAIRJS'
// Gmail sign in for the phone and desktop apps. The app opens the web version in the browser with a one-time
// pairing id, you sign in with Gmail there, and the browser hands that sign-in back to the app, then forgets it.
const PAIR_PARAM = new URLSearchParams(location.search).get("pair");
function pairId(){
  const b = new Uint8Array(24); crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}
async function appGmailSignIn(){
  const id = pairId();
  const s = await sb.rpc("pair_start", { p_id: id });
  if (s.error || !s.data){ showNote("Couldn't start Gmail sign in. Check your connection and try again."); return; }
  openOutside(WEB_HOME + "?pair=" + id);
  showNote("Finish Gmail sign in in your browser, then come back to this app.");
  const until = Date.now() + 10 * 60 * 1000;
  const tick = async () => {
    if (Date.now() > until){ showNote("Gmail sign in timed out. Tap Sign in with Gmail to try again."); return; }
    const t = await sb.rpc("pair_take", { p_id: id });
    if (t.data){
      const r = await sb.auth.refreshSession({ refresh_token: t.data });
      if (r.error){ showNote("Gmail sign in didn't finish: " + (r.error.message || "")); return; }
      location.reload(); return;
    }
    setTimeout(tick, 2000);
  };
  setTimeout(tick, 2000);
}
// Runs on the web version when it was opened by the app. Returns true when it took over the page.
async function finishAppPairing(){
  if (IS_APP) return false;
  if (PAIR_PARAM) { store("katPair", PAIR_PARAM); history.replaceState(null, "", RETURN_TO); }
  const id = load("katPair");
  if (!id) return false;
  const { data: { session } } = await sb.auth.getSession();
  const signedIn = session && session.user && !session.user.is_anonymous && (session.user.identities || []).some(i => i.provider === "google");
  if (!signedIn){
    showNote("Signing in with Gmail for the Cat Command Chat app...");
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: RETURN_TO } });
    if (error){ try{ localStorage.removeItem("katPair"); }catch(e){} showNote("Couldn't start Gmail sign in. " + (error.message || "")); }
    return true;
  }
  try{ localStorage.removeItem("katPair"); }catch(e){}
  const r = await sb.auth.refreshSession();
  const tok = r.data && r.data.session && r.data.session.refresh_token;
  const put = tok ? await sb.rpc("pair_put", { p_id: id, p_token: tok }) : { data: false };
  try{ Object.keys(localStorage).filter(k => /^sb-.*-auth-token/.test(k)).forEach(k => localStorage.removeItem(k)); }catch(e){}
  $("#onlineText").textContent = "App sign in";
  showNote(put.data ? "Your Cat Command Chat app is signed in with Gmail. Go back to the app. This browser tab is now signed out so the app keeps the sign in." : "That sign in link expired. Tap Sign in with Gmail in the app again.");
  return true;
}
PAIRJS
sed -i -e 's|^  if (IS_APP){ showNote("Gmail linking works in the web version for now. It comes to the app in a later update."); return; }$|  if (IS_APP){ appGmailSignIn(); return; }|' -e 's|^  if (IS_APP){ showNote("Gmail sign-in works in the web version for now. It comes to the app in a later update."); return; }$|  if (IS_APP){ appGmailSignIn(); return; }|' -e 's|^    sb = supabase.createClient(SB_URL, SB_KEY);$|    sb = supabase.createClient(SB_URL, SB_KEY);\n    if (await finishAppPairing()) return;|' index.html
awk 'FNR==NR{code=code $0 "\n"; next} /^async function start\(\)\{$/{printf "%s", code} {print}' $HOME/.kc-pair.js index.html > $HOME/.kc-index.html && mv $HOME/.kc-index.html index.html
rm -f $HOME/.kc-pair.js
