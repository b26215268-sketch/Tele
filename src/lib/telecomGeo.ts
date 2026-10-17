import { SectorInfo, CtcnObstacle, Station } from '../types';

const EARTH_RADIUS_METERS = 6371000; // Mean Earth radius in meters

/**
 * Normalizes an angle in degrees to [0, 360)
 */
export function normalizeAngle(angle: number): number {
  let a = angle % 360;
  if (a < 0) a += 360;
  return Math.round(a * 10) / 10;
}

/**
 * Calculates the shortest signed angular difference from source angle to target angle in degrees.
 * Returns value in [-180, +180].
 * Positive means target is clockwise (East) of source.
 * Negative means target is counter-clockwise (West) of source.
 */
export function angularDifference(sourceAngle: number, targetAngle: number): number {
  const diff = (targetAngle - sourceAngle + 540) % 360 - 180;
  return Math.round(diff * 10) / 10;
}

/**
 * Converts degrees to radians
 */
export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Converts radians to degrees
 */
export function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Direct Geodesic calculation:
 * Computes destination (Latitude, Longitude) given starting station (lat0, lng0),
 * distance in meters, and bearing/azimuth in degrees (from True North).
 */
export function computeDestinationPoint(
  lat: number,
  lng: number,
  distanceMeters: number,
  azimuthDegrees: number
): { latitude: number; longitude: number } {
  if (distanceMeters === 0) return { latitude: lat, longitude: lng };

  const δ = distanceMeters / EARTH_RADIUS_METERS; // Angular distance in radians
  const θ = toRadians(azimuthDegrees);

  const φ1 = toRadians(lat);
  const λ1 = toRadians(lng);

  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);

  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ);
  const φ2 = Math.asin(sinφ2);

  const y = Math.sin(θ) * sinδ * cosφ1;
  const x = cosδ - sinφ1 * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);

  return {
    latitude: Math.round(toDegrees(φ2) * 10000000) / 10000000,
    longitude: Math.round(toDegrees(λ2) * 10000000) / 10000000
  };
}

/**
 * Inverse Geodesic calculation (Haversine & Forward Bearing):
 * Computes distance in meters and bearing/azimuth from antenna foot (lat1, lng1) to target (lat2, lng2).
 */
export function computeDistanceAndBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): { distance: number; azimuth: number } {
  const φ1 = toRadians(lat1);
  const λ1 = toRadians(lng1);
  const φ2 = toRadians(lat2);
  const λ2 = toRadians(lng2);

  const Δφ = φ2 - φ1;
  const Δλ = λ2 - λ1;

  // Haversine formula
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = Math.round(EARTH_RADIUS_METERS * c * 10) / 10;

  // Initial bearing
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const initialBearing = toDegrees(Math.atan2(y, x));
  const azimuth = normalizeAngle(initialBearing);

  return { distance, azimuth };
}

/**
 * Clamps a target geographic point so its distance from station does not exceed maxMeters (default 100m).
 * If target exceeds maxMeters, it calculates the projected point at exactly maxMeters along the same azimuth ray.
 */
export function clampToMaxDistance(
  stLat: number,
  stLng: number,
  targetLat: number,
  targetLng: number,
  maxMeters: number = 100
): {
  latitude: number;
  longitude: number;
  distance: number;
  azimuth: number;
  clamped: boolean;
} {
  const { distance, azimuth } = computeDistanceAndBearing(stLat, stLng, targetLat, targetLng);

  if (distance <= maxMeters) {
    return {
      latitude: targetLat,
      longitude: targetLng,
      distance: Math.max(1, distance),
      azimuth,
      clamped: false
    };
  }

  // Clamped to maxMeters along the same bearing
  const projected = computeDestinationPoint(stLat, stLng, maxMeters, azimuth);
  return {
    latitude: projected.latitude,
    longitude: projected.longitude,
    distance: maxMeters,
    azimuth,
    clamped: true
  };
}

/**
 * Standard default 3-sector configuration for mobile cellular BTS stations
 */
export function getDefaultSectors(): SectorInfo[] {
  return [
    {
      id: 'sec-1',
      name: 'Sector 1',
      azimuth: 60,
      beamwidth: 65,
      antennaHeight: 30,
      tilt: 3,
      color: '#3b82f6' // Blue
    },
    {
      id: 'sec-2',
      name: 'Sector 2',
      azimuth: 180,
      beamwidth: 65,
      antennaHeight: 30,
      tilt: 3,
      color: '#10b981' // Green
    },
    {
      id: 'sec-3',
      name: 'Sector 3',
      azimuth: 300,
      beamwidth: 65,
      antennaHeight: 30,
      tilt: 3,
      color: '#f59e0b' // Amber
    }
  ];
}

/**
 * Analyzes which sector covers a given obstacle (CTCN) and evaluates QCVN 08 compliance risk
 */
export function analyzeCtcnSectorAndRisk(
  obstacleAzimuth: number,
  distance: number,
  sectors: SectorInfo[]
): {
  affectedSectorId: string;
  affectedSectorName: string;
  offsetAngle: number;
  isInMainLobe: boolean;
  exposureRisk: 'high' | 'medium' | 'low';
} {
  if (!sectors || sectors.length === 0) {
    return {
      affectedSectorId: '',
      affectedSectorName: 'Chưa có Sector',
      offsetAngle: 0,
      isInMainLobe: false,
      exposureRisk: distance <= 50 ? 'medium' : 'low'
    };
  }

  // Find the sector with smallest absolute angular difference
  let bestSector = sectors[0];
  let minDiff = 360;
  let signedDiff = 0;

  for (const sec of sectors) {
    const diff = angularDifference(sec.azimuth, obstacleAzimuth);
    const absDiff = Math.abs(diff);
    if (absDiff < minDiff) {
      minDiff = absDiff;
      signedDiff = diff;
      bestSector = sec;
    }
  }

  const beamHalfWidth = (bestSector.beamwidth || 65) / 2;
  const isInMainLobe = minDiff <= beamHalfWidth;

  // QCVN 08:2022/BTTTT Exposure Risk Classification:
  // High risk (Điểm đo ưu tiên 1): In main lobe (|diff| <= 20°) AND distance <= 50m
  // Medium risk (Điểm đo cần lưu ý): In main lobe (|diff| <= beamHalfWidth) AND distance 50m - 100m, OR right next to antenna (<=25m)
  // Low risk: Outside main lobe
  let exposureRisk: 'high' | 'medium' | 'low' = 'low';

  if (isInMainLobe) {
    if (distance <= 50 && minDiff <= 20) {
      exposureRisk = 'high';
    } else {
      exposureRisk = 'medium';
    }
  } else {
    if (distance <= 25) {
      exposureRisk = 'medium'; // Very close to tower base
    } else {
      exposureRisk = 'low';
    }
  }

  return {
    affectedSectorId: bestSector.id,
    affectedSectorName: bestSector.name,
    offsetAngle: signedDiff,
    isInMainLobe,
    exposureRisk
  };
}

/**
 * Building Type options with Vietnamese labels and icons
 */
export const CTCN_BUILDING_TYPES: { id: CtcnObstacle['buildingType']; label: string; icon: string; desc: string }[] = [
  { id: 'residential', label: 'Nhà dân / Khu dân cư', icon: '🏠', desc: 'Nhà ở của người dân, hộ gia đình' },
  { id: 'school_hospital', label: 'Trường học / Bệnh viện', icon: '🏥', desc: 'Khu vực nhạy cảm cần kiểm định kỹ' },
  { id: 'office', label: 'Cơ quan / Văn phòng', icon: '🏢', desc: 'Trụ sở làm việc thường xuyên' },
  { id: 'commercial', label: 'Trung tâm TM / Chợ', icon: '🏪', desc: 'Nơi tập trung đông người' },
  { id: 'industrial', label: 'Nhà xưởng / KCN', icon: '🏭', desc: 'Khu vực sản xuất, công nhân' },
  { id: 'other', label: 'Công trình khác (Tự điền)', icon: '📍', desc: 'Vật cản hoặc công trình xây dựng khác' }
];

export interface StandardObservationDirection {
  id: string;
  name: string;
  azimuth: number;
  directionType: 'sector_main' | 'sector_inter';
  description: string;
}

/**
 * Generates 6 standard observation directions for QCVN 08 inspection:
 * - 3 Hướng chính theo búp sóng các sector (vùng phủ sóng chính)
 * - 3 Hướng ở giữa các sector (vùng giao búp sóng / búp phụ)
 */
export function generateStandard6ObservationDirections(sectors: SectorInfo[]): StandardObservationDirection[] {
  const sortedSectors = [...sectors].sort((a, b) => a.azimuth - b.azimuth);
  const results: StandardObservationDirection[] = [];

  if (sortedSectors.length === 0) {
    return [
      { id: 'dir-sec-1', name: 'Hướng Sector 1', azimuth: 0, directionType: 'sector_main', description: 'Búp sóng chính Sector 1 (0°)' },
      { id: 'dir-inter-1', name: 'Hướng giữa Sec 1 & 2', azimuth: 60, directionType: 'sector_inter', description: 'Góc phân giác giữa Sector 1 & 2 (60°)' },
      { id: 'dir-sec-2', name: 'Hướng Sector 2', azimuth: 120, directionType: 'sector_main', description: 'Búp sóng chính Sector 2 (120°)' },
      { id: 'dir-inter-2', name: 'Hướng giữa Sec 2 & 3', azimuth: 180, directionType: 'sector_inter', description: 'Góc phân giác giữa Sector 2 & 3 (180°)' },
      { id: 'dir-sec-3', name: 'Hướng Sector 3', azimuth: 240, directionType: 'sector_main', description: 'Búp sóng chính Sector 3 (240°)' },
      { id: 'dir-inter-3', name: 'Hướng giữa Sec 3 & 1', azimuth: 300, directionType: 'sector_inter', description: 'Góc phân giác giữa Sector 3 & 1 (300°)' },
    ];
  }

  // 1. Add Main Sector Directions (3 hướng sector)
  sortedSectors.slice(0, 3).forEach((sec, idx) => {
    results.push({
      id: `dir-sec-${sec.id || idx + 1}`,
      name: `Hướng ${sec.name || `Sector ${idx + 1}`}`,
      azimuth: sec.azimuth,
      directionType: 'sector_main',
      description: `Búp sóng chính ${sec.name} (${sec.azimuth}°)`
    });
  });

  // 2. Add Inter-sector Directions (3 hướng ở giữa các sector)
  const count = Math.min(sortedSectors.length, 3);
  for (let i = 0; i < count; i++) {
    const currentSec = sortedSectors[i];
    const nextSec = sortedSectors[(i + 1) % count];
    
    // Calculate mid angle
    let diff = nextSec.azimuth - currentSec.azimuth;
    if (diff <= 0) diff += 360;
    const midAzimuth = normalizeAngle(currentSec.azimuth + diff / 2);

    results.push({
      id: `dir-inter-${i + 1}`,
      name: `Hướng giữa ${currentSec.name} & ${nextSec.name}`,
      azimuth: midAzimuth,
      directionType: 'sector_inter',
      description: `Góc phân giác giữa ${currentSec.name} (${currentSec.azimuth}°) và ${nextSec.name} (${nextSec.azimuth}°)`
    });
  }

  // Sort by azimuth
  return results.sort((a, b) => a.azimuth - b.azimuth);
}

/**
 * Checks QCVN 08 survey completion status:
 * Requires:
 * 1. Đầy đủ thông tin hạ tầng cơ bản
 * 2. Lưu trữ tối thiểu 3 ảnh quy chuẩn:
 *    - 1 Ảnh Nhà Trạm
 *    - 1 Ảnh Công trình cao nhất
 *    - Tối thiểu 1 ảnh Anten (AT1 - AT3/AT4)
 * 3. Tối thiểu 6 vị trí quan sát (3 hướng sector + 3 hướng giữa sector)
 */
export function checkQcvn08SurveyCompletion(
  station: Partial<Station>,
  ctcnList: CtcnObstacle[] = []
): {
  isComplete: boolean;
  validPhotos: boolean;
  photoCount: number;
  missingItems: string[];
} {
  const missingItems: string[] = [];
  const photos = station.surveyPhotos || {};

  const hasStationPhoto = Boolean(photos.stationPhotoUrl);
  const hasTallestPhoto = Boolean(photos.tallestObstaclePhotoUrl);
  const antennaPhotoCount = (photos.antennaPhotos || []).filter(p => Boolean(p.url)).length;
  const hasAntennaPhoto = antennaPhotoCount >= 1;

  let totalValidPhotos = 0;
  if (hasStationPhoto) totalValidPhotos++;
  if (hasTallestPhoto) totalValidPhotos++;
  totalValidPhotos += antennaPhotoCount;

  if (!hasStationPhoto) {
    missingItems.push('Chưa có Ảnh Nhà Trạm (chân cột)');
  }
  if (!hasTallestPhoto) {
    missingItems.push('Chưa có Ảnh Công trình cao nhất');
  }
  if (!hasAntennaPhoto) {
    missingItems.push('Cần tối thiểu 1 ảnh Chụp Anten (AT1 - AT3)');
  }

  const validPhotos = hasStationPhoto && hasTallestPhoto && hasAntennaPhoto;

  if (ctcnList.length < 6) {
    missingItems.push(`Chưa đủ 6 vị trí quan sát (hiện có ${ctcnList.length}/6 vị trí: 3 hướng sector + 3 hướng giữa sector)`);
  }

  const results = station.surveyResults || {};
  const hasTowerType = Boolean(results['Loại trụ anten'] || results['loai_tru'] || results['towerType']);
  if (!hasTowerType && Object.keys(results).length === 0) {
    missingItems.push('Chưa điền thông số hạ tầng cột trạm');
  }

  const isComplete = validPhotos && ctcnList.length >= 6;

  return {
    isComplete,
    validPhotos,
    photoCount: totalValidPhotos,
    missingItems
  };
}

export interface DetectedSurveyZone {
  zoneKey: string; // 'S1', 'S1-S2', 'S2', 'S2-S3', 'S3', 'S3-S1'
  zoneName: string; // 'Hướng Sector 1', 'Vùng giữa S1 - S2'
  zoneType: 'sector_main' | 'sector_inter';
  centerAzimuth: number; // Góc chuẩn tâm vùng
  offsetAngle: number; // Góc lệch so với tâm vùng
  sectorName?: string;
  badgeColor: string;
}

/**
 * Tự động nhận diện vùng khảo sát (S1, S2, S3 và các vùng ở giữa)
 * dựa vào góc phương vị đã chọn trên bản đồ.
 */
export function detectSurveyZone(azimuth: number, sectors: SectorInfo[]): DetectedSurveyZone {
  if (!sectors || sectors.length === 0) {
    return {
      zoneKey: 'S1',
      zoneName: 'Hướng Sector 1 (0°)',
      zoneType: 'sector_main',
      centerAzimuth: 0,
      offsetAngle: angularDifference(0, azimuth),
      sectorName: 'Sector 1',
      badgeColor: '#3b82f6'
    };
  }

  // Danh sách các ứng viên: Tất cả các hướng chính và các hướng ở giữa
  interface Candidate {
    zoneKey: string;
    zoneName: string;
    zoneType: 'sector_main' | 'sector_inter';
    centerAzimuth: number;
    sectorName?: string;
    badgeColor: string;
  }

  const candidates: Candidate[] = [];
  const sorted = [...sectors].sort((a, b) => a.azimuth - b.azimuth);

  // 1. Thêm các hướng chính của Sector (S1, S2, S3,...)
  sorted.forEach((sec, idx) => {
    const code = `S${idx + 1}`;
    candidates.push({
      zoneKey: code,
      zoneName: `Hướng ${sec.name || code} (${sec.azimuth}°)`,
      zoneType: 'sector_main',
      centerAzimuth: sec.azimuth,
      sectorName: sec.name || code,
      badgeColor: sec.color || '#3b82f6'
    });
  });

  // 2. Thêm các hướng ở giữa các Sector (S1-S2, S2-S3, S3-S1,...)
  const count = sorted.length;
  if (count >= 2) {
    for (let i = 0; i < count; i++) {
      const currentSec = sorted[i];
      const nextSec = sorted[(i + 1) % count];
      const codeA = `S${i + 1}`;
      const codeB = `S${((i + 1) % count) + 1}`;

      let diff = nextSec.azimuth - currentSec.azimuth;
      if (diff <= 0) diff += 360;
      const midAz = normalizeAngle(currentSec.azimuth + diff / 2);

      candidates.push({
        zoneKey: `${codeA}-${codeB}`,
        zoneName: `Vùng giữa ${codeA} - ${codeB} (${midAz}°)`,
        zoneType: 'sector_inter',
        centerAzimuth: midAz,
        sectorName: `${codeA} & ${codeB}`,
        badgeColor: '#8b5cf6' // Tím hiện đại cho vùng giao thoa
      });
    }
  }

  // Tìm candidate có độ lệch góc tuyệt đối nhỏ nhất so với azimuth hiện tại
  let bestCandidate = candidates[0];
  let minAbsDiff = 360;
  let signedDiff = 0;

  for (const cand of candidates) {
    const diff = angularDifference(cand.centerAzimuth, azimuth);
    const absDiff = Math.abs(diff);
    if (absDiff < minAbsDiff) {
      minAbsDiff = absDiff;
      signedDiff = diff;
      bestCandidate = cand;
    }
  }

  return {
    zoneKey: bestCandidate.zoneKey,
    zoneName: bestCandidate.zoneName,
    zoneType: bestCandidate.zoneType,
    centerAzimuth: bestCandidate.centerAzimuth,
    offsetAngle: signedDiff,
    sectorName: bestCandidate.sectorName,
    badgeColor: bestCandidate.badgeColor
  };
}

export interface SurveyObjectPreset {
  id: string;
  name: string;
  shortLabel: string;
  icon: string;
  category: 'building' | 'landscape';
  requiresHeight: boolean;
  buildingType?: CtcnObstacle['buildingType'];
  landscapeType?: CtcnObstacle['landscapeType'];
  description: string;
  defaultName: (dist: number, az: number, zoneName: string) => string;
}

export const SURVEY_OBJECT_PRESETS: SurveyObjectPreset[] = [
  // Nhóm Công trình xây dựng (CTCN / Cần cao độ & số tầng)
  {
    id: 'ctcn_house',
    name: 'Nhà dân / Khu dân cư',
    shortLabel: 'Nhà dân',
    icon: '🏠',
    category: 'building',
    requiresHeight: true,
    buildingType: 'residential',
    description: 'Nhà ở của người dân, khu dân cư sinh hoạt',
    defaultName: (d, a, z) => `Nhà dân (${z} - ${d}m)`
  },
  {
    id: 'ctcn_school',
    name: 'Trường học / Bệnh viện',
    shortLabel: 'Trường học/BV',
    icon: '🏫',
    category: 'building',
    requiresHeight: true,
    buildingType: 'school_hospital',
    description: 'Khu vực nhạy cảm cần lưu ý kiểm định phơi nhiễm',
    defaultName: (d, a, z) => `Trường học/BV (${z} - ${d}m)`
  },
  {
    id: 'ctcn_office',
    name: 'Cơ quan / Văn phòng',
    shortLabel: 'Cơ quan',
    icon: '🏢',
    category: 'building',
    requiresHeight: true,
    buildingType: 'office',
    description: 'Trụ sở UBND, cơ quan, văn phòng làm việc',
    defaultName: (d, a, z) => `Cơ quan (${z} - ${d}m)`
  },
  {
    id: 'ctcn_market',
    name: 'Trung tâm TM / Chợ',
    shortLabel: 'Chợ / TTTM',
    icon: '🏪',
    category: 'building',
    requiresHeight: true,
    buildingType: 'commercial',
    description: 'Nơi tập trung đông người buôn bán, giao thương',
    defaultName: (d, a, z) => `Chợ/TTTM (${z} - ${d}m)`
  },
  {
    id: 'ctcn_factory',
    name: 'Nhà xưởng / KCN',
    shortLabel: 'Nhà xưởng',
    icon: '🏭',
    category: 'building',
    requiresHeight: true,
    buildingType: 'industrial',
    description: 'Khu vực sản xuất, công xưởng, nhà kho',
    defaultName: (d, a, z) => `Nhà xưởng (${z} - ${d}m)`
  },
  {
    id: 'ctcn_other',
    name: 'Công trình xây dựng khác',
    shortLabel: 'CT khác',
    icon: '🏗️',
    category: 'building',
    requiresHeight: true,
    buildingType: 'other',
    description: 'Công trình xây dựng có người khác',
    defaultName: (d, a, z) => `Công trình (${z} - ${d}m)`
  },

  // Nhóm Cảnh quan tự nhiên & Hạ tầng (Bỏ qua phần nhập cao độ)
  {
    id: 'land_road',
    name: 'Đường xá / Giao thông',
    shortLabel: 'Đường xá',
    icon: '🛣️',
    category: 'landscape',
    requiresHeight: false,
    landscapeType: 'road',
    description: 'Đường nhựa, quốc lộ, tỉnh lộ, đường làng',
    defaultName: (d, a, z) => `Đường giao thông (${z} - ${d}m)`
  },
  {
    id: 'land_field',
    name: 'Đồng ruộng / Đất trồng',
    shortLabel: 'Đồng ruộng',
    icon: '🌾',
    category: 'landscape',
    requiresHeight: false,
    landscapeType: 'field',
    description: 'Ruộng lúa, hoa màu, đất nông nghiệp',
    defaultName: (d, a, z) => `Đồng ruộng (${z} - ${d}m)`
  },
  {
    id: 'land_garden',
    name: 'Vườn cây / Cây xanh',
    shortLabel: 'Vườn cây',
    icon: '🌳',
    category: 'landscape',
    requiresHeight: false,
    landscapeType: 'garden',
    description: 'Vườn cây ăn quả, rặng cây, công viên',
    defaultName: (d, a, z) => `Vườn cây (${z} - ${d}m)`
  },
  {
    id: 'land_water',
    name: 'Sông hồ / Kênh rạch',
    shortLabel: 'Sông hồ',
    icon: '🌊',
    category: 'landscape',
    requiresHeight: false,
    landscapeType: 'water',
    description: 'Sông, hồ nước, ao, kênh rạch, đầm lầy',
    defaultName: (d, a, z) => `Mặt nước/Sông hồ (${z} - ${d}m)`
  },
  {
    id: 'land_hill',
    name: 'Đồi núi / Gò đất',
    shortLabel: 'Đồi núi',
    icon: '⛰️',
    category: 'landscape',
    requiresHeight: false,
    landscapeType: 'hill',
    description: 'Đồi, núi đá, gò đất cao tự nhiên',
    defaultName: (d, a, z) => `Đồi núi (${z} - ${d}m)`
  },
  {
    id: 'land_open',
    name: 'Đất trống / Bãi đỗ xe',
    shortLabel: 'Đất trống',
    icon: '🅿️',
    category: 'landscape',
    requiresHeight: false,
    landscapeType: 'open_land',
    description: 'Bãi đất trống, sân bãi bê tông, bãi đỗ xe',
    defaultName: (d, a, z) => `Đất trống (${z} - ${d}m)`
  }
];

/**
 * Recursively cleans any object or array to ensure no undefined values are sent to Firestore.
 * Firestore strictly rejects undefined in any nested property and throws an error.
 */
export function cleanFirestoreData<T>(val: T): T {
  if (val === undefined) {
    return null as any;
  }
  if (val === null || typeof val !== 'object') {
    return val;
  }
  if (val instanceof Date) {
    return val.toISOString() as any;
  }
  if (Array.isArray(val)) {
    return val
      .filter(item => item !== undefined)
      .map(item => cleanFirestoreData(item)) as any;
  }
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(val as Record<string, any>)) {
    if (v !== undefined) {
      result[k] = cleanFirestoreData(v);
    }
  }
  return result as T;
}

