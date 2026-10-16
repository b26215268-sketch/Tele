import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, 
  Radar, 
  Save, 
  Printer, 
  MapPin, 
  Compass, 
  ShieldCheck, 
  AlertTriangle,
  Building,
  FileCheck2,
  ExternalLink,
  ClipboardList,
  FileText,
  Download,
  FolderOpen,
  Camera,
  Upload,
  CheckCircle2,
  AlertCircle,
  Zap,
  Plus,
  Trash2,
  Eye,
  Info
} from 'lucide-react';
import { Station, SectorInfo, CtcnObstacle } from '../types';
import { SectorRadar100m } from './SectorRadar100m';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { cn } from '../lib/utils';
import { 
  CTCN_BUILDING_TYPES, 
  generateStandard6ObservationDirections, 
  checkQcvn08SurveyCompletion,
  computeDestinationPoint,
  analyzeCtcnSectorAndRisk
} from '../lib/telecomGeo';

interface StationSectorModalProps {
  station: Station | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (station: Station) => void;
  readOnly?: boolean;
}

export function StationSectorModal({
  station,
  isOpen,
  onClose,
  onSaved,
  readOnly = false
}: StationSectorModalProps) {
  const [activeTab, setActiveTab] = useState<'radar' | 'survey_form' | 'report_export'>('radar');
  const [sectors, setSectors] = useState<SectorInfo[]>([]);
  const [ctcnList, setCtcnList] = useState<CtcnObstacle[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Form states for Surveyor (Tab 2)
  const [surveyResults, setSurveyResults] = useState<Record<string, any>>({});
  const [googleDriveFolderUrl, setGoogleDriveFolderUrl] = useState('');
  const [surveyPhotos, setSurveyPhotos] = useState<{
    stationPhotoUrl?: string;
    tallestObstaclePhotoUrl?: string;
    antennaPhotos?: { id: string; name: string; url: string }[];
  }>({});

  // Sync state when station opens
  useEffect(() => {
    if (station) {
      setSectors(station.sectors || []);
      setCtcnList(station.ctcnList || []);
      setSurveyResults(station.surveyResults || {});
      setGoogleDriveFolderUrl(station.googleDriveFolderUrl || station.additionalFields?.googleDriveUrl || '');
      setSurveyPhotos(station.surveyPhotos || {
        stationPhotoUrl: '',
        tallestObstaclePhotoUrl: '',
        antennaPhotos: [
          { id: 'at-1', name: 'Anten AT1 (Sector 1)', url: '' },
          { id: 'at-2', name: 'Anten AT2 (Sector 2)', url: '' },
          { id: 'at-3', name: 'Anten AT3 (Sector 3)', url: '' }
        ]
      });
      setSaveSuccess(false);
    }
  }, [station]);

  // Validation Status according to User's QCVN 08 Rule:
  // Must have: Required Info + Minimum 3 photos (Nhà trạm, CTCN cao nhất, tối thiểu 1 Anten)
  const completionStatus = useMemo(() => {
    const tempStation: Partial<Station> = {
      surveyResults,
      surveyPhotos
    };
    return checkQcvn08SurveyCompletion(tempStation, ctcnList);
  }, [surveyResults, surveyPhotos, ctcnList]);

  if (!isOpen || !station) return null;

  // Handle auto-fill from tallest obstacle in ctcnList
  const handleAutoFillTallestCtcn = () => {
    if (ctcnList.length === 0) {
      alert("Chưa có công trình nào trong danh sách CTCN 100m. Hãy chấm công trình trên bản đồ trước!");
      return;
    }

    const tallest = [...ctcnList].sort((a, b) => (b.heightMeters || 0) - (a.heightMeters || 0))[0];
    if (!tallest) return;

    setSurveyResults(prev => ({
      ...prev,
      tallestName: tallest.name,
      tallestAzimuth: tallest.azimuth,
      tallestDistance: Math.round(tallest.distance),
      tallestHeight: tallest.heightMeters || (tallest.floors ? tallest.floors * 3.5 : 12),
      observationAzimuth: prev.observationAzimuth || tallest.azimuth
    }));

    // If the tallest CTCN has a photo, link to tallestObstaclePhotoUrl if empty
    if (tallest.photoUrl && !surveyPhotos.tallestObstaclePhotoUrl) {
      setSurveyPhotos(p => ({ ...p, tallestObstaclePhotoUrl: tallest.photoUrl }));
    }

    alert(`Đã trích xuất thông số CTCN cao nhất: "${tallest.name}" (Cao ${tallest.heightMeters || 0}m, cách ${Math.round(tallest.distance)}m, hướng ${tallest.azimuth}°)!`);
  };

  // Quick generate 6 standard QCVN 08 observation directions (3 main sectors + 3 inter-sector)
  const handleGenerate6StandardDirections = () => {
    const stdDirections = generateStandard6ObservationDirections(sectors);
    const existingAzimuths = new Set(ctcnList.map(c => Math.round(c.azimuth)));

    const newPoints: CtcnObstacle[] = [];
    stdDirections.forEach((dir, idx) => {
      if (!existingAzimuths.has(Math.round(dir.azimuth))) {
        const destGps = computeDestinationPoint(
          station.latitude || 21.0,
          station.longitude || 105.8,
          dir.directionType === 'sector_main' ? 45 : 35,
          dir.azimuth
        );
        const analysis = analyzeCtcnSectorAndRisk(dir.azimuth, 45, sectors);

        newPoints.push({
          id: `obs-std-${Date.now()}-${idx}`,
          name: dir.name,
          buildingType: 'residential',
          distance: dir.directionType === 'sector_main' ? 45 : 35,
          azimuth: dir.azimuth,
          latitude: destGps.latitude,
          longitude: destGps.longitude,
          heightMeters: 10,
          floors: 3,
          directionType: dir.directionType,
          directionLabel: dir.name,
          affectedSectorId: analysis.affectedSectorId,
          affectedSectorName: analysis.affectedSectorName,
          offsetAngle: analysis.offsetAngle,
          isInMainLobe: analysis.isInMainLobe,
          exposureRisk: analysis.exposureRisk,
          notes: dir.description
        });
      }
    });

    if (newPoints.length === 0) {
      alert("Đã có đủ 6 hướng quan sát chuẩn trong danh sách!");
      return;
    }

    setCtcnList(prev => [...prev, ...newPoints]);
    alert(`Đã bổ sung ${newPoints.length} vị trí quan sát chuẩn QCVN 08 (3 hướng sector & 3 hướng xen kẽ)!`);
  };

  // Image compression & file handler for Surveyor
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>, photoKey: 'station' | 'tallest' | string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const MAX_WIDTH = 1200;
        const MAX_HEIGHT = 1200;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);

          // Watermark date & station name
          ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
          ctx.fillRect(10, height - 36, Math.min(width - 20, 380), 26);
          ctx.font = 'bold 12px sans-serif';
          ctx.fillStyle = '#ffffff';
          const stamp = `${station.name} (${station.infrastructureCode || 'CSHT'}) • ${new Date().toLocaleDateString('vi-VN')}`;
          ctx.fillText(stamp, 18, height - 19);

          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

          if (photoKey === 'station') {
            setSurveyPhotos(p => ({ ...p, stationPhotoUrl: dataUrl }));
          } else if (photoKey === 'tallest') {
            setSurveyPhotos(p => ({ ...p, tallestObstaclePhotoUrl: dataUrl }));
          } else {
            // Antenna photo
            setSurveyPhotos(p => {
              const currentList = p.antennaPhotos || [];
              const exists = currentList.some(at => at.id === photoKey);
              if (exists) {
                return {
                  ...p,
                  antennaPhotos: currentList.map(at => at.id === photoKey ? { ...at, url: dataUrl } : at)
                };
              }
              return {
                ...p,
                antennaPhotos: [...currentList, { id: photoKey, name: `Anten ${photoKey.toUpperCase()}`, url: dataUrl }]
              };
            });
          }
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Save full station survey data
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const isComplete = completionStatus.isComplete;
      const updatedStationData = {
        sectors,
        ctcnList,
        surveyResults,
        googleDriveFolderUrl: googleDriveFolderUrl.trim(),
        surveyPhotos,
        surveyStatus: (isComplete ? 'completed' : 'draft') as 'completed' | 'draft',
        status: (isComplete ? 'checked' : (station.status || 'unchecked')) as 'checked' | 'unchecked',
        updatedAt: new Date().toISOString()
      };

      await updateDoc(doc(db, 'stations', station.id), updatedStationData);

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      if (onSaved) {
        onSaved({
          ...station,
          ...updatedStationData
        });
      }
    } catch (err: any) {
      console.error("Failed to save station survey:", err);
      alert("Lỗi khi lưu dữ liệu trạm: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Download complete survey as JSON file
  const handleExportJSON = () => {
    const exportData = {
      standard: "QCVN 08:2022/BTTTT",
      station: {
        id: station.id,
        name: station.name,
        infrastructureCode: station.infrastructureCode || '',
        infrastructureDepartment: station.infrastructureDepartment || '',
        latitude: station.latitude,
        longitude: station.longitude,
        address: station.address,
        managerName: station.managerName,
        managerPhone: station.managerPhone
      },
      surveyResults,
      sectors,
      observationPointsAndCtcn: ctcnList,
      photos: {
        hasStationPhoto: Boolean(surveyPhotos.stationPhotoUrl),
        hasTallestPhoto: Boolean(surveyPhotos.tallestObstaclePhotoUrl),
        antennaPhotosCount: (surveyPhotos.antennaPhotos || []).filter(p => Boolean(p.url)).length
      },
      googleDriveFolderUrl: googleDriveFolderUrl || '',
      surveyStatus: completionStatus.isComplete ? 'completed' : 'draft',
      exportedAt: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const cshtCode = (station.infrastructureCode || station.name).replace(/[^a-zA-Z0-9_-]/g, '_');
    link.href = url;
    link.download = `KhaoSat_${cshtCode}_${new Date().toISOString().substring(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  const suggestedDriveFolderName = `${station.infrastructureCode || 'CSHT'}_${station.name.replace(/\s+/g, '_')}`;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-6xl overflow-hidden my-auto max-h-[94vh] flex flex-col"
        >
          {/* Header - Minimalist, high contrast, uncluttered */}
          <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-blue-600/30 text-blue-400 flex items-center justify-center shrink-0 border border-blue-500/30">
                <Radar className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-sm sm:text-base text-white truncate max-w-[240px] sm:max-w-md">
                    {station.name}
                  </h3>
                  {station.infrastructureCode && (
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700">
                      {station.infrastructureCode}
                    </span>
                  )}
                  <span className={cn(
                    "text-[10px] font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1",
                    completionStatus.isComplete 
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" 
                      : "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  )}>
                    {completionStatus.isComplete ? (
                      <>
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        Đủ điều kiện QCVN 08
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-3 h-3 text-amber-400" />
                        Chưa đủ ({completionStatus.photoCount}/3 ảnh • {ctcnList.length}/6 vị trí)
                      </>
                    )}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">
                  Tọa độ: {station.latitude}, {station.longitude} • {station.address}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 ml-3">
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
                title="Đóng"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Segmented Tabs Navigation */}
          <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 overflow-x-auto shrink-0">
            <div className="flex items-center gap-1 bg-slate-200/70 p-1 rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab('radar')}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer",
                  activeTab === 'radar' 
                    ? "bg-white text-slate-900 shadow-xs font-bold" 
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                <Radar className="w-3.5 h-3.5 text-blue-600" />
                <span>1. Sơ đồ Sector & Bán kính 100m</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('survey_form')}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer",
                  activeTab === 'survey_form' 
                    ? "bg-white text-blue-700 shadow-xs font-bold" 
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                <ClipboardList className="w-3.5 h-3.5 text-blue-600" />
                <span>2. Biểu mẫu Khảo sát Hiện trường</span>
                {completionStatus.isComplete && (
                  <CheckCircle2 className="w-3 h-3 text-emerald-500 ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('report_export')}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer",
                  activeTab === 'report_export' 
                    ? "bg-white text-slate-900 shadow-xs font-bold" 
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                <FileText className="w-3.5 h-3.5 text-indigo-600" />
                <span>3. Hồ sơ & Xuất Biên bản</span>
              </button>
            </div>

            <div className="hidden sm:flex items-center gap-2">
              {googleDriveFolderUrl && (
                <a
                  href={googleDriveFolderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-blue-600" />
                  <span>Mở Google Drive CSHT</span>
                  <ExternalLink className="w-3 h-3 ml-0.5" />
                </a>
              )}
            </div>
          </div>

          {/* Modal Body */}
          <div className="p-4 sm:p-5 overflow-y-auto flex-1 bg-slate-100/40">
            {/* TAB 1: Sơ đồ 100m (Radar & Vệ tinh) */}
            {activeTab === 'radar' && (
              <div className="space-y-3">
                <SectorRadar100m
                  station={station}
                  sectors={sectors}
                  ctcnList={ctcnList}
                  readOnly={readOnly}
                  onChange={data => {
                    setSectors(data.sectors);
                    setCtcnList(data.ctcnList);
                  }}
                />
              </div>
            )}

            {/* TAB 2: Biểu mẫu Khảo sát Hiện trường chuyên dụng */}
            {activeTab === 'survey_form' && (
              <div className="space-y-5 max-w-5xl mx-auto">
                {/* Completion Status Alert Box */}
                <div className={cn(
                  "p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-xs",
                  completionStatus.isComplete 
                    ? "bg-emerald-50 border-emerald-200 text-emerald-900" 
                    : "bg-amber-50 border-amber-200 text-amber-900"
                )}>
                  <div className="flex items-start sm:items-center gap-2.5">
                    {completionStatus.isComplete ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5 sm:mt-0" />
                    )}
                    <div>
                      <strong className="block text-sm">
                        {completionStatus.isComplete 
                          ? "Hồ sơ khảo sát hiện trường ĐÃ HOÀN TẤT & ĐỦ ĐIỀU KIỆN KIỂM ĐỊNH" 
                          : "Quy định hoàn tất công việc: Phải điền thông tin + lưu trữ tối thiểu 3 ảnh (Nhà trạm, CTCN cao nhất, Anten)"}
                      </strong>
                      {!completionStatus.isComplete && (
                        <div className="text-[11px] text-amber-800 mt-0.5 space-x-2">
                          <span>Còn thiếu:</span>
                          {completionStatus.missingItems.map((item, idx) => (
                            <span key={idx} className="font-semibold underline mr-1.5">• {item}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleAutoFillTallestCtcn}
                      className="bg-white border-amber-300 hover:bg-amber-100 text-amber-900 font-bold text-xs flex items-center gap-1 shadow-xs"
                      title="Trích xuất tự động thông số công trình cao nhất từ danh sách CTCN đã chấm"
                    >
                      <Zap className="w-3.5 h-3.5 text-amber-600 fill-amber-500" />
                      <span>⚡ Lấy số liệu CTCN cao nhất</span>
                    </Button>
                  </div>
                </div>

                {/* Section 1: Thông số hạ tầng trụ & Anten */}
                <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                  <div className="border-b border-slate-100 pb-2.5 flex items-center justify-between">
                    <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                      <Building className="w-4 h-4 text-blue-600" />
                      1. Thông số Hạ tầng Trụ Anten & Quang cảnh xung quanh
                    </h4>
                    <span className="text-[11px] text-slate-500 italic">Tham số không bắt buộc</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5 text-xs">
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Loại trụ anten</label>
                      <select
                        value={surveyResults.towerType || ''}
                        onChange={e => setSurveyResults({ ...surveyResults, towerType: e.target.value })}
                        className="w-full border border-slate-300 rounded-xl p-2.5 bg-white text-xs font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                      >
                        <option value="">-- Chọn loại trụ --</option>
                        <option value="Trụ tự đứng">Trụ tự đứng (Tam giác / Tứ giác)</option>
                        <option value="Trụ dây níu">Trụ dây níu</option>
                        <option value="Cột Monopole">Cột Monopole</option>
                        <option value="Cột ngụy trang">Cột ngụy trang (Cây, đèn...)</option>
                        <option value="Cột trên mái nhà dân">Cột gắn trên mái nhà dân</option>
                        <option value="Cột trên nóc cơ quan">Cột trên nóc cơ quan / Chung cư</option>
                        <option value="Khác">Loại khác (Ghi vào ghi chú)</option>
                      </select>
                    </div>

                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Vị trí đặt cột anten</label>
                      <select
                        value={surveyResults.towerLocation || ''}
                        onChange={e => setSurveyResults({ ...surveyResults, towerLocation: e.target.value })}
                        className="w-full border border-slate-300 rounded-xl p-2.5 bg-white text-xs font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                      >
                        <option value="">-- Chọn vị trí đặt --</option>
                        <option value="Trên mặt đất">Trên mặt đất</option>
                        <option value="Trên mái nhà dân">Trên mái nhà dân</option>
                        <option value="Trên nóc tòa nhà cơ quan">Trên nóc tòa nhà cơ quan</option>
                        <option value="Trên nóc chung cư">Trên nóc chung cư</option>
                        <option value="Trên đồi núi">Trên đồi núi</option>
                        <option value="Khác">Khác</option>
                      </select>
                    </div>

                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Quang cảnh xung quanh trạm</label>
                      <select
                        value={surveyResults.surroundingLandscape || ''}
                        onChange={e => setSurveyResults({ ...surveyResults, surroundingLandscape: e.target.value })}
                        className="w-full border border-slate-300 rounded-xl p-2.5 bg-white text-xs font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                      >
                        <option value="">-- Chọn quang cảnh --</option>
                        <option value="Khu dân cư đông đúc">Khu dân cư đông đúc</option>
                        <option value="Khu đô thị mới">Khu đô thị mới / Thưa dân</option>
                        <option value="Đồng bằng / Nông thôn">Đồng bằng / Nông thôn</option>
                        <option value="Ven biển">Ven biển</option>
                        <option value="Khu công nghiệp">Khu công nghiệp / Nhà máy</option>
                        <option value="Vùng đồi núi">Vùng đồi núi / Rừng rậm</option>
                      </select>
                    </div>

                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Góc phương vị hướng quan sát (° Bắc)</label>
                      <Input
                        type="number"
                        placeholder="VD: 45°"
                        value={surveyResults.observationAzimuth ?? ''}
                        onChange={(e: any) => setSurveyResults({ ...surveyResults, observationAzimuth: parseFloat(e.target.value) || 0 })}
                        className="h-9 text-xs"
                      />
                    </div>

                    {/* 3 Thông số Công trình cao nhất (Có thể tự điền hoặc bấm ⚡ lấy tự động) */}
                    <div className="bg-blue-50/60 p-2.5 rounded-xl border border-blue-200/80">
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-bold text-blue-900 block text-[11px]">Góc phương vị CTCN cao nhất (°)</label>
                        <span className="text-[10px] text-blue-600 font-mono">Bắc</span>
                      </div>
                      <Input
                        type="number"
                        placeholder="VD: 60°"
                        value={surveyResults.tallestAzimuth ?? ''}
                        onChange={(e: any) => setSurveyResults({ ...surveyResults, tallestAzimuth: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-xs bg-white font-bold"
                      />
                    </div>

                    <div className="bg-blue-50/60 p-2.5 rounded-xl border border-blue-200/80">
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-bold text-blue-900 block text-[11px]">Khoảng cách tới CTCN cao nhất (m)</label>
                        <span className="text-[10px] text-blue-600 font-mono">1-100m</span>
                      </div>
                      <Input
                        type="number"
                        placeholder="VD: 45m"
                        value={surveyResults.tallestDistance ?? ''}
                        onChange={(e: any) => setSurveyResults({ ...surveyResults, tallestDistance: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-xs bg-white font-bold"
                      />
                    </div>

                    <div className="bg-blue-50/60 p-2.5 rounded-xl border border-blue-200/80">
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-bold text-blue-900 block text-[11px]">Độ cao CTCN cao nhất (m)</label>
                        <span className="text-[10px] text-blue-600 font-mono">m</span>
                      </div>
                      <Input
                        type="number"
                        placeholder="VD: 15m"
                        value={surveyResults.tallestHeight ?? ''}
                        onChange={(e: any) => setSurveyResults({ ...surveyResults, tallestHeight: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-xs bg-white font-bold"
                      />
                    </div>

                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Độ cao cột anten (m)</label>
                      <Input
                        type="number"
                        placeholder="VD: 30m"
                        value={surveyResults.antennaTowerHeight ?? ''}
                        onChange={(e: any) => setSurveyResults({ ...surveyResults, antennaTowerHeight: parseFloat(e.target.value) || 0 })}
                        className="h-9 text-xs"
                      />
                    </div>

                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Độ cao nhà đặt cột (m)</label>
                      <Input
                        type="number"
                        placeholder="VD: 15m (nếu trên mái)"
                        value={surveyResults.buildingBaseHeight ?? ''}
                        onChange={(e: any) => setSurveyResults({ ...surveyResults, buildingBaseHeight: parseFloat(e.target.value) || 0 })}
                        className="h-9 text-xs"
                      />
                    </div>

                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Độ cao đồi đặt cột (m)</label>
                      <Input
                        type="number"
                        placeholder="VD: 50m (nếu trên đồi)"
                        value={surveyResults.hillHeight ?? ''}
                        onChange={(e: any) => setSurveyResults({ ...surveyResults, hillHeight: parseFloat(e.target.value) || 0 })}
                        className="h-9 text-xs"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 2: Khảo sát tối thiểu 6 vị trí quan sát (3 hướng sector & 3 hướng giữa sector) */}
                <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                  <div className="border-b border-slate-100 pb-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                        <Compass className="w-4 h-4 text-blue-600" />
                        2. Khảo sát Vị trí Quan sát & CTCN (Tối thiểu 6 vị trí: 3 hướng sector + 3 hướng xen kẽ)
                      </h4>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Kỹ sư chọn điểm trên bản đồ hoặc nạp nhanh 6 hướng chuẩn, app tự động tính cự ly & góc phương vị tới chân trụ.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={handleGenerate6StandardDirections}
                        className="h-7 text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200"
                      >
                        <Zap className="w-3 h-3 text-blue-600 mr-1" />
                        Tạo nhanh 6 hướng chuẩn QCVN 08
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          const newId = `obs-custom-${Date.now()}`;
                          const newAz = (ctcnList.length * 60) % 360;
                          const dest = computeDestinationPoint(station.latitude || 21, station.longitude || 105.8, 40, newAz);
                          setCtcnList(prev => [
                            ...prev,
                            {
                              id: newId,
                              name: `Vị trí quan sát ${prev.length + 1}`,
                              buildingType: 'residential',
                              distance: 40,
                              azimuth: newAz,
                              latitude: dest.latitude,
                              longitude: dest.longitude,
                              heightMeters: 12,
                              floors: 3,
                              offsetAngle: 0,
                              isInMainLobe: true,
                              exposureRisk: 'medium'
                            }
                          ]);
                        }}
                        className="h-7 text-xs"
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Thêm vị trí
                      </Button>
                    </div>
                  </div>

                  {/* 6 Observation Points Table */}
                  {ctcnList.length === 0 ? (
                    <div className="p-6 text-center border-2 border-dashed rounded-xl border-slate-200 bg-slate-50 text-slate-500 text-xs space-y-2">
                      <Compass className="w-8 h-8 text-slate-400 mx-auto" />
                      <p>Chưa ghi nhận vị trí quan sát hoặc công trình lân cận nào trong 100m.</p>
                      <Button size="sm" onClick={handleGenerate6StandardDirections} className="text-xs">
                        Tạo nhanh 6 vị trí khảo sát chuẩn QCVN 08
                      </Button>
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-slate-200 rounded-xl">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold">
                          <tr>
                            <th className="p-2.5 text-center w-10">STT</th>
                            <th className="p-2.5 text-left min-w-[140px]">Tên / Hướng quan sát</th>
                            <th className="p-2.5 text-center w-28">Góc (° Bắc)</th>
                            <th className="p-2.5 text-center w-28">Cự ly chân cột (m)</th>
                            <th className="p-2.5 text-left min-w-[160px]">Loại công trình định nghĩa</th>
                            <th className="p-2.5 text-center w-24">Độ cao (m)</th>
                            <th className="p-2.5 text-center w-20">Số tầng</th>
                            <th className="p-2.5 text-center w-12">Xóa</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {ctcnList.map((item, idx) => (
                            <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                              <td className="p-2 text-center font-bold text-slate-500">{idx + 1}</td>
                              <td className="p-2">
                                <input
                                  type="text"
                                  value={item.name}
                                  onChange={e => {
                                    const val = e.target.value;
                                    setCtcnList(prev => prev.map(c => c.id === item.id ? { ...c, name: val } : c));
                                  }}
                                  className="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs font-semibold focus:border-blue-500 outline-none"
                                />
                                {item.directionLabel && (
                                  <span className="text-[10px] text-blue-600 block mt-0.5">{item.directionLabel}</span>
                                )}
                              </td>
                              <td className="p-2 text-center">
                                <input
                                  type="number"
                                  min={0}
                                  max={359}
                                  value={item.azimuth}
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    setCtcnList(prev => prev.map(c => c.id === item.id ? { ...c, azimuth: val } : c));
                                  }}
                                  className="w-20 px-2 py-1 text-center font-mono font-bold bg-slate-50 border border-slate-200 rounded-lg text-xs"
                                />
                              </td>
                              <td className="p-2 text-center">
                                <input
                                  type="number"
                                  min={1}
                                  max={100}
                                  value={item.distance}
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    setCtcnList(prev => prev.map(c => c.id === item.id ? { ...c, distance: val } : c));
                                  }}
                                  className="w-20 px-2 py-1 text-center font-mono font-bold text-blue-700 bg-blue-50/50 border border-blue-200 rounded-lg text-xs"
                                />
                              </td>
                              <td className="p-2">
                                <select
                                  value={item.buildingType || 'residential'}
                                  onChange={e => {
                                    const val = e.target.value as CtcnObstacle['buildingType'];
                                    setCtcnList(prev => prev.map(c => c.id === item.id ? { ...c, buildingType: val } : c));
                                  }}
                                  className="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white focus:border-blue-500 outline-none font-medium"
                                >
                                  {CTCN_BUILDING_TYPES.map(bt => (
                                    <option key={bt.id} value={bt.id}>{bt.icon} {bt.label}</option>
                                  ))}
                                </select>
                                {item.buildingType === 'other' && (
                                  <input
                                    type="text"
                                    placeholder="Điền tên / loại công trình khác..."
                                    value={item.notes || ''}
                                    onChange={e => {
                                      const val = e.target.value;
                                      setCtcnList(prev => prev.map(c => c.id === item.id ? { ...c, notes: val } : c));
                                    }}
                                    className="mt-1 w-full px-2 py-1 border border-amber-300 rounded-md text-[11px] bg-amber-50/60 focus:bg-white outline-none"
                                  />
                                )}
                              </td>
                              <td className="p-2 text-center">
                                <input
                                  type="number"
                                  min={1}
                                  max={150}
                                  value={item.heightMeters || ''}
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    setCtcnList(prev => prev.map(c => c.id === item.id ? { ...c, heightMeters: val } : c));
                                  }}
                                  placeholder="Cao (m)"
                                  className="w-16 px-1.5 py-1 text-center font-mono border border-slate-200 rounded-lg text-xs"
                                />
                              </td>
                              <td className="p-2 text-center">
                                <input
                                  type="number"
                                  min={1}
                                  max={50}
                                  value={item.floors || ''}
                                  onChange={e => {
                                    const val = parseInt(e.target.value) || 1;
                                    setCtcnList(prev => prev.map(c => c.id === item.id ? { ...c, floors: val } : c));
                                  }}
                                  placeholder="Tầng"
                                  className="w-12 px-1 text-center font-mono border border-slate-200 rounded-lg text-xs"
                                />
                              </td>
                              <td className="p-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => setCtcnList(prev => prev.filter(c => c.id !== item.id))}
                                  className="p-1 text-slate-400 hover:text-red-600 rounded"
                                  title="Xóa điểm này"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Tallest Obstacle Summary Box */}
                  <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div>
                      <strong className="text-blue-950 font-bold block">
                        Thông số Công trình cao nhất trong 100m:
                      </strong>
                      <p className="text-blue-800 text-[11px] mt-0.5">
                        {surveyResults.tallestName ? (
                          <span>
                            {surveyResults.tallestName} • Cao: <strong>{surveyResults.tallestHeight}m</strong> • Cách cột: <strong>{surveyResults.tallestDistance}m</strong> • Hướng: <strong>{surveyResults.tallestAzimuth}° Bắc</strong>
                          </span>
                        ) : (
                          <span className="italic">Chưa liên kết. Bấm nút "Lấy số liệu CTCN cao nhất" ở trên để tự động điền.</span>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleAutoFillTallestCtcn}
                        className="h-7 text-xs bg-white text-blue-700 border-blue-300 font-semibold"
                      >
                        ⚡ Cập nhật từ CTCN cao nhất
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Section 3: Lưu trữ 3 Ảnh Bắt Buộc & Thư mục Google Drive theo CSHT */}
                <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                  <div className="border-b border-slate-100 pb-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                        <Camera className="w-4 h-4 text-blue-600" />
                        3. Hình ảnh Hiện trường Bắt buộc (Tối thiểu 3 ảnh) & Google Drive CSHT
                      </h4>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Quy chuẩn hoàn tất: Cần đủ <strong>Ảnh Nhà Trạm</strong>, <strong>Ảnh CTCN cao nhất</strong> và <strong>tối thiểu 1 ảnh Anten (AT1 - AT3/AT4)</strong>.
                      </p>
                    </div>

                    <span className={cn(
                      "text-[10px] font-bold px-2 py-0.5 rounded-full border self-start sm:self-auto",
                      completionStatus.validPhotos ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"
                    )}>
                      {completionStatus.validPhotos ? "Đủ 3 ảnh bắt buộc" : `Thiếu ảnh (${completionStatus.photoCount}/3)`}
                    </span>
                  </div>

                  {/* 3 Required Photo Slots */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 text-xs">
                    {/* Photo 1: Nhà Trạm */}
                    <div className="border border-slate-200 rounded-xl p-3 bg-slate-50 flex flex-col justify-between space-y-2">
                      <div>
                        <div className="flex items-center justify-between">
                          <strong className="text-slate-800">1. Ảnh Nhà Trạm / Chân Cột</strong>
                          <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">Bắt buộc</span>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-0.5">Chụp toàn cảnh nhà đặt trạm và chân cột</p>
                      </div>

                      {surveyPhotos.stationPhotoUrl ? (
                        <div className="relative aspect-video rounded-lg overflow-hidden border border-slate-300 bg-black">
                          <img src={surveyPhotos.stationPhotoUrl} alt="Nhà trạm" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setSurveyPhotos(p => ({ ...p, stationPhotoUrl: '' }))}
                            className="absolute top-1 right-1 bg-black/60 hover:bg-red-600 text-white p-1 rounded-full text-xs"
                            title="Xóa ảnh"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <label className="aspect-video rounded-lg border-2 border-dashed border-slate-300 hover:border-blue-500 bg-white flex flex-col items-center justify-center cursor-pointer transition-colors p-2 text-center">
                          <Upload className="w-5 h-5 text-slate-400 mb-1" />
                          <span className="text-[11px] font-semibold text-blue-600">Chọn hoặc Chụp ảnh</span>
                          <span className="text-[9px] text-slate-400">Tự động đóng dấu CSHT</span>
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={e => handlePhotoUpload(e, 'station')}
                            className="hidden"
                          />
                        </label>
                      )}
                    </div>

                    {/* Photo 2: CTCN Cao Nhất */}
                    <div className="border border-slate-200 rounded-xl p-3 bg-slate-50 flex flex-col justify-between space-y-2">
                      <div>
                        <div className="flex items-center justify-between">
                          <strong className="text-slate-800">2. Ảnh CTCN Cao Nhất</strong>
                          <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">Bắt buộc</span>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-0.5">Hướng nhìn từ chân cột về công trình cao nhất</p>
                      </div>

                      {surveyPhotos.tallestObstaclePhotoUrl ? (
                        <div className="relative aspect-video rounded-lg overflow-hidden border border-slate-300 bg-black">
                          <img src={surveyPhotos.tallestObstaclePhotoUrl} alt="CTCN cao nhất" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setSurveyPhotos(p => ({ ...p, tallestObstaclePhotoUrl: '' }))}
                            className="absolute top-1 right-1 bg-black/60 hover:bg-red-600 text-white p-1 rounded-full text-xs"
                            title="Xóa ảnh"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <label className="aspect-video rounded-lg border-2 border-dashed border-slate-300 hover:border-blue-500 bg-white flex flex-col items-center justify-center cursor-pointer transition-colors p-2 text-center">
                          <Upload className="w-5 h-5 text-slate-400 mb-1" />
                          <span className="text-[11px] font-semibold text-blue-600">Chọn hoặc Chụp ảnh</span>
                          <span className="text-[9px] text-slate-400">Hướng nhìn về CTCN</span>
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={e => handlePhotoUpload(e, 'tallest')}
                            className="hidden"
                          />
                        </label>
                      )}
                    </div>

                    {/* Photo 3: Anten AT1, AT2, AT3, AT4 */}
                    <div className="border border-slate-200 rounded-xl p-3 bg-slate-50 flex flex-col justify-between space-y-2">
                      <div>
                        <div className="flex items-center justify-between">
                          <strong className="text-slate-800">3. Ảnh Anten (AT1 - AT3/AT4)</strong>
                          <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">Tối thiểu 1 ảnh</span>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-0.5">Chụp cận cảnh anten trên cột</p>
                      </div>

                      <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                        {(surveyPhotos.antennaPhotos || []).map((at, idx) => (
                          <div key={at.id || idx} className="flex items-center justify-between gap-2 bg-white p-1.5 rounded-lg border border-slate-200 text-xs">
                            <span className="font-semibold text-slate-700 truncate">{at.name}</span>
                            {at.url ? (
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-emerald-600 font-bold">Đã có ảnh</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSurveyPhotos(p => ({
                                      ...p,
                                      antennaPhotos: (p.antennaPhotos || []).map(item => item.id === at.id ? { ...item, url: '' } : item)
                                    }));
                                  }}
                                  className="text-slate-400 hover:text-red-500 p-0.5"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <label className="text-[10px] bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold px-2 py-0.5 rounded cursor-pointer border border-blue-200">
                                <span>Tải ảnh</span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  capture="environment"
                                  onChange={e => handlePhotoUpload(e, at.id)}
                                  className="hidden"
                                />
                              </label>
                            )}
                          </div>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          const count = (surveyPhotos.antennaPhotos || []).length + 1;
                          setSurveyPhotos(p => ({
                            ...p,
                            antennaPhotos: [
                              ...(p.antennaPhotos || []),
                              { id: `at-${count}`, name: `Anten AT${count} (Sector ${count})`, url: '' }
                            ]
                          }));
                        }}
                        className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 justify-center py-1 bg-white border border-dashed border-blue-300 rounded-lg hover:bg-blue-50"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Thêm ảnh Anten (AT4...)</span>
                      </button>
                    </div>
                  </div>

                  {/* Google Drive Folder Box */}
                  <div className="pt-2 border-t border-slate-100">
                    <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                            <FolderOpen className="w-4 h-4 text-blue-600" />
                            Thư mục Google Drive theo CSHT:
                          </label>
                          <code className="bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded text-[11px] font-mono font-bold">
                            {suggestedDriveFolderName}
                          </code>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(suggestedDriveFolderName);
                              alert(`Đã sao chép tên thư mục: "${suggestedDriveFolderName}"! Hãy tạo hoặc tìm thư mục này trên Google Drive.`);
                            }}
                            className="text-[11px] text-blue-700 bg-white hover:bg-blue-100 border border-blue-200 px-2 py-0.5 rounded font-semibold transition-colors cursor-pointer"
                            title="Sao chép tên thư mục"
                          >
                            Sao chép tên
                          </button>
                        </div>
                        {googleDriveFolderUrl && (
                          <a
                            href={googleDriveFolderUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline flex items-center gap-1 font-semibold"
                          >
                            <span>Truy cập Drive CSHT</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <Input
                          type="url"
                          placeholder="Dán link thư mục Google Drive của trạm này (VD: https://drive.google.com/drive/folders/...)"
                          value={googleDriveFolderUrl}
                          onChange={(e: any) => setGoogleDriveFolderUrl(e.target.value)}
                          className="text-xs h-9 bg-white"
                        />
                        {googleDriveFolderUrl && (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => window.open(googleDriveFolderUrl, '_blank')}
                            className="h-9 text-xs shrink-0 flex items-center gap-1"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Mở</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: Hồ sơ & Xuất Biên bản (QCVN 08 & JSON & Google Drive) */}
            {activeTab === 'report_export' && (
              <div className="space-y-4 max-w-5xl mx-auto">
                {/* Action Bar */}
                <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3 print:hidden">
                  <div>
                    <h4 className="font-bold text-sm text-slate-900">Xuất Biên bản & Tệp tin Khảo sát</h4>
                    <p className="text-xs text-slate-500">In trực tiếp Biên bản phụ lục QCVN 08 hoặc tải tệp JSON lưu trữ.</p>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      type="button"
                      size="sm"
                      onClick={handlePrint}
                      className="h-8 text-xs bg-slate-900 hover:bg-slate-800 text-white font-semibold flex items-center gap-1.5"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>In Biên bản QCVN 08</span>
                    </Button>

                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleExportJSON}
                      className="h-8 text-xs border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5 text-blue-600" />
                      <span>Tải file JSON khảo sát</span>
                    </Button>

                    {googleDriveFolderUrl && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => window.open(googleDriveFolderUrl, '_blank')}
                        className="h-8 text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 flex items-center gap-1.5"
                      >
                        <FolderOpen className="w-3.5 h-3.5 text-blue-600" />
                        <span>Mở Thư mục Drive CSHT</span>
                      </Button>
                    )}
                  </div>
                </div>

                {/* Printable QCVN 08 Document */}
                <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 space-y-6 print:border-none print:p-0 print:m-0 text-slate-900 shadow-sm">
                  {/* Header Quốc hiệu */}
                  <div className="text-center border-b border-slate-200 pb-4 space-y-1">
                    <div className="text-xs font-bold uppercase tracking-wider">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
                    <div className="text-[11px] font-semibold underline underline-offset-4">Độc lập - Tự do - Hạnh phúc</div>
                    <h2 className="text-base sm:text-lg font-black uppercase text-slate-900 tracking-wider pt-3">
                      PHỤ LỤC KHẢO SÁT CÔNG TRÌNH XÂY DỰNG CÓ NGƯỜI (CTCN) TRONG BÁN KÍNH 100M
                    </h2>
                    <p className="text-xs text-slate-600 font-medium">
                      (Phục vụ Đánh giá Phơi nhiễm Trường điện từ theo Quy chuẩn Quốc gia QCVN 08:2022/BTTTT)
                    </p>
                  </div>

                  {/* Phần I: Thông tin Trạm & Hạ tầng */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      I. Thông tin Trạm & Hạ tầng kỹ thuật
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                      <div>
                        <span className="text-slate-500 font-semibold block">Tên trạm BTS:</span>
                        <strong className="text-slate-900">{station.name}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500 font-semibold block">Mã CSHT:</span>
                        <strong className="text-slate-900">{station.infrastructureCode || 'N/A'}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500 font-semibold block">Tọa độ chân trụ:</span>
                        <strong className="text-slate-900">{station.latitude}, {station.longitude}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500 font-semibold block">Địa chỉ đặt trạm:</span>
                        <strong className="text-slate-900 truncate block">{station.address}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500 font-semibold block">Loại trụ anten:</span>
                        <strong className="text-slate-900">{surveyResults.towerType || 'Chưa xác định'}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500 font-semibold block">Vị trí đặt cột:</span>
                        <strong className="text-slate-900">{surveyResults.towerLocation || 'Chưa xác định'}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500 font-semibold block">Độ cao cột anten:</span>
                        <strong className="text-slate-900">{surveyResults.antennaTowerHeight ? `${surveyResults.antennaTowerHeight}m` : 'N/A'}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500 font-semibold block">Quang cảnh xung quanh:</span>
                        <strong className="text-slate-900">{surveyResults.surroundingLandscape || 'Đồng bằng'}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Phần II: Thông số Sector */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      II. Thông số các Sector Anten
                    </h4>
                    <table className="w-full text-xs border border-slate-200">
                      <thead className="bg-slate-100 font-bold text-slate-700">
                        <tr>
                          <th className="p-2 border border-slate-200 text-left">Sector</th>
                          <th className="p-2 border border-slate-200 text-center">Góc hướng (Azimuth °)</th>
                          <th className="p-2 border border-slate-200 text-center">Độ rộng búp (BW °)</th>
                          <th className="p-2 border border-slate-200 text-center">Độ cao treo anten (m)</th>
                          <th className="p-2 border border-slate-200 text-center">Góc Tilt (°)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sectors.map(s => (
                          <tr key={s.id} className="border-b border-slate-200">
                            <td className="p-2 border border-slate-200 font-bold">{s.name}</td>
                            <td className="p-2 border border-slate-200 text-center">{s.azimuth}°</td>
                            <td className="p-2 border border-slate-200 text-center">{s.beamwidth || 65}°</td>
                            <td className="p-2 border border-slate-200 text-center">{s.antennaHeight || 30}m</td>
                            <td className="p-2 border border-slate-200 text-center">{s.tilt || 3}°</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Phần III: Bảng thống kê các vị trí quan sát & CTCN (100m) */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      III. Kết quả Khảo sát Vị trí Quan sát & CTCN trong bán kính 100m
                    </h4>
                    {ctcnList.length === 0 ? (
                      <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl border border-emerald-200 text-xs font-medium text-center">
                        Trong bán kính 100m tính từ tâm chân trụ không ghi nhận CTCN nào có người sinh sống hoặc làm việc.
                      </div>
                    ) : (
                      <table className="w-full text-xs border border-slate-200">
                        <thead className="bg-slate-100 font-bold text-slate-700">
                          <tr>
                            <th className="p-2 border border-slate-200 text-center w-10">STT</th>
                            <th className="p-2 border border-slate-200 text-left">Tên vị trí / CTCN</th>
                            <th className="p-2 border border-slate-200 text-center">Cự ly từ chân cột (m)</th>
                            <th className="p-2 border border-slate-200 text-center">Góc Bắc (°)</th>
                            <th className="p-2 border border-slate-200 text-left">Sector ảnh hưởng</th>
                            <th className="p-2 border border-slate-200 text-center">Độ lệch góc</th>
                            <th className="p-2 border border-slate-200 text-center">Độ cao (m)</th>
                            <th className="p-2 border border-slate-200 text-center">Ưu tiên đo QCVN 08</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ctcnList.map((c, idx) => (
                            <tr key={c.id} className="border-b border-slate-200">
                              <td className="p-2 border border-slate-200 text-center font-bold">{idx + 1}</td>
                              <td className="p-2 border border-slate-200 font-semibold">{c.name}</td>
                              <td className="p-2 border border-slate-200 text-center font-bold text-blue-700">{c.distance}m</td>
                              <td className="p-2 border border-slate-200 text-center font-bold">{c.azimuth}°</td>
                              <td className="p-2 border border-slate-200">{c.affectedSectorName || 'Sector'}</td>
                              <td className="p-2 border border-slate-200 text-center">{c.offsetAngle > 0 ? `+${c.offsetAngle}°` : `${c.offsetAngle}°`}</td>
                              <td className="p-2 border border-slate-200 text-center">{c.heightMeters ? `${c.heightMeters}m` : 'N/A'}</td>
                              <td className="p-2 border border-slate-200 text-center">
                                <span className={cn(
                                  "px-2 py-0.5 rounded text-[10px] font-bold",
                                  c.exposureRisk === 'high' ? "bg-red-100 text-red-800" :
                                  c.exposureRisk === 'medium' ? "bg-amber-100 text-amber-800" :
                                  "bg-emerald-100 text-emerald-800"
                                )}>
                                  {c.exposureRisk === 'high' ? "Ưu tiên đo" : c.exposureRisk === 'medium' ? "Cần đo" : "An toàn"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Phần IV: Hình ảnh hiện trường */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      IV. Hồ sơ Ảnh Hiện trường Kiểm định (Tối thiểu 3 ảnh quy chuẩn)
                    </h4>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="border border-slate-200 p-2 rounded-xl text-center space-y-1">
                        <span className="text-[11px] font-bold block">1. Ảnh Nhà Trạm</span>
                        {surveyPhotos.stationPhotoUrl ? (
                          <img src={surveyPhotos.stationPhotoUrl} alt="Nhà trạm" className="aspect-video w-full object-cover rounded" />
                        ) : (
                          <div className="aspect-video bg-slate-100 rounded flex items-center justify-center text-[10px] text-slate-400 italic">Chưa có ảnh</div>
                        )}
                      </div>

                      <div className="border border-slate-200 p-2 rounded-xl text-center space-y-1">
                        <span className="text-[11px] font-bold block">2. Ảnh CTCN Cao Nhất</span>
                        {surveyPhotos.tallestObstaclePhotoUrl ? (
                          <img src={surveyPhotos.tallestObstaclePhotoUrl} alt="CTCN cao nhất" className="aspect-video w-full object-cover rounded" />
                        ) : (
                          <div className="aspect-video bg-slate-100 rounded flex items-center justify-center text-[10px] text-slate-400 italic">Chưa có ảnh</div>
                        )}
                      </div>

                      <div className="border border-slate-200 p-2 rounded-xl text-center space-y-1">
                        <span className="text-[11px] font-bold block">3. Ảnh Anten (AT1 - AT3)</span>
                        {surveyPhotos.antennaPhotos?.find(p => p.url) ? (
                          <img src={surveyPhotos.antennaPhotos.find(p => p.url)!.url} alt="Anten" className="aspect-video w-full object-cover rounded" />
                        ) : (
                          <div className="aspect-video bg-slate-100 rounded flex items-center justify-center text-[10px] text-slate-400 italic">Chưa có ảnh</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Chữ ký xác nhận */}
                  <div className="pt-6 grid grid-cols-2 text-center text-xs">
                    <div className="space-y-12">
                      <strong className="block">ĐẠI DIỆN ĐƠN VỊ KIỂM ĐỊNH</strong>
                      <span className="text-slate-400 italic">(Ký, ghi rõ họ tên)</span>
                    </div>
                    <div className="space-y-12">
                      <strong className="block">KỸ SƯ KHẢO SÁT HIỆN TRƯỜNG</strong>
                      <span className="text-slate-400 italic">(Ký, ghi rõ họ tên)</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer Bar */}
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 text-xs">
              {saveSuccess && (
                <span className="text-emerald-600 font-bold flex items-center gap-1.5 animate-bounce">
                  <FileCheck2 className="w-4 h-4" />
                  Đã lưu toàn bộ số liệu khảo sát vào Hồ sơ Trạm!
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                className="h-8 text-xs px-3.5 rounded-xl"
              >
                Đóng
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleExportJSON}
                className="h-8 text-xs px-3 rounded-xl border-slate-300 text-slate-700 hover:bg-slate-100 flex items-center gap-1 font-semibold"
                title="Tải tệp JSON dữ liệu khảo sát"
              >
                <Download className="w-3.5 h-3.5 text-blue-600" />
                <span className="hidden sm:inline">Xuất JSON</span>
              </Button>

              {!readOnly && (
                <Button
                  size="sm"
                  disabled={isSaving}
                  onClick={handleSave}
                  className="h-8 text-xs px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-md shadow-blue-500/20 flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSaving ? "Đang lưu..." : "Lưu vào Hồ sơ Trạm"}</span>
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
