// Adds microphone permissions for voice notes and the catchat link for alerts to the generated Android project.
const fs = require("fs");
const f = "src-tauri/gen/android/app/src/main/AndroidManifest.xml";
let s = fs.readFileSync(f, "utf8");
if (!s.includes("android.permission.RECORD_AUDIO")) {
  s = s.replace(
    "<application",
    '<uses-permission android:name="android.permission.RECORD_AUDIO" />\n    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />\n    <application'
  );
  fs.writeFileSync(f, s);
}
// Lets a tapped ntfy alert (catchat://open) bring the chat app to the front.
if (!s.includes('android:scheme="catchat"')) {
  const filter = '<intent-filter>\n                <action android:name="android.intent.action.VIEW" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <category android:name="android.intent.category.BROWSABLE" />\n                <data android:scheme="catchat" />\n            </intent-filter>\n            ';
  const i = s.indexOf("</activity>");
  if (i < 0) throw new Error("no activity in manifest");
  s = s.slice(0, i) + filter + s.slice(i);
}
fs.writeFileSync(f, s);
console.log("Android manifest ready");
