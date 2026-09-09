require("dotenv").config();

const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();

app.use(cors());
app.use(express.json());

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

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Smart Ambulance server running on port ${PORT}`);
});