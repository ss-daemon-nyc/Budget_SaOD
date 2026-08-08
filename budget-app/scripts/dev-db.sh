#!/usr/bin/env bash
# Start a throwaway local Postgres for the demo and apply the schema.
# Same SQL runs unchanged on Supabase later — only DATABASE_URL changes.
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDATA=${PGDATA:-/var/lib/postgresql/demo}
PORT=${PORT:-5433}
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "==> initialising cluster in $PGDATA"
  mkdir -p "$PGDATA"; chown postgres:postgres "$PGDATA"; chmod 700 "$PGDATA"
  su postgres -s /bin/bash -c "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust" >/dev/null
fi

if ! pg_isready -h /tmp -p "$PORT" -q 2>/dev/null; then
  echo "==> starting postgres on port $PORT"
  su postgres -s /bin/bash -c \
    "$PGBIN/pg_ctl -D $PGDATA -o '-p $PORT -k /tmp' -l $PGDATA/server.log start" >/dev/null
  sleep 2
fi

psql -h /tmp -p "$PORT" -U postgres -tc \
  "select 1 from pg_database where datname='budget'" | grep -q 1 \
  || psql -h /tmp -p "$PORT" -U postgres -qc "create database budget"

echo "==> applying schema"
psql -h /tmp -p "$PORT" -U postgres -d budget -v ON_ERROR_STOP=1 -qf "$HERE/db/001_schema.sql"
echo "==> ready:  postgres://postgres@127.0.0.1:$PORT/budget"
