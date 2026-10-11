#!/usr/bin/env bash
# Sobe um Postgres descartável, aplica as migrações em ordem e roda os testes SQL do núcleo financeiro.
# Uso: bash supabase/tests/run-local.sh      (precisa dos binários do Postgres 15+; roda como root via usuário postgres)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$(dirname "$HERE")")"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
DATA="$(mktemp -d)"; PORT="${PGPORT:-54329}"
if [ "$(id -u)" = 0 ]; then RUN="su postgres -s /bin/bash -c"; chown postgres "$DATA"; else RUN="bash -c"; fi
cleanup(){ $RUN "$PGBIN/pg_ctl -D $DATA -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$DATA"; }; trap cleanup EXIT
$RUN "$PGBIN/initdb -D $DATA -A trust -U postgres" >/dev/null
$RUN "$PGBIN/pg_ctl -D $DATA -o '-p $PORT -k /tmp -c listen_addresses=' -w start" >/dev/null
PSQL="psql -h /tmp -p $PORT -U postgres -v ON_ERROR_STOP=1 -q -X"
$PSQL -c "create database bc" postgres; PSQL="$PSQL -d bc"
$PSQL -f "$HERE/auth_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do echo ">> $(basename "$f")"; $PSQL -f "$f"; done
if [ -n "${DUMP_FN:-}" ]; then
  $PSQL -At -c "select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') '||md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='core' or (n.nspname='public' and (p.proname like 'my\_%' or p.proname like 'admin\_%')) order by 1" > "$DUMP_FN"
fi
$PSQL -f "$HERE/core.test.sql"
