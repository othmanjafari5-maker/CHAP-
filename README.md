# CHAP — Ambulance operational readiness

React/Leaflet dashboard, Express/PostgreSQL API, authenticated telemetry simulator and advisory ML demonstration. Primary color: white. Secondary color: `#f54242`.

## Start

Use Node 22.12+ and PostgreSQL. In `backend`, install dependencies and configure `.env` from `.env.example` without overwriting existing connection details.

```sh
cd backend
npm install
npm run migrate
npm run seed
node bootstrap.js --simulator
npm start
```

`seed` adds only missing demo vehicles. `bootstrap` creates the first administrator only when no accounts exist. Its generated credentials are saved to ignored `backend/.initial-login` with owner-only permissions, never printed. The `--simulator` flag provisions per-vehicle credentials in ignored `simulator/devices.json`; existing device registrations are retained. Real devices are enrolled through Administration. The old shared `ADMIN_TOKEN` is no longer used.

In another terminal:

```sh
cd frontend
npm install
npm run dev
```

Optional `frontend/.env`: `VITE_API_URL=http://localhost:5000`.

From the repository root:

```sh
node simulator/simulator.js
```

Sign in, record real service schedules for the vehicles, and use the workspaces. Service history is never fabricated for the existing fleet. Sessions expire after eight hours and are held only in browser memory, so refreshing requires signing in again. Use TLS when deployed beyond localhost.

## Workspaces and roles

| Workspace | Function |
| --- | --- |
| Operations | Fleet totals, map, hospital/status/search filters and attention queue |
| Vehicle | Telemetry, trends, journey history, faults, maintenance and activity timeline |
| Maintenance | Job creation, technician assignment, expected completion, job progress, service records and inspection clearance |
| Dispatch | Incident creation, ranked recommendations, atomic vehicle assignment and mission progression |
| Planning | Hospital coverage, configurable coverage points and conservative availability scenarios |
| Alerts | Acknowledgment, in-app supervisor escalation and recent resolved history |
| Administration | Individual accounts, roles, vehicle registration, hospital/status updates and device key rotation/revocation |

- **Admin:** all actions, including account management and coverage configuration.
- **Dispatcher:** incident creation/assignment/progression, recommendations and alert actions.
- **Mechanic:** maintenance jobs, service records, inspection clearance and alert actions.
- **Viewer:** read-only operational information.

Permissions are enforced by the API. Passwords use salted scrypt hashes; session and device tokens are stored hashed. Account changes revoke active sessions. The last active administrator cannot be disabled or demoted. Write attribution comes from the authenticated account, not a submitted operator name.

## Workflow rules

- Assignment locks the incident and vehicle, rechecks readiness, and marks the vehicle responding. A unique active-assignment constraint prevents double assignment.
- Missions follow open → assigned → en route → on scene → transporting/completed. Allowed cancellation paths are explicit. Completion releases the vehicle; existing inspection holds and readiness failures still prevent dispatch.
- Starting a maintenance job marks the vehicle in maintenance and rejects vehicles on a mission. Completion requires a matching service record created since that job opened. Multiple concurrent jobs must finish before the vehicle becomes available. Cancelling an in-progress repair leaves the vehicle in maintenance for explicit administrator review.
- Healthy readings resolve threshold alerts, but do not clear inspection holds. Clearance requires a mechanic/admin, notes, live normal telemetry, a fault scan and a service schedule.
- Alert acknowledgment does not resolve a fault or clear a hold. Escalation records a supervisor-review flag in the inbox; it does not send an email or external notification. A severity change resets acknowledgment.
- Activity history combines persistent audits, telemetry alerts, inspection holds/clearances and service records. Lists show the most recent 200 jobs/incidents or 300 alerts/timeline events.

## Intelligence and integrations

Readiness uses weighted prototype rules with explicit missing-data handling and mechanical exclusions. LIVE is up to 15 seconds, DELAYED up to 60 seconds, then OFFLINE; unknown observations remain UNKNOWN. Event IDs deduplicate retries, late measurements cannot replace newer state, and simulator events persist across restart.

The synthetic model is **advisory only**, including HIGH risk results. It cannot veto or approve dispatch, alter ranking, or reduce forecast availability. Forecasts are conservative scenarios; scheduled repair returns are shown separately and never treated as completed repairs. They are not calibrated failure probabilities or shift forecasts.

Road routing is supported through an optional private OSRM service configured by `ROUTING_URL`. Without it, distances are clearly labelled approximate and road coverage remains unknown. See [hardware and model instructions](HARDWARE_AND_MODEL.md) for enrollment, units, routing, real-data export, candidate training and remaining validation requirements.

## API groups

- `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`
- `/api/users` — account administration
- `/api/ambulances` — fleet reads, registration and updates
- `/api/ambulances/:id/device`, `/device/revoke` — device enrollment/revocation
- `/api/readings` — authenticated per-device ingestion
- `/api/ambulances/:id/latest`, `/history`, `/trends`, `/timeline`
- `/api/ambulances/:id/maintenance`, `/clear-inspection`
- `/api/work-orders`, `/:id`, `/:id/transition`
- `/api/incidents`, `/:id/assign`, `/:id/transition`
- `/api/dispatch/recommendations`
- `/api/alerts`, `/:id/action`
- `/api/fleet/coverage`, `/api/fleet/availability`, `/api/coverage-points`

All operational reads require a user session. Telemetry requires a device key tied to the submitted ambulance ID. `/api/health` exposes only database availability. Hash navigation supports direct vehicle links and browser Back/Forward.

## Checks

```sh
npm test --prefix backend
node backend/integration-check.js
node --test simulator/simulator.test.js
npm run build --prefix frontend
npm run lint --prefix frontend
```

Integration tests create/drop an isolated schema and require schema-creation privileges. They do not modify live fleet rows. Optional browser checks require Playwright and Chromium/Chrome:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/usr/bin/google-chrome node backend/browser-check.js
```

Build the frontend before browser checks. Browser tests also use an isolated schema and exercise actual API workflows. The test intercepts the default localhost:5000 API origin to reach its temporary server.

Migrations are additive; review/back up production data before deployment. Legacy timestamps use the database timezone for backfill. This implementation is informed by publicly documented SCAS IVM concepts, not a copy of its private systems or a connection to NHS services.
