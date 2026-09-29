# CHAP — Ambulance operational readiness

React/Leaflet dashboard, Express/PostgreSQL API, persistent telemetry simulator and a reproducible decision-tree demo. White is the primary UI color; `#f54242` is the secondary color.

## Run

1. Create a PostgreSQL database. Copy `backend/.env.example` to `backend/.env` and set its connection details. Set a long random `ADMIN_TOKEN` for maintenance and inspection actions. Existing `.env` files are not overwritten.
2. In `backend`, run `npm install`, `npm run migrate`, and `npm run seed` if you need the three demo vehicles. Existing vehicles are retained. Run `npm start` (default port 5000). Startup also applies the idempotent additive schema.
3. In `frontend`, run `npm install` and `npm run dev`. Optionally set `VITE_API_URL` using `.env.example`.
4. From the repository root, run `node simulator/simulator.js`. It looks up AMB-001 through AMB-003 in the database.
5. Select a vehicle and add a completed maintenance record with its next service date, operator name and backend operator token. No maintenance history is fabricated for existing vehicles. Missing service schedules and missing fault scans intentionally prevent READY status.

Use Node 22.12 or newer for the current Vite toolchain. Use Python 3 to regenerate the included ML artifact with `python3 ml/train.py`, then restart the backend to load it.

## Implemented features

- Weighted 0–100 readiness, reasons and common backend dispatch eligibility rules.
- LIVE (up to 15 seconds), DELAYED (up to 60 seconds), OFFLINE and UNKNOWN states based on observation time. Last receipt is shown separately. Dashboard connection states age even if requests fail.
- Persistent inspection holds for critical readings and reported fault codes. Normal readings do not clear a hold. Operator-token authorization and inspection notes are required for clearance.
- Historical battery, temperature, vibration, RPM and new fault-occurrence charts; all selected-period samples aggregated into approximately 120 buckets, with missing buckets shown as gaps.
- Append-only maintenance records, next service date/mileage, failure labels and operator attribution.
- Synthetic-data decision tree with held-out evaluation and explicit DEMO labels. Insufficient history shows UNKNOWN. Requires at least 12 valid samples spanning one minute.
- Readiness-first dispatch ranking with exclusions and straight-line distance. This recommends vehicles; it does not assign or dispatch them.
- Hospital-level coverage with configurable minimums, and today/3-day/7-day conservative availability scenarios.
- Durable simulator queue with stable event IDs, retry deduplication and original observation timestamps. Failed uploads remain on disk. At capacity, sampling pauses instead of silently dropping data.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Database connectivity |
| POST | `/api/readings` | Validated, transactional telemetry ingestion |
| GET | `/api/ambulances` | Fleet with readiness, freshness, risk and safety |
| GET | `/api/ambulances/:id/latest` | Vehicle intelligence |
| GET | `/api/ambulances/:id/trends?hours=24` | Aggregated sensor trends and new fault occurrences |
| GET | `/api/ambulances/:id/history?from=...&to=...&limit=...` | Chronological telemetry, max 31-day range and 2,000 rows |
| GET / POST | `/api/ambulances/:id/maintenance` | Read / append service records |
| POST | `/api/ambulances/:id/clear-inspection` | Audited clearance |
| POST | `/api/dispatch/recommendations` | Rank for `{latitude, longitude}` |
| GET / PUT | `/api/fleet/coverage` | Coverage / set `{hospital, minimum}` |
| GET | `/api/fleet/availability` | Scenario forecasts |

Maintenance writes, clearance and coverage configuration require `Authorization: Bearer <ADMIN_TOKEN>`. The dashboard keeps this token only in component memory. This is prototype operator authentication, not a multi-user identity system. Deployments need TLS, individual identities and device authentication before exposing ingestion publicly.

Telemetry accepts existing sensor fields plus `eventId`, `recordedAt`, `odometerKm`, `faultCodes` and `source`. Legacy payloads are accepted but absent fault scans remain unknown. `faultCodes: []` means a completed scan with no faults. Ingestion rejects invalid numbers and timestamps more than 30 seconds ahead. Old uploads cannot replace current readings or resolve newer alerts. A historical critical event may still create an inspection hold.

## Model and operational assumptions

`ml/train.py` generates 600 independent synthetic vehicle scenarios, trains a small decision tree on 450 and evaluates on 150. `ml/evaluation.json` includes confusion counts, precision, recall and an always-healthy baseline. `ml/synthetic_dataset.csv` identifies every scenario. Outcomes are simulated future failures driven by hidden wear; they are not real maintenance labels.

The artifact is a demonstration of the prediction pipeline. Its uncalibrated risk bands are not real fleet probabilities. Real training needs longitudinal telemetry joined to subsequent recorded failures, vehicle/time-separated validation and calibration. Existing maintenance records capture future labels for that work. Battery/temperature/vibration thresholds and score weights are prototype assumptions; vibration units depend on hardware. All reported fault codes conservatively require inspection until a vehicle-specific severity mapping exists.

Availability assumes current status persists and excludes service due by each horizon; it does not estimate return-to-service times or shift changes. Unknown risk is displayed separately and does not itself block a vehicle that passes all current readiness checks. Hospital grouping is a coverage proxy, not a geographic travel-time analysis. Fault charts count codes newly appearing relative to the previous known scan; an unknown initial scan is not treated as a new fault.

## Verify

```sh
cd backend
npm test
node integration-check.js
node --test ../simulator/simulator.test.js
```

The integration check creates and drops its own temporary schema in the configured database. It needs schema-creation permission and does not modify production fleet rows.

```sh
cd frontend
npm run build
npm run lint
```

Database migrations are additive and preserve existing readings. Legacy timestamp-without-time-zone observations use the database's configured timezone during backfill; confirm that timezone matches the original installation before migrating another deployment. Back up an existing deployment before a production migration.

## Dashboard workspaces

- **Operations:** fleet totals, search and hospital filters, map and attention queue. Select a vehicle to investigate it.
- **Vehicle:** a selected-vehicle workspace with Telemetry, Trends, Journey history, Faults and Maintenance tabs.
- **Maintenance:** a prioritized worklist for inspection holds, overdue service, missing schedules and upcoming service, with access to recorded repairs and clearance actions.
- **Dispatch:** incident coordinates, eligible candidates, exclusion reasons and links to review vehicle evidence. Coordinates remain in memory when switching workspaces.
- **Planning:** hospital coverage minimums and availability scenarios.

Hash navigation supports direct links (for example `#vehicle/1/trends`) and browser Back/Forward. The interface retains the white and `#f54242` palette. These are CHAP workspace designs informed by SCAS's publicly documented IVM approach, not a reproduction of its private interface.
