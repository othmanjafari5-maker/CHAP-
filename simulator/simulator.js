const API_URL = "http://localhost:5000/api/readings";

let latitude = -6.1630;
let longitude = 35.7516;

let speed = 35;
let rpm = 1700;
let engineTemperature = 86;
let batteryVoltage = 12.7;
let fuelLevel = 82;
let vibration = 1.0;

let faultMode = null;
let faultCyclesRemaining = 0;

function random(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function maybeStartFault() {
  if (faultCyclesRemaining > 0) {
    faultCyclesRemaining--;
    return;
  }

  faultMode = null;

  // Around 5% chance every reading
  if (Math.random() < 0.05) {
    const faults = [
      "HIGH_TEMP",
      "LOW_BATTERY",
      "HIGH_VIBRATION"
    ];

    faultMode =
      faults[Math.floor(Math.random() * faults.length)];

    faultCyclesRemaining = Math.floor(random(3, 8));

    console.log(`\n⚠ Simulating fault: ${faultMode}`);
  }
}

function updateVehicleData() {
  maybeStartFault();

  // GPS movement
  latitude += random(-0.00012, 0.00012);
  longitude += random(-0.00012, 0.00012);

  // Speed changes gradually
  speed = clamp(
    speed + random(-4, 4),
    0,
    80
  );

  // RPM roughly follows vehicle speed
  const targetRpm =
    speed === 0
      ? 800
      : 900 + speed * 30;

  rpm = Math.round(
    clamp(
      rpm + (targetRpm - rpm) * 0.3 + random(-100, 100),
      750,
      3800
    )
  );

  // Normal engine temp tends toward about 88°C
  engineTemperature +=
    (88 - engineTemperature) * 0.15 +
    random(-0.6, 0.6);

  // Normal battery tends toward about 12.7V
  batteryVoltage +=
    (12.7 - batteryVoltage) * 0.2 +
    random(-0.04, 0.04);

  // Fuel reduces very slowly
  fuelLevel -= random(0.01, 0.04);

  // Normal vibration
  vibration +=
    (1.0 - vibration) * 0.25 +
    random(-0.08, 0.08);

  // Simulated faults
  if (faultMode === "HIGH_TEMP") {
    engineTemperature += random(3, 6);
  }

  if (faultMode === "LOW_BATTERY") {
    batteryVoltage -= random(0.2, 0.4);
  }

  if (faultMode === "HIGH_VIBRATION") {
    vibration += random(0.5, 1.0);
  }

  engineTemperature =
    clamp(engineTemperature, 70, 115);

  batteryVoltage =
    clamp(batteryVoltage, 10.8, 14.4);

  fuelLevel =
    clamp(fuelLevel, 0, 100);

  vibration =
    clamp(vibration, 0.2, 5);
}

async function sendReading() {
  try {
    updateVehicleData();

    const reading = {
      ambulanceId: 1,

      latitude: Number(latitude.toFixed(7)),
      longitude: Number(longitude.toFixed(7)),

      speed: Number(speed.toFixed(2)),
      rpm,

      engineTemperature:
        Number(engineTemperature.toFixed(2)),

      batteryVoltage:
        Number(batteryVoltage.toFixed(2)),

      fuelLevel:
        Number(fuelLevel.toFixed(2)),

      vibration:
        Number(vibration.toFixed(3))
    };

    const response = await fetch(API_URL, {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify(reading)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Server error:", data);
      return;
    }

    console.log("\n🚑 AMB-001");
    console.log("-----------------------------");

    console.log(
      `GPS: ${reading.latitude}, ${reading.longitude}`
    );

    console.log(
      `Speed: ${reading.speed} km/h`
    );

    console.log(
      `RPM: ${reading.rpm}`
    );

    console.log(
      `Engine Temp: ${reading.engineTemperature} °C`
    );

    console.log(
      `Battery: ${reading.batteryVoltage} V`
    );

    console.log(
      `Fuel: ${reading.fuelLevel}%`
    );

    console.log(
      `Vibration: ${reading.vibration}`
    );

    console.log(
      `Mode: ${faultMode ?? "NORMAL"}`
    );

  } catch (error) {

    console.error(
      "❌ Cannot connect to Smart Ambulance API"
    );

    console.error(error.message);
  }
}

console.log(
  "🚑 Smart Ambulance Simulator Started"
);

console.log(
  "Sending realistic data every 5 seconds..."
);

sendReading();

setInterval(sendReading, 5000);
