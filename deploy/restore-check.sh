#!/bin/sh
# Restores only into a NEW isolated database. It never overwrites the live database.
set -eu
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then printf 'Usage: %s /absolute/path/to/backup.dump\n' "$0" >&2; exit 1; fi
archive=$(realpath "$1")
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
restore_db="wahi_restorecheck_$(date -u +%Y%m%d%H%M%S)_$$"
docker compose exec -T db createdb -U wahi "$restore_db"
printf 'Restoring into isolated database %s (retained for inspection).\n' "$restore_db"
docker compose exec -T db pg_restore -U wahi --exit-on-error --no-owner -d "$restore_db" < "$archive"
docker compose exec -T db psql -U wahi -d "$restore_db" -v ON_ERROR_STOP=1 -c 'SELECT COUNT(*) AS vehicles FROM ambulances; SELECT COUNT(*) AS users FROM app_users; SELECT COUNT(*) AS observations FROM vehicle_readings;'
printf 'Restore verified. Review this database and remove it manually when finished: %s\n' "$restore_db"
