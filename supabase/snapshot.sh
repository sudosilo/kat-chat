#!/data/data/com.termux/files/usr/bin/bash
# Saves the database layout (tables, access rules, functions) to supabase/schema-snapshot.json and pushes it to GitHub.
# No messages or user data are included. Run from the kat-chat folder: bash supabase/snapshot.sh
set -e
REF=vogxdikogfaxhwcgajfg
TOKEN_FILE="$HOME/.supabase/access-token"
node -e 'process.stdout.write(JSON.stringify({query: require("fs").readFileSync("supabase/schema-export.sql", "utf8")}))' \
  | curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer $(cat "$TOKEN_FILE")" -H "Content-Type: application/json" --data-binary @- \
  > supabase/schema-snapshot.json
git add supabase/schema-snapshot.json
git commit -q -m "Database layout snapshot" && git push -q
echo "Snapshot saved and pushed."
