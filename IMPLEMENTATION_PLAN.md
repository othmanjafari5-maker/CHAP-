# CHAP missing-feature review and implementation plan

> Historical review: implementation has since been added. See `README.md` for the current features, setup, tests and prototype limitations.

Reviewed against `Smart_Ambulance_Missing_Features.pdf` on 2026-09-28.
This is a repository assessment and proposed implementation, not a record of implemented features. The PDF supplies feature requirements; its proposed direction and thresholds still require engineering decisions. Existing application edits have been preserved.

## Current foundation

| Area | What exists | Main gap |
| --- | --- | --- |
| `backend/server.js` | Express ingestion, PostgreSQL readings, threshold alerts, fleet/latest/history APIs | No readiness, freshness policy, maintenance, safety hold, dispatch, or forecasting |
| `backend/db.js` | PostgreSQL connection pool | No versioned schema/migration files in the repository |
| `frontend/src/App.jsx` | Fleet summary/cards, vehicle readings, five-second polling | Health rules duplicated from backend; availability uses only stored status |
| Map components | Fleet markers, selected vehicle route | Both always claim LIVE; no age-based state |
| `simulator/simulator.js` | Three vehicles, random movement, simulated faults, five-second ingestion | No durable buffering, event timestamps, mileage, fault codes, or labelled failure outcomes |
| `ml/` | Empty placeholder | No dataset, training, validation, or inference |

Telemetry history is already stored. The history API exposes only location, speed, and timestamp, so trends do not need an entirely new storage system. `hospital_name` already provides an initial grouping for coverage. The actual database schema was not inspected; table structure is inferred from SQL in the source.

## Problems to address before adding predictions

1. A vehicle marked `available` remains in the available count even with critical readings. Separate administrative status, mechanical readiness, and dispatch eligibility.
2. An old reading still appears LIVE. Calculate freshness from observation time on the server and let the UI age readings even if polling fails.
3. Missing numeric values can become zero through `Number(null)`. Treat missing/invalid sensor data as unknown, not healthy or a confirmed battery failure.
4. Ingestion does not validate payloads and saves the reading separately from alert changes. Use one database transaction and enforce numeric ranges, vehicle existence, and timestamps.
5. Alerts automatically resolve when readings recover. An inspection hold must persist independently until an authorized, recorded clearance.
6. Route history limits accept negative/fractional values. Validate positive integer limits and date ranges.
7. Map coordinate checks reject legitimate zero coordinates in some paths and turn null into zero in another. Require finite values within geographic ranges, preserving valid zeros.
8. Requests can overlap and late responses can display the previous vehicle's route. Add cancellation and prevent overlapping polling. The simulator also needs caught network errors and a non-overlapping send loop.
9. There are no backend tests or repository database setup instructions. Establish migrations, environment examples without secrets, seed data, and focused tests.

## Implementation sequence

### 1. Reliable telemetry and connection state

Add versioned migrations after checking the existing schema. Extend readings with:

- `event_id`: stable device-generated identifier, unique per ambulance for retry deduplication.
- `recorded_at`: when the device observed the reading.
- `received_at`: when the server received it.
- `odometer_km`, `fault_codes`, and a source indicator such as simulator/device.

Preserve `created_at` for existing clients. Backfill old event times from it while documenting that these are approximate observation times. Add an index on `(ambulance_id, recorded_at DESC)` and use observation time, with a deterministic tie-breaker, to select latest readings.

Expose both `last_seen_at` (server receipt/contact time) and `last_observed_at` (newest measurement time). Receiving buffered old readings proves contact but does not make their measurements fresh. Suggested prototype freshness: LIVE through 15 seconds, DELAYED through 60 seconds, OFFLINE beyond 60 seconds; no reading is UNKNOWN. These are configurable assumptions based on the current five-second simulator cadence.

Reject invalid/far-future timestamps under an explicit clock-skew policy. Late telemetry belongs in history and must not overwrite newer state or resolve a current alert. Critical historical events should remain auditable and can create an inspection hold under the safety policy.

Update the simulator to persist each generated event before attempting upload, retry with backoff, and delete queued events only after acknowledgement. Keep the same event ID across retries. Set a bounded storage policy and visibly report dropped data. Device firmware will need its own persistent queue when hardware replaces the simulator.

**Acceptance:** stopping the simulator changes LIVE to DELAYED to OFFLINE without a new reading; replaying old events does not produce fresh telemetry; retrying an event creates one reading.

### 2. Backend readiness and persistent safety holds

Create pure functions in `backend/services/readiness.js` and `backend/services/connectivity.js`. Use the same output in fleet, latest, dispatch, and coverage APIs. Remove the frontend's independent `analyzeVehicleHealth` decisions.

A proposed prototype score uses component health values from 0–1, multiplied by these weights:

| Component | Weight |
| --- | ---: |
| Fuel | 15 |
| Battery | 20 |
| Engine temperature | 20 |
| Vibration | 15 |
| Fault codes | 15 |
| Service status | 10 |
| Connection freshness | 5 |

Store the rule version and return each component/reason. Existing warning/critical sensor thresholds can seed demo rules, but battery interpretation depends on engine state and vibration requires defined units and sensor placement. These are prototype settings, not validated fleet operating limits.

Suggested complete-data labels: READY at 80–100, WARNING at 60–79, NOT RECOMMENDED FOR DISPATCH below 60. Missing required sensors, unknown service/fault state, or stale data must prevent READY; return an explicit unknown/incomplete result instead of a misleading full score. An empty fault list must mean a successful scan with no faults, rather than a missing scan.

Hard exclusions override the numeric score: critical mechanical readings, serious mapped fault codes, persistent inspection hold, stale/unknown telemetry, maintenance/responding status, or insufficient fuel. Do not allow a high average to hide one critical fault. For an initial conservative demo, only READY vehicles with complete current data are eligible.

Add `safety_holds` with ambulance, triggering event/reason, created time, clearance time, actor, and clearance notes. Critical ingestion creates a hold transactionally. Healthy later readings may resolve the alert but cannot clear the hold. Add a protected clearance endpoint; until authentication and roles exist, do not expose unrestricted clearance writes. Keep stored operational status separate, and expose an effective status of INSPECTION REQUIRED while a hold exists.

**Acceptance:** a hot engine blocks a nearby ambulance even with otherwise good values; a hold survives restart and sensor recovery; unknown sensors never produce READY; responding vehicles never enter the dispatch pool.

### 3. Deterioration charts and maintenance records

Extend `GET /api/ambulances/:id/history` compatibly to include battery, temperature, vibration, RPM, mileage, and faults. Add validated `from`, `to`, `limit`, and optionally aggregation parameters. Return chronological data; bound queries and use aggregation for long ranges rather than loading every five-second sample.

Add a `TelemetryTrends` component with selectable time ranges, units, timestamps, and visible gaps during outages. Plot fault occurrence frequency using distinct events, so a fault repeatedly reported every five seconds is not mistaken for many separate failures. Preserve the existing route view.

Add `maintenance_records`: vehicle, service date, odometer, repair type, fault codes, work performed, next service date/odometer, actual failure outcome, actor, and timestamps. Provide validated history/create/update APIs and a maintenance form. Audit edits; retain outcome labels for model training. Add read-only maintenance history before exposing unprotected modification routes.

**Acceptance:** different vehicles never share chart data; null values appear as gaps; time ranges are bounded; upcoming and overdue service affect readiness consistently.

### 4. Failure-risk model with honest evidence

Begin with an explicitly named rule-based risk estimate or UNKNOWN while collecting data. Do not call a threshold rule an ML prediction, and do not invent failure probabilities.

In `ml/`, add dataset export, reproducible labelled test-data generation, training, evaluation, and a versioned model artifact. Define a target such as a recorded mechanical failure within the next seven days. Features can include temperature exceedance counts, battery slope, vibration trend, RPM context, fault frequency, mileage since service, and time to service.

Generate temporal scenarios with healthy/degrading trajectories and independent future failure outcomes. Label synthetic data and all model output trained on it as DEMO. Random fault injection alone is not a maintenance/failure label.

Split by vehicle/scenario and time to avoid leakage between adjacent readings; build features only from information available at prediction time. Report class balance, confusion matrix, precision, recall, and false negatives against a simple baseline. Do not present synthetic validation as evidence of real fleet accuracy.

Train the PDF's suggested decision tree or random forest offline. Run scoring through a bounded worker/service, rather than training or launching an unbounded process for every API request. Persist risk band, model version, prediction horizon, timestamp, data sufficiency, and explanatory contributing features. If inference is unavailable or outdated, show UNKNOWN and preserve hard safety gates.

**Acceptance:** training is repeatable; holdout vehicles/scenarios are excluded from training; insufficient history produces UNKNOWN; demo outputs are clearly labelled.

### 5. Readiness-based dispatch recommendation

Add `POST /api/dispatch/recommendations` accepting validated incident coordinates. First exclude ineligible vehicles using the common eligibility service. Then rank eligible vehicles using distance, readiness, fuel, and current failure risk; return ranked candidates, reasons, and excluded vehicles with explanations.

Start with straight-line distance and identify it as approximate. Do not present it as driving distance or travel time. Keep ranking weights configurable and return “no suitable vehicle” when appropriate. Recommendation does not itself dispatch a vehicle. A later assignment endpoint should recheck eligibility transactionally to prevent simultaneous assignments.

**Acceptance:** a nearby unsafe vehicle loses to a farther safe vehicle; stale, busy, and held vehicles are excluded; invalid coordinates fail validation; an empty eligible pool produces no recommendation.

### 6. Coverage and fleet availability

Group by existing `hospital_name` initially, with missing assignments shown as unknown. Later normalize hospitals/service areas into IDs with configured minimum coverage. Use the same eligibility decisions as dispatch and avoid double-counting vehicles with several exclusion reasons.

Add `GET /api/fleet/coverage` with total, eligible now, busy, maintenance, inspection hold, stale/unknown, and high-risk counts. Flag below-minimum coverage as critical and at-minimum coverage as vulnerable to one additional loss. Geographic response-time coverage needs actual service boundaries and routing; hospital grouping alone cannot establish it.

Add `GET /api/fleet/availability` for today, three days, and seven days using scheduled maintenance and failure-risk evidence. Distinguish mechanically operational from immediately dispatchable. Without service duration/return dates, shift schedules, and calibrated horizon-specific probabilities, provide transparent scenario estimates rather than precise expected counts. Show assumptions and unknown vehicles. Sum probabilities only once they are calibrated for the corresponding horizon.

**Acceptance:** a hospital with one vehicle in maintenance and another unsafe has no eligible coverage; changing minimum coverage changes the warning; forecasts explain exclusions and uncertainty.

## Proposed shared API fields

Keep existing fleet fields for compatibility and add:

```text
connection: { status, lastSeenAt, lastObservedAt, ageSeconds }
readiness: { score, label, complete, components, reasons, ruleVersion }
safety: { inspectionRequired, holdId, reasons }
risk: { level, source, horizonDays, calculatedAt, modelVersion, reasons }
dispatch: { eligible, exclusionReasons }
```

Use `score: null` for an unknown/incomplete score. Keep receipt timestamps separate from measurement timestamps. Define casing and null handling once in the API contract.

## Suggested code organization

```text
backend/
  migrations/           schema and indexes, reviewed against existing DB
  services/             readiness, freshness, safety, risk, dispatch, coverage
  routes/               readings, fleet, maintenance, dispatch
  test/                 rules, ordering, transactions, API integration
frontend/src/
  components/           readiness badge, connection badge, trends,
                        maintenance form, dispatch and coverage panels
  api/                  shared API URL, cancellation/error handling
ml/                     dataset generation/export, training, evaluation
simulator/              scenarios and durable upload queue
```

Keep Express/PostgreSQL, React, and Leaflet. No framework rewrite is needed. Make the API URL configurable instead of repeating localhost in components. Start with migrations, telemetry correctness, readiness, safety holds, and trends as the first working increment; add maintenance and the labelled demo model next; then dispatch, coverage, and availability.

## Verification performed

- Inspected all application source, package manifests, frontend configuration/styles, simulator, and the empty ML directory.
- Frontend production build passes.
- Frontend lint exits successfully with two existing `set-state-in-effect` warnings, in `App.jsx` and `LiveAmbulanceMap.jsx`.
- No backend test suite is configured. Database schema, live endpoints, browser behavior, and hardware were not verified in this review.
- No application source was changed. This plan is the review deliverable.
