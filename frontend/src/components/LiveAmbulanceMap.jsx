import { API_URL, validGPS } from '../api';
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
      ✚
    </div>
  `,

  iconSize: [45, 45],
  iconAnchor: [22, 22],
  popupAnchor: [0, -20]
});

function MoveMap({ latitude, longitude }) {
  const map = useMap();

  useEffect(() => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

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
  const [routeData, setRouteData] = useState({ id: null, points: [] });
  const route = routeData.id === ambulance?.id ? routeData.points : [];

  useEffect(() => {
    if (!ambulance?.id) return;

    const controller = new AbortController();
    let timer;
    const fetchAmbulanceRoute = async () => {
      try {
        const response = await fetch(
          `${API_URL}/api/ambulances/${ambulance.id}/history?limit=100`, { signal: controller.signal }
        );

        if (!response.ok) {
          throw new Error("Failed to load route");
        }

        const data = await response.json();

        const coordinates = data
          .filter(
            (item) =>
              validGPS(item)
          )
          .map((item) => [
            Number(item.latitude),
            Number(item.longitude)
          ]);

        if (!controller.signal.aborted) setRouteData({ id: ambulance.id, points: coordinates });

      } catch (error) {
        if (error.name !== "AbortError") console.error("Route loading error:", error);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(fetchAmbulanceRoute, 5000);
      }
    };

    fetchAmbulanceRoute();
    return () => { controller.abort(); clearTimeout(timer); };

  }, [ambulance?.id]);

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
    !validGPS(ambulance)
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
            Vehicle location
          </h2>

          <p>
            Latest known position and travelled route of{" "}
            {ambulance.ambulance_code}
          </p>
        </div>

        <span className="live-indicator">
          {ambulance.connection?.status || "UNKNOWN"}
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
            weight={4}
            pathOptions={{ color: "#f54242" }}
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

            Speed:{" "}
            {ambulance.speed} km/h

            <br />

            Status:{" "}
            {ambulance.status}

            <br />

            Engine:{" "}
            {ambulance.engine_temperature} °C

            <br />

            Fuel:{" "}
            {ambulance.fuel_level}%

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