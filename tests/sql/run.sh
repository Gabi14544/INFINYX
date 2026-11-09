#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# Uses only a LOCAL isolated container, never a remote database or existing project.
container="infinyx-sql-test-${RANDOM}-${RANDOM}"
docker --host=unix:///var/run/docker.sock run --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine >/dev/null
trap 'docker --host=unix:///var/run/docker.sock rm -f "$container" >/dev/null' EXIT
for attempt in {1..30}; do
  if docker --host=unix:///var/run/docker.sock exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
run_sql() { docker --host=unix:///var/run/docker.sock exec -i "$container" psql -X -q -U postgres -v ON_ERROR_STOP=1 < "$1"; }
run_sql tests/sql/bootstrap.sql
mapfile -t migrations < <(printf '%s\n' supabase/migrations/*.sql | sort -t_ -k1,1)
for migration in "${migrations[@]}"; do run_sql "$migration"; done
run_sql tests/sql/security.sql
