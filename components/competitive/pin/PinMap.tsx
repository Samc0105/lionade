"use client";

// Leaflet world map for Map Pin Drop. Client-only (Leaflet needs `window`).
// Loaded via next/dynamic with ssr:false from PinScreen. OpenStreetMap tiles
// (free, no key). Tapping the map places/moves the player's pin; after reveal
// we also show the true location + a line between them.

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Default Leaflet marker icons reference image files that don't resolve under
// the Next bundler — define inline divIcons instead so no asset import needed.
const guessIcon = L.divIcon({
  className: "",
  html: `<div style="width:18px;height:18px;border-radius:50%;background:#FFD700;border:2px solid #0a0a14;box-shadow:0 0 8px rgba(255,215,0,0.7)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});
const trueIcon = L.divIcon({
  className: "",
  html: `<div style="width:18px;height:18px;border-radius:50%;background:#50C878;border:2px solid #0a0a14;box-shadow:0 0 8px rgba(80,200,120,0.7)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function ClickHandler({ onPick, disabled }: { onPick: (lat: number, lng: number) => void; disabled: boolean }) {
  useMapEvents({
    click(e) {
      if (disabled) return;
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function PinMap({
  guess,
  truePoint,
  onPick,
  disabled,
}: {
  guess: { lat: number; lng: number } | null;
  truePoint: { lat: number; lng: number } | null;
  onPick: (lat: number, lng: number) => void;
  disabled: boolean;
}) {
  const ref = useRef<L.Map | null>(null);

  // Invalidate size once mounted (container animates in).
  useEffect(() => {
    const t = setTimeout(() => ref.current?.invalidateSize(), 200);
    return () => clearTimeout(t);
  }, []);

  return (
    <MapContainer
      center={[20, 0]}
      zoom={2}
      minZoom={1}
      worldCopyJump
      style={{ height: "100%", width: "100%", background: "#0a0e18" }}
      ref={(m) => { if (m) ref.current = m; }}
    >
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onPick={onPick} disabled={disabled} />
      {guess && <Marker position={[guess.lat, guess.lng]} icon={guessIcon} />}
      {truePoint && <Marker position={[truePoint.lat, truePoint.lng]} icon={trueIcon} />}
      {guess && truePoint && (
        <Polyline positions={[[guess.lat, guess.lng], [truePoint.lat, truePoint.lng]]} pathOptions={{ color: "#EF4444", dashArray: "6 6", weight: 2 }} />
      )}
    </MapContainer>
  );
}
