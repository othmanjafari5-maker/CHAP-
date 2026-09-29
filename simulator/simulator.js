const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const API_URL = process.env.API_URL || "http://localhost:5000";
const QUEUE_FILE = process.env.QUEUE_FILE || path.join(__dirname, 'pending-readings.json');
const devices = JSON.parse(fs.readFileSync(process.env.DEVICES_FILE || path.join(__dirname, 'devices.json'), 'utf8'));
let pending = [];
try { pending = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error(`Cannot read durable queue: ${error.message}`); }
function persistQueue() {
  fs.writeFileSync(`${QUEUE_FILE}.tmp`, JSON.stringify(pending));
  fs.renameSync(`${QUEUE_FILE}.tmp`, QUEUE_FILE);
}
async function flushQueue() {
  while (pending.length) {
    const response = await fetch(`${API_URL}/api/readings`, { method: 'POST', headers: {'Content-Type':'application/json', Authorization: `Bearer ${Object.values(devices).find(d => d.id === pending[0].ambulanceId)?.token || ''}`}, body: JSON.stringify(pending[0]), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Upload rejected (${response.status}): ${await response.text()}`);
    pending.shift(); persistQueue();
  }
}

const ambulances = [
  {
    code: "AMB-001",
    id: null,
    latitude: -6.1630,
    longitude: 35.7516,
    speed: 35,
    rpm: 1700,
    engineTemperature: 86,
    batteryVoltage: 12.7,
    fuelLevel: 82,
    vibration: 1.0,
    faultMode: null,
    faultCycles: 0
  },

  {
    code: "AMB-002",
    id: null,
    latitude: -6.1585,
    longitude: 35.7580,
    speed: 48,
    rpm: 2200,
    engineTemperature: 88,
    batteryVoltage: 12.6,
    fuelLevel: 64,
    vibration: 1.1,
    faultMode: null,
    faultCycles: 0
  },

  {
    code: "AMB-003",
    id: null,
    latitude: -6.1690,
    longitude: 35.7440,
    speed: 0,
    rpm: 800,
    engineTemperature: 84,
    batteryVoltage: 12.4,
    fuelLevel: 45,
    vibration: 0.8,
    faultMode: null,
    faultCycles: 0
  }
];

function random(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

async function loadAmbulanceIds() {
  for (const ambulance of ambulances) {
    const device = devices[ambulance.code];
    if (!device?.id || !device?.token) throw new Error(`Missing device credentials for ${ambulance.code}; run backend/bootstrap.js --simulator`);
    ambulance.id = device.id;
  }
}

function simulateFault(ambulance) {
  if (ambulance.faultCycles > 0) {
    ambulance.faultCycles--;
    return;
  }

  ambulance.faultMode = null;

  if (Math.random() < 0.03) {
    const faults = [
      "HIGH_TEMP",
      "LOW_BATTERY",
      "HIGH_VIBRATION"
    ];

    ambulance.faultMode =
      faults[Math.floor(Math.random() * faults.length)];

    ambulance.faultCycles =
      Math.floor(random(3, 8));

    console.log(
      `⚠ ${ambulance.code}: ${ambulance.faultMode}`
    );
  }
}

function updateAmbulance(ambulance) {
  simulateFault(ambulance);

  ambulance.latitude += random(-0.00012, 0.00012);
  ambulance.longitude += random(-0.00012, 0.00012);

  ambulance.speed = clamp(
    ambulance.speed + random(-4, 4),
    0,
    80
  );

  const targetRpm =
    ambulance.speed < 2
      ? 800
      : 900 + ambulance.speed * 30;

  ambulance.rpm = Math.round(
    clamp(
      ambulance.rpm +
        (targetRpm - ambulance.rpm) * 0.3 +
        random(-100, 100),
      750,
      3800
    )
  );

  ambulance.engineTemperature +=
    (88 - ambulance.engineTemperature) * 0.15 +
    random(-0.5, 0.5);

  ambulance.batteryVoltage +=
    (12.7 - ambulance.batteryVoltage) * 0.2 +
    random(-0.04, 0.04);

  ambulance.fuelLevel -= random(0.005, 0.02);

  ambulance.vibration +=
    (1 - ambulance.vibration) * 0.25 +
    random(-0.07, 0.07);

  if (ambulance.faultMode === "HIGH_TEMP") {
    ambulance.engineTemperature += random(3, 5);
  }

  if (ambulance.faultMode === "LOW_BATTERY") {
    ambulance.batteryVoltage -= random(0.2, 0.4);
  }

  if (ambulance.faultMode === "HIGH_VIBRATION") {
    ambulance.vibration += random(0.5, 1);
  }

  ambulance.engineTemperature =
    clamp(ambulance.engineTemperature, 70, 115);

  ambulance.batteryVoltage =
    clamp(ambulance.batteryVoltage, 10.8, 14.4);

  ambulance.fuelLevel =
    clamp(ambulance.fuelLevel, 0, 100);

  ambulance.vibration =
    clamp(ambulance.vibration, 0.2, 5);
}

async function sendAmbulance(ambulance) {
  updateAmbulance(ambulance);

  ambulance.odometerKm = (ambulance.odometerKm || 25000) + ambulance.speed * 5 / 3600;
  const reading = {
    eventId: randomUUID(),
    recordedAt: new Date().toISOString(),
    source: 'simulator',
    odometerKm: Number(ambulance.odometerKm.toFixed(2)),
    faultCodes: ambulance.faultMode === 'HIGH_TEMP' ? ['P0217'] : [],
    ambulanceId: ambulance.id,

    latitude: Number(
      ambulance.latitude.toFixed(7)
    ),

    longitude: Number(
      ambulance.longitude.toFixed(7)
    ),

    speed: Number(
      ambulance.speed.toFixed(2)
    ),

    rpm: ambulance.rpm,

    engineTemperature: Number(
      ambulance.engineTemperature.toFixed(2)
    ),

    batteryVoltage: Number(
      ambulance.batteryVoltage.toFixed(2)
    ),

    fuelLevel: Number(
      ambulance.fuelLevel.toFixed(2)
    ),

    vibration: Number(
      ambulance.vibration.toFixed(3)
    )
  };

  if (pending.length >= 50000) throw new Error('Offline queue full; sampling paused. Restore connectivity before continuing.');
  pending.push(reading);
  persistQueue();

  console.log(
    `🚑 ${ambulance.code} | ` +
    `${reading.speed} km/h | ` +
    `${reading.engineTemperature}°C | ` +
    `${reading.fuelLevel}% fuel`
  );
}

async function runSimulation() {
  let initialized = false;
  while (true) {
    try {
      if (!initialized) { await loadAmbulanceIds(); initialized = true; }
      // Flush first when full so reconnecting can recover without dropping data.
      if (pending.length >= 49997) await flushQueue();
      for (const ambulance of ambulances) await sendAmbulance(ambulance);
      await flushQueue();
    } catch (error) { console.error(`Simulator: ${error.message}. Buffered: ${pending.length}; retrying.`); }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
runSimulation();
