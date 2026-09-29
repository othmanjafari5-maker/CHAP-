# Hardware, routing and real-data validation

These integrations distinguish what the code supports from what needs external evidence or infrastructure.

## Enroll a device

An administrator selects a vehicle in Administration, issues a device key, and copies it to the device's secure configuration. Keys are tied to one vehicle, stored hashed on the server, and can be rotated or revoked. Rotation immediately invalidates the old key. No shared operator token is accepted for telemetry.

Send `POST /api/readings` with `Authorization: Bearer DEVICE_KEY` and JSON:

```json
{
  "ambulanceId": 1,
  "eventId": "stable-unique-event-id",
  "recordedAt": "2026-09-29T09:00:00.000Z",
  "source": "device",
  "latitude": -6.163,
  "longitude": 35.7516,
  "speed": 0,
  "rpm": 800,
  "engineTemperature": 86,
  "batteryVoltage": 12.7,
  "fuelLevel": 80,
  "vibration": 1,
  "odometerKm": 25000,
  "faultCodes": []
}
```

Use the actual observation timestamp, not the example date. Units: latitude/longitude degrees, speed km/h, engine temperature °C, battery V, fuel percentage, odometer km. Vibration remains a prototype sensor-specific value: its units, mount orientation, sample window and calibration must be established with the actual hardware before applying the current thresholds. Empty fault codes indicate a completed diagnostic scan, not unavailable data.

Persist events before upload. On retry keep event ID, original timestamp and sensor values unchanged. Remove a queued event only after a successful acknowledgement. Distinguish connectivity errors from validation errors: a permanently invalid event needs local operator review instead of infinite retries. Never put a key in URLs or telemetry payloads. For deployed devices use TLS and a trustworthy clock.

The bundled simulator demonstrates durable buffering, authentication and replay. Physical sensor drivers, hardware clock synchronization and calibration cannot be verified without a device. Existing thresholds are prototype rules, not fleet-specific calibration certificates.

## Road routing

Set `ROUTING_URL` in `backend/.env` to a private OSRM-compatible service containing road data for the operating area. Restart the backend. Its table service must return distance (metres) and duration (seconds):

https://project-osrm.org/docs/v5.22.0/api/#table-service

The application never sends operational coordinates to a public demonstration routing server. If the configured service fails or is absent, dispatch explicitly falls back to straight-line distances. Point-based coverage remains UNKNOWN without road travel times. Add named locations and target minutes in Planning. They test selected locations; they do not prove continuous coverage of every point in a district. Estimates exclude live traffic and emergency-driving adjustments.

## Real model development

Synthetic predictions are advisory only. They do not change dispatch eligibility, ranking, inspection holds or fleet forecasts. Mechanical rules, service status, freshness, inspection holds and current mission status govern eligibility.

Export historical device windows locally:

```sh
node ml/export.js /tmp/chap-review-windows.csv
```

This exports the last 90 days of device-source windows whose seven-day outcome period has elapsed. Simulator rows are excluded. The six features use only observations available at each prediction timestamp, matching the existing inference feature function. CSV output intentionally has blank `failure_within_7_days`, `verified_through` and `outcome_verified` columns. A reviewer must confirm outcomes from real maintenance/failure records and follow-up. Absence of a failure record alone must not be labelled a verified negative.

Train a separate research candidate:

```sh
python3 ml/train_real.py /tmp/chap-review-windows.csv --output /tmp/chap-candidate.json
```

Required reviewed labels: `failure_within_7_days` is 0 or 1; `outcome_verified` is `yes`; `verified_through` covers the complete following seven days. Timestamps must include timezones. The pipeline requires at least 100 reviewed windows across five vehicles, then enforces disjoint training/test vehicles, a chronological cutoff, a seven-day label gap and examples of both outcomes in each split. It fails explicitly if evidence is insufficient.

Candidate output includes confusion counts, precision, recall, accuracy and an always-healthy baseline. It cannot overwrite `ml/model.json` and is never automatically loaded into dispatch. Prospective validation, representative fleet data, calibration and domain approval are still required before any operational use. No real-data accuracy claim has been established by the current implementation.
