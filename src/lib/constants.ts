import L from 'leaflet';
import { Station } from '../types';

export const BRAND_COLORS = {
  checked: '#10b981', // Emerald 500
  planned: '#f59e0b', // Amber 500
  unchecked: '#f43f5e' // Rose 500
};

export const createSvgMarker = (color: string) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" width="32" height="32" style="filter: drop-shadow(0px 3px 4px rgba(0,0,0,0.4)); stroke: white; stroke-width: 0.5px;">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
  </svg>`;
  return new L.DivIcon({
    className: 'custom-svg-marker duration-300 transition-opacity',
    html: svg,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  });
};

export const createDimmedSvgMarker = (color: string) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" width="32" height="32" style="filter: drop-shadow(0px 1px 2px rgba(0,0,0,0.2)) opacity(30%) grayscale(50%); stroke: white; stroke-width: 0.5px;">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
  </svg>`;
  return new L.DivIcon({
    className: 'custom-svg-marker z-0 duration-300 transition-opacity',
    html: svg,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  });
};

export const svgIcons = {
  checked: createSvgMarker(BRAND_COLORS.checked),
  planned: createSvgMarker(BRAND_COLORS.planned),
  unchecked: createSvgMarker(BRAND_COLORS.unchecked)
};

export const dimmedSvgIcons = {
  checked: createDimmedSvgMarker(BRAND_COLORS.checked),
  planned: createDimmedSvgMarker(BRAND_COLORS.planned),
  unchecked: createDimmedSvgMarker(BRAND_COLORS.unchecked)
};

export const formatStationName = (name: string) => {
  if (!name) return '';
  const parts = name.split(/[-_]/);
  if (parts.length >= 3) {
    return parts[1].trim();
  }
  if (parts.length === 2) {
    return parts[1].trim();
  }
  return name;
};

export const iconCache: Record<string, L.DivIcon> = {};

export const getStationIcon = (station: Station, isPlanned: boolean = false, isDimmed: boolean = false) => {
  if (station.icon) {
    const borderColor = station.status === 'checked' ? BRAND_COLORS.checked : (isPlanned ? BRAND_COLORS.planned : BRAND_COLORS.unchecked);
    const cacheKey = `${station.id}-${borderColor}-${station.icon}-${isDimmed}`;
    
    if (!iconCache[cacheKey]) {
      const dimStyle = isDimmed ? 'opacity: 0.3; filter: grayscale(50%);' : '';
      iconCache[cacheKey] = new L.DivIcon({
        className: 'custom-station-icon duration-300 transition-opacity',
        html: `<div style="width: 32px; height: 32px; border-radius: 50%; overflow: hidden; border: 3px solid ${borderColor}; background-color: white; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3); ${dimStyle}"><img src="${station.icon}" style="width: 100%; height: 100%; object-fit: cover;" /></div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32]
      });
    }
    return iconCache[cacheKey];
  }
  
  const iconSet = isDimmed ? dimmedSvgIcons : svgIcons;
  
  if (station.status === 'checked') return iconSet.checked;
  if (isPlanned) return iconSet.planned;
  return iconSet.unchecked;
};
