#!/data/data/com.termux/files/usr/bin/bash
# Runs a .sql file against the Cat Command Chat database using the Supabase CLI login token.
# Usage: bash supabase/run-sql.sh supabase/notify_push.sql
set -e
REF=vogxdikogfaxhwcgajfg
TOKEN_FILE="$HOME/.supabase/access-token"
if [ ! -s "$TOKEN_FILE" ]; then echo "No Supabase login token found at $TOKEN_FILE"; exit 1; fi
node -e 'process.stdout.write(JSON.stringify({query: require("fs").readFileSync(process.argv[1], "utf8")}))' "$1" \
  | curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer $(cat "$TOKEN_FILE")" \
    -H "Content-Type: application/json" \
    --data-binary @-
echo
echo "Finished running $1"
