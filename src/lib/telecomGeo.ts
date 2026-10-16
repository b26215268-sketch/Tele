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
