import { useEffect, useState } from "react";
import LiveAmbulanceMap from "./components/LiveAmbulanceMap";
import "./App.css";

function App() {
  const [ambulance, setAmbulance] = useState(null);
  const [error, setError] = useState("");

  const fetchAmbulance = async () => {
    try {
      const response = await fetch(
        "http://localhost:5000/api/ambulances/1/latest"
      );

      if (!response.ok) {
        throw new Error("Unable to get ambulance data");
      }

      const data = await response.json();

      setAmbulance(data);
      setError("");
    } catch (err) {
      console.error(err);
      setError("Cannot connect to Smart Ambulance backend");
    }
  };

  useEffect(() => {
    fetchAmbulance();

    const interval = setInterval(fetchAmbulance, 5000);

    return () => clearInterval(interval);
  }, []);

  // Prototype rule-based vehicle health analysis
  const analyzeVehicleHealth = (data) => {
    if (!data) {
      return {
        status: "UNKNOWN",
        level: "unknown",
        alerts: []
      };
    }

    const temperature = Number(data.engine_temperature);
    const battery = Number(data.battery_voltage);
    const fuel = Number(data.fuel_level);
    const vibration = Number(data.vibration);

    const alerts = [];
    let criticalCount = 0;
    let warningCount = 0;

    // Engine temperature
    if (temperature >= 105) {
      alerts.push({
        type: "critical",
        message: "Engine temperature is critically high"
      });
      criticalCount++;
    } else if (temperature >= 95) {
      alerts.push({
        type: "warning",
        message: "Engine temperature is higher than normal"
      });
      warningCount++;
    }

    // Battery
    if (battery <= 11.5) {
      alerts.push({
        type: "critical",
        message: "Battery voltage is critically low"
      });
      criticalCount++;
    } else if (battery < 12.0) {
      alerts.push({
        type: "warning",
        message: "Battery voltage is low"
      });
      warningCount++;
    }

    // Fuel
    if (fuel <= 10) {
      alerts.push({
        type: "critical",
        message: "Fuel level is critically low"
      });
      criticalCount++;
    } else if (fuel <= 20) {
      alerts.push({
        type: "warning",
        message: "Fuel level is low"
      });
      warningCount++;
    }

    // Vibration
    if (vibration >= 4) {
      alerts.push({
        type: "critical",
        message: "Severe abnormal vibration detected"
      });
      criticalCount++;
    } else if (vibration >= 2.5) {
      alerts.push({
        type: "warning",
        message: "Abnormal vibration detected"
      });
      warningCount++;
    }

    if (criticalCount > 0) {
      return {
        status: "CRITICAL",
        level: "critical",
        alerts
      };
    }

    if (warningCount > 0) {
      return {
        status: "WARNING",
        level: "warning",
        alerts
      };
    }

    return {
      status: "NORMAL",
      level: "normal",
      alerts: []
    };
  };

  if (error) {
    return (
      <div className="container">
        <h1>Smart Ambulance Control Center</h1>
        <p className="error">{error}</p>
      </div>
    );
  }

  if (!ambulance) {
    return (
      <div className="container">
        <h1> Smart Ambulance Control Center</h1>
        <p>Loading ambulance data...</p>
      </div>
    );
  }

  const vehicleHealth = analyzeVehicleHealth(ambulance);

  return (
    <div className="container">

      <h1>Smart Ambulance Control Center</h1>

      <div className="ambulance-card">

        <div className="header">

          <div>
            <h2>{ambulance.ambulance_code}</h2>
            <p>{ambulance.registration_number}</p>
          </div>

          <span className="status">
            {ambulance.status}
          </span>

        </div>

        <p>
          <strong>Hospital:</strong>{" "}
          {ambulance.hospital_name}
        </p>

        {/* VEHICLE HEALTH */}

        <div className={`health-box ${vehicleHealth.level}`}>

          <div>
            <span className="health-label">
              Vehicle Health
            </span>

            <h2>
              {vehicleHealth.status === "NORMAL" && "🟢 "}
              {vehicleHealth.status === "WARNING" && "🟡 "}
              {vehicleHealth.status === "CRITICAL" && "🔴 "}

              {vehicleHealth.status}
            </h2>
          </div>

          <div className="health-description">
            {vehicleHealth.status === "NORMAL" &&
              "All monitored vehicle conditions are within the prototype normal range."}

            {vehicleHealth.status === "WARNING" &&
              "One or more vehicle readings require attention."}

            {vehicleHealth.status === "CRITICAL" &&
              "Immediate vehicle inspection may be required."}
          </div>

        </div>

        {/* SENSOR DATA */}

        <div className="data-grid">

          <div className="data-card">
            <h3> Location</h3>
            <p className="small-data">
              Lat: {ambulance.latitude}
            </p>
            <p className="small-data">
              Long: {ambulance.longitude}
            </p>
          </div>

          <div className="data-card">
            <h3> Speed</h3>
            <p>{ambulance.speed} km/h</p>
          </div>

          <div className="data-card">
            <h3> RPM</h3>
            <p>{ambulance.rpm}</p>
          </div>

          <div className="data-card">
            <h3> Engine Temperature</h3>
            <p>{ambulance.engine_temperature} °C</p>
          </div>

          <div className="data-card">
            <h3> Battery</h3>
            <p>{ambulance.battery_voltage} V</p>
          </div>

          <div className="data-card">
            <h3> Fuel</h3>
            <p>{ambulance.fuel_level}%</p>
          </div>

          <div className="data-card">
            <h3>📳 Vibration</h3>
            <p>{ambulance.vibration}</p>
          </div>

        </div>
<LiveAmbulanceMap ambulance={ambulance} />
        {/* ALERTS */}

        <div className="alerts-section">

          <h2>Vehicle Alerts</h2>

          {vehicleHealth.alerts.length === 0 ? (
            <div className="no-alert">
              ✅ No abnormal vehicle conditions detected.
            </div>
          ) : (
            vehicleHealth.alerts.map((alert, index) => (
              <div
                key={index}
                className={`alert ${alert.type}`}
              >
                {alert.type === "critical" ? "🚨" : "⚠️"}{" "}
                {alert.message}
              </div>
            ))
          )}

        </div>

        <p className="updated">
          Last Update:{" "}
          {new Date(ambulance.created_at).toLocaleString()}
        </p>

      </div>

    </div>
  );
}

export default App;
