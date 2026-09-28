import { validGPS } from '../api';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup
} from "react-leaflet";

import L from "leaflet";

import "leaflet/dist/leaflet.css";

function createAmbulanceIcon() {
  return L.divIcon({
    className: "ambulance-marker",

    html: `
      <div class="ambulance-marker-inner">
        ✚
      </div>
    `,

    iconSize: [45, 45],
    iconAnchor: [22, 22]
  });
}

function FleetMap({ ambulances, onSelect }) {

  const validAmbulances = ambulances.filter(
    ambulance =>
      validGPS(ambulance)
  );

  if (validAmbulances.length === 0) {
    return (
      <div className="map-section">
        Waiting for ambulance locations...
      </div>
    );
  }

  const first = validAmbulances[0];

  return (
    <div className="map-section">

      <div className="map-heading">

        <div>
          <h2>Fleet locations</h2>
          <p>
            Latest known positions · check each vehicle’s connection status
          </p>
        </div>

        <span className="live-indicator">
          {ambulances.filter(a => a.connection?.status === "LIVE").length} LIVE / {ambulances.length}
        </span>

      </div>

      <MapContainer
        center={[
          Number(first.latitude),
          Number(first.longitude)
        ]}
        zoom={14}
        className="ambulance-map"
      >

        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {validAmbulances.map(ambulance => (

          <Marker
            key={ambulance.id}

            position={[
              Number(ambulance.latitude),
              Number(ambulance.longitude)
            ]}

            icon={createAmbulanceIcon()}
          >

            <Popup>

              <strong>
                🚑 {ambulance.ambulance_code}
              </strong>

              <br />

              {ambulance.registration_number}

              <br /><br />

              Status: {ambulance.effective_status || ambulance.status}<br />Connection: {ambulance.connection?.status || "UNKNOWN"}

              <br />

              Speed: {ambulance.speed} km/h

              <br />

              Fuel: {ambulance.fuel_level}%

              <br /><br />

              <button
                onClick={() =>
                  onSelect(ambulance.id)
                }
              >
                View Ambulance
              </button>

            </Popup>

          </Marker>

        ))}

      </MapContainer>

    </div>
  );
}

export default FleetMap;
