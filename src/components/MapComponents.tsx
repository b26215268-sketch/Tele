import React, { useEffect, useState } from 'react';
import { useMap, Marker, Circle, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import { Eye, EyeOff, Layers, Compass } from 'lucide-react';

export type MapType = 'google' | 'satellite' | 'osm';

export const MAP_TILE_PROVIDERS: Record<MapType, { name: string; url: string; attribution: string; subdomains?: string[]; maxZoom?: number }> = {
  google: {
    name: 'Bản đồ số',
    url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    attribution: '&copy; Google Maps',
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    maxZoom: 20
  },
  satellite: {
    name: 'Vệ tinh',
    url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    attribution: '&copy; Google Maps Hybrid Satellite',
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    maxZoom: 20
  },
  osm: {
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }
};

/**
 * Ensures Leaflet recalculates viewport sizes properly when tab switches, 
 * animations finish, or mobile devices rotate.
 */
export function MapResizer() {
  const map = useMap();

  useEffect(() => {
    // Initial size calculation
    map.invalidateSize();

    // Staggered size adjustments for tabs and CSS transitions
    const timers = [50, 200, 500, 1000].map(delay =>
      setTimeout(() => {
        try {
          map.invalidateSize();
        } catch (e) {
          // ignore if unmounted
        }
      }, delay)
    );

    const handleResize = () => {
      try {
        map.invalidateSize();
      } catch (e) {
        // ignore
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', handleResize);
    };
  }, [map]);

  return null;
}

/**
 * Fits bounds around given positions safely without crashing on invalid coords
 */
export function MapUpdater({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const positionsStr = JSON.stringify(positions);

  useEffect(() => {
    const validPositions = (positions || []).filter(
      p => Array.isArray(p) && p.length === 2 && !isNaN(p[0]) && !isNaN(p[1]) && p[0] !== 0 && p[1] !== 0
    );

    if (validPositions.length > 0) {
      try {
        const bounds = L.latLngBounds(validPositions);
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
        }
      } catch (e) {
        console.warn('Map fitBounds error:', e);
      }
    }
  }, [positionsStr, map]);

  return null;
}

/**
 * Locate control using GPS
 */
export function LocateControl() {
  const map = useMap();
  const [position, setPosition] = useState<L.LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);

  useEffect(() => {
    const onLocationFound = (e: L.LocationEvent) => {
      setPosition(e.latlng);
      setAccuracy(e.accuracy);
      map.flyTo(e.latlng, 16);
    };

    const onLocationError = (e: L.ErrorEvent) => {
      console.warn('Error finding location:', e.message);
    };

    map.on('locationfound', onLocationFound);
    map.on('locationerror', onLocationError);

    return () => {
      map.off('locationfound', onLocationFound);
      map.off('locationerror', onLocationError);
    };
  }, [map]);

  const handleLocate = () => {
    map.locate({ setView: false, enableHighAccuracy: true });
  };

  const userIcon = L.divIcon({
    html: `
      <div class="relative flex items-center justify-center w-7 h-7">
        <div class="absolute w-7 h-7 bg-blue-500/40 rounded-full animate-ping"></div>
        <div class="relative w-4 h-4 bg-blue-600 rounded-full border-2 border-white shadow-md"></div>
      </div>
    `,
    className: 'custom-user-location-icon',
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });

  return (
    <>
      <div className="leaflet-bottom leaflet-right">
        <div className="leaflet-control leaflet-bar shadow-sm" style={{ marginBottom: '30px' }}>
          <button
            type="button"
            onClick={handleLocate}
            title="Định vị vị trí của tôi"
            className="flex items-center justify-center w-[32px] h-[32px] bg-white hover:bg-gray-100 transition-colors border-none text-gray-700 cursor-pointer"
          >
            <Compass className="w-4 h-4 text-blue-600" />
          </button>
        </div>
      </div>
      {position && (
        <>
          <Marker position={position} icon={userIcon} zIndexOffset={2000} />
          {accuracy && (
            <Circle 
              center={position} 
              radius={accuracy} 
              pathOptions={{ fillColor: '#3b82f6', color: 'transparent', opacity: 0.1, fillOpacity: 0.12 }} 
            />
          )}
        </>
      )}
    </>
  );
}

/**
 * Toggle display of station codes on the map markers
 */
export function StationCodeToggleControl({ show, onToggle }: { show: boolean; onToggle: (val: boolean) => void }) {
  return (
    <div className="leaflet-bottom leaflet-left">
      <div className="leaflet-control leaflet-bar shadow-sm" style={{ marginBottom: '30px' }}>
        <button
          type="button"
          onClick={() => onToggle(!show)}
          title={show ? "Ẩn nhãn trạm" : "Hiện nhãn trạm"}
          className="flex items-center justify-center w-[32px] h-[32px] bg-white hover:bg-gray-100 transition-colors border-none cursor-pointer"
        >
          {show ? (
            <Eye className="w-4 h-4 text-blue-600" />
          ) : (
            <EyeOff className="w-4 h-4 text-gray-400" />
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * Switcher between Google Roadmap, Google Satellite (Hybrid), and OpenStreetMap
 */
export function MapLayerSwitcherControl({ 
  mapType, 
  onChange 
}: { 
  mapType: MapType; 
  onChange: (type: MapType) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="leaflet-top leaflet-right">
      <div className="leaflet-control shadow-sm relative m-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          title="Chọn kiểu bản đồ"
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/95 hover:bg-white backdrop-blur-sm rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 shadow-sm transition-all"
        >
          <Layers className="w-3.5 h-3.5 text-blue-600" />
          <span>{MAP_TILE_PROVIDERS[mapType].name}</span>
        </button>

        {open && (
          <div className="absolute right-0 top-9 bg-white rounded-xl shadow-lg border border-slate-200 py-1 min-w-[140px] z-50">
            {(Object.keys(MAP_TILE_PROVIDERS) as MapType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  onChange(type);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between transition-colors ${
                  mapType === type ? 'bg-blue-50 text-blue-600 font-bold' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span>{MAP_TILE_PROVIDERS[type].name}</span>
                {mapType === type && <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Standard SVG icon for start point in Route Planner
 */
export const startPointIcon = L.divIcon({
  html: `
    <div class="relative flex items-center justify-center w-7 h-7">
      <div class="absolute w-7 h-7 bg-emerald-500/40 rounded-full animate-ping"></div>
      <div class="relative w-5 h-5 bg-emerald-600 rounded-full border-2 border-white shadow-md flex items-center justify-center text-white text-[10px] font-bold">
        A
      </div>
    </div>
  `,
  className: 'custom-start-marker',
  iconSize: [28, 28],
  iconAnchor: [14, 14]
});
