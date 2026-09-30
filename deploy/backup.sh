#!/bin/sh
set -eu
umask 077
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
mkdir -p backups
backup="backups/wahi-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
# Never expose a partially written archive as a completed backup.
trap 'rm -f "$backup.partial"' EXIT HUP INT TERM
docker compose exec -T db pg_dump -U wahi -d wahi -Fc > "$backup.partial"
docker compose exec -T db pg_restore --list < "$backup.partial" > /dev/null
mv "$backup.partial" "$backup"
printf 'Backup created: %s\n' "$backup"
