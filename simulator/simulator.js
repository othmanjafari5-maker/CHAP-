const API_URL = "http://localhost:5000/api/readings";

let latitude = -6.1630;
let longitude = 35.7516;

let speed = 40;
let rpm = 2000;
let engineTemperature = 85;
let batteryVoltage = 12.6;
let fuelLevel = 75;
let vibration = 1.0;

function randomChange(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

async function sendReading() {
  try {
    // Simulate ambulance movement
    latitude += randomChange(-0.0003, 0.0003);
    longitude += randomChange(-0.0003, 0.0003);

    speed = clamp(speed + randomChange(-5, 5), 0, 100);
    rpm = Math.round(clamp(rpm + randomChange(-200, 200), 700, 4500));

    engineTemperature = clamp(
      engineTemperature + randomChange(-1.5, 1.5),
      70,
      115
    );

    batteryVoltage = clamp(
      batteryVoltage + randomChange(-0.15, 0.15),
      11,
      14.5
    );

    fuelLevel = clamp(
      fuelLevel - randomChange(0.05, 0.2),
      0,
      100
    );

    vibration = clamp(
      vibration + randomChange(-0.2, 0.2),
      0,
      5
    );

    const reading = {
      ambulanceId: 1,
      latitude: Number(latitude.toFixed(7)),
      longitude: Number(longitude.toFixed(7)),
      speed: Number(speed.toFixed(2)),
      rpm,
      engineTemperature: Number(engineTemperature.toFixed(2)),
      batteryVoltage: Number(batteryVoltage.toFixed(2)),
      fuelLevel: Number(fuelLevel.toFixed(2)),
      vibration: Number(vibration.toFixed(3))
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

    console.log("\n🚑 AMB-001 reading sent");
    console.log("-------------------------");
    console.log(`GPS: ${reading.latitude}, ${reading.longitude}`);
    console.log(`Speed: ${reading.speed} km/h`);
    console.log(`RPM: ${reading.rpm}`);
    console.log(`Engine Temp: ${reading.engineTemperature} °C`);
    console.log(`Battery: ${reading.batteryVoltage} V`);
    console.log(`Fuel: ${reading.fuelLevel} %`);
    console.log(`Vibration: ${reading.vibration}`);
  } catch (error) {
    console.error("❌ Cannot connect to Smart Ambulance API");
    console.error(error.message);
  }
}

console.log("🚑 Smart Ambulance Simulator Started");
console.log("Sending data every 5 seconds...");

sendReading();

setInterval(sendReading, 5000);
