import { useEffect, useState } from "react";

import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap
} from "react-leaflet";

import L from "leaflet";

import "leaflet/dist/leaflet.css";

const ambulanceIcon = L.divIcon({
  className: "ambulance-marker",

  html: `
    <div class="ambulance-marker-inner">
      🚑
    </div>
  `,

  iconSize: [45, 45],

  iconAnchor: [22, 22],

  popupAnchor: [0, -20]
});

function MoveMap({ latitude, longitude }) {

  const map = useMap();

  useEffect(() => {

    if (!latitude || !longitude) return;

    map.panTo(
      [Number(latitude), Number(longitude)],
      {
        animate: true,
        duration: 1
      }
    );

  }, [latitude, longitude, map]);

  return null;
}

function LiveAmbulanceMap({ ambulance }) {

  const [route, setRoute] = useState([]);

  const fetchRoute = async () => {

    try {

      const response = await fetch(
        "http://localhost:5000/api/ambulances/1/history?limit=100"
      );

      if (!response.ok) {
        throw new Error("Failed to load route");
      }

      const data = await response.json();

      const coordinates = data
        .filter(
          (item) =>
            item.latitude &&
            item.longitude
        )
        .map((item) => [
          Number(item.latitude),
          Number(item.longitude)
        ]);

      setRoute(coordinates);

    } catch (error) {

      console.error(
        "Route loading error:",
        error
      );

    }
  };

  useEffect(() => {

    fetchRoute();

    const interval =
      setInterval(fetchRoute, 5000);

    return () =>
      clearInterval(interval);

  }, []);

  if (!ambulance) {

    return (
      <p>
        Waiting for ambulance GPS...
      </p>
    );
  }

  const latitude =
    Number(ambulance.latitude);

  const longitude =
    Number(ambulance.longitude);

  if (
    Number.isNaN(latitude) ||
    Number.isNaN(longitude)
  ) {

    return (
      <p>
        Invalid GPS coordinates.
      </p>
    );
  }

  const position = [
    latitude,
    longitude
  ];

  return (

    <div className="map-section">

      <div className="map-heading">

        <div>

          <h2>
            Live Ambulance Map
          </h2>

          <p>
            Current location and travelled route of{" "}
            {ambulance.ambulance_code}
          </p>

        </div>

        <span className="live-indicator">
          ● LIVE
        </span>

      </div>

      <MapContainer
        center={position}
        zoom={16}
        scrollWheelZoom={true}
        className="ambulance-map"
      >

        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {route.length > 1 && (

          <Polyline
            positions={route}
            weight={5}
          />

        )}

        <Marker
          position={position}
          icon={ambulanceIcon}
        >

          <Popup>

            <strong>
              🚑 {ambulance.ambulance_code}
            </strong>

            <br />

            {ambulance.registration_number}

            <br />
            <br />

            Speed:
            {" "}
            {ambulance.speed}
            {" "}km/h

            <br />

            Status:
            {" "}
            {ambulance.status}

            <br />

            Engine:
            {" "}
            {ambulance.engine_temperature}
            {" "}°C

            <br />

            Fuel:
            {" "}
            {ambulance.fuel_level}
            %

          </Popup>

        </Marker>

        <MoveMap
          latitude={latitude}
          longitude={longitude}
        />

      </MapContainer>

      <div className="gps-details">

        <div>

          <span>
            Latitude
          </span>

          <strong>
            {latitude.toFixed(6)}
          </strong>

        </div>

        <div>

          <span>
            Longitude
          </span>

          <strong>
            {longitude.toFixed(6)}
          </strong>

        </div>

        <div>

          <span>
            Speed
          </span>

          <strong>
            {ambulance.speed} km/h
          </strong>

        </div>

        <div>

          <span>
            Route Points
          </span>

          <strong>
            {route.length}
          </strong>

        </div>

      </div>

    </div>

  );
}

export default LiveAmbulanceMap;
