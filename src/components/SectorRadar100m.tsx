import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { 
  Radar, 
  Map as MapIcon, 
  Compass, 
  Plus, 
  Trash2, 
  Edit3, 
  CheckCircle, 
  AlertTriangle, 
  ShieldAlert, 
  Info, 
  Layers, 
  Sliders, 
  Maximize2, 
  Upload, 
  Camera, 
  FileText, 
  ChevronRight, 
  X,
  RotateCcw,
  Eye,
  Crosshair,
  Zap
} from 'lucide-react';
import { SectorInfo, CtcnObstacle, Station } from '../types';
import { 
  getDefaultSectors, 
  analyzeCtcnSectorAndRisk, 
  computeDestinationPoint, 
  computeDistanceAndBearing,
  clampToMaxDistance,
  normalizeAngle,
  angularDifference,
  CTCN_BUILDING_TYPES,
  generateStandard6ObservationDirections
} from '../lib/telecomGeo';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { cn } from '../lib/utils';
import { MapContainer, TileLayer, Circle, Polygon, Marker, Popup, Polyline, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { MAP_TILE_PROVIDERS, MapResizer } from './MapComponents';

function SatelliteMapEvents({
  onMapClick,
  onMapMouseMove,
  isRotateMode,
  disabled
}: {
  onMapClick: (lat: number, lng: number) => void;
  onMapMouseMove?: (lat: number, lng: number) => void;
  isRotateMode?: boolean;
  disabled?: boolean;
}) {
  const map = useMap();

  useEffect(() => {
    if (isRotateMode) {
      map.dragging.disable();
    } else {
      map.dragging.enable();
    }
  }, [isRotateMode, map]);

  useMapEvents({
    click(e) {
      if (disabled) return;
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
    mousemove(e) {
      if (disabled || !isRotateMode || !onMapMouseMove) return;
      onMapMouseMove(e.latlng.lat, e.latlng.lng);
    }
  });
  return null;
}

function MapRecenterFly({ trigger, center }: { trigger: number; center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    if (trigger > 0) {
      map.flyTo(center, 18, { animate: true, duration: 0.8 });
    }
  }, [trigger, center, map]);
  return null;
}

interface SectorRadar100mProps {
  station: Station;
  sectors?: SectorInfo[];
  ctcnList?: CtcnObstacle[];
  onChange?: (data: { sectors: SectorInfo[]; ctcnList: CtcnObstacle[] }) => void;
  readOnly?: boolean;
}

export function SectorRadar100m({
  station,
  sectors: initialSectors,
  ctcnList: initialCtcnList,
  onChange,
  readOnly = false
}: SectorRadar100mProps) {
  const [sectors, setSectors] = useState<SectorInfo[]>(() => {
    if (initialSectors && initialSectors.length > 0) return initialSectors;
    if (station.sectors && station.sectors.length > 0) return station.sectors;
    return getDefaultSectors();
  });

  const [ctcnList, setCtcnList] = useState<CtcnObstacle[]>(() => {
    if (initialCtcnList && initialCtcnList.length > 0) return initialCtcnList;
    if (station.ctcnList && station.ctcnList.length > 0) return station.ctcnList;
    return [];
  });

  const [activeView, setActiveView] = useState<'radar' | 'satellite'>('radar');
  const [selectedCtcnId, setSelectedCtcnId] = useState<string | null>(null);
  const [isEditingSectors, setIsEditingSectors] = useState(false);
  const [isAddingCtcn, setIsAddingCtcn] = useState(false);
  const [recenterTrigger, setRecenterTrigger] = useState(0);

  // Form states for active CTCN
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<CtcnObstacle['buildingType']>('residential');
  const [formDistance, setFormDistance] = useState<number>(40);
  const [formAzimuth, setFormAzimuth] = useState<number>(60);
  const [formFloors, setFormFloors] = useState<number>(3);
  const [formHeight, setFormHeight] = useState<number>(12);
  const [formNotes, setFormNotes] = useState('');
  const [formPhotoUrl, setFormPhotoUrl] = useState('');

  // Interactive dragging on radar SVG
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Interactive dragging & clicking on Satellite Leaflet Map
  const [satelliteDragInfo, setSatelliteDragInfo] = useState<{
    active?: boolean;
    lat: number;
    lng: number;
    distance: number;
    azimuth: number;
    clamped: boolean;
    ctcnId?: string | null;
  } | null>(null);
  const [clampedWarning, setClampedWarning] = useState<string | null>(null);
  const [isSweepRotateMode, setIsSweepRotateMode] = useState<boolean>(false);

  // Keep parent in sync
  useEffect(() => {
    if (onChange) {
      onChange({ sectors, ctcnList });
    }
  }, [sectors, ctcnList, onChange]);

  // When a CTCN is selected, populate form
  const selectedCtcn = useMemo(() => {
    return ctcnList.find(c => c.id === selectedCtcnId) || null;
  }, [ctcnList, selectedCtcnId]);

  useEffect(() => {
    if (selectedCtcn) {
      setFormName(selectedCtcn.name);
      setFormType(selectedCtcn.buildingType);
      setFormDistance(selectedCtcn.distance);
      setFormAzimuth(selectedCtcn.azimuth);
      setFormFloors(selectedCtcn.floors || 3);
      setFormHeight(selectedCtcn.heightMeters || 12);
      setFormNotes(selectedCtcn.notes || '');
      setFormPhotoUrl(selectedCtcn.photoUrl || '');
    }
  }, [selectedCtcn]);

  // Real-time analysis of the active draft
  const currentAnalysis = useMemo(() => {
    return analyzeCtcnSectorAndRisk(formAzimuth, formDistance, sectors);
  }, [formAzimuth, formDistance, sectors]);

  // Convert distance (0-100m) & azimuth (0-360 deg) to SVG canvas (x, y)
  // Center is (250, 250), radius for 100m is 210px
  const center = 250;
  const maxRadiusPx = 210; // represents 100 meters
  const scale = maxRadiusPx / 100; // 2.1 px/meter

  const polarToSvg = useCallback((distMeters: number, azDeg: number) => {
    // 0 deg is North (-Y), 90 deg is East (+X)
    const angleRad = ((azDeg - 90) * Math.PI) / 180;
    const r = Math.min(distMeters, 100) * scale;
    const x = center + r * Math.cos(angleRad);
    const y = center + r * Math.sin(angleRad);
    return { x, y };
  }, [scale]);

  const svgToPolar = useCallback((svgX: number, svgY: number) => {
    const dx = svgX - center;
    const dy = svgY - center;
    const rPx = Math.sqrt(dx * dx + dy * dy);
    let distMeters = Math.round((rPx / scale) * 10) / 10;
    if (distMeters > 100) distMeters = 100;
    if (distMeters < 1) distMeters = 1;

    // Angle in degrees from North
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    deg = normalizeAngle(deg);

    return { distance: distMeters, azimuth: deg };
  }, [scale]);

  // Handle pointer down on radar
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (readOnly) return;
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * 500;
    const clickY = ((e.clientY - rect.top) / rect.height) * 500;

    const { distance, azimuth } = svgToPolar(clickX, clickY);
    setFormDistance(distance);
    setFormAzimuth(azimuth);
    setIsDragging(true);

    if (!isAddingCtcn && !selectedCtcnId) {
      setIsAddingCtcn(true);
      setFormName(`CTCN-${ctcnList.length + 1} (${distance}m, ${azimuth}°)`);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDragging || readOnly || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * 500;
    const clickY = ((e.clientY - rect.top) / rect.height) * 500;

    const { distance, azimuth } = svgToPolar(clickX, clickY);
    setFormDistance(distance);
    setFormAzimuth(azimuth);
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  // Handle click on Satellite map to place/move CTCN
  const handleSatelliteClick = useCallback((lat: number, lng: number) => {
    if (readOnly) return;
    const stLat = station.latitude || 21.0;
    const stLng = station.longitude || 105.8;
    const clamped = clampToMaxDistance(stLat, stLng, lat, lng, 100);

    if (clamped.clamped) {
      setClampedWarning("Điểm đã được tự động giới hạn ở bán kính 100m (QCVN 08)");
      setTimeout(() => setClampedWarning(null), 3000);
    }

    setFormDistance(clamped.distance);
    setFormAzimuth(clamped.azimuth);

    if (!isAddingCtcn && !selectedCtcnId) {
      setIsAddingCtcn(true);
      setFormName(`CTCN-${ctcnList.length + 1} (${clamped.distance}m, ${clamped.azimuth}°)`);
    } else if (selectedCtcnId) {
      const analysis = analyzeCtcnSectorAndRisk(clamped.azimuth, clamped.distance, sectors);
      setCtcnList(prev => prev.map(c => {
        if (c.id === selectedCtcnId) {
          return {
            ...c,
            distance: clamped.distance,
            azimuth: clamped.azimuth,
            latitude: clamped.latitude,
            longitude: clamped.longitude,
            affectedSectorId: analysis.affectedSectorId,
            affectedSectorName: analysis.affectedSectorName,
            offsetAngle: analysis.offsetAngle,
            isInMainLobe: analysis.isInMainLobe,
            exposureRisk: analysis.exposureRisk
          };
        }
        return c;
      }));
    }
  }, [readOnly, station, isAddingCtcn, selectedCtcnId, ctcnList.length, sectors]);

  // Handle continuous rotation sweep on Satellite map when Sweep Rotate Mode is active
  const handleSatelliteMouseMove = useCallback((lat: number, lng: number) => {
    if (readOnly) return;
    const stLat = station.latitude || 21.0;
    const stLng = station.longitude || 105.8;
    const clamped = clampToMaxDistance(stLat, stLng, lat, lng, 100);

    setFormDistance(clamped.distance);
    setFormAzimuth(clamped.azimuth);

    if (selectedCtcnId) {
      const analysis = analyzeCtcnSectorAndRisk(clamped.azimuth, clamped.distance, sectors);
      setCtcnList(prev => prev.map(c => {
        if (c.id === selectedCtcnId) {
          return {
            ...c,
            distance: clamped.distance,
            azimuth: clamped.azimuth,
            latitude: clamped.latitude,
            longitude: clamped.longitude,
            affectedSectorId: analysis.affectedSectorId,
            affectedSectorName: analysis.affectedSectorName,
            offsetAngle: analysis.offsetAngle,
            isInMainLobe: analysis.isInMainLobe,
            exposureRisk: analysis.exposureRisk
          };
        }
        return c;
      }));
    }

    setSatelliteDragInfo({
      active: true,
      lat: clamped.latitude,
      lng: clamped.longitude,
      distance: clamped.distance,
      azimuth: clamped.azimuth,
      clamped: clamped.clamped
    });
  }, [readOnly, station, selectedCtcnId, sectors]);

  // Handle drag on Satellite marker
  const handleMarkerDrag = (ctcnId: string, e: L.LeafletEvent) => {
    if (readOnly) return;
    const marker = e.target as L.Marker;
    const pos = marker.getLatLng();
    const stLat = station.latitude || 21.0;
    const stLng = station.longitude || 105.8;
    const clamped = clampToMaxDistance(stLat, stLng, pos.lat, pos.lng, 100);

    if (clamped.clamped) {
      marker.setLatLng([clamped.latitude, clamped.longitude]);
      setClampedWarning("Đã đạt giới hạn tối đa 100m (QCVN 08)");
    } else {
      setClampedWarning(null);
    }

    setFormDistance(clamped.distance);
    setFormAzimuth(clamped.azimuth);
    setSelectedCtcnId(ctcnId);
    setIsAddingCtcn(false);

    setSatelliteDragInfo({
      lat: clamped.latitude,
      lng: clamped.longitude,
      distance: clamped.distance,
      azimuth: clamped.azimuth,
      clamped: clamped.clamped,
      ctcnId
    });
  };

  const handleMarkerDragEnd = (ctcnId: string, e: L.LeafletEvent) => {
    if (readOnly) return;
    const marker = e.target as L.Marker;
    const pos = marker.getLatLng();
    const stLat = station.latitude || 21.0;
    const stLng = station.longitude || 105.8;
    const clamped = clampToMaxDistance(stLat, stLng, pos.lat, pos.lng, 100);

    const analysis = analyzeCtcnSectorAndRisk(clamped.azimuth, clamped.distance, sectors);

    setCtcnList(prev => prev.map(c => {
      if (c.id === ctcnId) {
        return {
          ...c,
          distance: clamped.distance,
          azimuth: clamped.azimuth,
          latitude: clamped.latitude,
          longitude: clamped.longitude,
          affectedSectorId: analysis.affectedSectorId,
          affectedSectorName: analysis.affectedSectorName,
          offsetAngle: analysis.offsetAngle,
          isInMainLobe: analysis.isInMainLobe,
          exposureRisk: analysis.exposureRisk
        };
      }
      return c;
    }));

    setFormDistance(clamped.distance);
    setFormAzimuth(clamped.azimuth);
    setSatelliteDragInfo(null);
    setTimeout(() => setClampedWarning(null), 3000);
  };

  // Save current CTCN
  const handleSaveCtcn = () => {
    if (!formName.trim()) return;

    const analysis = analyzeCtcnSectorAndRisk(formAzimuth, formDistance, sectors);
    const destGps = computeDestinationPoint(
      station.latitude || 21.0,
      station.longitude || 105.8,
      formDistance,
      formAzimuth
    );

    const newCtcn: CtcnObstacle = {
      id: selectedCtcnId || `ctcn-${Date.now()}`,
      name: formName.trim(),
      buildingType: formType,
      distance: formDistance,
      azimuth: formAzimuth,
      latitude: destGps.latitude,
      longitude: destGps.longitude,
      heightMeters: formHeight,
      floors: formFloors,
      notes: formNotes,
      photoUrl: formPhotoUrl,
      affectedSectorId: analysis.affectedSectorId,
      affectedSectorName: analysis.affectedSectorName,
      offsetAngle: analysis.offsetAngle,
      isInMainLobe: analysis.isInMainLobe,
      exposureRisk: analysis.exposureRisk,
      inspectionPointHeight: 1.5,
      createdAt: selectedCtcn?.createdAt || new Date().toISOString()
    };

    if (selectedCtcnId) {
      setCtcnList(prev => prev.map(c => c.id === selectedCtcnId ? newCtcn : c));
    } else {
      setCtcnList(prev => [...prev, newCtcn]);
      setSelectedCtcnId(newCtcn.id);
    }
    setIsAddingCtcn(false);
  };

  const handleDeleteCtcn = (id: string) => {
    setCtcnList(prev => prev.filter(c => c.id !== id));
    if (selectedCtcnId === id) setSelectedCtcnId(null);
  };

  const handleResetSectors = () => {
    setSectors(getDefaultSectors());
  };

  // Helper to generate SVG pie sector wedge path
  const getSectorArcPath = (azimuth: number, beamwidth: number) => {
    const half = beamwidth / 2;
    const startAngle = azimuth - half;
    const endAngle = azimuth + half;

    const startPt = polarToSvg(100, startAngle);
    const endPt = polarToSvg(100, endAngle);

    const largeArcFlag = beamwidth > 180 ? 1 : 0;
    return `M ${center} ${center} L ${startPt.x} ${startPt.y} A ${maxRadiusPx} ${maxRadiusPx} 0 ${largeArcFlag} 1 ${endPt.x} ${endPt.y} Z`;
  };

  // Calculate polygon points for Leaflet map for a given sector
  const getSectorPolygonCoords = (sec: SectorInfo): [number, number][] => {
    const stLat = station.latitude || 21.0;
    const stLng = station.longitude || 105.8;
    const half = (sec.beamwidth || 65) / 2;
    const steps = 10;
    const coords: [number, number][] = [[stLat, stLng]];

    for (let i = 0; i <= steps; i++) {
      const az = sec.azimuth - half + (i / steps) * (half * 2);
      const pt = computeDestinationPoint(stLat, stLng, 100, az);
      coords.push([pt.latitude, pt.longitude]);
    }
    coords.push([stLat, stLng]);
    return coords;
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden space-y-0">
      {/* Clean, minimalist toolbar */}
      <div className="px-4 py-3 bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center">
            <Radar className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-100">Sơ đồ Sector & Bán kính 100m</h3>
          </div>
        </div>

        {/* View mode toggle & Actions */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700/60 text-xs">
            <button
              type="button"
              onClick={() => setActiveView('radar')}
              className={cn(
                "px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-all",
                activeView === 'radar' ? "bg-white text-slate-900 shadow-xs font-bold" : "text-slate-300 hover:text-white"
              )}
            >
              <Radar className="w-3.5 h-3.5 text-blue-600" />
              <span>Radar</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveView('satellite')}
              className={cn(
                "px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-all",
                activeView === 'satellite' ? "bg-white text-slate-900 shadow-xs font-bold" : "text-slate-300 hover:text-white"
              )}
            >
              <MapIcon className="w-3.5 h-3.5 text-emerald-600" />
              <span>Vệ tinh</span>
            </button>
          </div>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setRecenterTrigger(prev => prev + 1);
              setSelectedCtcnId(null);
            }}
            className="h-7 text-xs bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 hover:text-white flex items-center gap-1 font-semibold"
            title="Đưa tâm bản đồ về chính giữa trạm"
          >
            <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
            <span>Căn giữa</span>
          </Button>

          {!readOnly && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setIsEditingSectors(!isEditingSectors)}
              className="h-7 text-xs bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 hover:text-white flex items-center gap-1 font-semibold"
            >
              <Sliders className="w-3 h-3 text-blue-400" />
              <span>{isEditingSectors ? 'Xong Sector' : 'Cấu hình Sector'}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Sector Config drawer if opened */}
      {isEditingSectors && !readOnly && (
        <div className="p-3.5 bg-slate-50 border-b border-slate-200 space-y-2.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-blue-600" />
              Thông số các Sector ({sectors.length} sector)
            </h4>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetSectors}
                className="text-[11px] text-slate-500 hover:text-blue-600 flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                Mặc định 3 Sector
              </button>
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-xs"
                onClick={() => {
                  const newId = `sec-${sectors.length + 1}`;
                  const defaultAz = (sectors.length * 90) % 360;
                  setSectors(prev => [
                    ...prev,
                    {
                      id: newId,
                      name: `Sector ${prev.length + 1}`,
                      azimuth: defaultAz,
                      beamwidth: 65,
                      antennaHeight: 30,
                      tilt: 3,
                      color: '#ec4899'
                    }
                  ]);
                }}
              >
                <Plus className="w-3 h-3 mr-1" />
                Thêm Sector
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {sectors.map((sec, idx) => (
              <div key={sec.id} className="bg-white p-3 rounded-2xl border border-slate-200 space-y-2 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: sec.color || '#3b82f6' }} />
                    <input
                      type="text"
                      className="text-xs font-bold text-slate-800 border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none w-24"
                      value={sec.name}
                      onChange={e => {
                        const val = e.target.value;
                        setSectors(prev => prev.map(s => s.id === sec.id ? { ...s, name: val } : s));
                      }}
                    />
                  </div>
                  {sectors.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setSectors(prev => prev.filter(s => s.id !== sec.id))}
                      className="text-slate-400 hover:text-red-500 p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="text-[10px] text-slate-500 font-semibold block">Góc hướng (Azimuth °)</label>
                    <input
                      type="number"
                      min={0}
                      max={359}
                      value={sec.azimuth}
                      onChange={e => {
                        const val = normalizeAngle(parseFloat(e.target.value) || 0);
                        setSectors(prev => prev.map(s => s.id === sec.id ? { ...s, azimuth: val } : s));
                      }}
                      className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 font-semibold block">Độ rộng búp (° BW)</label>
                    <input
                      type="number"
                      min={10}
                      max={180}
                      value={sec.beamwidth || 65}
                      onChange={e => {
                        const val = parseFloat(e.target.value) || 65;
                        setSectors(prev => prev.map(s => s.id === sec.id ? { ...s, beamwidth: val } : s));
                      }}
                      className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 font-semibold block">Độ cao anten (m)</label>
                    <input
                      type="number"
                      min={5}
                      max={120}
                      value={sec.antennaHeight || 30}
                      onChange={e => {
                        const val = parseFloat(e.target.value) || 30;
                        setSectors(prev => prev.map(s => s.id === sec.id ? { ...s, antennaHeight: val } : s));
                      }}
                      className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 font-semibold block">Góc Tilt (°)</label>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={sec.tilt || 3}
                      onChange={e => {
                        const val = parseFloat(e.target.value) || 0;
                        setSectors(prev => prev.map(s => s.id === sec.id ? { ...s, tilt: val } : s));
                      }}
                      className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Grid: Visual Map/Radar on Left + CTCN details / Tool panel on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        {/* Left Column: Visual Area (7 cols) */}
        <div className="lg:col-span-7 p-4 sm:p-5 flex flex-col items-center justify-center bg-slate-950/5 relative overflow-hidden">
          {activeView === 'radar' ? (
            <div className="w-full max-w-[460px] aspect-square relative select-none">
              {/* Radar Instructions Overlay */}
              <div className="absolute top-2 left-2 z-10 pointer-events-none bg-slate-900/80 backdrop-blur-md px-2.5 py-1 rounded-xl text-[11px] text-slate-200 border border-white/10 flex items-center gap-1.5 shadow-md">
                <Crosshair className="w-3.5 h-3.5 text-blue-400" />
                <span>Chạm / kéo để đặt vị trí CTCN</span>
              </div>

              {/* Status Indicator */}
              <div className="absolute top-2 right-2 z-10 pointer-events-none bg-blue-600/90 backdrop-blur-md px-2.5 py-1 rounded-xl text-[11px] font-bold text-white shadow-md">
                Bán kính 100m
              </div>

              {/* SVG Polar Radar Canvas */}
              <svg
                ref={svgRef}
                viewBox="0 0 500 500"
                className="w-full h-full cursor-crosshair touch-none filter drop-shadow-md"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              >
                <defs>
                  {/* Radial Gradient for 100m Boundary */}
                  <radialGradient id="radarBg" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#0f172a" stopOpacity="0.05" />
                    <stop offset="70%" stopColor="#1e293b" stopOpacity="0.08" />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.15" />
                  </radialGradient>
                  
                  {/* Glow filter for antenna mast */}
                  <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>

                {/* 100m Background Circle */}
                <circle cx={center} cy={center} r={maxRadiusPx} fill="url(#radarBg)" stroke="#cbd5e1" strokeWidth="2" />

                {/* Concentric Distance Rings: 25m, 50m, 75m, 100m */}
                {[25, 50, 75, 100].map(m => {
                  const r = m * scale;
                  const is50m = m === 50;
                  return (
                    <g key={`ring-${m}`}>
                      <circle
                        cx={center}
                        cy={center}
                        r={r}
                        fill="none"
                        stroke={is50m ? "#f59e0b" : "#94a3b8"}
                        strokeWidth={is50m ? "1.5" : "1"}
                        strokeDasharray={is50m ? "4 3" : "2 2"}
                        strokeOpacity={is50m ? "0.8" : "0.5"}
                      />
                      {/* Distance label on the East Axis */}
                      <text
                        x={center + r + 3}
                        y={center - 4}
                        fill={is50m ? "#b45309" : "#64748b"}
                        fontSize="9"
                        fontWeight="bold"
                        textAnchor="start"
                      >
                        {m}m
                      </text>
                    </g>
                  );
                })}

                {/* Radial Angle Grid Lines every 30 deg */}
                {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(deg => {
                  const pt = polarToSvg(100, deg);
                  const isCardinal = deg % 90 === 0;
                  return (
                    <line
                      key={`axis-${deg}`}
                      x1={center}
                      y1={center}
                      x2={pt.x}
                      y2={pt.y}
                      stroke={isCardinal ? "#64748b" : "#cbd5e1"}
                      strokeWidth={isCardinal ? "1.2" : "0.75"}
                      strokeDasharray={isCardinal ? "" : "3 3"}
                      strokeOpacity="0.6"
                    />
                  );
                })}

                {/* Compass Cardinal Points: N, E, S, W */}
                <text x={center} y={center - maxRadiusPx - 8} fill="#ef4444" fontSize="13" fontWeight="900" textAnchor="middle">
                  BẮC (0° N)
                </text>
                <text x={center + maxRadiusPx + 14} y={center + 4} fill="#1e293b" fontSize="11" fontWeight="bold" textAnchor="start">
                  Đ (90° E)
                </text>
                <text x={center} y={center + maxRadiusPx + 16} fill="#1e293b" fontSize="11" fontWeight="bold" textAnchor="middle">
                  NAM (180° S)
                </text>
                <text x={center - maxRadiusPx - 14} y={center + 4} fill="#1e293b" fontSize="11" fontWeight="bold" textAnchor="end">
                  T (270° W)
                </text>

                {/* Sector Fan Wedges */}
                {sectors.map(sec => {
                  const wedgePath = getSectorArcPath(sec.azimuth, sec.beamwidth || 65);
                  const mainLinePt = polarToSvg(100, sec.azimuth);
                  const labelPt = polarToSvg(70, sec.azimuth);
                  const color = sec.color || '#3b82f6';

                  return (
                    <g key={sec.id}>
                      {/* Sector Fan area */}
                      <path
                        d={wedgePath}
                        fill={color}
                        fillOpacity="0.22"
                        stroke={color}
                        strokeWidth="1.5"
                        strokeDasharray="4 2"
                      />
                      {/* Main Beam Center Line */}
                      <line
                        x1={center}
                        y1={center}
                        x2={mainLinePt.x}
                        y2={mainLinePt.y}
                        stroke={color}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                      {/* Sector Name Badge */}
                      <rect
                        x={labelPt.x - 30}
                        y={labelPt.y - 10}
                        width="60"
                        height="20"
                        rx="6"
                        fill="#0f172a"
                        fillOpacity="0.85"
                        stroke={color}
                        strokeWidth="1"
                      />
                      <text
                        x={labelPt.x}
                        y={labelPt.y + 3.5}
                        fill="#ffffff"
                        fontSize="9"
                        fontWeight="bold"
                        textAnchor="middle"
                      >
                        {sec.name} ({sec.azimuth}°)
                      </text>
                    </g>
                  );
                })}

                {/* Tower Center Mast (Antenna Pole Foot) */}
                <circle cx={center} cy={center} r="14" fill="#3b82f6" fillOpacity="0.2" className="animate-ping" />
                <circle cx={center} cy={center} r="9" fill="#1e293b" stroke="#ffffff" strokeWidth="2.5" />
                <circle cx={center} cy={center} r="3.5" fill="#ef4444" />
                <text x={center} y={center + 20} fill="#1e293b" fontSize="9" fontWeight="900" textAnchor="middle">
                  CHÂN TRỤ ANTEN (0m)
                </text>

                {/* Draw saved CTCN Markers */}
                {ctcnList.map(c => {
                  const pt = polarToSvg(c.distance, c.azimuth);
                  const isSelected = c.id === selectedCtcnId;
                  const isHighRisk = c.exposureRisk === 'high';
                  const isMediumRisk = c.exposureRisk === 'medium';
                  const pinColor = isHighRisk ? '#ef4444' : isMediumRisk ? '#f59e0b' : '#10b981';

                  return (
                    <g
                      key={c.id}
                      className="cursor-pointer transition-transform"
                      onClick={e => {
                        e.stopPropagation();
                        setSelectedCtcnId(c.id);
                        setIsAddingCtcn(false);
                      }}
                    >
                      {/* Connecting ray to mast */}
                      <line
                        x1={center}
                        y1={center}
                        x2={pt.x}
                        y2={pt.y}
                        stroke={pinColor}
                        strokeWidth={isSelected ? "2" : "1"}
                        strokeDasharray={isSelected ? "" : "3 3"}
                        strokeOpacity={isSelected ? "1" : "0.5"}
                      />

                      {/* Pin Circle */}
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={isSelected ? "11" : "8"}
                        fill={pinColor}
                        stroke="#ffffff"
                        strokeWidth="2.5"
                        filter={isSelected ? "url(#glow)" : undefined}
                      />
                      <circle cx={pt.x} cy={pt.y} r={isSelected ? "4" : "2.5"} fill="#ffffff" />

                      {/* Pin Label */}
                      <rect
                        x={pt.x - 38}
                        y={pt.y - 25}
                        width="76"
                        height="16"
                        rx="4"
                        fill="#0f172a"
                        fillOpacity="0.88"
                        stroke={isSelected ? "#ffffff" : pinColor}
                        strokeWidth={isSelected ? "1.5" : "0.5"}
                      />
                      <text
                        x={pt.x}
                        y={pt.y - 14}
                        fill="#ffffff"
                        fontSize="8.5"
                        fontWeight="bold"
                        textAnchor="middle"
                      >
                        {c.name.length > 11 ? c.name.slice(0, 10) + '..' : c.name} ({Math.round(c.distance)}m)
                      </text>
                    </g>
                  );
                })}

                {/* Active Draft Pin (if adding or dragging) */}
                {(isAddingCtcn || isDragging) && (
                  (() => {
                    const draftPt = polarToSvg(formDistance, formAzimuth);
                    const isHigh = currentAnalysis.exposureRisk === 'high';
                    const isMed = currentAnalysis.exposureRisk === 'medium';
                    const activeColor = isHigh ? '#ef4444' : isMed ? '#f59e0b' : '#10b981';

                    return (
                      <g pointerEvents="none">
                        {/* Ray */}
                        <line
                          x1={center}
                          y1={center}
                          x2={draftPt.x}
                          y2={draftPt.y}
                          stroke={activeColor}
                          strokeWidth="2.5"
                        />
                        {/* Target reticle */}
                        <circle
                          cx={draftPt.x}
                          cy={draftPt.y}
                          r="14"
                          fill="none"
                          stroke={activeColor}
                          strokeWidth="2"
                          strokeDasharray="3 3"
                          className="animate-spin"
                        />
                        <circle
                          cx={draftPt.x}
                          cy={draftPt.y}
                          r="9"
                          fill={activeColor}
                          stroke="#ffffff"
                          strokeWidth="2"
                        />
                        {/* Dynamic Tooltip */}
                        <rect
                          x={draftPt.x - 45}
                          y={draftPt.y + 14}
                          width="90"
                          height="18"
                          rx="5"
                          fill="#1e1b4b"
                          stroke="#ffffff"
                          strokeWidth="1"
                        />
                        <text
                          x={draftPt.x}
                          y={draftPt.y + 26.5}
                          fill="#ffffff"
                          fontSize="9"
                          fontWeight="bold"
                          textAnchor="middle"
                        >
                          {formDistance}m | {formAzimuth}° N
                        </text>
                      </g>
                    );
                  })()
                )}
              </svg>
            </div>
          ) : (
            /* Leaflet Satellite Map View */
            <div className="w-full h-[470px] rounded-2xl overflow-hidden border border-slate-200 relative select-none">
              {/* Top Controls Overlay */}
              <div className="absolute top-2 left-2 right-2 z-[400] flex flex-wrap items-center justify-between gap-1.5 pointer-events-auto">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setIsSweepRotateMode(!isSweepRotateMode)}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold transition-all shadow cursor-pointer",
                      isSweepRotateMode
                        ? "bg-amber-500 text-slate-950 ring-2 ring-amber-300"
                        : "bg-slate-900/90 text-white hover:bg-slate-800 border border-white/10"
                    )}
                    title="Bật/tắt chế độ di chuột quét xoay góc quanh trạm"
                  >
                    <Compass className={cn("w-3.5 h-3.5", isSweepRotateMode ? "animate-spin text-slate-950" : "text-cyan-400")} />
                    <span>{isSweepRotateMode ? "Xoay: Đang BẬT" : "Bật quét xoay 360°"}</span>
                  </button>
                  <span className="bg-slate-900/80 backdrop-blur-md px-2 py-1 rounded-xl text-[10px] text-slate-200 border border-white/10 hidden sm:inline">
                    {isSweepRotateMode ? "Rê chuột trên ảnh để xoay tia • Nhấp để ghim" : "Bấm lên sector/vệ tinh để chọn vị trí • Kéo chốt 🎯 để xoay"}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <span className="bg-emerald-600/90 backdrop-blur-md px-2 py-0.5 rounded-lg text-[10px] font-bold text-white shadow">
                    Vệ tinh 100m
                  </span>
                  {clampedWarning && (
                    <span className="bg-amber-500/95 text-slate-950 font-bold px-2 py-0.5 rounded-lg text-[10px] shadow border border-amber-300 animate-pulse">
                      {clampedWarning}
                    </span>
                  )}
                  {satelliteDragInfo?.active && (
                    <span className="bg-blue-600 text-white font-mono font-bold px-2 py-0.5 rounded-lg text-[11px] shadow border border-blue-400 animate-bounce">
                      {satelliteDragInfo.distance}m | {satelliteDragInfo.azimuth}°
                    </span>
                  )}
                </div>
              </div>

              {/* Bottom Quick Angle Snapping Bar */}
              <div className="absolute bottom-2 left-2 right-2 z-[400] bg-slate-950/85 backdrop-blur-md px-2.5 py-1.5 rounded-xl text-white border border-white/10 flex flex-wrap items-center justify-between gap-1.5 shadow-xl pointer-events-auto">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Góc & Cự ly:</span>
                  <span className="text-xs font-mono font-bold text-cyan-300 px-1.5 py-0.5 bg-slate-900 rounded border border-cyan-500/30">
                    {formAzimuth}° | {formDistance}m
                  </span>
                  <button
                    type="button"
                    onClick={() => setFormAzimuth(prev => normalizeAngle(prev - 5))}
                    className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-white text-xs font-mono font-bold border border-white/10"
                    title="Quay trái 5 độ"
                  >
                    -5°
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormAzimuth(prev => normalizeAngle(prev + 5))}
                    className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-white text-xs font-mono font-bold border border-white/10"
                    title="Quay phải 5 độ"
                  >
                    +5°
                  </button>
                </div>

                <div className="flex items-center gap-1 overflow-x-auto">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold hidden md:inline">Khớp nhanh:</span>
                  {sectors.map(sec => (
                    <button
                      key={sec.id}
                      type="button"
                      onClick={() => setFormAzimuth(sec.azimuth)}
                      className="px-2 py-0.5 rounded bg-blue-900/80 hover:bg-blue-600 text-white text-[11px] font-semibold border border-blue-400/30 whitespace-nowrap shadow transition-colors"
                      title={`Khớp nhanh vào hướng ${sec.name} (${sec.azimuth}°)`}
                    >
                      {sec.name} ({sec.azimuth}°)
                    </button>
                  ))}
                </div>
              </div>

              <MapContainer
                center={[station.latitude || 21.0, station.longitude || 105.8]}
                zoom={18}
                className="w-full h-full cursor-crosshair"
                scrollWheelZoom={true}
              >
                <MapResizer />
                <MapRecenterFly trigger={recenterTrigger} center={[station.latitude || 21.0, station.longitude || 105.8]} />
                <SatelliteMapEvents 
                  onMapClick={handleSatelliteClick} 
                  onMapMouseMove={handleSatelliteMouseMove}
                  isRotateMode={isSweepRotateMode}
                  disabled={readOnly} 
                />

                <TileLayer
                  url={MAP_TILE_PROVIDERS.satellite.url}
                  attribution={MAP_TILE_PROVIDERS.satellite.attribution}
                  maxZoom={20}
                />

                {/* 100m Buffer Circle (QCVN 08 Boundary) - Clickable */}
                <Circle
                  center={[station.latitude || 21.0, station.longitude || 105.8]}
                  radius={100}
                  pathOptions={{
                    color: '#38bdf8',
                    weight: 2,
                    fillColor: '#38bdf8',
                    fillOpacity: 0.1,
                    dashArray: '6, 6'
                  }}
                  eventHandlers={{
                    click: (e) => {
                      if (readOnly) return;
                      L.DomEvent.stopPropagation(e);
                      handleSatelliteClick(e.latlng.lat, e.latlng.lng);
                    }
                  }}
                />

                {/* 50m Warning Circle - Clickable */}
                <Circle
                  center={[station.latitude || 21.0, station.longitude || 105.8]}
                  radius={50}
                  pathOptions={{
                    color: '#f59e0b',
                    weight: 1.5,
                    fillColor: '#f59e0b',
                    fillOpacity: 0.08,
                    dashArray: '4, 4'
                  }}
                  eventHandlers={{
                    click: (e) => {
                      if (readOnly) return;
                      L.DomEvent.stopPropagation(e);
                      handleSatelliteClick(e.latlng.lat, e.latlng.lng);
                    }
                  }}
                />

                {/* Sector Fan Polygons (Click directly to select location and angle) */}
                {sectors.map(sec => (
                  <Polygon
                    key={sec.id}
                    positions={getSectorPolygonCoords(sec)}
                    pathOptions={{
                      color: sec.color || '#3b82f6',
                      fillColor: sec.color || '#3b82f6',
                      fillOpacity: 0.28,
                      weight: 2
                    }}
                    eventHandlers={{
                      click: (e) => {
                        if (readOnly) return;
                        L.DomEvent.stopPropagation(e);
                        handleSatelliteClick(e.latlng.lat, e.latlng.lng);
                      }
                    }}
                  />
                ))}

                {/* Tower Mast Marker (0m) */}
                <Marker
                  position={[station.latitude || 21.0, station.longitude || 105.8]}
                  icon={L.divIcon({
                    html: `
                      <div class="relative flex items-center justify-center w-7 h-7">
                        <div class="absolute w-7 h-7 bg-blue-500/40 rounded-full animate-ping"></div>
                        <div class="relative w-5 h-5 bg-blue-600 rounded-full border-2 border-white shadow-md flex items-center justify-center text-white text-[10px] font-bold">
                          🗼
                        </div>
                      </div>
                    `,
                    className: 'mast-pin',
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                  })}
                >
                  <Popup>
                    <div className="text-xs p-1">
                      <strong>{station.name}</strong>
                      <div>Tâm trụ anten (0m)</div>
                    </div>
                  </Popup>
                </Marker>

                {/* Dynamic Guideline & Interactive 360° Rotate Reticle */}
                {(() => {
                  const draftGps = computeDestinationPoint(
                    station.latitude || 21.0,
                    station.longitude || 105.8,
                    formDistance,
                    formAzimuth
                  );
                  const isHigh = currentAnalysis.exposureRisk === 'high';
                  const isMed = currentAnalysis.exposureRisk === 'medium';
                  const activeColor = isHigh ? '#ef4444' : isMed ? '#f59e0b' : '#38bdf8';

                  return (
                    <React.Fragment key="aiming-reticle-guideline">
                      {/* Real-time Dynamic Guideline ray from mast to aiming point */}
                      <Polyline
                        positions={[
                          [station.latitude || 21.0, station.longitude || 105.8],
                          [draftGps.latitude, draftGps.longitude]
                        ]}
                        pathOptions={{
                          color: activeColor,
                          weight: 3,
                          dashArray: '5, 5'
                        }}
                      />

                      {/* Draggable Aiming Reticle (Chốt kéo xoay 360° & cự ly) */}
                      <Marker
                        position={[draftGps.latitude, draftGps.longitude]}
                        draggable={!readOnly}
                        eventHandlers={{
                          dragstart: () => {
                            setSatelliteDragInfo({
                              active: true,
                              lat: draftGps.latitude,
                              lng: draftGps.longitude,
                              distance: formDistance,
                              azimuth: formAzimuth,
                              clamped: false
                            });
                          },
                          drag: (e) => {
                            if (readOnly) return;
                            const marker = e.target as L.Marker;
                            const pos = marker.getLatLng();
                            const stLat = station.latitude || 21.0;
                            const stLng = station.longitude || 105.8;
                            const clamped = clampToMaxDistance(stLat, stLng, pos.lat, pos.lng, 100);

                            if (clamped.clamped) {
                              setClampedWarning("Đã đạt giới hạn tối đa 100m (QCVN 08)");
                            } else {
                              setClampedWarning(null);
                            }

                            setFormDistance(clamped.distance);
                            setFormAzimuth(clamped.azimuth);

                            if (selectedCtcnId) {
                              const analysis = analyzeCtcnSectorAndRisk(clamped.azimuth, clamped.distance, sectors);
                              setCtcnList(prev => prev.map(c => {
                                if (c.id === selectedCtcnId) {
                                  return {
                                    ...c,
                                    distance: clamped.distance,
                                    azimuth: clamped.azimuth,
                                    latitude: clamped.latitude,
                                    longitude: clamped.longitude,
                                    affectedSectorId: analysis.affectedSectorId,
                                    affectedSectorName: analysis.affectedSectorName,
                                    offsetAngle: analysis.offsetAngle,
                                    isInMainLobe: analysis.isInMainLobe,
                                    exposureRisk: analysis.exposureRisk
                                  };
                                }
                                return c;
                              }));
                            }

                            setSatelliteDragInfo({
                              active: true,
                              lat: clamped.latitude,
                              lng: clamped.longitude,
                              distance: clamped.distance,
                              azimuth: clamped.azimuth,
                              clamped: clamped.clamped
                            });
                          },
                          dragend: (e) => {
                            if (readOnly) return;
                            const marker = e.target as L.Marker;
                            const pos = marker.getLatLng();
                            const stLat = station.latitude || 21.0;
                            const stLng = station.longitude || 105.8;
                            const clamped = clampToMaxDistance(stLat, stLng, pos.lat, pos.lng, 100);

                            setFormDistance(clamped.distance);
                            setFormAzimuth(clamped.azimuth);
                            setSatelliteDragInfo(null);
                            setTimeout(() => setClampedWarning(null), 2500);
                          }
                        }}
                        icon={L.divIcon({
                          html: `
                            <div class="relative flex items-center justify-center cursor-grab active:cursor-grabbing">
                              <div class="absolute -top-7 bg-slate-950/95 text-cyan-300 font-mono text-[10px] font-bold px-2 py-0.5 rounded shadow-lg whitespace-nowrap border border-cyan-400/50 flex items-center gap-1 pointer-events-none">
                                <span>🧭 ${formAzimuth}°</span>
                                <span class="text-white/40">|</span>
                                <span class="text-amber-300">${formDistance}m</span>
                              </div>
                              <div class="w-8 h-8 rounded-full border-2 border-dashed border-cyan-400 bg-cyan-500/25 animate-pulse flex items-center justify-center shadow-lg">
                                <div class="w-3.5 h-3.5 bg-cyan-400 rounded-full border-2 border-white shadow"></div>
                              </div>
                            </div>
                          `,
                          className: 'rotate-reticle-pin',
                          iconSize: [32, 32],
                          iconAnchor: [16, 16]
                        })}
                      />
                    </React.Fragment>
                  );
                })()}

                {/* CTCN Markers on Map with full Drag & Drop support */}
                {ctcnList.map(c => {
                  const cLat = c.latitude || station.latitude || 21.0;
                  const cLng = c.longitude || station.longitude || 105.8;
                  const isSelected = c.id === selectedCtcnId;
                  const isHigh = c.exposureRisk === 'high';
                  const isMed = c.exposureRisk === 'medium';
                  const pinBg = isHigh ? 'bg-red-600' : isMed ? 'bg-amber-500' : 'bg-emerald-600';
                  const ringClass = isSelected ? 'ring-4 ring-white shadow-xl scale-110' : '';

                  return (
                    <Marker
                      key={c.id}
                      position={[cLat, cLng]}
                      draggable={!readOnly}
                      eventHandlers={{
                        drag: (e) => handleMarkerDrag(c.id, e),
                        dragend: (e) => handleMarkerDragEnd(c.id, e),
                        click: () => {
                          setSelectedCtcnId(c.id);
                          setIsAddingCtcn(false);
                        }
                      }}
                      icon={L.divIcon({
                        html: `
                          <div class="relative flex items-center justify-center w-7 h-7 cursor-grab active:cursor-grabbing">
                            <div class="w-6 h-6 ${pinBg} rounded-full border-2 border-white shadow-md flex items-center justify-center text-white text-[10px] font-bold ${ringClass} transition-transform">
                              📍
                            </div>
                            <div class="absolute -top-6 bg-slate-900/90 text-white font-mono text-[9px] px-1.5 py-0.2 rounded shadow whitespace-nowrap pointer-events-none">
                              ${Math.round(c.distance)}m
                            </div>
                          </div>
                        `,
                        className: 'ctcn-pin',
                        iconSize: [28, 28],
                        iconAnchor: [14, 14]
                      })}
                    >
                      <Popup>
                        <div className="text-xs p-1 space-y-1 min-w-[160px]">
                          <strong className="block text-slate-900">{c.name}</strong>
                          <div>Khoảng cách chân cột: <strong className="text-blue-700">{c.distance}m</strong></div>
                          <div>Góc lệch hướng Bắc: <strong className="text-slate-800">{c.azimuth}°</strong></div>
                          <div>Sector: <strong>{c.affectedSectorName || 'Sector'}</strong> ({c.offsetAngle > 0 ? `+${c.offsetAngle}°` : `${c.offsetAngle}°`})</div>
                          <div className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-bold mt-1 text-center",
                            isHigh ? "bg-red-100 text-red-800" : isMed ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                          )}>
                            {isHigh ? "Điểm đo ưu tiên (Búp sóng chính)" : isMed ? "Cần đo kiểm" : "Ngoài búp sóng"}
                          </div>
                          {!readOnly && (
                            <div className="pt-1 text-[10px] text-slate-400 italic text-center">
                              (Có thể kéo trực tiếp marker này trên bản đồ)
                            </div>
                          )}
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}
              </MapContainer>

              {/* Floating Recenter Button on Satellite Map */}
              <div className="absolute bottom-3 right-3 z-[400]">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRecenterTrigger(prev => prev + 1);
                    setSelectedCtcnId(null);
                  }}
                  className="bg-slate-900/90 hover:bg-slate-900 text-white px-3 py-1.5 rounded-xl shadow-xl border border-white/20 flex items-center gap-1.5 text-xs font-bold transition-all hover:scale-105 active:scale-95 cursor-pointer backdrop-blur-md"
                  title="Căn giữa bản đồ về tâm chân cột anten"
                >
                  <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Về tâm trạm</span>
                </button>
              </div>
            </div>
          )}

          {/* Quick legend footer */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-[11px] font-medium text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
              Điểm đo ưu tiên (&lt;50m, búp chính)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              Cần đo kiểm (50-100m búp chính)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              Búp phụ / Ngoài vùng phủ chính
            </span>
          </div>
        </div>

        {/* Right Column: CTCN List & Editor Panel (5 cols) */}
        <div className="lg:col-span-5 p-4 sm:p-5 flex flex-col justify-between space-y-4 bg-white">
          <div className="space-y-4">
            {/* Action Bar */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-blue-600" />
                  Danh sách CTCN trong bán kính 100m ({ctcnList.length})
                </h4>
                <p className="text-[11px] text-slate-500">
                  {ctcnList.length > 0 
                    ? "Trạm thuộc diện BẮT BUỘC kiểm định theo QCVN 08" 
                    : "Chưa ghi nhận CTCN nào trong bán kính 100m"}
                </p>
              </div>

              {!readOnly && (
                <Button
                  size="sm"
                  onClick={() => {
                    setIsAddingCtcn(true);
                    setSelectedCtcnId(null);
                    setFormName(`CTCN-${ctcnList.length + 1}`);
                    setFormDistance(45);
                    setFormAzimuth(60);
                  }}
                  className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Thêm CTCN
                </Button>
              )}
            </div>

            {/* List of existing CTCNs */}
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {ctcnList.length === 0 ? (
                <div className="p-6 text-center rounded-2xl bg-slate-50 border border-dashed border-slate-200">
                  <Radar className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-slate-600">Chưa có công trình CTCN nào</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Chạm trực tiếp lên radar 100m ở bên trái hoặc bấm "Thêm CTCN" để đo đạc
                  </p>
                </div>
              ) : (
                ctcnList.map(c => {
                  const isSelected = c.id === selectedCtcnId;
                  const isHigh = c.exposureRisk === 'high';
                  const isMed = c.exposureRisk === 'medium';
                  const badgeColor = isHigh 
                    ? "bg-red-50 text-red-700 border-red-200" 
                    : isMed 
                    ? "bg-amber-50 text-amber-700 border-amber-200" 
                    : "bg-emerald-50 text-emerald-700 border-emerald-200";

                  return (
                    <div
                      key={c.id}
                      onClick={() => {
                        setSelectedCtcnId(c.id);
                        setIsAddingCtcn(false);
                      }}
                      className={cn(
                        "p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-2",
                        isSelected 
                          ? "bg-blue-50/80 border-blue-400 ring-2 ring-blue-500/20 shadow-xs" 
                          : "bg-slate-50/70 hover:bg-slate-50 border-slate-200"
                      )}
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900 truncate">
                            {c.name}
                          </span>
                          <span className={cn("text-[10px] font-bold px-1.5 py-0.2 rounded border", badgeColor)}>
                            {isHigh ? "Ưu tiên đo" : isMed ? "Cần đo" : "Búp phụ"}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                          <span>Cách chân trụ: <strong className="text-slate-700">{c.distance}m</strong></span>
                          <span>Hướng Bắc: <strong className="text-slate-700">{c.azimuth}°</strong></span>
                          <span>Thuộc: <strong className="text-blue-700">{c.affectedSectorName || 'Sector'}</strong> ({c.offsetAngle > 0 ? `+${c.offsetAngle}°` : `${c.offsetAngle}°`})</span>
                        </div>
                      </div>

                      {!readOnly && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              handleDeleteCtcn(c.id);
                            }}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition-colors"
                            title="Xóa CTCN này"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* CTCN Edit / Input Form */}
            {(isAddingCtcn || selectedCtcnId) && (
              <div className="p-3.5 rounded-2xl bg-blue-50/50 border border-blue-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-900 uppercase tracking-wider flex items-center gap-1.5">
                    <Edit3 className="w-3.5 h-3.5 text-blue-600" />
                    {selectedCtcnId ? 'Chi tiết / Chỉnh sửa CTCN' : 'Thêm mới CTCN'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingCtcn(false);
                      setSelectedCtcnId(null);
                    }}
                    className="text-slate-400 hover:text-slate-600 p-1"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Form fields */}
                <div className="space-y-2.5">
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 uppercase">Tên công trình (CTCN)</label>
                    <Input
                      value={formName}
                      onChange={(e: any) => setFormName(e.target.value)}
                      placeholder="VD: Nhà dân 4 tầng, Trường học..."
                      className="h-8 text-xs bg-white font-medium"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 uppercase">Khoảng cách chân cột (m)</label>
                      <div className="relative">
                        <Input
                          type="number"
                          min={1}
                          max={100}
                          value={formDistance}
                          onChange={(e: any) => setFormDistance(Math.min(100, Math.max(1, parseFloat(e.target.value) || 1)))}
                          className="h-8 text-xs bg-white font-bold pr-7"
                        />
                        <span className="absolute right-2.5 top-2 text-[10px] text-slate-400 font-bold">m</span>
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-600 uppercase">Góc lệch hướng Bắc (°)</label>
                      <div className="relative">
                        <Input
                          type="number"
                          min={0}
                          max={359}
                          value={formAzimuth}
                          onChange={(e: any) => setFormAzimuth(normalizeAngle(parseFloat(e.target.value) || 0))}
                          className="h-8 text-xs bg-white font-bold pr-7"
                        />
                        <span className="absolute right-2.5 top-2 text-[10px] text-slate-400 font-bold">°</span>
                      </div>
                    </div>
                  </div>

                  {/* Sliders for quick tactile adjustment */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-[10px] text-slate-500 font-medium">
                      <span>Cự ly: {formDistance}m</span>
                      <input
                        type="range"
                        min={1}
                        max={100}
                        value={formDistance}
                        onChange={e => setFormDistance(parseFloat(e.target.value))}
                        className="w-32 h-1.5 bg-blue-200 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-500 font-medium">
                      <span>Góc ngắm: {formAzimuth}°</span>
                      <input
                        type="range"
                        min={0}
                        max={359}
                        value={formAzimuth}
                        onChange={e => setFormAzimuth(parseFloat(e.target.value))}
                        className="w-32 h-1.5 bg-blue-200 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* Real-time Sector & QCVN 08 Analysis Card */}
                  <div className="p-2.5 rounded-xl bg-white border border-blue-100 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-800">
                        {currentAnalysis.affectedSectorName || 'Sector'}
                      </span>
                      <span className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded-full",
                        currentAnalysis.exposureRisk === 'high' 
                          ? "bg-red-100 text-red-800" 
                          : currentAnalysis.exposureRisk === 'medium'
                          ? "bg-amber-100 text-amber-800"
                          : "bg-emerald-100 text-emerald-800"
                      )}>
                        {currentAnalysis.exposureRisk === 'high'
                          ? "Điểm đo ưu tiên QCVN 08"
                          : currentAnalysis.exposureRisk === 'medium'
                          ? "Điểm đo cần lưu ý"
                          : "Ngoài búp sóng chính"}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-600 leading-relaxed">
                      Độ lệch búp sóng: <strong>{currentAnalysis.offsetAngle > 0 ? `+${currentAnalysis.offsetAngle}° (về phía Đông)` : `${currentAnalysis.offsetAngle}° (về phía Tây)`}</strong>.
                      {currentAnalysis.isInMainLobe ? (
                        <span className="text-amber-700 font-medium ml-1">
                          Nằm trong búp sóng ngang 65°.
                        </span>
                      ) : (
                        <span className="text-slate-500 ml-1">
                          Nằm ngoài búp sóng chính 65°.
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 uppercase">Loại công trình</label>
                      <select
                        value={formType}
                        onChange={(e: any) => setFormType(e.target.value)}
                        className="w-full h-8 px-2 bg-white border border-slate-200 rounded-lg text-xs font-medium"
                      >
                        {CTCN_BUILDING_TYPES.map(t => (
                          <option key={t.id} value={t.id}>
                            {t.icon} {t.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-600 uppercase">Số tầng / Cao (m)</label>
                      <div className="flex gap-1.5">
                        <Input
                          type="number"
                          placeholder="Tầng"
                          value={formFloors}
                          onChange={(e: any) => setFormFloors(parseInt(e.target.value) || 1)}
                          className="h-8 text-xs bg-white font-medium w-16"
                        />
                        <Input
                          type="number"
                          placeholder="Cao (m)"
                          value={formHeight}
                          onChange={(e: any) => setFormHeight(parseFloat(e.target.value) || 0)}
                          className="h-8 text-xs bg-white font-medium flex-1"
                        />
                      </div>
                    </div>
                  </div>

                  {!readOnly && (
                    <Button
                      size="sm"
                      onClick={handleSaveCtcn}
                      className="w-full h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-xs"
                    >
                      <CheckCircle className="w-3.5 h-3.5 mr-1" />
                      {selectedCtcnId ? 'Lưu cập nhật CTCN' : 'Thêm vào danh sách CTCN'}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Compliance Summary footer */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-1 text-[11px]">
              <Info className="w-3.5 h-3.5 text-blue-500" />
              Độ cao đo chuẩn: <strong>1.0m, 1.5m, 1.7m</strong>
            </span>
            <span className="font-bold text-[11px] text-blue-700">
              {ctcnList.length} CTCN đã ghi nhận
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
