#!/usr/bin/env bash
# Прохід по основних ендпоінтах. Потрібні запущені API і воркер (і сід: npm run seed).
# Використання: scripts/smoke.sh [BASE_URL]   (типово http://localhost:3000; з docker compose: http://localhost:8080)
set -euo pipefail
BASE="${1:-http://localhost:3000}"
PASS=0
FAIL=0

check() { # назва, очікуваний код, фактичний код
  if [ "$2" = "$3" ]; then PASS=$((PASS + 1)); echo "  ok   $1 -> $3"; else FAIL=$((FAIL + 1)); echo "  FAIL $1 -> $3 (очікував $2)"; fi
}
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
json() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

echo "== foundation"
check "GET /health" 200 "$(code "$BASE/health")"
check "GET /openapi.json" 200 "$(code "$BASE/openapi.json")"
check "GET /reference (Scalar)" 200 "$(code "$BASE/reference")"
check "GET /queues (Bull Board)" 200 "$(code "$BASE/queues")"
check "GET /demo/live" 200 "$(code "$BASE/demo/live")"
check "GET /nope -> 404 JSON" 404 "$(code "$BASE/nope")"
RID=$(curl -s -D - -o /dev/null "$BASE/health" -H 'X-Request-Id: smoke-1' | tr -d '\r' | awk -F': ' 'tolower($1)=="x-request-id"{print $2}')
check "X-Request-Id echoed" smoke-1 "$RID"

echo "== auth"
LOGIN=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d '{"email":"admin@devhub.local","password":"password123"}')
TOKEN=$(echo "$LOGIN" | json "d['tokens']['accessToken']")
REFRESH=$(echo "$LOGIN" | json "d['tokens']['refreshToken']")
ADMIN_ID=$(echo "$LOGIN" | json "d['user']['id']")
AUTH=(-H "Authorization: Bearer $TOKEN")
check "GET /auth/me" 200 "$(code "$BASE/auth/me" "${AUTH[@]}")"
check "GET /auth/me без токена" 401 "$(code "$BASE/auth/me")"
NEW=$(curl -s -X POST "$BASE/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}")
check "POST /auth/refresh" 200 "$(echo "$NEW" | json "200 if 'accessToken' in d else 0")"
check "повторний refresh старим токеном" 401 "$(code -X POST "$BASE/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}")"

echo "== posts"
POST=$(curl -s -X POST "$BASE/posts" "${AUTH[@]}" -H 'Content-Type: application/json' -d '{"title":"Smoke post","body":"про postgres і redis","tags":["smoke"],"likes":"42","meta":{"seo":{"title":"seo"}}}')
POST_ID=$(echo "$POST" | json "d['id']")
check "POST /posts (likes '42' -> 42)" 42 "$(echo "$POST" | json "d['likes']")"
check "POST /posts невідоме поле" 400 "$(code -X POST "$BASE/posts" "${AUTH[@]}" -H 'Content-Type: application/json' -d '{"title":"abc","body":"x","hack":1}')"
check "GET /posts offset" 200 "$(code "$BASE/posts?page=1&pageSize=5&sort=likes&dir=desc")"
check "GET /posts cursor" 200 "$(code "$BASE/posts?mode=cursor&pageSize=5")"
check "GET /posts filters" 200 "$(code "$BASE/posts?q=postgres&tags=smoke&status=draft")"
check "GET /posts/:id/stats MISS" MISS "$(curl -s -D - -o /dev/null "$BASE/posts/$POST_ID/stats" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-cache"{print $2}')"
check "GET /posts/:id/stats HIT" HIT "$(curl -s -D - -o /dev/null "$BASE/posts/$POST_ID/stats" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-cache"{print $2}')"
check "POST /posts/:id/publish" 201 "$(code -X POST "$BASE/posts/$POST_ID/publish" "${AUTH[@]}")"
check "POST /posts/:id/publish повторно" 409 "$(code -X POST "$BASE/posts/$POST_ID/publish" "${AUTH[@]}")"
check "POST /posts/:id/moderate" 201 "$(code -X POST "$BASE/posts/$POST_ID/moderate" "${AUTH[@]}")"
check "DELETE /posts/:id" 204 "$(code -X DELETE "$BASE/posts/$POST_ID" "${AUTH[@]}")"
check "GET видаленого" 404 "$(code "$BASE/posts/$POST_ID")"
check "POST /posts/:id/restore" 201 "$(code -X POST "$BASE/posts/$POST_ID/restore" "${AUTH[@]}")"
SIMILAR=$(code "$BASE/posts/similar?q=postgres")
check "GET /posts/similar (200 з pgvector, 422 без)" "$SIMILAR" "$( [ "$SIMILAR" = 200 ] || [ "$SIMILAR" = 422 ] && echo "$SIMILAR" )"

echo "== queries"
check "GET /reports/posts-per-day" 200 "$(code "$BASE/reports/posts-per-day?days=60")"
echo "  N+1 naive queries: $(curl -s "$BASE/demo/n-plus-one?fixed=false" | json "d['queryCount']"), fixed: $(curl -s "$BASE/demo/n-plus-one?fixed=true" | json "d['queryCount']")"
echo "  EXPLAIN no index: $(curl -s "$BASE/demo/explain?indexed=false" | json "str(d['nodeType'])+' '+str(d['executionTimeMs'])+'ms'"), with index: $(curl -s "$BASE/demo/explain?indexed=true" | json "str(d['nodeType'])+' '+str(d['executionTimeMs'])+'ms'")"

echo "== pool"
check "GET /demo/pool/stats" 200 "$(code "$BASE/demo/pool/stats")"
echo "  slow n=12 seconds=1: $(curl -s "$BASE/demo/pool/slow?seconds=1&n=12" | json "'wall '+str(d['wallClockMs'])+'ms, request 12 waited '+str(d['timings'][11]['waitedForConnectionMs'])+'ms'")"

echo "== credits"
check "POST /credits/topup (admin)" 201 "$(code -X POST "$BASE/credits/topup" "${AUTH[@]}" -H 'Content-Type: application/json' -d "{\"userId\":\"$ADMIN_ID\",\"amount\":30}")"
RES=$(curl -s -X POST "$BASE/credits/reserve" "${AUTH[@]}" -H 'Content-Type: application/json' -d '{"amount":10}')
RES_ID=$(echo "$RES" | json "d['id']")
check "POST /credits/reserve" reserved "$(echo "$RES" | json "d['status']")"
check "POST /credits/reservations/:id/release" 201 "$(code -X POST "$BASE/credits/reservations/$RES_ID/release" "${AUTH[@]}")"
check "GET /credits/me" 200 "$(code "$BASE/credits/me" "${AUTH[@]}")"

echo "== ratelimit"
check "GET /demo/throttled" 200 "$(code "$BASE/demo/throttled")"

echo "== jobs"
REP=$(curl -s -X POST "$BASE/reports" "${AUTH[@]}" -H 'Content-Type: application/json' -d '{}')
REP_ID=$(echo "$REP" | json "d['id']")
check "POST /reports -> 202 queued" queued "$(echo "$REP" | json "d['status']")"
check "GET /reports/queue-stats" 200 "$(code "$BASE/reports/queue-stats")"
check "POST /events" 202 "$(code -X POST "$BASE/events" "${AUTH[@]}" -H 'Content-Type: application/json' -d '{"type":"smoke","payload":{"a":1}}')"
echo "  SSE: $(timeout 15 curl -s -N "$BASE/reports/$REP_ID/events" "${AUTH[@]}" | grep -c '^data:') повідомлень"
check "GET /reports/:id completed" completed "$(curl -s "$BASE/reports/$REP_ID" "${AUTH[@]}" | json "d['status']")"

echo "== github (справжній api.github.com; без мережі буде 502)"
GH=$(code -X POST "$BASE/github/import" "${AUTH[@]}" -H 'Content-Type: application/json' -d '{"username":"octocat"}')
echo "  POST /github/import -> $GH"

echo
echo "Пройшло: $PASS, впало: $FAIL"
[ "$FAIL" -eq 0 ]
