"use client";

// OpenStreetMap through Leaflet: no API key, and tiles are small enough for a
// patchy mobile connection. Leaflet touches `window`, so it is loaded only in
// the browser, inside an effect.

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";

export interface LatLng {
  lat: number;
  lng: number;
}

type LeafletModule = typeof import("leaflet");

/** Leaflet ships ESM and UMD builds; accept either shape. */
async function loadLeaflet(): Promise<LeafletModule> {
  const mod = (await import("leaflet")) as LeafletModule & { default?: LeafletModule };
  return mod.default ?? mod;
}

const PIN_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 44" width="34" height="44" aria-hidden="true">
  <path d="M17 1C8.2 1 1 8 1 16.7 1 28.5 17 43 17 43s16-14.5 16-26.3C33 8 25.8 1 17 1Z" fill="#0d4d2c" stroke="#fff" stroke-width="2"/>
  <circle cx="17" cy="16.5" r="6" fill="#fff"/>
</svg>`;

export function MapView({
  center,
  pin,
  zoom = 16,
  height = 220,
  interactive = true,
  onPick,
  label,
}: {
  center: LatLng;
  pin?: LatLng | null;
  zoom?: number;
  height?: number;
  interactive?: boolean;
  /** When set, tapping the map or dragging the pin moves it. */
  onPick?: (point: LatLng) => void;
  label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const pickRef = useRef(onPick);
  const [failed, setFailed] = useState(false);
  pickRef.current = onPick;

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const L = await loadLeaflet();
        if (cancelled || !host.current || map.current) return;
        const instance = L.map(host.current, {
          center: [center.lat, center.lng],
          zoom,
          zoomControl: interactive,
          dragging: interactive,
          scrollWheelZoom: false,
          touchZoom: interactive,
          doubleClickZoom: interactive,
          boxZoom: false,
          keyboard: interactive,
          attributionControl: true,
        });
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(instance);
        instance.on("click", (e) => {
          if (pickRef.current) pickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
        });
        map.current = instance;
        placeMarker(L, pin ?? null);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
    // The map is created once; later prop changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function placeMarker(L: LeafletModule, point: LatLng | null) {
    const instance = map.current;
    if (!instance) return;
    if (!point) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      const icon = L.divIcon({ html: PIN_SVG, className: "map-pin", iconSize: [34, 44], iconAnchor: [17, 43] });
      marker.current = L.marker([point.lat, point.lng], { icon, draggable: Boolean(pickRef.current), keyboard: false }).addTo(instance);
      marker.current.on("dragend", () => {
        const at = marker.current?.getLatLng();
        if (at && pickRef.current) pickRef.current({ lat: at.lat, lng: at.lng });
      });
    } else {
      marker.current.setLatLng([point.lat, point.lng]);
    }
  }

  // Follow pin and centre changes.
  useEffect(() => {
    (async () => {
      if (!map.current) return;
      const L = await loadLeaflet();
      placeMarker(L, pin ?? null);
      map.current.setView([center.lat, center.lng], map.current.getZoom(), { animate: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin?.lat, pin?.lng, center.lat, center.lng]);

  return (
    <div className="map" style={{ "--map-h": `${height}px` } as React.CSSProperties} role="region" aria-label={label}>
      <div ref={host} style={{ width: "100%", height: "100%" }} />
      {failed ? (
        <div className="photo-fallback" style={{ position: "absolute", inset: 0 }}>
          Map unavailable
        </div>
      ) : null}
    </div>
  );
}

/** "Get directions" in whatever maps app the phone has. */
export function directionsUrl(lat: number | string, lng: number | string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${Number(lat)},${Number(lng)}`;
}
