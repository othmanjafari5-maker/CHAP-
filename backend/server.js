require("dotenv").config();

const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();

app.use(cors());
app.use(express.json());
function analyzeVehicleReading(data) {
  const alerts = [];

  const temperature = Number(data.engineTemperature);
  const battery = Number(data.batteryVoltage);
  const fuel = Number(data.fuelLevel);
  const vibration = Number(data.vibration);

  // ENGINE TEMPERATURE
  if (temperature >= 105) {
    alerts.push({
      type: "ENGINE_TEMPERATURE",
      severity: "CRITICAL",
      message: "Engine temperature is critically high",
      value: temperature
    });
  } else if (temperature >= 95) {
    alerts.push({
      type: "ENGINE_TEMPERATURE",
      severity: "WARNING",
      message: "Engine temperature is higher than normal",
      value: temperature
    });
  }

  // BATTERY
  if (battery <= 11.5) {
    alerts.push({
      type: "BATTERY",
      severity: "CRITICAL",
      message: "Battery voltage is critically low",
      value: battery
    });
  } else if (battery < 12) {
    alerts.push({
      type: "BATTERY",
      severity: "WARNING",
      message: "Battery voltage is low",
      value: battery
    });
  }

  // FUEL
  if (fuel <= 10) {
    alerts.push({
      type: "FUEL",
      severity: "CRITICAL",
      message: "Fuel level is critically low",
      value: fuel
    });
  } else if (fuel <= 20) {
    alerts.push({
      type: "FUEL",
      severity: "WARNING",
      message: "Fuel level is low",
      value: fuel
    });
  }

  // VIBRATION
  if (vibration >= 4) {
    alerts.push({
      type: "VIBRATION",
      severity: "CRITICAL",
      message: "Severe abnormal vibration detected",
      value: vibration
    });
  } else if (vibration >= 2.5) {
    alerts.push({
      type: "VIBRATION",
      severity: "WARNING",
      message: "Abnormal vibration detected",
      value: vibration
    });
  }

  return alerts;
}
async function updateVehicleAlerts(ambulanceId, reading) {
  const currentAlerts = analyzeVehicleReading(reading);

  const activeResult = await pool.query(
    `
    SELECT *
    FROM vehicle_alerts
    WHERE ambulance_id = $1
      AND status = 'ACTIVE'
    `,
    [ambulanceId]
  );

  const existingAlerts = activeResult.rows;

  // CREATE OR UPDATE CURRENT ALERTS
  for (const alert of currentAlerts) {
    const existing = existingAlerts.find(
      (item) => item.alert_type === alert.type
    );

    if (existing) {
      await pool.query(
        `
        UPDATE vehicle_alerts
        SET severity = $1,
            message = $2,
            sensor_value = $3
        WHERE id = $4
        `,
        [
          alert.severity,
          alert.message,
          alert.value,
          existing.id
        ]
      );
    } else {
      await pool.query(
        `
        INSERT INTO vehicle_alerts
        (
          ambulance_id,
          alert_type,
          severity,
          message,
          sensor_value
        )
        VALUES ($1,$2,$3,$4,$5)
        `,
        [
          ambulanceId,
          alert.type,
          alert.severity,
          alert.message,
          alert.value
        ]
      );
    }
  }

  // RESOLVE ALERTS THAT ARE NO LONGER PRESENT
  for (const existing of existingAlerts) {
    const stillActive = currentAlerts.some(
      (alert) => alert.type === existing.alert_type
    );

    if (!stillActive) {
      await pool.query(
        `
        UPDATE vehicle_alerts
        SET status = 'RESOLVED',
            resolved_at = CURRENT_TIMESTAMP
        WHERE id = $1
        `,
        [existing.id]
      );
    }
  }
}
app.get("/", (req, res) => {
  res.json({
    message: "Smart Ambulance API is running"
  });
});

app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.json({
      status: "OK",
      database: "Connected",
      time: result.rows[0].now
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "ERROR",
      database: "Not connected"
    });
  }
});

app.post("/api/readings", async (req, res) => {
  try {
    const {
      ambulanceId,
      latitude,
      longitude,
      speed,
      rpm,
      engineTemperature,
      batteryVoltage,
      fuelLevel,
      vibration
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO vehicle_readings
      (
        ambulance_id,
        latitude,
        longitude,
        speed,
        rpm,
        engine_temperature,
        battery_voltage,
        fuel_level,
        vibration
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
      `,
      [
        ambulanceId,
        latitude,
        longitude,
        speed,
        rpm,
        engineTemperature,
        batteryVoltage,
        fuelLevel,
        vibration
      ]
    );
await updateVehicleAlerts(ambulanceId, {
  engineTemperature,
  batteryVoltage,
  fuelLevel,
  vibration
});
    res.status(201).json({
      message: "Vehicle reading saved successfully",
      reading: result.rows[0]
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to save vehicle reading"
    });
  }
});
app.get("/api/ambulances/:id/history", async (req, res) => {
  try {
    const ambulanceId = req.params.id;

    let limit = Number(req.query.limit) || 100;

    if (limit > 500) {
      limit = 500;
    }

    const result = await pool.query(
      `
      SELECT
        latitude,
        longitude,
        speed,
        created_at
      FROM vehicle_readings
      WHERE ambulance_id = $1
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [ambulanceId, limit]
    );

    // Reverse so oldest coordinate comes first
    res.json(result.rows.reverse());

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to get ambulance route history"
    });
  }
});
const PORT = process.env.PORT || 5000;
app.get("/api/ambulances/:id/latest", async (req, res) => {
  try {
    const ambulanceId = req.params.id;

    const result = await pool.query(
      `
      SELECT
        vr.*,
        a.ambulance_code,
        a.registration_number,
        a.hospital_name,
        a.status
      FROM vehicle_readings vr
      JOIN ambulances a
        ON vr.ambulance_id = a.id
      WHERE vr.ambulance_id = $1
      ORDER BY vr.created_at DESC
      LIMIT 1
      `,
      [ambulanceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "No readings found for this ambulance"
      });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to get latest ambulance reading"
    });
  }
});
app.listen(PORT, () => {
  console.log(`Smart Ambulance server running on port ${PORT}`);
});