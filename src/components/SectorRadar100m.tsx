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
  ChevronUp,
  ChevronDown,
  X,
  RotateCcw,
  Eye,
  EyeOff,
  Crosshair,
  Zap,
  Building,
  Building2,
  Minus,
  Sparkles,
  Navigation,
  Star,
  Trees,
  Waves,
  Milestone,
  Mountain,
  Sprout,
  Store,
  School,
  CheckCircle2,
  ArrowRight
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
  generateStandard6ObservationDirections,
  detectSurveyZone,
  SURVEY_OBJECT_PRESETS,
  SurveyObjectPreset,
  DetectedSurveyZone
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

function MobileMapOffsetPan({ 
  isModalOpen, 
  isMinimized 
}: { 
  isModalOpen: boolean; 
  isMinimized: boolean; 
}) {
  const map = useMap();

  useEffect(() => {
    // Whenever modal state or minimize changes, recalculate Leaflet canvas size so tiles render smoothly
    const t1 = setTimeout(() => {
      try {
        map.invalidateSize();
      } catch (e) {
        // ignore
      }
    }, 100);

    const t2 = setTimeout(() => {
      try {
        map.invalidateSize();
      } catch (e) {
        // ignore
      }
    }, 350);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isModalOpen, isMinimized, map]);

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

  const [activeView, setActiveView] = useState<'roadmap' | 'satellite' | 'radar'>('roadmap');
  const [tileProvider, setTileProvider] = useState<'google' | 'osm'>('google');
  const [selectedCtcnId, setSelectedCtcnId] = useState<string | null>(null);
  const [isEditingSectors, setIsEditingSectors] = useState(false);
  const [isAddingCtcn, setIsAddingCtcn] = useState(false);
  const [recenterTrigger, setRecenterTrigger] = useState(0);

  // Popup panel state (stays right over the map without hiding the map)
  const [isMapInputModalOpen, setIsMapInputModalOpen] = useState(false);
  const [isInputMinimized, setIsInputMinimized] = useState(false);
  const [isPeekingMap, setIsPeekingMap] = useState(false);
  const [isHeightCustomized, setIsHeightCustomized] = useState(false);

  // Form states
  const [formDistance, setFormDistance] = useState<number>(45);
  const [formAzimuth, setFormAzimuth] = useState<number>(60);
  const [formObjectCategory, setFormObjectCategory] = useState<'building' | 'landscape'>('building');
  const [formPresetId, setFormPresetId] = useState<string>('ctcn_house');
  const [formIsCtcn, setFormIsCtcn] = useState<boolean>(true);
  const [formIsTallest, setFormIsTallest] = useState<boolean>(false);
  const [formFloors, setFormFloors] = useState<number>(3);
  const [formHeight, setFormHeight] = useState<number>(10.5);
  const [formName, setFormName] = useState('');
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

  // Selected item
  const selectedCtcn = useMemo(() => {
    return ctcnList.find(c => c.id === selectedCtcnId) || null;
  }, [ctcnList, selectedCtcnId]);

  // Tự động nhận diện vùng khảo sát (S1, S2, S3 và các vùng ở giữa) dựa trên góc phương vị hiện tại
  const detectedZone = useMemo(() => {
    return detectSurveyZone(formAzimuth, sectors);
  }, [formAzimuth, sectors]);

  // Danh sách 6 vùng chuẩn QCVN 08 (3 hướng sector + 3 hướng xen kẽ) để hiển thị thanh tiến độ
  const standard6Directions = useMemo(() => {
    return generateStandard6ObservationDirections(sectors);
  }, [sectors]);

  // Sync state when an item is selected for editing
  useEffect(() => {
    if (selectedCtcn) {
      setFormName(selectedCtcn.name);
      setFormDistance(selectedCtcn.distance);
      setFormAzimuth(selectedCtcn.azimuth);
      setFormNotes(selectedCtcn.notes || '');
      setFormPhotoUrl(selectedCtcn.photoUrl || '');

      const isBuilding = selectedCtcn.objectCategory !== 'landscape' && !selectedCtcn.landscapeType;
      setFormObjectCategory(isBuilding ? 'building' : 'landscape');
      setFormPresetId(selectedCtcn.presetId || (isBuilding ? 'ctcn_house' : 'land_road'));
      setFormIsCtcn(selectedCtcn.isCtcn !== undefined ? selectedCtcn.isCtcn : isBuilding);
      setFormIsTallest(Boolean(selectedCtcn.isTallest));

      if (isBuilding) {
        setFormFloors(selectedCtcn.floors || 3);
        setFormHeight(selectedCtcn.heightMeters || 10.5);
      } else {
        setFormFloors(0);
        setFormHeight(0);
      }
      setIsHeightCustomized(true);
    }
  }, [selectedCtcn]);

  // Real-time analysis of the active draft
  const currentAnalysis = useMemo(() => {
    return analyzeCtcnSectorAndRisk(formAzimuth, formDistance, sectors);
  }, [formAzimuth, formDistance, sectors]);

  // Convert distance (0-100m) & azimuth (0-360 deg) to SVG canvas (x, y)
  const center = 250;
  const maxRadiusPx = 210; // represents 100 meters
  const scale = maxRadiusPx / 100; // 2.1 px/meter

  const polarToSvg = useCallback((distMeters: number, azDeg: number) => {
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

    let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    deg = normalizeAngle(deg);

    return { distance: distMeters, azimuth: deg };
  }, [scale]);

  // Setup default form when pointing to a new location
  const prepareNewPointForm = useCallback((dist: number, az: number) => {
    const zone = detectSurveyZone(az, sectors);
    setIsAddingCtcn(true);
    setSelectedCtcnId(null);
    setFormDistance(dist);
    setFormAzimuth(az);

    const defaultPreset = SURVEY_OBJECT_PRESETS.find(p => p.id === formPresetId) || SURVEY_OBJECT_PRESETS[0];
    setFormName(defaultPreset.defaultName(dist, az, zone.zoneName));
    if (formObjectCategory === 'building') {
      setFormFloors(3);
      setFormHeight(10.5);
      setFormIsCtcn(true);
    } else {
      setFormFloors(0);
      setFormHeight(0);
      setFormIsCtcn(false);
    }
    setIsHeightCustomized(false);
    setIsMapInputModalOpen(true);
  }, [sectors, formPresetId, formObjectCategory]);

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
      prepareNewPointForm(distance, azimuth);
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
    if (!isDragging) return;
    setIsDragging(false);
    if (readOnly) return;

    if (!selectedCtcnId) {
      prepareNewPointForm(formDistance, formAzimuth);
    }
    setIsMapInputModalOpen(true);
  };

  // Handle click on Satellite map
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

    if (!selectedCtcnId) {
      prepareNewPointForm(clamped.distance, clamped.azimuth);
    } else {
      const analysis = analyzeCtcnSectorAndRisk(clamped.azimuth, clamped.distance, sectors);
      const zone = detectSurveyZone(clamped.azimuth, sectors);
      setCtcnList(prev => prev.map(c => {
        if (c.id === selectedCtcnId) {
          return {
            ...c,
            distance: clamped.distance,
            azimuth: clamped.azimuth,
            latitude: clamped.latitude,
            longitude: clamped.longitude,
            zoneKey: zone.zoneKey,
            zoneName: zone.zoneName,
            directionType: zone.zoneType,
            directionLabel: zone.zoneName,
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
    setIsMapInputModalOpen(true);
    // On mobile screens, keep the bottom bar minimized so the map, surveyed point, and sectors remain 100% visible!
    // The user can easily tap "Điền thông số" at any time to open the full form.
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    if (isMobile) {
      setIsInputMinimized(true);
    }
  }, [readOnly, station, selectedCtcnId, sectors, prepareNewPointForm]);

  // Handle continuous rotation sweep on Satellite map
  const handleSatelliteMouseMove = useCallback((lat: number, lng: number) => {
    if (readOnly) return;
    const stLat = station.latitude || 21.0;
    const stLng = station.longitude || 105.8;
    const clamped = clampToMaxDistance(stLat, stLng, lat, lng, 100);

    setFormDistance(clamped.distance);
    setFormAzimuth(clamped.azimuth);

    setSatelliteDragInfo({
      active: true,
      lat: clamped.latitude,
      lng: clamped.longitude,
      distance: clamped.distance,
      azimuth: clamped.azimuth,
      clamped: clamped.clamped
    });
  }, [readOnly, station]);

  // Handle marker drag on Satellite map
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
    const zone = detectSurveyZone(clamped.azimuth, sectors);

    setCtcnList(prev => prev.map(c => {
      if (c.id === ctcnId) {
        return {
          ...c,
          distance: clamped.distance,
          azimuth: clamped.azimuth,
          latitude: clamped.latitude,
          longitude: clamped.longitude,
          zoneKey: zone.zoneKey,
          zoneName: zone.zoneName,
          directionType: zone.zoneType,
          directionLabel: zone.zoneName,
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

  // Chọn loại đối tượng khảo sát (Preset)
  const handleSelectPreset = (preset: SurveyObjectPreset) => {
    setFormPresetId(preset.id);
    setFormObjectCategory(preset.category);

    const isBuilding = preset.category === 'building';
    setFormIsCtcn(isBuilding);

    if (isBuilding) {
      if (formFloors === 0) setFormFloors(3);
      if (formHeight === 0) setFormHeight(10.5);
    } else {
      // Đối tượng cảnh quan: bỏ qua cao độ & số tầng
      setFormFloors(0);
      setFormHeight(0);
      setFormIsTallest(false);
    }

    // Tự động gợi ý tên
    setFormName(preset.defaultName(formDistance, formAzimuth, detectedZone.zoneName));
  };

  // Save current surveyed point
  const handleSaveCtcn = () => {
    if (!formName.trim()) return;

    const analysis = analyzeCtcnSectorAndRisk(formAzimuth, formDistance, sectors);
    const destGps = computeDestinationPoint(
      station.latitude || 21.0,
      station.longitude || 105.8,
      formDistance,
      formAzimuth
    );

    const preset = SURVEY_OBJECT_PRESETS.find(p => p.id === formPresetId);
    const isBuilding = formObjectCategory === 'building';
    const effectiveIsCtcn = isBuilding ? formIsCtcn : false;
    const effectiveFloors = isBuilding ? formFloors : undefined;
    const effectiveHeight = isBuilding ? formHeight : undefined;

    // Nếu người dùng đánh dấu đây là CTCN cao nhất hướng này, bỏ đánh dấu điểm khác cùng zone
    let updatedList = [...ctcnList];
    if (formIsTallest && isBuilding) {
      updatedList = updatedList.map(c => {
        if (c.zoneKey === detectedZone.zoneKey && c.id !== selectedCtcnId) {
          return { ...c, isTallest: false };
        }
        return c;
      });
    }

    const newCtcn: CtcnObstacle = {
      id: selectedCtcnId || `obs-${Date.now()}`,
      name: formName.trim() || (preset?.name || 'Điểm khảo sát'),
      buildingType: isBuilding ? (preset?.buildingType || 'residential') : 'other',
      distance: formDistance,
      azimuth: formAzimuth,
      latitude: destGps.latitude || station.latitude || 0,
      longitude: destGps.longitude || station.longitude || 0,
      heightMeters: effectiveHeight || 0,
      floors: effectiveFloors || 0,
      notes: formNotes || '',
      photoUrl: formPhotoUrl || '',

      // Smart fields
      isCtcn: effectiveIsCtcn,
      isTallest: Boolean(isBuilding && formIsTallest),
      objectCategory: formObjectCategory,
      presetId: formPresetId || (isBuilding ? 'ctcn_house' : 'land_road'),
      landscapeType: !isBuilding ? (preset?.landscapeType || 'road') : 'other',
      zoneKey: detectedZone.zoneKey || '',
      zoneName: detectedZone.zoneName || '',
      directionType: detectedZone.zoneType || 'custom',
      directionLabel: detectedZone.zoneName || '',
      surveyCategory: formPresetId || 'other',
      categoryLabel: preset?.name || (isBuilding ? 'Công trình CTCN' : 'Cảnh quan'),

      affectedSectorId: analysis.affectedSectorId || '',
      affectedSectorName: analysis.affectedSectorName || '',
      offsetAngle: analysis.offsetAngle || 0,
      isInMainLobe: Boolean(analysis.isInMainLobe),
      exposureRisk: analysis.exposureRisk || 'low',
      inspectionPointHeight: 1.5,
      createdAt: selectedCtcn?.createdAt || new Date().toISOString()
    };

    if (selectedCtcnId) {
      setCtcnList(updatedList.map(c => c.id === selectedCtcnId ? newCtcn : c));
    } else {
      setCtcnList([...updatedList, newCtcn]);
      setSelectedCtcnId(newCtcn.id);
    }
    setIsAddingCtcn(false);
    setIsMapInputModalOpen(false);
  };

  const handleDeleteCtcn = (id: string) => {
    setCtcnList(prev => prev.filter(c => c.id !== id));
    if (selectedCtcnId === id) {
      setSelectedCtcnId(null);
      setIsMapInputModalOpen(false);
    }
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

  // Helper to get visual pin presentation for each obstacle
  const getPointVisualMeta = (c: CtcnObstacle) => {
    if (c.isTallest) {
      return {
        icon: '⭐',
        color: '#f59e0b',
        bgClass: 'bg-amber-500',
        label: `⭐ ${c.floors ? `${c.floors}T` : ''} (${c.heightMeters || 0}m)`,
        badgeText: 'CTCN Cao nhất'
      };
    }
    if (c.objectCategory === 'landscape' || c.landscapeType) {
      switch (c.landscapeType) {
        case 'water':
          return { icon: '🌊', color: '#0284c7', bgClass: 'bg-cyan-600', label: '🌊 Sông hồ', badgeText: 'Sông hồ' };
        case 'field':
          return { icon: '🌾', color: '#65a30d', bgClass: 'bg-lime-600', label: '🌾 Đồng ruộng', badgeText: 'Đồng ruộng' };
        case 'garden':
          return { icon: '🌳', color: '#16a34a', bgClass: 'bg-emerald-600', label: '🌳 Vườn cây', badgeText: 'Vườn cây' };
        case 'road':
          return { icon: '🛣️', color: '#64748b', bgClass: 'bg-slate-600', label: '🛣️ Đường xá', badgeText: 'Đường xá' };
        case 'hill':
          return { icon: '⛰️', color: '#78716c', bgClass: 'bg-stone-600', label: '⛰️ Đồi núi', badgeText: 'Đồi núi' };
        default:
          return { icon: '🅿️', color: '#0d9488', bgClass: 'bg-teal-600', label: '🅿️ Đất trống', badgeText: 'Đất trống' };
      }
    }
    // CTCN default
    return {
      icon: '🏢',
      color: c.exposureRisk === 'high' ? '#ef4444' : '#3b82f6',
      bgClass: c.exposureRisk === 'high' ? 'bg-red-600' : 'bg-blue-600',
      label: `🏢 ${c.floors ? `${c.floors}T` : 'CT'} (${Math.round(c.distance)}m)`,
      badgeText: c.isCtcn ? 'CTCN' : 'Công trình'
    };
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden space-y-0 relative">
      {/* Top Toolbar */}
      <div className="px-3 py-2 bg-slate-900 text-white flex items-center justify-between gap-2 border-b border-slate-800 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center bg-slate-800 p-0.5 rounded-xl border border-slate-700/60 text-xs">
            <button
              type="button"
              onClick={() => setActiveView('roadmap')}
              className={cn(
                "px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer font-bold",
                activeView === 'roadmap' ? "bg-blue-600 text-white shadow-xs" : "text-slate-300 hover:text-white"
              )}
              title="Xem bản đồ số đường xá, địa vật mặt bằng (MB)"
            >
              <MapIcon className="w-3.5 h-3.5" />
              <span>Mặt bằng (MB)</span>
            </button>
            {activeView === 'roadmap' && (
              <button
                type="button"
                onClick={() => setTileProvider(prev => prev === 'google' ? 'osm' : 'google')}
                className="px-1.5 py-0.5 text-[9px] font-mono text-cyan-300 bg-slate-900 hover:bg-slate-700 rounded mr-0.5 border border-white/10 cursor-pointer"
                title="Đổi nguồn bản đồ: Google Maps hoặc OpenStreetMap"
              >
                {tileProvider === 'google' ? 'Google' : 'OSM'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveView('satellite')}
              className={cn(
                "px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer font-bold",
                activeView === 'satellite' ? "bg-emerald-600 text-white shadow-xs" : "text-slate-300 hover:text-white"
              )}
              title="Xem ảnh vệ tinh độ phân giải cao"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Vệ tinh</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveView('radar')}
              className={cn(
                "px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer font-bold",
                activeView === 'radar' ? "bg-indigo-600 text-white shadow-xs" : "text-slate-300 hover:text-white"
              )}
              title="Xem lưới tọa độ cực Radar vector"
            >
              <Radar className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">Lưới Radar</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setRecenterTrigger(prev => prev + 1);
              setSelectedCtcnId(null);
            }}
            className="h-7 px-2.5 text-xs bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 hover:text-white flex items-center gap-1 font-semibold rounded-lg cursor-pointer"
            title="Đưa tâm bản đồ về chính giữa trạm"
          >
            <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
            <span>Về tâm</span>
          </Button>

          {!readOnly && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setIsEditingSectors(!isEditingSectors)}
              className="h-7 px-2 text-xs bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 hover:text-white flex items-center gap-1 font-semibold rounded-lg cursor-pointer"
            >
              <Sliders className="w-3 h-3 text-blue-400" />
              <span>{isEditingSectors ? 'Xong' : 'Sửa Sector'}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Thông minh: Thanh 6 Hướng Khảo sát QCVN 08 (Tự động biết vùng & Bấm để khớp nhanh) */}
      <div className="px-3.5 py-2 bg-slate-950/95 border-b border-slate-800 text-white flex items-center justify-between gap-2 overflow-x-auto text-xs">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] uppercase font-bold tracking-wider text-cyan-400">
            6 Vùng QCVN 08:
          </span>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto shrink-0">
          {standard6Directions.map((dir, idx) => {
            const isMain = dir.directionType === 'sector_main';
            // Check if any surveyed point matches this zone
            const matchedPoint = ctcnList.find(c => {
              if (c.zoneName && c.zoneName.includes(dir.name)) return true;
              return Math.abs(angularDifference(dir.azimuth, c.azimuth)) <= 25;
            });
            const hasTallest = matchedPoint?.isTallest;

            return (
              <button
                key={dir.id}
                type="button"
                onClick={() => {
                  setFormAzimuth(dir.azimuth);
                  if (matchedPoint) {
                    setSelectedCtcnId(matchedPoint.id);
                    setFormDistance(matchedPoint.distance);
                  } else {
                    setSelectedCtcnId(null);
                    setFormDistance(isMain ? 45 : 35);
                  }
                  setIsMapInputModalOpen(true);
                }}
                className={cn(
                  "px-2 py-0.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap",
                  matchedPoint
                    ? hasTallest
                      ? "bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-xs"
                      : "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                    : "bg-slate-800/80 text-slate-300 hover:text-white border-slate-700 hover:border-slate-500"
                )}
                title={`Bấm để xem/khảo sát ${dir.name} (${dir.azimuth}°)`}
              >
                <span>{dir.name.replace('Hướng ', '')} ({dir.azimuth}°)</span>
                {matchedPoint ? (
                  <span className="text-xs">
                    {hasTallest ? '⭐' : matchedPoint.objectCategory === 'landscape' ? '🍃' : '🏢'}
                  </span>
                ) : (
                  <span className="text-[9px] text-slate-500 font-mono">+</span>
                )}
              </button>
            );
          })}
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
            {sectors.map((sec) => (
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

      {/* Main Grid: Visual Map/Radar (7 cols) + Right Info / List Panel (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 relative">
        {/* Left Column: Visual Map Area with Floating Popup (BẢN ĐỒ VẪN GIỮ NGUYÊN) */}
        <div className="lg:col-span-7 p-2 sm:p-3 flex flex-col items-center justify-center bg-slate-950/5 relative overflow-hidden">
          {activeView === 'radar' ? (
            <div className="w-full max-w-[460px] aspect-square relative select-none">
              {/* Radar Instructions Overlay */}
              <div className="absolute top-2 left-2 z-10 pointer-events-none bg-slate-900/80 backdrop-blur-md px-2.5 py-1 rounded-xl text-[11px] text-slate-200 border border-white/10 flex items-center gap-1.5 shadow-md">
                <Crosshair className="w-3.5 h-3.5 text-blue-400" />
                <span>Chạm bản đồ để khảo sát • Hệ thống tự nhận diện vùng</span>
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
                  <radialGradient id="radarBg" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#0f172a" stopOpacity="0.05" />
                    <stop offset="70%" stopColor="#1e293b" stopOpacity="0.08" />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.15" />
                  </radialGradient>
                  
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

                {/* Compass Cardinal Points */}
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
                  const labelPt = polarToSvg(72, sec.azimuth);
                  const color = sec.color || '#3b82f6';

                  return (
                    <g key={sec.id}>
                      <path
                        d={wedgePath}
                        fill={color}
                        fillOpacity="0.22"
                        stroke={color}
                        strokeWidth="1.5"
                        strokeDasharray="4 2"
                      />
                      <line
                        x1={center}
                        y1={center}
                        x2={mainLinePt.x}
                        y2={mainLinePt.y}
                        stroke={color}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
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

                {/* Tower Center Mast */}
                <circle cx={center} cy={center} r="14" fill="#3b82f6" fillOpacity="0.2" className="animate-ping" />
                <circle cx={center} cy={center} r="9" fill="#1e293b" stroke="#ffffff" strokeWidth="2.5" />
                <circle cx={center} cy={center} r="3.5" fill="#ef4444" />
                <text x={center} y={center + 20} fill="#1e293b" fontSize="9" fontWeight="900" textAnchor="middle">
                  CHÂN CỘT (0m)
                </text>

                {/* Draw saved points on Radar with distinct icons */}
                {ctcnList.map(c => {
                  const pt = polarToSvg(c.distance, c.azimuth);
                  const isSelected = c.id === selectedCtcnId;
                  const meta = getPointVisualMeta(c);

                  return (
                    <g
                      key={c.id}
                      className="cursor-pointer transition-transform"
                      onClick={e => {
                        e.stopPropagation();
                        setSelectedCtcnId(c.id);
                        setIsAddingCtcn(false);
                        setIsMapInputModalOpen(true);
                      }}
                    >
                      <line
                        x1={center}
                        y1={center}
                        x2={pt.x}
                        y2={pt.y}
                        stroke={meta.color}
                        strokeWidth={isSelected ? "2.5" : "1"}
                        strokeDasharray={isSelected ? "" : "3 3"}
                        strokeOpacity={isSelected ? "1" : "0.5"}
                      />

                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={isSelected ? "13" : "10"}
                        fill={meta.color}
                        stroke="#ffffff"
                        strokeWidth="2.5"
                        filter={isSelected ? "url(#glow)" : undefined}
                      />
                      <text
                        x={pt.x}
                        y={pt.y + 3.5}
                        fontSize={isSelected ? "10" : "8"}
                        textAnchor="middle"
                        className="select-none pointer-events-none"
                      >
                        {meta.icon}
                      </text>

                      {/* Label badge */}
                      <rect
                        x={pt.x - 40}
                        y={pt.y - 24}
                        width="80"
                        height="16"
                        rx="4"
                        fill="#0f172a"
                        fillOpacity="0.9"
                        stroke={isSelected ? "#ffffff" : meta.color}
                        strokeWidth={isSelected ? "1.5" : "0.5"}
                      />
                      <text
                        x={pt.x}
                        y={pt.y - 13}
                        fill="#ffffff"
                        fontSize="8"
                        fontWeight="bold"
                        textAnchor="middle"
                      >
                        {meta.label}
                      </text>
                    </g>
                  );
                })}

                {/* Active Draft Reticle */}
                {(isAddingCtcn || isDragging || isMapInputModalOpen) && (
                  (() => {
                    const draftPt = polarToSvg(formDistance, formAzimuth);
                    const activeColor = detectedZone.badgeColor || '#38bdf8';

                    return (
                      <g pointerEvents="none">
                        <line
                          x1={center}
                          y1={center}
                          x2={draftPt.x}
                          y2={draftPt.y}
                          stroke={activeColor}
                          strokeWidth="2.5"
                          strokeDasharray="4 2"
                        />
                        <circle
                          cx={draftPt.x}
                          cy={draftPt.y}
                          r="15"
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
                        <rect
                          x={draftPt.x - 48}
                          y={draftPt.y + 14}
                          width="96"
                          height="18"
                          rx="5"
                          fill="#0f172a"
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
                          {formDistance}m | {formAzimuth}°
                        </text>
                      </g>
                    );
                  })()
                )}
              </svg>
            </div>
          ) : (
            /* Leaflet Interactive Map View (Mặt bằng MB & Vệ tinh) */
            <div className="w-full h-[480px] sm:h-[530px] lg:h-[560px] rounded-2xl overflow-hidden border border-slate-200 relative select-none">
              {/* Map Floating Header Badges & Actions */}
              <div className="absolute top-2.5 left-2.5 right-2.5 z-[400] flex items-center justify-between gap-2 pointer-events-auto">
                <div className="flex items-center gap-1.5">
                  <span className="bg-slate-900/90 backdrop-blur-md px-2.5 py-1 rounded-xl text-xs font-bold text-white border border-white/20 flex items-center gap-1.5 shadow-md">
                    <Radar className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Bán kính 100m</span>
                  </span>
                  {clampedWarning && (
                    <span className="bg-amber-500/95 text-slate-950 font-bold px-2 py-0.5 rounded-lg text-[10px] shadow border border-amber-300 animate-pulse">
                      {clampedWarning}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  {isMapInputModalOpen ? (
                    <button
                      type="button"
                      onClick={() => setIsMapInputModalOpen(false)}
                      className="px-2.5 py-1 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white flex items-center gap-1 shadow-md cursor-pointer border border-white/20"
                      title="Xem danh sách các điểm đã khảo sát"
                    >
                      <FileText className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Xem danh sách</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => prepareNewPointForm(45, 60)}
                      className="px-2.5 py-1 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1 shadow-md cursor-pointer"
                      title="Thêm điểm khảo sát mới"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Thêm điểm</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRecenterTrigger(prev => prev + 1);
                      setSelectedCtcnId(null);
                    }}
                    className="bg-slate-900/90 hover:bg-slate-800 text-white px-2.5 py-1 rounded-xl shadow-md border border-white/20 flex items-center gap-1 text-xs font-bold transition-all active:scale-95 cursor-pointer backdrop-blur-md"
                    title="Căn giữa bản đồ về tâm chân cột anten"
                  >
                    <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="hidden xs:inline">Về tâm</span>
                  </button>
                </div>
              </div>

              {/* Bottom Quick Angle Snapping Bar (Chỉ hiện khi chưa mở biểu mẫu khảo sát) */}
              {!isMapInputModalOpen && (
                <div className="absolute bottom-2.5 left-2.5 right-2.5 z-[400] bg-slate-950/90 backdrop-blur-md px-3 py-1.5 rounded-2xl text-white border border-white/15 flex flex-wrap items-center justify-between gap-1.5 shadow-2xl pointer-events-auto">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Tọa độ:</span>
                    <span className="text-xs font-mono font-bold text-cyan-300 px-1.5 py-0.5 bg-slate-900 rounded-lg border border-cyan-500/30">
                      {formAzimuth}° | {formDistance}m
                    </span>
                    <button
                      type="button"
                      onClick={() => setFormAzimuth(prev => normalizeAngle(prev - 5))}
                      className="px-1.5 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-mono font-bold border border-white/10 cursor-pointer"
                    >
                      -5°
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormAzimuth(prev => normalizeAngle(prev + 5))}
                      className="px-1.5 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-mono font-bold border border-white/10 cursor-pointer"
                    >
                      +5°
                    </button>
                  </div>

                  <div className="flex items-center gap-1 overflow-x-auto">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold hidden md:inline">Khớp Sector:</span>
                    {sectors.map(sec => (
                      <button
                        key={sec.id}
                        type="button"
                        onClick={() => setFormAzimuth(sec.azimuth)}
                        className="px-2 py-0.5 rounded-lg bg-blue-900/80 hover:bg-blue-600 text-white text-[11px] font-semibold border border-blue-400/30 whitespace-nowrap shadow cursor-pointer transition-colors"
                      >
                        {sec.name} ({sec.azimuth}°)
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <MapContainer
                center={[station.latitude || 21.0, station.longitude || 105.8]}
                zoom={18}
                className="w-full h-full cursor-crosshair"
                scrollWheelZoom={true}
                attributionControl={false}
              >
                <MapResizer />
                <MapRecenterFly trigger={recenterTrigger} center={[station.latitude || 21.0, station.longitude || 105.8]} />
                <MobileMapOffsetPan 
                  isModalOpen={isMapInputModalOpen}
                  isMinimized={isInputMinimized}
                />
                <SatelliteMapEvents 
                  onMapClick={handleSatelliteClick} 
                  onMapMouseMove={handleSatelliteMouseMove}
                  isRotateMode={isSweepRotateMode}
                  disabled={readOnly} 
                />

                <TileLayer
                  key={`${activeView}-${tileProvider}`}
                  url={
                    activeView === 'satellite'
                      ? MAP_TILE_PROVIDERS.satellite.url
                      : tileProvider === 'osm'
                      ? MAP_TILE_PROVIDERS.osm.url
                      : MAP_TILE_PROVIDERS.google.url
                  }
                  attribution={
                    activeView === 'satellite'
                      ? MAP_TILE_PROVIDERS.satellite.attribution
                      : tileProvider === 'osm'
                      ? MAP_TILE_PROVIDERS.osm.attribution
                      : MAP_TILE_PROVIDERS.google.attribution
                  }
                  subdomains={
                    activeView === 'satellite'
                      ? (MAP_TILE_PROVIDERS.satellite.subdomains || ['mt0', 'mt1', 'mt2', 'mt3'])
                      : tileProvider === 'osm'
                      ? (MAP_TILE_PROVIDERS.osm.subdomains || ['a', 'b', 'c'])
                      : (MAP_TILE_PROVIDERS.google.subdomains || ['mt0', 'mt1', 'mt2', 'mt3'])
                  }
                  maxZoom={activeView === 'satellite' ? 20 : tileProvider === 'osm' ? 19 : 20}
                />

                {/* 100m Buffer Circle */}
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

                {/* 50m Warning Circle */}
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

                {/* Sector Fan Polygons */}
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

                {/* Tower Mast Marker */}
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
                      <div>Tâm chân cột anten (0m)</div>
                    </div>
                  </Popup>
                </Marker>

                {/* Dynamic Guideline & Interactive Reticle */}
                {(() => {
                  const draftGps = computeDestinationPoint(
                    station.latitude || 21.0,
                    station.longitude || 105.8,
                    formDistance,
                    formAzimuth
                  );

                  return (
                    <React.Fragment key="aiming-reticle-guideline">
                      <Polyline
                        positions={[
                          [station.latitude || 21.0, station.longitude || 105.8],
                          [draftGps.latitude, draftGps.longitude]
                        ]}
                        pathOptions={{
                          color: '#38bdf8',
                          weight: 3,
                          dashArray: '5, 5'
                        }}
                      />

                      <Marker
                        position={[draftGps.latitude, draftGps.longitude]}
                        draggable={!readOnly}
                        eventHandlers={{
                          drag: (e) => {
                            if (readOnly) return;
                            const marker = e.target as L.Marker;
                            const pos = marker.getLatLng();
                            const stLat = station.latitude || 21.0;
                            const stLng = station.longitude || 105.8;
                            const clamped = clampToMaxDistance(stLat, stLng, pos.lat, pos.lng, 100);

                            setFormDistance(clamped.distance);
                            setFormAzimuth(clamped.azimuth);
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

                {/* Surveyed Markers on Map */}
                {ctcnList.map(c => {
                  const cLat = c.latitude || station.latitude || 21.0;
                  const cLng = c.longitude || station.longitude || 105.8;
                  const isSelected = c.id === selectedCtcnId;
                  const meta = getPointVisualMeta(c);
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
                          setIsMapInputModalOpen(true);
                        }
                      }}
                      icon={L.divIcon({
                        html: `
                          <div class="relative flex items-center justify-center w-7 h-7 cursor-grab active:cursor-grabbing">
                            <div class="w-6 h-6 ${meta.bgClass} rounded-full border-2 border-white shadow-md flex items-center justify-center text-white text-[11px] font-bold ${ringClass} transition-transform">
                              ${meta.icon}
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
                        <div className="text-xs p-1 space-y-1 min-w-[170px]">
                          <strong className="block text-slate-900">{c.name}</strong>
                          <div className="text-[11px] text-blue-700 font-semibold">{c.zoneName || 'Vùng khảo sát'}</div>
                          <div>Khoảng cách chân cột: <strong>{c.distance}m</strong></div>
                          <div>Góc phương vị Bắc: <strong>{c.azimuth}°</strong></div>
                          {c.floors ? (
                            <div>Quy mô: <strong>{c.floors} tầng ({c.heightMeters || 0}m)</strong></div>
                          ) : (
                            <div className="text-emerald-700 font-semibold">Cảnh quan tự nhiên (Không cần cao độ)</div>
                          )}
                          {c.isTallest && (
                            <div className="bg-amber-100 text-amber-900 font-bold px-1.5 py-0.5 rounded text-[10px] text-center">
                              ⭐ CTCN Cao nhất hướng này
                            </div>
                          )}
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}
              </MapContainer>
            </div>
          )}

          {/* Quick legend footer */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-[11px] font-medium text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              ⭐ CTCN cao nhất
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
              🏢 CTCN (Nhà dân, cơ quan)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
              🍃 Cảnh quan (Đường, ruộng, sông)
            </span>
          </div>

          {/* Quick Mobile Action Bar (Chỉ hiện trên Mobile khi đang chấm/chọn điểm) */}
          {isMapInputModalOpen && (
            <div className="lg:hidden w-full mt-3 bg-slate-900 text-white p-2.5 rounded-2xl border border-slate-700 shadow-lg flex items-center justify-between gap-2 animate-in fade-in pointer-events-auto">
              <div className="min-w-0 pr-1">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: detectedZone.badgeColor }} />
                  <span className="font-bold text-xs truncate text-cyan-300">
                    {formName || detectedZone.zoneName}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5 mt-0.5">
                  <span className="text-amber-400 font-bold">{formDistance}m</span>
                  <span>•</span>
                  <span>{formAzimuth}°</span>
                  <span>•</span>
                  <span className="text-emerald-300">
                    {formObjectCategory === 'building' ? `${formFloors}T (${formHeight}m)` : 'Cảnh quan'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const el = document.getElementById('point-survey-form-container');
                    if (el) el.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="px-2.5 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white rounded-xl flex items-center gap-1 cursor-pointer shadow-xs"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Điền thông số ↓</span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveCtcn}
                  className="px-2.5 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl flex items-center gap-1 cursor-pointer shadow-xs"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Lưu</span>
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Right Column: Survey Points List OR Survey Point Form (5 cols) */}
        <div 
          id="point-survey-form-container"
          className="lg:col-span-5 p-4 sm:p-5 flex flex-col justify-between space-y-4 bg-white min-h-[500px]"
        >
          {isMapInputModalOpen ? (
            /* ACTIVE SURVEY POINT FORM */
            <div className="flex flex-col h-full space-y-3.5 animate-in fade-in duration-200">
              {/* Form Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span 
                      className="w-2.5 h-2.5 rounded-full shrink-0" 
                      style={{ backgroundColor: detectedZone.badgeColor }} 
                    />
                    <h4 className="font-bold text-slate-800 text-sm truncate">
                      {selectedCtcnId ? 'Chỉnh sửa điểm khảo sát' : 'Khảo sát điểm mới'}
                    </h4>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500 font-mono">
                    <span className="text-blue-700 font-semibold">{detectedZone.zoneName}</span>
                    <span>•</span>
                    <span>Cách cột: <strong className="text-amber-600 font-bold">{formDistance}m</strong></span>
                    <span>•</span>
                    <span>Góc: <strong className="text-slate-800 font-bold">{formAzimuth}°</strong></span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {detectedZone.offsetAngle !== 0 && (
                    <button
                      type="button"
                      onClick={() => setFormAzimuth(detectedZone.centerAzimuth)}
                      className="px-2 py-1 text-[10px] font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg border border-blue-200 cursor-pointer hidden sm:inline"
                      title="Khớp chính xác góc tâm búp sóng"
                    >
                      Khớp {detectedZone.centerAzimuth}°
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setIsMapInputModalOpen(false);
                      setSelectedCtcnId(null);
                    }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer transition-colors"
                    title="Đóng / Quay lại danh sách"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Form Scrollable Content */}
              <div className="space-y-3.5 text-xs overflow-y-auto max-h-[460px] pr-1">
                {/* 1. Phân loại đối tượng */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide block">
                    Phân loại đối tượng tại điểm này
                  </label>
                  <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setFormObjectCategory('building');
                        setFormIsCtcn(true);
                        if (formFloors === 0) setFormFloors(3);
                        if (formHeight === 0) setFormHeight(10.5);
                        const p = SURVEY_OBJECT_PRESETS.find(x => x.id === 'ctcn_house');
                        if (p) setFormPresetId(p.id);
                      }}
                      className={cn(
                        "py-2 px-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer",
                        formObjectCategory === 'building'
                          ? "bg-blue-600 text-white shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      )}
                    >
                      <Building className="w-3.5 h-3.5" />
                      <span>Công trình / CTCN</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setFormObjectCategory('landscape');
                        setFormIsCtcn(false);
                        setFormIsTallest(false);
                        setFormFloors(0);
                        setFormHeight(0);
                        const p = SURVEY_OBJECT_PRESETS.find(x => x.id === 'land_field');
                        if (p) {
                          setFormPresetId(p.id);
                          setFormName(p.defaultName(formDistance, formAzimuth, detectedZone.zoneName));
                        }
                      }}
                      className={cn(
                        "py-2 px-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer",
                        formObjectCategory === 'landscape'
                          ? "bg-emerald-600 text-white shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      )}
                    >
                      <Trees className="w-3.5 h-3.5" />
                      <span>Cảnh quan & Đất</span>
                    </button>
                  </div>
                </div>

                {/* 2. Presets đối tượng */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wide block">
                    {formObjectCategory === 'building' ? 'Loại công trình (Chọn nhanh 1 chạm)' : 'Loại cảnh quan (Chọn nhanh 1 chạm)'}
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {SURVEY_OBJECT_PRESETS.filter(p => p.category === formObjectCategory).map(preset => {
                      const isSelected = formPresetId === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => handleSelectPreset(preset)}
                          className={cn(
                            "p-2 rounded-xl border text-left flex items-start gap-2 transition-all cursor-pointer",
                            isSelected
                              ? "bg-blue-50 border-blue-500 ring-2 ring-blue-500/20 text-blue-900 shadow-xs font-semibold"
                              : "bg-white hover:bg-slate-50 border-slate-200 text-slate-700"
                          )}
                        >
                          <span className="text-base shrink-0">{preset.icon}</span>
                          <div className="min-w-0">
                            <span className="font-bold text-xs block leading-tight truncate">
                              {preset.shortLabel}
                            </span>
                            <span className="text-[10px] text-slate-500 line-clamp-1">
                              {preset.description}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 3. Chi tiết Công trình: Số tầng, Cao độ, CTCN cao nhất */}
                {formObjectCategory === 'building' ? (
                  <div className="space-y-3 p-3 bg-slate-50 rounded-2xl border border-slate-200">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                        Thông số quy mô công trình
                      </span>
                      <span className="text-[10px] text-blue-600 font-semibold bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-200">
                        1 tầng ≈ 3.5m
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {/* Số tầng */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-600 uppercase block">
                          Số tầng
                        </label>
                        <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1">
                          <button
                            type="button"
                            onClick={() => {
                              const next = Math.max(1, formFloors - 1);
                              setFormFloors(next);
                              if (!isHeightCustomized) setFormHeight(next * 3.5);
                            }}
                            className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center cursor-pointer transition-colors"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={50}
                            value={formFloors}
                            onChange={e => {
                              const val = Math.max(1, parseInt(e.target.value) || 1);
                              setFormFloors(val);
                              if (!isHeightCustomized) setFormHeight(val * 3.5);
                            }}
                            className="w-full text-center font-bold text-xs outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const next = formFloors + 1;
                              setFormFloors(next);
                              if (!isHeightCustomized) setFormHeight(next * 3.5);
                            }}
                            className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center cursor-pointer transition-colors"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      {/* Cao độ mét */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-bold text-slate-600 uppercase block">
                            Cao độ (m)
                          </label>
                          {isHeightCustomized && (
                            <button
                              type="button"
                              onClick={() => {
                                setIsHeightCustomized(false);
                                setFormHeight(formFloors * 3.5);
                              }}
                              className="text-[9px] text-blue-600 hover:underline"
                            >
                              Theo tầng
                            </button>
                          )}
                        </div>
                        <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1">
                          <button
                            type="button"
                            onClick={() => {
                              setIsHeightCustomized(true);
                              setFormHeight(prev => Math.max(1, +(prev - 0.5).toFixed(1)));
                            }}
                            className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center cursor-pointer transition-colors"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            step="0.5"
                            min={1}
                            max={200}
                            value={formHeight}
                            onChange={e => {
                              setIsHeightCustomized(true);
                              setFormHeight(parseFloat(e.target.value) || 0);
                            }}
                            className="w-full text-center font-bold text-xs text-blue-700 outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setIsHeightCustomized(true);
                              setFormHeight(prev => +(prev + 0.5).toFixed(1));
                            }}
                            className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center cursor-pointer transition-colors"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Quick chips tầng */}
                    <div className="flex items-center gap-1 overflow-x-auto pt-1">
                      <span className="text-[10px] text-slate-400 font-semibold mr-1">Nhanh:</span>
                      {[1, 2, 3, 4, 5, 7].map(f => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => {
                            setFormFloors(f);
                            setIsHeightCustomized(false);
                            setFormHeight(f * 3.5);
                          }}
                          className={cn(
                            "px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-all cursor-pointer whitespace-nowrap",
                            formFloors === f
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                          )}
                        >
                          {f} tầng
                        </button>
                      ))}
                    </div>

                    {/* Checkbox CTCN cao nhất */}
                    <div 
                      onClick={() => setFormIsTallest(!formIsTallest)}
                      className={cn(
                        "p-2.5 rounded-xl border transition-all cursor-pointer flex items-center gap-2.5 select-none",
                        formIsTallest 
                          ? "bg-amber-500/10 border-amber-400 text-amber-900 ring-2 ring-amber-400/30" 
                          : "bg-white border-slate-200 hover:bg-slate-50 text-slate-700"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={formIsTallest}
                        onChange={e => setFormIsTallest(e.target.checked)}
                        className="w-4 h-4 text-amber-600 rounded cursor-pointer"
                        onClick={e => e.stopPropagation()}
                      />
                      <div className="min-w-0">
                        <span className="font-bold text-xs flex items-center gap-1">
                          <span>⭐ CTCN cao nhất theo hướng này</span>
                          <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-normal">
                            QCVN 08
                          </span>
                        </span>
                        <p className="text-[10px] text-slate-500 line-clamp-1">
                          Dùng làm mốc phân tích trường điện từ và kiểm định phơi nhiễm
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-emerald-50/80 rounded-2xl border border-emerald-200 text-xs text-emerald-900 space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>Đối tượng cảnh quan tự nhiên & giao thông</span>
                    </div>
                    <p className="text-[11px] text-emerald-700 leading-relaxed">
                      Theo QCVN 08, những đối tượng như sông hồ, đường xá, đồng ruộng, vườn cây <strong>không cần xác định cao độ</strong> và được tự động ghi nhận là không gian mở.
                    </p>
                  </div>
                )}

                {/* 4. Tên & Ghi chú */}
                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 uppercase block mb-1">
                      Tên ghi nhận
                    </label>
                    <input
                      type="text"
                      value={formName}
                      onChange={e => setFormName(e.target.value)}
                      placeholder="VD: Nhà dân 3 tầng, Cánh đồng lúa..."
                      className="w-full px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-xl outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-600 uppercase block mb-1">
                      Ghi chú thêm
                    </label>
                    <input
                      type="text"
                      value={formNotes}
                      onChange={e => setFormNotes(e.target.value)}
                      placeholder="Hiện trạng thực địa..."
                      className="w-full px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-xl outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Form Footer */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 shrink-0">
                {selectedCtcnId ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteCtcn(selectedCtcnId)}
                    className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Xóa</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMapInputModalOpen(false);
                      setSelectedCtcnId(null);
                    }}
                    className="px-2.5 py-1 text-slate-500 hover:text-slate-800 text-xs font-semibold cursor-pointer"
                  >
                    Hủy
                  </button>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsMapInputModalOpen(false);
                      setSelectedCtcnId(null);
                    }}
                    className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Xem danh sách
                  </button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveCtcn}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer"
                  >
                    <CheckCircle className="w-3.5 h-3.5 mr-1" />
                    {selectedCtcnId ? 'Cập nhật' : 'Lưu vị trí'}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            /* DANH SÁCH ĐỐI TƯỢNG 100M (KHI CHƯA CHỌN ĐIỂM) */
            <div className="space-y-4 flex flex-col justify-between h-full">
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-blue-600" />
                      Danh sách Đối tượng 100m ({ctcnList.length})
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      {ctcnList.some(c => c.isCtcn) 
                        ? "Có công trình CTCN — BẮT BUỘC kiểm định phơi nhiễm QCVN 08" 
                        : "Chưa ghi nhận CTCN (Chỉ có cảnh quan hoặc chưa khảo sát)"}
                    </p>
                  </div>

                  {!readOnly && (
                    <Button
                      size="sm"
                      onClick={() => {
                        prepareNewPointForm(45, 60);
                      }}
                      className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      Thêm điểm
                    </Button>
                  )}
                </div>

                {/* List */}
                <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                  {ctcnList.length === 0 ? (
                    <div className="p-6 text-center rounded-2xl bg-slate-50 border border-dashed border-slate-200">
                      <Radar className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-xs font-semibold text-slate-600">Chưa có vị trí nào được khảo sát</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Chạm trực tiếp lên bản đồ bên trái để chấm điểm và phân loại
                      </p>
                    </div>
                  ) : (
                    ctcnList.map(c => {
                      const isSelected = c.id === selectedCtcnId;
                      const meta = getPointVisualMeta(c);

                      return (
                        <div
                          key={c.id}
                          onClick={() => {
                            setSelectedCtcnId(c.id);
                            setIsAddingCtcn(false);
                            setFormDistance(c.distance);
                            setFormAzimuth(c.azimuth);
                            setFormName(c.name);
                            setFormNotes(c.notes || '');
                            setFormFloors(c.floors || 0);
                            setFormHeight(c.heightMeters || 0);
                            setFormIsCtcn(Boolean(c.isCtcn));
                            setFormIsTallest(Boolean(c.isTallest));
                            setFormObjectCategory(c.objectCategory || (c.isCtcn ? 'building' : 'landscape'));
                            setFormPresetId(c.presetId || (c.isCtcn ? 'ctcn_house' : 'land_road'));
                            setIsMapInputModalOpen(true);
                          }}
                          className={cn(
                            "p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-2",
                            isSelected 
                              ? "bg-blue-50/80 border-blue-400 ring-2 ring-blue-500/20 shadow-xs" 
                              : "bg-slate-50/70 hover:bg-slate-50 border-slate-200"
                          )}
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            <span className="text-lg shrink-0 mt-0.5">{meta.icon}</span>
                            <div className="space-y-0.5 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs font-bold text-slate-900 truncate">
                                  {c.name}
                                </span>
                                <span className={cn("text-[9px] font-bold px-1.5 py-0.2 rounded border text-white", meta.bgClass)}>
                                  {meta.badgeText}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                                <span>Vùng: <strong className="text-indigo-700">{c.zoneName || 'Sector'}</strong></span>
                                <span>Cách: <strong className="text-slate-700">{Math.round(c.distance)}m</strong></span>
                                <span>Góc: <strong className="text-slate-700">{c.azimuth}°</strong></span>
                                {c.floors ? (
                                  <span>Quy mô: <strong className="text-blue-700 font-bold">{c.floors} tầng ({c.heightMeters}m)</strong></span>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          {!readOnly && (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                handleDeleteCtcn(c.id);
                              }}
                              className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition-colors cursor-pointer"
                              title="Xóa điểm này"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Footer note */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span className="flex items-center gap-1 text-[11px]">
                  <Info className="w-3.5 h-3.5 text-blue-500" />
                  Khảo sát tối thiểu 6 vị trí (3 sector + 3 hướng xen kẽ)
                </span>
                <span className="font-bold text-[11px] text-blue-700">
                  {ctcnList.length}/6 vị trí
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
