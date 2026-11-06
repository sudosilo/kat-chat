#!/data/data/com.termux/files/usr/bin/bash
# Saves the database layout (tables, access rules, functions) to supabase/schema-snapshot.json and pushes it to GitHub.
# No messages or user data are included. Run from the kat-chat folder: bash supabase/snapshot.sh
set -eo pipefail
REF=vogxdikogfaxhwcgajfg
TOKEN_FILE="$HOME/.supabase/access-token"
if [ ! -s "$TOKEN_FILE" ]; then echo "No Supabase login token found at $TOKEN_FILE"; exit 1; fi
TMP="$(mktemp)"
node -e 'process.stdout.write(JSON.stringify({query: require("fs").readFileSync("supabase/schema-export.sql", "utf8")}))' \
  | curl --fail-with-body -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer $(cat "$TOKEN_FILE")" -H "Content-Type: application/json" --data-binary @- \
  > "$TMP"
mv "$TMP" supabase/schema-snapshot.json
git add supabase/schema-snapshot.json
if git diff --cached --quiet; then echo "Snapshot unchanged."; exit 0; fi
git commit -q -m "Database layout snapshot"
git push -q
echo "Snapshot saved and pushed."
