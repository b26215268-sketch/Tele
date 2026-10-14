import React, { useState, useMemo, useEffect, useRef } from 'react';
import { collection, addDoc, doc, updateDoc, query, getDocs, deleteDoc } from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { motion, AnimatePresence } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { db, storage } from '../firebase';
import { Station, EquipmentDict, TaskGroup, Workspace, Report, ReportDetail, InfrastructureCheck, Attachment, SurveyParameter, Assignment } from '../types';
import { User } from 'firebase/auth';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { cn } from '../lib/utils';
import { FileText, Save, CheckCircle, Image as ImageIcon, MessageSquare, X, ChevronDown, ChevronRight, Check, ClipboardList, Search, Settings2, Trash2, Home, Cloud, Plus, History, MapPin, Clock } from 'lucide-react';
import { handleFirestoreError } from '../lib/firebase-utils';
import { removeVietnameseTones } from '../lib/utils';

export function ReportsTab({
  stations,
  user,
  equipmentDict,
  taskGroups,
  workspaces,
  technologies,
  initialStationId = '',
  initialAssignmentId = '',
  reports,
  surveyParameters,
  assignments = []
}: {
  stations: Station[];
  user: User;
  equipmentDict: EquipmentDict[];
  taskGroups: TaskGroup[];
  workspaces: Workspace[];
  technologies?: string[];
  initialStationId?: string;
  initialAssignmentId?: string;
  reports: Report[];
  surveyParameters: SurveyParameter[];
  assignments?: Assignment[];
}) {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [toastMessage, setToastMessage] = useState<{message: string, type: 'success' | 'error' | 'info'} | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{isOpen: boolean, title: string, message: string, onConfirm: () => void}>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  const [stationId, setStationId] = useState(initialStationId);
  const [assignmentId, setAssignmentId] = useState(initialAssignmentId);
  const [stationSearch, setStationSearch] = useState('');
  const [isStationDropdownOpen, setIsStationDropdownOpen] = useState(false);
  const stationDropdownRef = useRef<HTMLDivElement>(null);
  
  const [taskGroupId, setTaskGroupId] = useState('');
  const [taskGroupSearch, setTaskGroupSearch] = useState('');

  useEffect(() => {
    setStationId(initialStationId);
    setAssignmentId(initialAssignmentId);
    
    if (initialAssignmentId && assignments.length > 0) {
       const assignment = assignments.find(a => a.id === initialAssignmentId);
       if (assignment && assignment.taskGroupId) {
         setTaskGroupId(assignment.taskGroupId);
         const tg = taskGroups.find(t => t.id === assignment.taskGroupId);
         if (tg) setTaskGroupSearch(tg.name);
       }
    }
    
    if (initialStationId) setCurrentStep(1);
  }, [initialStationId, initialAssignmentId, assignments, taskGroups]);

  const selectedTaskGroup = taskGroups.find(tg => tg.id === taskGroupId);
  const [actualCategories, setActualCategories] = useState<string[]>([]);
  const [isNoMaterial, setIsNoMaterial] = useState<boolean>(false);

  useEffect(() => {
    if (selectedTaskGroup) {
      const allowed = (selectedTaskGroup.applicableCategories && selectedTaskGroup.applicableCategories.length > 0)
        ? selectedTaskGroup.applicableCategories
        : (selectedTaskGroup.workspace === 'Full' ? ['Indoor', 'Outdoor'] : (selectedTaskGroup.workspace ? [selectedTaskGroup.workspace] : []));
      
      setActualCategories(allowed);
      setIsNoMaterial(false);
    }
  }, [taskGroupId, selectedTaskGroup]);

  useEffect(() => {
    if (equipmentDict.length === 0) return;

    if (stationId) {
      const st = stations.find(s => s.id === stationId);
      if (st && stationSearch !== st.name) {
        setStationSearch(st.name);
      }
    }
  }, [stationId, equipmentDict.length, stations, stationSearch]);

  useEffect(() => {
    if (equipmentDict.length === 0) return;
    
    if (isNoMaterial) {
      setDetailsList([]);
    } else {
      const newDetailsList: ReportDetail[] = [];
      
      const findEqItem = (name: string) => {
        const normalizedQuery = removeVietnameseTones(name.toLowerCase().replace(/\s+/g, ''));
        const exact = equipmentDict.find(e => removeVietnameseTones(e.name.toLowerCase().replace(/\s+/g, '')) === normalizedQuery);
        if (exact) return exact;
        const partial = equipmentDict.find(e => removeVietnameseTones(e.name.toLowerCase().replace(/\s+/g, '')).includes(normalizedQuery));
        return partial || null;
      };

      const addEq = (spaceId: string, name: string, qty: number) => {
        const eq = findEqItem(name);
        newDetailsList.push({
           id: Math.random().toString(36).substr(2, 9),
           spaceId,
           equipmentId: eq ? eq.id : '',
           unit: eq ? (eq.unit || 'cái') : undefined,
           quantity: qty,
           status: 'Tốt',
           note: ''
        });
      };

      const addIndoor = (spaceId: string) => {
        addEq(spaceId, 'baseband', 1);
        addEq(spaceId, 'dâynguồn', 1);
        addEq(spaceId, 'dâytiếpđất', 1);
      };

      const addOutdoor = (spaceId: string) => {
        addEq(spaceId, 'anten', 3);
        addEq(spaceId, 'rru', 3);
        addEq(spaceId, 'quang', 3);
        addEq(spaceId, 'jumper', 3);
        addEq(spaceId, 'dâyjet', 3);
        addEq(spaceId, 'dâynguồn', 3);
      };

      // Fill legacy categories
      actualCategories.forEach(cat => {
        const catNameLower = cat.toLowerCase();
        if (catNameLower.includes('indoor')) addIndoor(cat);
        else if (catNameLower.includes('outdoor')) addOutdoor(cat);
      });

      setDetailsList(newDetailsList);
    }
  }, [actualCategories, isNoMaterial, equipmentDict]);

  const [reportContent, setReportContent] = useState('');
  const [detailsList, setDetailsList] = useState<ReportDetail[]>([]);
  const [photos, setPhotos] = useState<{ id: string, name: string, dataUrl: string, file: File, category: 'panorama' | 'power' | 'grounding' | 'damage' | 'general' }[]>([]);
  const [photoCategory, setPhotoCategory] = useState<'panorama' | 'power' | 'grounding' | 'damage' | 'general'>('general');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [infraCheck, setInfraCheck] = useState<InfrastructureCheck>({
    acStatus: 'Tốt',
    powerStatus: 'Tốt',
    securityStatus: 'An toàn',
    leakStatus: 'Khô ráo',
    note: ''
  });
  
  const [surveyResults, setSurveyResults] = useState<Record<string, any>>({});

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{current: number, total: number}>({current: 0, total: 0});
  const [confirmDeleteDetailDialog, setConfirmDeleteDetailDialog] = useState<{isOpen: boolean, detailId: string | null}>({isOpen: false, detailId: null});
  const [noteDialog, setNoteDialog] = useState<{isOpen: boolean, detailId: string | null}>({isOpen: false, detailId: null});

  const [watermarkTime, setWatermarkTime] = useState(true);
  const [watermarkStation, setWatermarkStation] = useState(true);
  const [watermarkCoords, setWatermarkCoords] = useState(false);
  const [isProcessingPhotos, setIsProcessingPhotos] = useState(false);

  const compressImage = (file: File, lat: string = '', lng: string = ''): Promise<string> => {
    return new Promise((resolve, reject) => {
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

            if (watermarkTime || watermarkStation || watermarkCoords) {
              const fontSize = Math.max(16, Math.floor(width * 0.035));
              ctx.font = `${fontSize}px sans-serif`;
              
              const lines: string[] = [];
              if (watermarkTime) {
                lines.push(`Thời gian: ${format(new Date(), 'dd/MM/yyyy HH:mm:ss')}`);
              }
              if (watermarkStation && stationId) {
                const s = stations.find(st => st.id === stationId);
                if (s) {
                  lines.push(`Trạm: ${s.name} ${s.infrastructureCode ? `(${s.infrastructureCode})` : ''}`);
                }
              }
              if (watermarkCoords && lat && lng) {
                lines.push(`Tọa độ: ${lat}, ${lng}`);
              }

              if (lines.length > 0) {
                const padding = fontSize * 0.6;
                const lineHeight = fontSize * 1.5;
                const boxHeight = lines.length * lineHeight + padding * 1.5;
                
                ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
                ctx.fillRect(0, canvas.height - boxHeight, canvas.width, boxHeight);

                ctx.fillStyle = 'white';
                ctx.textBaseline = 'top';
                lines.forEach((line, index) => {
                  ctx.fillText(line, padding, canvas.height - boxHeight + padding + index * lineHeight);
                });
              }
            }
          }
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = reject;
        img.src = event.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = async (e: any) => {
    if (e.target.files && e.target.files.length > 0) {
      setIsProcessingPhotos(true);
      const newPhotos = [...photos];
      
      let lat = '';
      let lng = '';
      if (watermarkCoords) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
          });
          lat = position.coords.latitude.toFixed(6);
          lng = position.coords.longitude.toFixed(6);
        } catch (error) {
          console.warn("Could not get location", error);
          alert("Không thể tự động lấy tọa độ vị trí. Trình duyệt chưa cấp quyền truy cập GPS.");
        }
      }

      for (let i = 0; i < e.target.files.length; i++) {
        const file = e.target.files[i];
        if (!file.type.startsWith('image/')) continue;
        try {
          const dataUrl = await compressImage(file, lat, lng);
          newPhotos.push({
            id: Math.random().toString(36).substr(2, 9),
            name: file.name,
            dataUrl,
            file: file,
            category: photoCategory
          });
        } catch (error) {
          console.error("Lỗi nén/đóng dấu ảnh:", error);
        }
      }
      setPhotos(newPhotos);
      setIsProcessingPhotos(false);
      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removePhoto = (id: string) => {
    setPhotos(photos.filter(p => p.id !== id));
  };

  // Filter equipments based on wordSpace or spaceId
  const getEquipmentsForSpace = (space: string) => {
    return equipmentDict.filter(eq => eq.validSpaces.includes(space)).map(eq => eq.name);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (stationDropdownRef.current && !stationDropdownRef.current.contains(event.target as Node)) {
        setIsStationDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const sortedSurveyParameters = useMemo(() => {
    return [...surveyParameters].sort((a, b) => a.label.localeCompare(b.label, 'vi'));
  }, [surveyParameters]);

  const filteredStations = useMemo(() => {
    if (!stationSearch) return stations.slice(0, 50);
    const searchTerms = removeVietnameseTones(stationSearch.toLowerCase().trim()).split(/\s+/).filter(Boolean);
    if (searchTerms.length === 0) return stations.slice(0, 50);
    return stations.filter(s => {
      const searchableArray = [
        s.name,
        s.infrastructureCode,
        s.infrastructureDepartment,
        s.address,
        s.managerName,
        s.managerPhone,
        s.note,
        s.region,
        ...(s.tags || []),
        ...(s.networkTypes || [])
      ];
      const massiveString = removeVietnameseTones(searchableArray.filter(Boolean).join(' ').toLowerCase());
      return searchTerms.every(term => massiveString.includes(term));
    }).slice(0, 50);
  }, [stations, stationSearch]);

  const SPACES = ['Indoor', 'Outdoor'];

  const handleAddDetail = (forcedSpace?: string) => {
    setDetailsList([
      ...detailsList,
      {
        id: Math.random().toString(36).substr(2, 9),
        spaceId: forcedSpace || actualCategories[0] || '',
        equipmentId: '',
        quantity: 1,
        status: 'Tốt'
      }
    ]);
  };

  const handleRemoveDetail = (id: string) => {
    setConfirmDeleteDetailDialog({ isOpen: true, detailId: id });
  };

  const confirmRemoveDetail = () => {
    if (confirmDeleteDetailDialog.detailId) {
      setDetailsList(detailsList.filter(d => d.id !== confirmDeleteDetailDialog.detailId));
    }
    setConfirmDeleteDetailDialog({ isOpen: false, detailId: null });
  };

  const handleChangeDetail = (id: string, field: keyof ReportDetail, value: any) => {
    setDetailsList(detailsList.map(d => {
      if (d.id === id) {
        if (field === 'spaceId') {
          // Reset equipment if space changes to prevent invalid equipment
          return { ...d, [field]: value, equipmentId: '', unit: undefined };
        }
        if (field === 'equipmentId') {
          const matchedEq = equipmentDict.find(eq => eq.id === value || eq.name === value);
          return { ...d, [field]: value, unit: matchedEq?.unit || 'cái' };
        }
        if (field === 'quantity') {
          // Parse float to allow decimal numbers properly while preventing NaN errors
          const parsedValue = typeof value === 'string' ? parseFloat(value) : value;
          return { ...d, [field]: isNaN(parsedValue) ? 0 : parsedValue };
        }
        return { ...d, [field]: value };
      }
      return d;
    }));
  };

  const handleSubmit = async () => {
    let finalStationId = stationId;
    
    // Auto-select if they typed the exact name but didn't click dropdown
    if (!finalStationId && stationSearch) {
      const typed = removeVietnameseTones(stationSearch.toLowerCase());
      const match = stations.find(s => removeVietnameseTones(s.name.toLowerCase()) === typed || removeVietnameseTones(s.infrastructureCode?.toLowerCase() || '') === typed);
      if (match) {
        finalStationId = match.id;
        setStationId(match.id);
      }
    }

    if (!finalStationId || !taskGroupId) {
      alert("Vui lòng chọn đủ Trạm trong danh sách và Loại Công Việc!");
      return;
    }

    const selectedTaskGroup = taskGroups.find(tg => tg.id === taskGroupId);
    const hasEquipmentModule = selectedTaskGroup?.modules?.includes('EQUIPMENT') ?? (selectedTaskGroup?.requiresEquipment !== false);
    const showInfraModule = taskGroupId && selectedTaskGroup?.modules?.includes('INFRASTRUCTURE');

    // Remove strict validation for empty/zero items
    const validDetailsList = detailsList.filter(d => d.equipmentId && d.quantity > 0);

    setIsSubmitting(true);
    try {
      const selectedStation = stations.find(s => s.id === finalStationId);
      const now = new Date().toISOString();
      const today = format(new Date(), 'yyyy-MM-dd');

      // Upload photos sequentially
      const uploadedAttachments: Attachment[] = [];
      setUploadProgress({ current: 0, total: photos.length });
      
      for (let i = 0; i < photos.length; i++) {
         const photo = photos[i];
         const fileRef = ref(storage, `reports/${finalStationId}/${now}_${photo.id}.jpg`);
         try {
           // We upload the base64 dataUrl directly
           await uploadString(fileRef, photo.dataUrl, 'data_url');
           const downloadUrl = await getDownloadURL(fileRef);
           uploadedAttachments.push({
             id: photo.id,
             url: downloadUrl,
             type: 'image/jpeg',
             category: photo.category
           });
         } catch (uploadObjErr) {
           console.error("Failed to upload photo to storage, falling back to dataUrl.", uploadObjErr);
           // Fallback if storage fails (e.g. not provisioned)
           uploadedAttachments.push({
             id: photo.id,
             url: photo.dataUrl, 
             type: 'image/jpeg',
             category: photo.category
           });
         }
         setUploadProgress({ current: i + 1, total: photos.length });
      }

      const reportData: Partial<Report> = {
        userId: user.uid,
        stationId: finalStationId,
        stationName: selectedStation?.name || 'Trạm không xác định',
        taskGroupId: taskGroupId,
        date: today,
        workSpace: isNoMaterial ? 'Không có vật tư' : actualCategories.join(', '),
        content: reportContent.trim() ? reportContent.trim() : (hasEquipmentModule ? 'Báo cáo chi tiết thiết bị' : 'Báo cáo khảo sát & bảo dưỡng chung'),
        equipmentDetails: hasEquipmentModule && !isNoMaterial ? validDetailsList : [],
        attachments: uploadedAttachments,
        surveyResults: showInfraModule ? surveyResults : {},
        infrastructureCheck: infraCheck,
        status: 'completed',
        createdAt: now,
        completedAt: now,
        updatedAt: now,
        history: [{
          userId: user.uid,
          userName: user.displayName || user.email || 'Unknown',
          timestamp: now,
          content: hasEquipmentModule ? 'Tạo mới báo cáo Master-Detail' : 'Tạo mới báo cáo khảo sát/chung'
        }]
      };

      const reportRef = await addDoc(collection(db, 'reports'), reportData);
      
      // Auto-update assignment status to "completed" if assignmentId is present
      if (assignmentId) {
        try {
          await updateDoc(doc(db, 'assignments', assignmentId), {
            status: 'completed',
            updatedAt: now
          });
        } catch (e) {
          console.error("Failed to update assignment status", e);
        }
      }

      // Auto-update station status to "checked" when a report is created
      if (selectedStation && selectedStation.status !== 'checked') {
        await updateDoc(doc(db, 'stations', finalStationId), {
          status: 'checked'
        });
      }

      // Add to audit_logs
      await addDoc(collection(db, 'audit_logs'), {
        reportId: reportRef.id,
        stationId: finalStationId,
        userId: user.uid,
        userEmail: user.email || user.displayName || 'Unknown',
        action: 'CREATE',
        changes: `Tạo báo cáo mới: ${selectedTaskGroup?.name || 'Khác'}. Trạm: ${selectedStation?.name || 'Không rõ'}`,
        timestamp: now
      });

      setToastMessage({ message: "Lưu báo cáo thành công!", type: 'success' });
      setTimeout(() => setToastMessage(null), 3000);
      
      // Clear form
      setStationId(''); setAssignmentId(''); setDetailsList([]); setPhotos([]); setNoteDialog({isOpen: false, detailId: null}); setReportContent(''); setSurveyResults({});
      setTaskGroupId(''); setTaskGroupSearch('');
      setCurrentStep(1);
    } catch (err: any) {
      console.error(err);
      setToastMessage({ message: `Lỗi: ${err?.message || err}`, type: 'error' });
      setTimeout(() => setToastMessage(null), 5000);
    } finally {
      setIsSubmitting(false);
    }
  };

  const showInfraModule = taskGroupId && selectedTaskGroup?.modules?.includes('INFRASTRUCTURE');
  const isEquipmentConfigured = taskGroupId ? (selectedTaskGroup?.modules?.includes('EQUIPMENT') ?? (selectedTaskGroup?.requiresEquipment !== false)) : false;
  const showEquipmentDetails = isEquipmentConfigured && !isNoMaterial;

  return (
    <motion.div 
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} 
      className="space-y-4 w-full relative pb-20"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900">Thực hiện Công việc</h2>
        <div className="text-sm font-medium text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
          Bước {currentStep} / {showEquipmentDetails || showInfraModule ? '3' : '2'}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden mb-6">
        <div 
          className="bg-blue-600 h-full transition-all duration-300" 
          style={{ width: `${(currentStep / (showEquipmentDetails || showInfraModule ? 3 : 2)) * 100}%` }}
        />
      </div>

      <Card className="flex-col flex shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-gray-100 rounded-2xl overflow-hidden">
        
        {/* STEP 1: CHOOSE STATION & TASK */}
        {currentStep === 1 && (
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="p-4 sm:p-6 space-y-6">
            <div className="space-y-2">
              <h3 className="font-bold text-blue-900 flex items-center gap-2 text-lg">
                <MapPin className="w-5 h-5 text-blue-600" /> Chọn Trạm
              </h3>
              <p className="text-sm text-gray-500">Tìm kiếm và chọn trạm viễn thông bạn đang thao tác.</p>
            </div>
            
            <div className="space-y-5">
              <div ref={stationDropdownRef} className="relative z-50">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Trạm <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Input 
                    type="text"
                    placeholder="Tìm theo tên hoặc mã CSHT..."
                    value={stationSearch}
                    onChange={(e: any) => {
                      setStationSearch(e.target.value);
                      setIsStationDropdownOpen(true);
                      if (stationId) setStationId('');
                    }}
                    onFocus={() => setIsStationDropdownOpen(true)}
                  />
                  <Search className="w-4 h-4 absolute right-3 top-3 text-gray-400" />
                </div>
                
                <AnimatePresence>
                  {isStationDropdownOpen && (
                    <motion.div 
                      initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.15 }}
                      className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-60 overflow-y-auto"
                    >
                      {filteredStations.length === 0 ? (
                        <div className="p-3 text-sm text-gray-500 italic text-center">Không tìm thấy trạm phù hợp.</div>
                      ) : (
                        filteredStations.map(s => (
                          <div 
                            key={s.id}
                            className={cn(
                              "p-3 cursor-pointer border-b border-gray-50 last:border-0 transition-colors",
                              stationId === s.id ? "bg-blue-50" : "hover:bg-gray-50"
                            )}
                            onClick={() => {
                              setStationId(s.id);
                              setStationSearch(`${s.name} (${s.infrastructureCode || 'N/A'})`);
                              setIsStationDropdownOpen(false);
                            }}
                          >
                            <div className={cn("font-medium text-sm", stationId === s.id ? "text-blue-700" : "text-gray-900")}>{s.name}</div>
                            <div className="text-xs text-gray-500 font-mono mt-0.5">{s.infrastructureCode || 'Chưa cập nhật mã'}</div>
                          </div>
                        ))
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Người thực hiện</label>
                <Input value={user.displayName || user.email || ''} readOnly className="bg-gray-50 text-gray-500" />
              </div>

              <div className="relative z-40">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Loại công việc <span className="text-red-500">*</span>
                </label>
                <select 
                  className="w-full border border-gray-200 p-2.5 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                  value={taskGroupId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setTaskGroupId(id);
                    const selected = taskGroups.find(tg => tg.id === id);
                    if (selected) setTaskGroupSearch(selected.name);
                  }}
                >
                  <option value="">-- Chọn loại công việc --</option>
                  {taskGroups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>

              {taskGroupId && (selectedTaskGroup?.modules?.includes('EQUIPMENT') ?? (selectedTaskGroup?.requiresEquipment !== false)) && (
                <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100/50 mt-5 space-y-3 relative z-30">
                  <label className="block text-sm font-bold text-blue-900">Chọn nhóm vật tư phát sinh:</label>
                  <div className="flex flex-col gap-3">
                    <label className={cn("flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors", isNoMaterial ? "bg-white border-blue-400 shadow-sm" : "bg-white/60 border-transparent hover:border-blue-200")}>
                      <div className={cn("w-4 h-4 rounded-full border flex items-center justify-center shrink-0", isNoMaterial ? "border-blue-600 bg-white" : "border-gray-300 bg-white")}>
                         {isNoMaterial && <div className="w-2 h-2 rounded-full bg-blue-600" />}
                      </div>
                      <input
                        type="checkbox"
                        checked={isNoMaterial}
                        onChange={(e) => setIsNoMaterial(e.target.checked)}
                        className="hidden"
                      />
                      <span className={cn("text-sm font-medium", isNoMaterial ? "text-blue-800" : "text-gray-600")}>Không phát sinh vật tư</span>
                    </label>

                    {!isNoMaterial && (() => {
                      const tgCats = (selectedTaskGroup?.applicableCategories && selectedTaskGroup.applicableCategories.length > 0)
                        ? selectedTaskGroup.applicableCategories
                        : (selectedTaskGroup?.workspace === 'Full' ? ['Indoor', 'Outdoor'] : (selectedTaskGroup?.workspace ? [selectedTaskGroup.workspace] : []));
                      
                      if (tgCats.length === 0) return <div className="p-3 text-sm text-gray-500 italic bg-white/60 rounded-lg">Không có nhóm vật tư nào được cấu hình cho công việc này.</div>;

                      return (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {tgCats.map(cat => (
                            <label key={cat} className={cn("flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors", actualCategories.includes(cat) ? "bg-white border-blue-400 shadow-sm" : "bg-white/60 border-transparent hover:border-blue-200")}>
                              <div className={cn("w-4 h-4 rounded border flex items-center justify-center shrink-0", actualCategories.includes(cat) ? "border-blue-600 bg-blue-600 text-white" : "border-gray-300 bg-white")}>
                                {actualCategories.includes(cat) && <Check className="w-3 h-3" />}
                              </div>
                              <input
                                type="checkbox"
                                checked={actualCategories.includes(cat)}
                                onChange={(e) => {
                                  if (e.target.checked) setActualCategories([...actualCategories, cat]);
                                  else setActualCategories(actualCategories.filter(c => c !== cat));
                                }}
                                className="hidden"
                              />
                              <span className={cn("text-sm font-medium", actualCategories.includes(cat) ? "text-blue-800" : "text-gray-600")}>{cat}</span>
                            </label>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-4">
              <Button 
                onClick={() => {
                  if (!stationId || !taskGroupId) {
                    setToastMessage({ message: 'Vui lòng chọn Trạm và Loại công việc', type: 'error' });
                    setTimeout(() => setToastMessage(null), 3000);
                    return;
                  }
                  if (showEquipmentDetails || showInfraModule) {
                     setCurrentStep(2);
                  } else {
                     setCurrentStep(3); // Skip straight to final step if no Details/Survey needed
                  }
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2 px-6"
              >
                Tiếp tục <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </motion.div>
        )}

        {/* STEP 2: DETAILS OR SURVEY */}
        {currentStep === 2 && (showEquipmentDetails || showInfraModule) && (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="p-4 sm:p-6 space-y-6">
            <div className="space-y-2">
              <h3 className="font-bold text-blue-900 flex items-center gap-2 text-lg">
                <ClipboardList className="w-5 h-5 text-blue-600" /> Chi tiết công việc
              </h3>
              <p className="text-sm text-gray-500">Cập nhật thiết bị hoặc nhập số liệu khảo sát hạ tầng.</p>
            </div>

            {/* Dynamic Survey Form (Survey Parameters) */}
            {showInfraModule && surveyParameters.length > 0 && (
              <div className="space-y-4 px-4 sm:px-6 pt-4 border border-blue-100 bg-[#f8fafc] rounded-xl pb-6 shadow-sm">
                <h3 className="font-bold text-blue-800 flex items-center gap-2 border-b border-blue-100 pb-2 mb-4">
                  <ClipboardList className="w-5 h-5 text-blue-600" /> Khảo sát Thông số trạm
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {sortedSurveyParameters.map(param => (
                    <div key={param.id} className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm transition-all hover:border-blue-200">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 ml-1">
                        {param.label}
                      </label>
                      <div className="relative">
                        <Input 
                          type={param.type}
                          placeholder={param.type === 'number' ? '0.0' : `Nhập ${param.label.toLowerCase()}...`}
                          value={surveyResults[param.id] || ''}
                          onChange={(e: any) => setSurveyResults({...surveyResults, [param.id]: e.target.value})}
                          className="pr-12 h-10 text-sm font-medium focus:ring-blue-500/20"
                        />
                        {param.unit && (
                          <div className="absolute right-3 top-2.5 text-xs font-bold text-gray-400 pointer-events-none">
                            {param.unit}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* Details Form (Equipment) */}
          {showEquipmentDetails && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center border-b pb-2 gap-3">
                  <h3 className="font-semibold text-blue-700 flex items-center gap-2">
                    <Settings2 className="w-5 h-5" /> 2. Chi tiết thiết bị (Detail)
                  </h3>
                  
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-lg border">
                      <span className="text-sm font-medium text-gray-700 truncate max-w-[200px]" title={actualCategories.join(', ')}>
                        Nhóm: {isNoMaterial ? 'Không có vật tư' : actualCategories.join(', ') || 'Chưa chọn'}
                      </span>
                    </div>
                    {/* Total Summary */}
                    <div className="text-xs font-semibold text-gray-600 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200 flex items-center gap-1">
                      Tổng: <span className="text-blue-700 text-sm mx-1">{detailsList.length}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  {(() => {
                    const renderDetailRow = (detail: ReportDetail) => {
                      const hasNote = detail.note && detail.note.trim().length > 0;
                      return (
                        <div key={detail.id} className="flex gap-2 items-center bg-white p-2 border border-gray-200 rounded-lg shadow-sm w-full">
                          <div className="w-[140px] md:w-[160px] shrink-0 sticky left-0 z-10 bg-white/95 backdrop-blur-sm -ml-2 pl-2 shadow-[2px_0_10px_-4px_rgba(0,0,0,0.15)] flex items-center">
                            <select className="w-full border-gray-200 bg-gray-50 focus:bg-white p-1.5 rounded-md text-sm border truncate" value={detail.equipmentId} onChange={e => handleChangeDetail(detail.id, 'equipmentId', e.target.value)}>
                              <option value="">- Chọn Thiết bị -</option>
                              {equipmentDict.filter(eq => eq.validSpaces.includes(detail.spaceId)).map(eq => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
                            </select>
                          </div>
                          <div className="w-[75px] shrink-0 relative flex items-center">
                             <Input 
                               type="number" 
                               step="any"
                               value={detail.quantity} 
                               onChange={(e: any) => handleChangeDetail(detail.id, 'quantity', e.target.value)} 
                               className="w-full p-1.5 text-sm h-8 text-center font-medium pr-5" 
                               placeholder="0"
                             />
                             {detail.unit && <span className="absolute right-1 text-[9px] text-gray-500 font-medium pointer-events-none">{detail.unit}</span>}
                          </div>
                          <div className="w-10 shrink-0 flex justify-center">
                            <button 
                              onClick={() => setNoteDialog({ isOpen: true, detailId: detail.id })}
                              className={`p-1.5 rounded-md transition-colors ${hasNote ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                              title="Ghi chú"
                            >
                              <FileText className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="w-[85px] shrink-0">
                            <select 
                              className="w-full border-gray-200 bg-white p-1.5 rounded-md text-sm border h-8"
                              value={detail.status}
                              onChange={e => handleChangeDetail(detail.id, 'status', e.target.value)}
                            >
                              <option value="Tốt">Tốt</option>
                              <option value="Hỏng">Hỏng</option>
                              <option value="Khác">Khác</option>
                            </select>
                          </div>
                          <button onClick={() => handleRemoveDetail(detail.id)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded shrink-0">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    };

                    const renderSpaceBlock = (spaceCode: string) => {
                        const items = detailsList.filter(d => spaceCode ? d.spaceId === spaceCode : true);
                        const title = spaceCode ? <><Home className="w-4 h-4"/> {spaceCode.toUpperCase()} : {items.length}</> : null;
                        const titleClass = "text-indigo-700";
                        
                        return (
                            <div key={spaceCode} className="bg-gray-50/50 p-2 sm:p-3 rounded-xl border border-gray-200 border-dashed space-y-3 overflow-x-auto relative">
                                 {title && <h4 className={`font-bold flex items-center gap-1.5 text-sm px-1 ${titleClass}`}>{title}</h4>}
                                 {items.length === 0 ? (
                                     <div className="text-center py-4 text-gray-400 text-sm border border-dashed border-gray-300 rounded-lg bg-white/50">Chưa có thiết bị.</div>
                                 ) : (
                                     <div className="space-y-2 min-w-[600px] pb-1">
                                         <div className="flex gap-2 items-center px-2 py-1 text-xs font-semibold text-gray-500">
                                           <div className="w-[140px] md:w-[160px] shrink-0 sticky left-0 z-10 bg-gray-50/90 backdrop-blur-sm -ml-2 pl-2 shadow-[2px_0_8px_-4px_rgba(0,0,0,0.05)]">Thiết bị</div>
                                           <div className="w-[75px] text-center shrink-0">SL</div>
                                           <div className="w-10 text-center shrink-0">Note</div>
                                           <div className="w-[85px] text-center shrink-0">Tình trạng</div>
                                           <div className="w-8 shrink-0"></div>
                                         </div>
                                         {items.map(renderDetailRow)}
                                     </div>
                                 )}
                                 <div className="flex justify-end">
                                    <Button size="sm" variant="outline" onClick={() => handleAddDetail(spaceCode as any)} className="text-xs h-7 px-3 bg-white hover:bg-gray-100 flex items-center gap-1 font-medium text-gray-700 border-gray-300 shadow-sm">
                                       <Plus className="w-3.5 h-3.5" /> Thêm
                                    </Button>
                                 </div>
                            </div>
                        )
                    };

                    const activeCategories = isNoMaterial ? [] : actualCategories;
                    if (activeCategories.length === 0) {
                      return <div className="text-center py-6 text-gray-500 italic bg-gray-50 rounded-xl border border-dashed border-gray-200">Không có vật tư thiết bị phát sinh.</div>;
                    }
                    return (
                        <div className="space-y-4">
                          {activeCategories.map(cat => renderSpaceBlock(cat))}
                        </div>
                    );
                  })()}
                </div>
              </div>
            )}

            <div className="flex justify-between pt-4 border-t border-gray-100">
              <Button onClick={() => setCurrentStep(1)} variant="outline" className="px-6">Lùi lại</Button>
              <Button 
                onClick={() => setCurrentStep(3)} 
                className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2 px-6"
              >
                Tiếp tục <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </motion.div>
        )}

        {/* STEP 3: SUBMIT / PHOTOS / NOTES */}
        {currentStep === 3 && (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
            {/* Photos Form */}
            <div className="p-4 sm:p-6 space-y-6">
              <div className="space-y-2 mb-2">
                <h3 className="font-bold text-blue-900 flex items-center gap-2 text-lg">
                  <ImageIcon className="w-5 h-5 text-blue-600" /> Nghiệm thu & Chụp ảnh
                </h3>
                <p className="text-sm text-gray-500">Bước cuối cùng để hoàn tất công việc.</p>
              </div>

              {(() => {
                const selectedTaskGroup = taskGroups.find(tg => tg.id === taskGroupId);
                const showPhotoModule = taskGroupId && selectedTaskGroup?.modules?.includes('PHOTO');
                
                if (!showPhotoModule) return null;

                return (
                  <div className="space-y-4">
                    <div className="flex flex-col gap-3">
                      
                      {/* Watermark Options */}
                      <div className="flex flex-wrap items-center gap-3 bg-blue-50/50 border border-blue-100 p-3 rounded-xl text-sm shadow-sm">
                        <span className="font-bold text-blue-900 w-full sm:w-auto mb-1 sm:mb-0 flex items-center gap-1.5"><MapPin className="w-4 h-4 text-blue-600" /> Đóng dấu thông tin (Watermark):</span>
                        <div className="flex items-center gap-4 flex-1">
                          <label className="flex items-center gap-1.5 cursor-pointer text-gray-700 hover:text-blue-600 transition-colors font-medium">
                            <input type="checkbox" checked={watermarkTime} onChange={(e) => setWatermarkTime(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                            <span>Thời gian</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer text-gray-700 hover:text-blue-600 transition-colors font-medium">
                            <input type="checkbox" checked={watermarkStation} onChange={(e) => setWatermarkStation(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                            <span>Trạm</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer text-gray-700 hover:text-blue-600 transition-colors font-medium">
                            <input type="checkbox" checked={watermarkCoords} onChange={(e) => setWatermarkCoords(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                            <span>Tọa độ GPS</span>
                          </label>
                        </div>
                      </div>

                      <div className="flex gap-2 pb-2 overflow-x-auto mt-2">
                        {[
                          { id: 'general', label: '📸 Chưa phân loại' },
                          { id: 'panorama', label: '🏞️ Toàn cảnh trạm' },
                          { id: 'power', label: '⚡ Tủ nguồn / AC' },
                          { id: 'grounding', label: '🔌 Tiếp đất' },
                          { id: 'damage', label: '⚠️ Hư hỏng / Lỗi' }
                        ].map(cat => (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => setPhotoCategory(cat.id as any)}
                            className={cn(
                              "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
                              photoCategory === cat.id ? "bg-blue-600 text-white shadow-md shadow-blue-500/20" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                            )}
                          >
                            {cat.label}
                          </button>
                        ))}
                      </div>

                      <div className="flex flex-wrap gap-3 mb-2">
                        {photos.map(photo => (
                          <div key={photo.id} className="relative w-24 h-24 rounded-lg overflow-hidden border border-gray-200 group flex-shrink-0">
                            <img src={photo.dataUrl} alt={photo.name} className="w-full h-full object-cover" />
                            <div className="absolute inset-x-0 bottom-0 bg-black/50 text-[9px] text-white text-center py-0.5 truncate px-1">
                              {photo.category === 'panorama' ? 'Toàn cảnh' : photo.category === 'power' ? 'Tủ nguồn' : photo.category === 'grounding' ? 'Tiếp đất' : photo.category === 'damage' ? 'Hư hỏng' : 'Chung'}
                            </div>
                            <button 
                              onClick={() => removePhoto(photo.id)}
                              className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                        
                        <label className={cn("w-24 h-24 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center transition-colors flex-shrink-0", isProcessingPhotos ? "bg-gray-50 text-gray-400 cursor-not-allowed" : "hover:border-blue-500 hover:bg-blue-50 cursor-pointer text-gray-500 hover:text-blue-500")}>
                          {isProcessingPhotos ? (
                            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-1"></div>
                          ) : (
                            <Plus className="w-6 h-6 mb-1" />
                          )}
                          <span className="text-[10px] font-medium text-center px-1">{isProcessingPhotos ? "Đang xử lý..." : "Thêm ảnh"}</span>
                          <input 
                            type="file" 
                            accept="image/jpeg, image/png, image/webp" 
                            multiple
                            capture="environment" /* Support direct camera open on mobile browsers */
                            className="hidden" 
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            disabled={isProcessingPhotos}
                          />
                        </label>
                      </div>
                      <p className="text-xs text-gray-500 italic">Chọn danh mục trước khi bấm tải ảnh lên để hệ thống phân loại. Ảnh sẽ được tự động nén thu nhỏ.</p>
                    </div>
                  </div>
                );
              })()}

              {/* General Notes */}
              <div className="space-y-2 pt-4">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                   Nội dung & Ghi chú cuối
                </h3>
                <textarea 
                  className="w-full border border-gray-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 min-h-[100px] resize-y"
                  placeholder="Nhập thêm nội dung báo cáo, ghi chú khảo sát, tình trạng chung..."
                  value={reportContent}
                  onChange={(e) => setReportContent(e.target.value)}
                ></textarea>
              </div>
            </div>

            <div className="p-4 sm:p-6 pb-8 border-t border-gray-100 flex gap-4">
              <Button onClick={() => setCurrentStep(showEquipmentDetails || showInfraModule ? 2 : 1)} variant="outline" className="w-[100px]">Lùi lại</Button>
              <Button 
                className="flex-1 py-4 text-base sm:text-lg rounded-xl font-bold shadow-lg shadow-blue-500/20 transition-all active:scale-[0.98]" 
                onClick={handleSubmit} 
                disabled={isSubmitting || !stationId || (taskGroupId && taskGroups.find(tg => tg.id === taskGroupId)?.modules?.includes('EQUIPMENT') && detailsList.length === 0)}
              >
                <Save className={cn("w-5 h-5", isSubmitting && "animate-spin")} />
                {isSubmitting 
                  ? (uploadProgress.total > 0 ? `Đang tải ảnh lên (${uploadProgress.current}/${uploadProgress.total})...` : 'Đang lưu báo cáo...') 
                  : 'Lưu báo cáo hoàn thành'}
              </Button>
            </div>
          </motion.div>
        )}
        </Card>

      {/* Detail Delete Confirmation Modal */}
      <AnimatePresence>
        {confirmDeleteDetailDialog.isOpen && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] p-4"
          >
            <motion.div 
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl"
            >
              <h3 className="text-lg font-bold text-gray-900 mb-2">Xác nhận xóa</h3>
              <p className="text-gray-600 mb-6 text-sm">Bạn có chắc chắn muốn xóa thiết bị này khỏi danh sách báo cáo không?</p>
              <div className="flex justify-end gap-3">
                <Button variant="secondary" size="sm" onClick={() => setConfirmDeleteDetailDialog({ isOpen: false, detailId: null })}>Hủy</Button>
                <Button variant="danger" size="sm" onClick={confirmRemoveDetail}>Xóa</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Note Edit Modal */}
      <AnimatePresence>
        {noteDialog.isOpen && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] p-4"
          >
            <motion.div 
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-xl p-0 max-w-lg w-full shadow-xl overflow-hidden flex flex-col"
            >
              <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <h3 className="text-lg font-bold text-gray-900">Chi tiết ghi chú</h3>
                <button onClick={() => setNoteDialog({ isOpen: false, detailId: null })} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5"/>
                </button>
              </div>
              <div className="p-4 flex-1">
                {(() => {
                  const detail = detailsList.find(d => d.id === noteDialog.detailId);
                  if (!detail) return null;
                  return (
                    <textarea 
                      className="w-full border p-3 rounded-lg min-h-[150px] resize-none outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      placeholder="Gõ ghi chú chi tiết cho thiết bị này..."
                      autoFocus
                      value={detail.note || ''}
                      onChange={(e) => handleChangeDetail(detail.id, 'note', e.target.value)}
                    />
                  );
                })()}
              </div>
              <div className="p-4 border-t border-gray-100 flex justify-end gap-3 bg-gray-50/50">
                <Button 
                   className="w-24 bg-blue-600 hover:bg-blue-700 text-white" 
                   onClick={() => setNoteDialog({ isOpen: false, detailId: null })}
                >
                  Xong
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {toastMessage && (
          <motion.div 
            initial={{ opacity: 0, y: 50, scale: 0.9 }} 
            animate={{ opacity: 1, y: 0, scale: 1 }} 
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
            className={cn(
              "fixed bottom-24 left-1/2 -translate-x-1/2 z-[150] flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium",
              toastMessage.type === 'success' ? "bg-emerald-50 text-emerald-700 border-emerald-200" : 
              toastMessage.type === 'error' ? "bg-rose-50 text-rose-700 border-rose-200" :
              "bg-blue-50 text-blue-700 border-blue-200"
            )}
          >
            {toastMessage.type === 'success' ? <CheckCircle className="w-5 h-5" /> : null}
            {toastMessage.message}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

