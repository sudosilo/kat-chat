// Adds microphone permissions to the generated Android project so voice notes can record.
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
console.log("Android manifest ready");
