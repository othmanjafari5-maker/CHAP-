# Deploying WAHI

The repository includes a single-host Docker Compose deployment: PostgreSQL, the API, a notification worker, and a Caddy HTTPS/static frontend. Hosting, DNS, an external notification receiver, and operational backup storage still need to be supplied. Container startup and real TLS issuance must be verified on that host; the development machine cannot access its Docker daemon.

## Initial deployment

Use a Linux host with Docker Engine and Compose, a DNS hostname pointing to that host, and inbound TCP 80/443 (UDP 443 is optional). Keep PostgreSQL and the API private: only the web service publishes ports. Choose and pin approved image digests for your release process; the supplied major-version tags receive upstream patch updates.

From the repository root:

```sh
cp deploy/production.env.example .env
mkdir -p secrets
chmod 700 secrets
(umask 077; openssl rand -hex 32 > secrets/db_password.txt)
chmod 444 secrets/db_password.txt
```

Edit `.env` and set `SITE_ADDRESS` to your hostname, without a scheme or path. Keep `.env` private (`chmod 600 .env`). Secrets, local credentials, simulator queues, image documents and dependencies are excluded from image build contexts. The database password is mounted as a Compose secret. The secret file is readable inside the non-root API container; its host directory remains mode 700 to restrict host access. Keep that directory private, since local Compose mounts preserve host file permissions. Optional webhook credentials live in the ignored host `.env`; restrict Docker/host administrator access accordingly.

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose exec api node bootstrap.js
docker compose exec api cat /tmp/.initial-login
```

Retrieve the first administrator's generated password privately and save it in your organization's password manager. `/tmp/.initial-login` is temporary and disappears when the container is recreated. Bootstrap leaves all existing accounts and passwords unchanged. Do not run the demo seed or simulator on a production fleet.

Visit `https://YOUR_HOSTNAME`, sign in, and open Administration. Register vehicles, enroll device keys, create staff accounts, and configure service records. Create **crew** accounts, then schedule shifts and complete readiness checklists under Dispatch. Crew accounts receive a restricted mobile workspace. An active shift and a passed checklist are required for dispatch; the crew must acknowledge a mission before departure. For assignments created before this upgrade, open the incident and use **Confirm current shift crew** after scheduling the shift and checklist.

Health gates wait for the database and API before starting dependent services. Caddy serves the built application and proxies `/api/*`; production uses same-origin API requests. Certificate issuance requires working DNS and reachable ports. See [Compose startup order](https://docs.docker.com/compose/how-tos/startup-order/) and [Caddy routing patterns](https://caddyserver.com/docs/caddyfile/patterns).

## Notifications

The inbox works as soon as the API migration is applied. Operational transactions enqueue notifications for new/severity-changed alerts, dispatch assignment/progression, maintenance jobs, crew acknowledgment/checklists, and escalations. Read state is per user and does **not** acknowledge the underlying vehicle alert. Crew accounts only see their own shifts/missions, not the organization-wide inbox.

Start `npm run worker --prefix backend` for local development; Compose runs it separately in production. Every cycle checks for:

- Critical alerts still unacknowledged after `ALERT_ESCALATION_MINUTES` (default 10).
- Assigned missions still unacknowledged after two minutes.
- Pending or abandoned webhook deliveries.

Configure `NOTIFICATION_WEBHOOK_URL` (HTTPS, without credentials/query strings) and a random `NOTIFICATION_WEBHOOK_SECRET` of at least 32 characters. Restart API and worker after configuration changes. The receiver can bridge events to your approved SMS, email, paging, or messaging provider. WAHI does not yet include a provider-specific SMS/email adapter, and no external service is contacted until configured.

Webhook requests are JSON with `id`, `application`, `kind`, `ambulanceId`, `entityType`, `entityId`, and `createdAt`. Patient descriptions, coordinates, staff notes, and passwords are excluded. The receiver should:

1. Verify `X-WAHI-Signature`, `sha256=` followed by the HMAC-SHA256 of `X-WAHI-Timestamp + '.' + raw request body`, using the shared secret. Reject stale timestamps (for example, beyond five minutes).
2. Deduplicate by `Idempotency-Key` (`wahi-<notification id>`). Delivery is **at least once**; a receiver may see a duplicate after an interrupted delivery.
3. Return a 2xx response after accepting the event. Redirects are refused; requests time out after ten seconds.

Failures retry with exponential delays, up to eight attempts, then appear as failed in Administration. Admins can retry failed entries. A one-minute lease lets another worker recover an interrupted attempt. Without a configured receiver, notifications remain queued; enabling delivery later sends that backlog. Review outstanding items before enabling a receiver on an established database.

Administration shows queue counts, failures and the worker heartbeat. There is no claim of emergency-grade message delivery: use your established dispatch communications if the network or dashboard is unavailable.

## Health and operation

- `GET /api/health`: public database readiness probe, no fleet data.
- `GET /api/system/status`: admin-only database, worker heartbeat and delivery counts.
- Compose API/worker/database health checks; `docker compose ps` and `docker compose logs --tail=100 api worker` for diagnosis.
- `ACCESS_LOG=true`: JSON request ID, route pattern, status and duration; no bodies, tokens or query strings. Docker rotates logs at 10 MB, three files per service.
- SIGTERM stops accepting API requests, closes connections and finishes the worker's current attempt. Migrations are transactionally serialized with an advisory lock.
- CORS uses `UI_ORIGIN`; `TRUST_PROXY=1` is intended only behind the supplied private Caddy proxy. Directly exposed installations must review that setting.
- A remote managed database can use `DB_SSL_CA_FILE` with verified TLS. The supplied PostgreSQL runs on the private Compose network.

Connect these probes/logs to your actual monitoring service and assign responders; health endpoints alone do not page staff. Configure host patches, disk alerts, access controls, and service restart policy in your deployment environment. This stack is a single-host baseline, not high availability.

## Backups and recovery drills

Create a database archive:

```sh
./deploy/backup.sh
```

The script uses `pg_dump -Fc`, checks the archive index, and creates a private timestamped file under `backups/`. It never deletes older backups. Schedule it with your host scheduler, copy archives to encrypted off-host storage, define retention, and monitor job failures. A backup on the same host is insufficient for host loss. Keep infrastructure secrets separately in a password manager.

Test an archive without touching the live database:

```sh
./deploy/restore-check.sh /absolute/path/to/backups/wahi-TIMESTAMP.dump
```

This creates a **new** `wahi_restorecheck_*` database, restores with `--exit-on-error`, and verifies key tables. The database is retained for inspection and must be explicitly removed by an operator after the drill. For disaster recovery, restore to a new database, test using an isolated deployment and then deliberately switch the production connection. Never run a recovery drill's notification worker against a real messaging receiver: restored pending events could be sent again. Revoke restored sessions and rotate device/webhook credentials as appropriate for the incident.

Before application upgrades, back up, review schema changes, test the release against a restored database, then rebuild/recreate the services. Rolling back application images does not undo database changes; rehearse compatible rollback or recovery first.

## Account recovery and reports

Users can change passwords under My account, or request account recovery from the sign-in screen. An administrator verifies identity using the organization's process, then issues a 15-minute, single-use code under Administration. Codes are stored hashed, displayed only on issuance, and must be shared privately. Recovery and password changes revoke existing sessions. Rate limits apply to public recovery endpoints. No recovery email is implied.

Reports provide 50-row cursor pages, date filters and CSV downloads for incidents, maintenance and alerts. Dates use UTC; exports are capped at 10,000 rows and escape spreadsheet formulas. Choose a shorter range for larger datasets. Browser sessions stay in memory and expire after eight hours; refresh requires a new sign-in.

## Release checks

```sh
npm test --prefix backend
node backend/integration-check.js
node backend/experience-check.js
node --test simulator/simulator.test.js
npm run lint --prefix frontend
npm run build --prefix frontend
PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/usr/bin/google-chrome node backend/browser-check.js
```

Integration/browser checks use isolated database schemas and need schema-creation permission. They cover signed delivery and failures using a **local** mock receiver, recovery expiry/reuse, role restrictions, pagination, crew scope, dispatch checks and browser workflows.

For a bounded, read-only load smoke test against an authorized staging instance, export `WAHI_URL`, `WAHI_TOKEN` (a valid session), optional `WAHI_CONCURRENCY` (1–20, default 5), and `WAHI_REQUESTS` (1–1000, default 100), then run `node backend/load-check.js`. It reports failures and p50/p95 response times. This is a smoke test, not a production capacity certification.

Hardware calibration, private road-routing infrastructure, validated real-data prediction models, live hosting, off-host backup jobs and real messaging credentials remain deployment/integration work. The user-selected existing local administrator password has not been changed by this release.
