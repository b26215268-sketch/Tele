import React, { useState, useRef, useEffect, useMemo } from 'react';
import { collection, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import { db } from '../firebase';
import { Station, Report, ValidationWarning, AppUser } from '../types';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { cn } from '../lib/utils';
import { MapPin, Search, Edit2, Trash2, Plus, Upload, X, Map, Activity, CheckCircle2, AlertCircle, ChevronDown, User as UserIcon, Phone, Navigation } from 'lucide-react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { GoogleGenAI } from "@google/genai";
import { handleFirestoreError } from '../lib/firebase-utils';
import { removeVietnameseTones } from '../lib/utils';

function CustomFieldsEditor({ 
  fields, 
  onChange, 
  allCustomKeys 
}: { 
  fields: Record<string, string>, 
  onChange: (fields: Record<string, string>) => void,
  allCustomKeys: string[]
}) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  
  const suggestedKeys = allCustomKeys.filter(k => k.toLowerCase().includes(newKey.toLowerCase()) && !(fields && fields[k]));

  const addField = () => {
    if (newKey.trim() && newValue.trim()) {
      onChange({ ...(fields || {}), [newKey.trim()]: newValue.trim() });
      setNewKey('');
      setNewValue('');
      setShowSuggestions(false);
    }
  };

  const removeField = (key: string) => {
    const next = { ...fields };
    delete next[key];
    onChange(next);
  };

  return (
    <div className="space-y-3 sm:col-span-2 mt-4 pt-4 border-t border-gray-100">
      <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
        <Plus className="w-4 h-4 text-blue-600" />
        Thông tin mở rộng
      </h4>
      
      {fields && Object.keys(fields).length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          {Object.entries(fields).map(([k, v]) => (
            <div key={k} className="flex gap-2 items-center bg-gray-50 border border-gray-200 rounded-lg p-2">
              <span className="text-xs font-semibold text-gray-500 w-1/3 truncate" title={k}>{k}:</span>
              <Input 
                value={v} 
                onChange={(e: any) => onChange({ ...fields, [k]: e.target.value })} 
                className="flex-1 h-8 text-sm"
              />
              <button 
                type="button" 
                onClick={() => removeField(k)}
                className="text-red-400 hover:text-red-600 p-1 bg-red-50 hover:bg-red-100 rounded transition-colors"
                title={`Xóa ${k}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2 relative">
        <div className="relative flex-1">
           <Input 
             placeholder="Tên thông tin mới (VD: Dung lượng pin...)" 
             value={newKey} 
             onChange={(e: any) => {
               setNewKey(e.target.value);
               setShowSuggestions(true);
             }}
             onFocus={() => setShowSuggestions(true)}
             onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
           />
           {showSuggestions && suggestedKeys.length > 0 && (
             <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-40 overflow-y-auto">
               {suggestedKeys.map(sk => (
                 <div 
                   key={sk}
                   className="p-2 cursor-pointer text-sm border-b border-gray-50 hover:bg-gray-50 font-medium"
                   onClick={() => {
                     setNewKey(sk);
                     setShowSuggestions(false);
                   }}
                 >
                   {sk}
                 </div>
               ))}
             </div>
           )}
        </div>
        <Input 
          placeholder="Giá trị (VD: 200Ah)" 
          value={newValue} 
          onChange={(e: any) => setNewValue(e.target.value)}
          className="flex-1"
          onKeyDown={(e: any) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addField();
            }
          }}
        />
        <Button type="button" onClick={addField} disabled={!newKey.trim() || !newValue.trim()} className="shrink-0 bg-gray-900 text-white hover:bg-black">
          Thêm
        </Button>
      </div>
    </div>
  );
}

export function StationsTab({ stations, reports, validationWarnings, setValidationWarnings, campaigns, selectedCampaignId, appUsers }: { stations: Station[], reports: Report[], validationWarnings: ValidationWarning[] | null, setValidationWarnings: (warnings: ValidationWarning[] | null) => void, campaigns?: import('../types').Campaign[], selectedCampaignId?: string, appUsers?: AppUser[] }) {
  const [isAdding, setIsAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [newStation, setNewStation] = useState<Partial<Station>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [editingStation, setEditingStation] = useState<Station | null>(null);
  const [expandedStationId, setExpandedStationId] = useState<string | null>(null);
  const [showWarningsModal, setShowWarningsModal] = useState(false);
  const [viewingReport, setViewingReport] = useState<Report | null>(null);

  // Upload mapping states
  const [uploadData, setUploadData] = useState<any[]>([]);
  const [uploadHeaders, setUploadHeaders] = useState<string[]>([]);
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [mapCampaignId, setMapCampaignId] = useState('');
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({
    infrastructureCode: '', name: '', latitude: '', longitude: '', address: '', managerName: '', managerPhone: '', status: '', infrastructureDepartment: ''
  });

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{isOpen: boolean, title: string, message: string, onConfirm: () => void}>({
    isOpen: false, title: '', message: '', onConfirm: () => {}
  });

  const [isStationDropdownOpen, setIsStationDropdownOpen] = useState(false);
  const stationDropdownRef = useRef<HTMLDivElement>(null);

  const allCustomKeys = useMemo(() => Array.from(new Set(stations.flatMap(s => Object.keys(s.additionalFields || {})))), [stations]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (stationDropdownRef.current && !stationDropdownRef.current.contains(event.target as Node)) {
        setIsStationDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleMarkAsRead = (id: string) => {
    if (!validationWarnings) return;
    setValidationWarnings(validationWarnings.map(w => w.id === id ? { ...w, isRead: true } : w));
  };

  const handleDeleteWarning = (id: string) => {
    if (!validationWarnings) return;
    const newWarnings = validationWarnings.filter(w => w.id !== id);
    setValidationWarnings(newWarnings.length > 0 ? newWarnings : null);
    if (newWarnings.length === 0) setShowWarningsModal(false);
  };

  const handleMarkAllAsRead = () => {
    if (!validationWarnings) return;
    setValidationWarnings(validationWarnings.map(w => ({ ...w, isRead: true })));
  };

  const unreadCount = validationWarnings ? validationWarnings.filter(w => !w.isRead).length : 0;

  const filteredStations = stations.filter(s => {
    if (!search) return true;
    const searchTerms = removeVietnameseTones(search.toLowerCase().trim()).split(/\s+/).filter(Boolean);
    if (searchTerms.length === 0) return true;

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
      ...(s.networkTypes || []),
      s.latitude?.toString(),
      s.longitude?.toString()
    ];
    const massiveString = removeVietnameseTones(searchableArray.filter(Boolean).join(' ').toLowerCase());
    return searchTerms.every(term => massiveString.includes(term));
  });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStation.name || !newStation.latitude || !newStation.longitude) return;
    try {
      const targetCampaignId = selectedCampaignId !== 'all' ? selectedCampaignId : newStation.campaignId;
      await addDoc(collection(db, 'stations'), { ...newStation, campaignId: targetCampaignId });
      setNewStation({});
      setIsAdding(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStation || !editingStation.name || !editingStation.latitude || !editingStation.longitude) return;
    try {
      const { id, ...data } = editingStation;
      await updateDoc(doc(db, 'stations', id), data);
      setEditingStation(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setNewStation({ ...newStation, icon: reader.result as string });
    };
    reader.readAsDataURL(file);
  };

  const handleEditIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingStation) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setEditingStation({ ...editingStation, icon: reader.result as string });
    };
    reader.readAsDataURL(file);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const fileExt = file.name.split('.').pop()?.toLowerCase();

    try {
      let data: any[] = [];

      if (fileExt === 'csv' || fileExt === 'txt') {
        data = await new Promise((resolve, reject) => {
          Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => resolve(results.data),
            error: (error) => reject(error)
          });
        });
      } else if (fileExt === 'xlsx' || fileExt === 'xls') {
        const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as ArrayBuffer);
          reader.onerror = () => reject(new Error('Không thể đọc file Excel'));
          reader.readAsArrayBuffer(file);
        });
        
        const read = XLSX.read || (XLSX as any).default?.read;
        const utils = XLSX.utils || (XLSX as any).default?.utils;
        
        if (!read || !utils) {
          throw new Error('Thư viện đọc Excel (XLSX) không khả dụng.');
        }
        
        const workbook = read(arrayBuffer, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        data = utils.sheet_to_json(worksheet);
      } else {
        throw new Error('Định dạng file không được hỗ trợ. Vui lòng tải lên file .csv, .txt, .xlsx, hoặc .xls');
      }

      if (data.length === 0) {
        alert('File không có dữ liệu');
        setIsUploading(false);
        e.target.value = '';
        return;
      }

      const headers = Object.keys(data[0]);
      setUploadHeaders(headers);
      setUploadData(data);

      const mapping: Record<string, string> = {
        infrastructureCode: '', name: '', infrastructureDepartment: '', latitude: '', longitude: '', address: '', managerName: '', managerPhone: '', status: ''
      };
      
      headers.forEach(h => {
        const normalized = h.toLowerCase().trim().replace(/\s+/g, '');
        if (!mapping.infrastructureCode && (normalized.includes('mãcsht') || normalized.includes('macsht') || normalized.includes('infrastructurecode'))) mapping.infrastructureCode = h;
        else if (!mapping.name && (normalized.includes('name') || normalized.includes('tên') || normalized.includes('station') || normalized.includes('tram') || normalized.includes('mã') || normalized.includes('code'))) mapping.name = h;
        else if (!mapping.infrastructureDepartment && (normalized.includes('phònghạtầng') || normalized.includes('phonghatang') || normalized.includes('department'))) mapping.infrastructureDepartment = h;
        else if (!mapping.latitude && (normalized.includes('lat') || normalized.includes('vĩđộ') || normalized.includes('vido'))) mapping.latitude = h;
        else if (!mapping.longitude && (normalized.includes('lng') || normalized.includes('long') || normalized.includes('kinhđộ') || normalized.includes('kinhdo'))) mapping.longitude = h;
        else if (!mapping.address && (normalized.includes('address') || normalized.includes('địachỉ') || normalized.includes('diachi'))) mapping.address = h;
        else if (!mapping.managerName && (normalized.includes('managername') || normalized.includes('quảnlý') || normalized.includes('quanly') || normalized.includes('người'))) mapping.managerName = h;
        else if (!mapping.managerPhone && (normalized.includes('phone') || normalized.includes('điệnthoại') || normalized.includes('dienthoai') || normalized.includes('sđt') || normalized.includes('sdt'))) mapping.managerPhone = h;
        else if (!mapping.status && (normalized.includes('status') || normalized.includes('trạngthái') || normalized.includes('trangthai') || normalized.includes('kiểm tra'))) mapping.status = h;
      });

      setColumnMapping(mapping);
      setShowMappingModal(true);
    } catch (err: any) {
      console.error(err);
      alert(`Lỗi đọc file: ${err.message || 'Không xác định'}`);
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const processUpload = async () => {
    setIsUploading(true);
    setShowMappingModal(false);
    try {
      const validStations: any[] = [];
      const mappedColValues = Object.values(columnMapping).filter(Boolean);

      for (const rawRow of uploadData) {
        let infrastructureCode = rawRow[columnMapping.infrastructureCode] || '';
        let name = rawRow[columnMapping.name];
        let infrastructureDepartment = rawRow[columnMapping.infrastructureDepartment] || '';
        let lat = rawRow[columnMapping.latitude];
        let lng = rawRow[columnMapping.longitude];
        let address = rawRow[columnMapping.address] || '';
        let managerName = rawRow[columnMapping.managerName] || '';
        let managerPhone = rawRow[columnMapping.managerPhone] || '';
        let statusRaw = rawRow[columnMapping.status] || '';
        
        let status: 'checked' | 'unchecked' = 'unchecked';
        if (typeof statusRaw === 'string') {
          const s = statusRaw.toLowerCase();
          if (s.includes('đã') || s.includes('checked') || s.includes('ok') || s === '1' || s === 'true') {
            status = 'checked';
          }
        }

        if (typeof lat === 'string') lat = lat.replace(',', '.');
        if (typeof lng === 'string') lng = lng.replace(',', '.');

        const parsedLat = parseFloat(lat);
        const parsedLng = parseFloat(lng);

        if (name && String(name).trim() !== '' && lat !== undefined && lng !== undefined && !isNaN(parsedLat) && !isNaN(parsedLng)) {
          const additionalFields: Record<string, string> = {};
          for (const key of Object.keys(rawRow)) {
            if (!mappedColValues.includes(key) && rawRow[key]) {
              additionalFields[key] = String(rawRow[key]).trim();
            }
          }

          validStations.push({
            infrastructureCode: String(infrastructureCode || ''),
            name: String(name).trim(),
            infrastructureDepartment: String(infrastructureDepartment || ''),
            latitude: parsedLat,
            longitude: parsedLng,
            address: String(address || ''),
            managerName: String(managerName || ''),
            managerPhone: String(managerPhone || ''),
            status: status,
            additionalFields
          });
        }
      }
      
      if (validStations.length === 0) {
        alert('Lỗi: Không tìm thấy dữ liệu hợp lệ. Vui lòng đảm bảo bạn đã chọn đúng cột Tên trạm, Vĩ độ và Kinh độ (Vĩ độ/Kinh độ phải là số).');
        setIsUploading(false);
        return;
      }

      let successCount = 0;
      let updateCount = 0;
      let errorCount = 0;
      let errorDetails: string[] = [];
      
      for (const newStationData of validStations) {
        try {
          const existing = stations.find(s => 
            (newStationData.infrastructureCode && s.infrastructureCode === newStationData.infrastructureCode) 
            || (s.name.toLowerCase() === newStationData.name.toLowerCase())
          );

          if (existing) {
            const updatePayload: any = {};
            if (newStationData.infrastructureCode) updatePayload.infrastructureCode = newStationData.infrastructureCode;
            if (newStationData.infrastructureDepartment) updatePayload.infrastructureDepartment = newStationData.infrastructureDepartment;
            if (newStationData.latitude) updatePayload.latitude = newStationData.latitude;
            if (newStationData.longitude) updatePayload.longitude = newStationData.longitude;
            if (newStationData.address) updatePayload.address = newStationData.address;
            if (newStationData.managerName) updatePayload.managerName = newStationData.managerName;
            if (newStationData.managerPhone) updatePayload.managerPhone = newStationData.managerPhone;
            if (newStationData.status !== 'unchecked') updatePayload.status = newStationData.status;

            if (Object.keys(newStationData.additionalFields).length > 0) {
               updatePayload.additionalFields = { 
                 ...(existing.additionalFields || {}), 
                 ...newStationData.additionalFields 
               };
            }

            if (Object.keys(updatePayload).length > 0) {
              await updateDoc(doc(db, 'stations', existing.id), updatePayload);
              updateCount++;
            }
          } else {
             const finalNewData = { ...newStationData };
             if (selectedCampaignId && selectedCampaignId !== 'all') {
               finalNewData.campaignId = selectedCampaignId;
             } else if (mapCampaignId) {
               finalNewData.campaignId = mapCampaignId;
             }
             await addDoc(collection(db, 'stations'), finalNewData);
             successCount++;
          }
        } catch (error: any) {
          console.error("Error adding/updating station:", newStationData.name, error);
          errorCount++;
          if (errorDetails.length < 5) {
            errorDetails.push(`Trạm ${newStationData.name}: ${error.message}`);
          }
        }
      }

      alert(`Xong! Đã tạo mới ${successCount} trạm, cập nhật ${updateCount} trạm.`);

      if (errorCount > 0) {
        alert(`Có ${errorCount} trạm bị lỗi.\nChi tiết lỗi:\n${errorDetails.join('\n')}`);
      }
    } catch (err: any) {
      console.error(err);
      let msg = err.message || 'Có lỗi xảy ra khi lưu dữ liệu.';
      if (msg.includes('Missing or insufficient permissions') || msg.includes('operationType')) {
        msg = 'Lỗi phân quyền: Dữ liệu không hợp lệ hoặc bạn không có quyền thêm/sửa dữ liệu.';
      }
      alert(msg);
    } finally {
      setIsUploading(false);
      setUploadData([]);
      setUploadHeaders([]);
    }
  };

  const handleDelete = (id: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Xóa trạm',
      message: 'Bạn có chắc chắn muốn xóa trạm này?',
      onConfirm: async () => {
        await deleteDoc(doc(db, 'stations', id));
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleDeleteAll = () => {
    setConfirmDialog({
      isOpen: true,
      title: 'Xóa tất cả trạm',
      message: 'Bạn có chắc chắn muốn xóa TẤT CẢ các trạm? Hành động này không thể hoàn tác.',
      onConfirm: async () => {
        for (const station of stations) {
          await deleteDoc(doc(db, 'stations', station.id));
        }
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      transition={{ duration: 0.15 }}
      className="space-y-6 w-full relative"
    >
      {/* Validation Warnings Modal */}
      <AnimatePresence>
        {showWarningsModal && validationWarnings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-xl max-h-[90vh] flex flex-col"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-red-600 flex items-center gap-2">
                  <X className="w-6 h-6" />
                  Cảnh báo dữ liệu trạm
                </h3>
                <button onClick={() => setShowWarningsModal(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="overflow-y-auto flex-1 pr-2 space-y-4">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-gray-600 text-sm">
                    AI đã phát hiện {validationWarnings.length} trạm có tọa độ đáng ngờ ({unreadCount} chưa đọc):
                  </p>
                  {unreadCount > 0 && (
                    <button onClick={handleMarkAllAsRead} className="text-sm text-blue-600 hover:underline">
                      Đánh dấu tất cả đã đọc
                    </button>
                  )}
                </div>
                {validationWarnings.map((warning) => (
                  <div key={warning.id} className={cn("border rounded-xl p-4 relative transition-colors", warning.isRead ? "bg-gray-50 border-gray-200" : "bg-red-50 border-red-100")}>
                    <div className="flex justify-between items-start mb-1">
                      <h4 className={cn("font-bold", warning.isRead ? "text-gray-700" : "text-red-900")}>{warning.name}</h4>
                      <div className="flex gap-3">
                        {!warning.isRead && (
                          <button onClick={() => handleMarkAsRead(warning.id)} className="text-xs text-blue-600 hover:underline font-medium">
                            Đã đọc
                          </button>
                        )}
                        <button onClick={() => handleDeleteWarning(warning.id)} className="text-xs text-red-500 hover:underline font-medium">
                          Xóa
                        </button>
                      </div>
                    </div>
                    <div className={cn("text-sm space-y-1", warning.isRead ? "text-gray-500" : "text-red-800")}>
                      <p><span className="font-medium">Địa chỉ:</span> {warning.address}</p>
                      <p><span className="font-medium">Tọa độ:</span> {warning.latitude}, {warning.longitude}</p>
                      <p><span className="font-medium">Vấn đề:</span> {warning.issue}</p>
                      <p><span className="font-medium">Khuyến cáo:</span> {warning.recommendation}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 pt-4 border-t border-gray-100 flex justify-end">
                <Button onClick={() => setShowWarningsModal(false)}>
                  Đã hiểu
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Hide header to merge seamlessly into AdminTab */}
        <h2 className="text-2xl font-bold text-gray-900 hidden">Danh sách</h2>
        <div className="flex flex-wrap gap-2 w-full justify-end">
          <Button onClick={handleDeleteAll} variant="danger" disabled={stations.length === 0}>
            <Trash2 className="w-5 h-5" />
            <span className="hidden sm:inline">Xóa tất cả</span>
          </Button>
          <label className="cursor-pointer">
            <input type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden" onChange={handleFileUpload} disabled={isUploading} />
            <div className={cn("px-4 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 bg-gray-100 text-gray-900 hover:bg-gray-200", isUploading && "opacity-50 cursor-not-allowed")}>
              <Upload className="w-5 h-5" />
              <span className="hidden sm:inline">{isUploading ? 'Đang nhập...' : 'Nhập File'}</span>
            </div>
          </label>
          <Button onClick={() => setIsAdding(!isAdding)} variant={isAdding ? 'secondary' : 'primary'}>
            {isAdding ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
            <span className="hidden sm:inline">{isAdding ? 'Hủy' : 'Thêm trạm'}</span>
          </Button>
        </div>
      </div>

      {isAdding && (
        <Card className="p-4">
          <form onSubmit={handleAdd} className="space-y-4">
            {selectedCampaignId === 'all' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Gắn vào Đợt công việc (Bắt buộc nếu chọn "Tất cả")</label>
                <select 
                  required
                  value={newStation.campaignId || ''} 
                  onChange={(e) => setNewStation({...newStation, campaignId: e.target.value})}
                  className="w-full sm:max-w-md border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="" disabled>-- Chọn Đợt Công Việc --</option>
                  {campaigns?.filter(c => c.status === 'active').map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input placeholder="Mã CSHT" value={newStation.infrastructureCode || ''} onChange={(e: any) => setNewStation({...newStation, infrastructureCode: e.target.value})} />
              <Input placeholder="Tên trạm" value={newStation.name || ''} onChange={(e: any) => setNewStation({...newStation, name: e.target.value})} required />
              <Input placeholder="Phòng Hạ Tầng" value={newStation.infrastructureDepartment || ''} onChange={(e: any) => setNewStation({...newStation, infrastructureDepartment: e.target.value})} />
              <Input placeholder="Địa chỉ" value={newStation.address || ''} onChange={(e: any) => setNewStation({...newStation, address: e.target.value})} required />
              <Input type="number" step="any" placeholder="Vĩ độ (Lat)" value={newStation.latitude || ''} onChange={(e: any) => setNewStation({...newStation, latitude: parseFloat(e.target.value)})} required />
              <Input type="number" step="any" placeholder="Kinh độ (Lng)" value={newStation.longitude || ''} onChange={(e: any) => setNewStation({...newStation, longitude: parseFloat(e.target.value)})} required />
              <Input placeholder="Người quản lý" value={newStation.managerName || ''} onChange={(e: any) => setNewStation({...newStation, managerName: e.target.value})} required />
              <Input placeholder="Số điện thoại" value={newStation.managerPhone || ''} onChange={(e: any) => setNewStation({...newStation, managerPhone: e.target.value})} required />
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Giao việc cho nhân viên</label>
                <select
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={newStation.assigneeId || ''}
                  onChange={(e) => setNewStation({...newStation, assigneeId: e.target.value})}
                >
                  <option value="">-- Để trống (Người quản lý tự check-in hoặc chưa phân công) --</option>
                  {appUsers?.map(u => (
                    <option key={u.id} value={u.id}>{u.displayName} ({u.email})</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Biểu tượng / Hình ảnh trạm</label>
                <div className="flex items-center gap-4">
                  {newStation.icon && (
                    <img src={newStation.icon} alt="Icon" className="w-12 h-12 rounded-lg object-cover border border-gray-200" referrerPolicy="no-referrer" />
                  )}
                  <label className="cursor-pointer">
                    <input type="file" accept="image/*" className="hidden" onChange={handleIconUpload} />
                    <div className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                      Chọn ảnh
                    </div>
                  </label>
                  {newStation.icon && (
                    <button type="button" onClick={() => {
                      const { icon, ...rest } = newStation;
                      setNewStation(rest);
                    }} className="text-red-500 text-sm hover:underline">Xóa</button>
                  )}
                </div>
              </div>
            </div>
            
            <CustomFieldsEditor 
              fields={newStation.additionalFields || {}} 
              onChange={fields => setNewStation({ ...newStation, additionalFields: fields })}
              allCustomKeys={allCustomKeys}
            />

            <Button type="submit" className="w-full">Lưu trạm</Button>
          </form>
        </Card>
      )}

      <div className="flex flex-col sm:flex-row gap-3 justify-between items-center relative z-[60]">
        <div className="relative flex-1 w-full" ref={stationDropdownRef}>
          <div className="relative">
            <Input 
              type="text"
              className="w-full pr-10" 
              placeholder="Tìm theo tên hoặc mã CSHT..." 
              value={search}
              onChange={(e: any) => {
                setSearch(e.target.value);
                setIsStationDropdownOpen(true);
              }}
              onFocus={() => setIsStationDropdownOpen(true)}
            />
            <Search className="w-4 h-4 absolute right-3 top-3 text-gray-400 pointer-events-none" />
          </div>

          <AnimatePresence>
            {isStationDropdownOpen && search && (
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
                      className="p-3 cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors"
                      onClick={() => {
                        setSearch(s.name);
                        setIsStationDropdownOpen(false);
                      }}
                    >
                      <div className="font-medium text-sm text-gray-900">{s.name}</div>
                      <div className="text-xs text-gray-500 font-mono mt-0.5">{s.infrastructureCode || 'Chưa cập nhật mã'}</div>
                    </div>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {filteredStations.map(station => (
        <Card key={station.id} className="p-4 group">
            {editingStation?.id === station.id ? (
              <form onSubmit={handleEdit} className="space-y-4">
                {selectedCampaignId === 'all' && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Đổi Đợt công việc (Tùy chọn)</label>
                    <select 
                      value={editingStation.campaignId || ''} 
                      onChange={(e) => setEditingStation({...editingStation, campaignId: e.target.value})}
                      className="w-full sm:max-w-md border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="">-- Thuộc về Đợt chung / Mặc định --</option>
                      {campaigns?.filter(c => c.status === 'active' || c.id === editingStation.campaignId).map(c => (
                        <option key={c.id} value={c.id}>{c.name} {c.status === 'closed' ? '(Đã đóng)' : ''}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input placeholder="Mã CSHT" value={editingStation.infrastructureCode || ''} onChange={(e: any) => setEditingStation({...editingStation, infrastructureCode: e.target.value})} />
                  <Input placeholder="Tên trạm" value={editingStation.name || ''} onChange={(e: any) => setEditingStation({...editingStation, name: e.target.value})} required />
                  <Input placeholder="Phòng Hạ Tầng" value={editingStation.infrastructureDepartment || ''} onChange={(e: any) => setEditingStation({...editingStation, infrastructureDepartment: e.target.value})} />
                  <Input placeholder="Địa chỉ" value={editingStation.address || ''} onChange={(e: any) => setEditingStation({...editingStation, address: e.target.value})} required />
                  <Input type="number" step="any" placeholder="Vĩ độ (Lat)" value={editingStation.latitude || ''} onChange={(e: any) => setEditingStation({...editingStation, latitude: parseFloat(e.target.value)})} required />
                  <Input type="number" step="any" placeholder="Kinh độ (Lng)" value={editingStation.longitude || ''} onChange={(e: any) => setEditingStation({...editingStation, longitude: parseFloat(e.target.value)})} required />
                  <Input placeholder="Người quản lý" value={editingStation.managerName || ''} onChange={(e: any) => setEditingStation({...editingStation, managerName: e.target.value})} required />
                  <Input placeholder="Số điện thoại" value={editingStation.managerPhone || ''} onChange={(e: any) => setEditingStation({...editingStation, managerPhone: e.target.value})} required />
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Giao việc cho nhân viên</label>
                    <select
                      className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      value={editingStation.assigneeId || ''}
                      onChange={(e) => setEditingStation({...editingStation, assigneeId: e.target.value})}
                    >
                      <option value="">-- Để trống (Người quản lý tự check-in hoặc chưa phân công) --</option>
                      {appUsers?.map(u => (
                        <option key={u.id} value={u.id}>{u.displayName} ({u.email})</option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Biểu tượng / Hình ảnh trạm</label>
                    <div className="flex items-center gap-4">
                      {editingStation.icon && (
                        <img src={editingStation.icon} alt="Icon" className="w-12 h-12 rounded-lg object-cover border border-gray-200" referrerPolicy="no-referrer" />
                      )}
                      <label className="cursor-pointer">
                        <input type="file" accept="image/*" className="hidden" onChange={handleEditIconUpload} />
                        <div className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                          Chọn ảnh
                        </div>
                      </label>
                      {editingStation.icon && (
                        <button type="button" onClick={() => {
                          const { icon, ...rest } = editingStation;
                          setEditingStation(rest as Station);
                        }} className="text-red-500 text-sm hover:underline">Xóa</button>
                      )}
                    </div>
                  </div>
                </div>
                
                <CustomFieldsEditor 
                  fields={editingStation.additionalFields || {}} 
                  onChange={fields => setEditingStation({ ...editingStation, additionalFields: fields })}
                  allCustomKeys={allCustomKeys}
                />

                <div className="flex gap-2">
                  <Button type="submit" className="flex-1">Lưu thay đổi</Button>
                  <Button type="button" variant="secondary" onClick={() => setEditingStation(null)}>Hủy</Button>
                </div>
              </form>
            ) : (
              <div className="flex flex-col gap-2">
                <div 
                  className="flex justify-between items-start cursor-pointer group-hover:bg-gray-50/50 -m-4 p-4 rounded-lg transition-colors" 
                  onClick={() => setExpandedStationId(expandedStationId === station.id ? null : station.id)}
                >
                  <div className="flex items-start sm:items-center gap-3 w-full min-w-0 pr-2">
                    {station.icon ? (
                      <img src={station.icon} alt={station.name} className="w-10 h-10 rounded-lg object-cover border border-gray-200 shrink-0" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                        <MapPin className="w-5 h-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        {station.infrastructureCode && (
                          <span className="text-[10px] sm:text-xs font-bold bg-gray-100 text-gray-600 px-1.5 sm:px-2 py-0.5 rounded">
                            {station.infrastructureCode}
                          </span>
                        )}
                        <h3 className="font-bold text-base sm:text-lg text-gray-900 truncate max-w-full">{station.name}</h3>
                        {station.infrastructureDepartment && (
                          <span className="text-[10px] sm:text-xs font-medium text-blue-600 bg-blue-50 border border-blue-100 px-1.5 sm:px-2 py-0.5 rounded whitespace-nowrap">
                            {station.infrastructureDepartment}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 sm:gap-4 text-xs sm:text-sm text-gray-500 mt-1 flex-wrap">
                        <div className="flex items-center gap-1">
                          <UserIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-400" />
                          <span className="truncate max-w-[100px] sm:max-w-none">{station.managerName || 'Chưa cập nhật'}</span>
                        </div>
                        {station.managerPhone && (
                          <a href={`tel:${station.managerPhone}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 hover:text-blue-600 transition-colors">
                            <Phone className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-400" />
                            <span>{station.managerPhone}</span>
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0 ml-auto -mr-2">
                    <button 
                      onClick={(e) => { e.stopPropagation(); setEditingStation(station); }}
                      className="p-2.5 sm:p-2 text-gray-400 hover:text-blue-600 transition-colors bg-gray-50/50 hover:bg-blue-50 rounded-lg sm:rounded-full ml-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleDelete(station.id); }}
                      className="p-2.5 sm:p-2 text-gray-400 hover:text-red-600 transition-colors bg-gray-50/50 hover:bg-red-50 rounded-lg sm:rounded-full"
                    >
                      <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {expandedStationId === station.id && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }} 
                      animate={{ height: 'auto', opacity: 1 }} 
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="pt-4 mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3 pb-2">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-semibold text-gray-900">Thông tin địa chỉ</h4>
                            <span className={cn(
                              "text-xs px-2 py-1 rounded-full font-medium",
                              station.status === 'checked' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                            )}>
                              {station.status === 'checked' ? 'Đã kiểm tra' : 'Chưa kiểm tra'}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                              <MapPin className="w-5 h-5" />
                            </div>
                            <div>
                              <div className="font-medium text-gray-900">{station.address || 'Chưa cập nhật'}</div>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-3">
                          <h4 className="text-sm font-semibold text-gray-900 flex items-center justify-between">
                            Phân công & Lộ trình
                          </h4>
                          {station.assigneeId ? (() => {
                            const assignee = appUsers?.find(u => u.id === station.assigneeId);
                            return (
                              <div className="flex items-center gap-3 p-3 bg-indigo-50 rounded-lg">
                                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                                  <UserIcon className="w-5 h-5" />
                                </div>
                                <div>
                                  <div className="text-xs text-indigo-500 font-medium tracking-wide uppercase">Người phụ trách</div>
                                  <div className="font-medium text-indigo-900">{assignee?.displayName || assignee?.email || station.assigneeId}</div>
                                </div>
                              </div>
                            );
                          })() : (
                            <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-500 italic text-center">
                              Chưa gắn nhân viên phụ trách
                            </div>
                          )}
                          <a 
                            href={`https://www.google.com/maps/dir/?api=1&destination=${station.latitude},${station.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 p-3 bg-blue-50 hover:bg-blue-100 transition-colors rounded-lg group"
                          >
                            <div className="w-10 h-10 rounded-full bg-blue-200 flex items-center justify-center text-blue-700">
                              <Navigation className="w-5 h-5 group-hover:scale-110 transition-transform" />
                            </div>
                            <div>
                              <div className="font-medium text-blue-900">Mở Google Maps</div>
                              <div className="text-xs text-blue-700 mt-0.5">
                                {station.latitude}, {station.longitude}
                              </div>
                            </div>
                          </a>
                        </div>
                      </div>

                      {station.additionalFields && Object.keys(station.additionalFields).length > 0 && (
                        <div className="mt-2 pt-3 border-t border-gray-100">
                          <h4 className="text-sm font-semibold text-gray-900 mb-3">Thông tin mở rộng</h4>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {Object.entries(station.additionalFields).map(([k, v]) => (
                               <div key={k} className="bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                                 <div className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1 truncate">{k}</div>
                                 <div className="text-sm font-medium text-gray-900 truncate" title={v}>{v}</div>
                               </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </Card>
        ))}
        {filteredStations.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            Không tìm thấy trạm nào.
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmDialog.isOpen && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4"
          >
            <motion.div 
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl"
            >
              <h3 className="text-xl font-bold text-gray-900 mb-2">{confirmDialog.title}</h3>
              <p className="text-gray-600 mb-6">{confirmDialog.message}</p>
              <div className="flex justify-end gap-3">
                <Button variant="secondary" onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}>Hủy</Button>
                <Button variant="danger" onClick={confirmDialog.onConfirm}>Xác nhận</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mapping Modal */}
      <AnimatePresence>
        {showMappingModal && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4"
          >
            <motion.div 
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-xl p-6 max-w-2xl w-full shadow-xl max-h-[90vh] overflow-y-auto"
            >
              <h3 className="text-xl font-bold text-gray-900 mb-4">Ghép nối cột dữ liệu</h3>
              <p className="text-gray-600 mb-6">Vui lòng chọn cột tương ứng từ file của bạn cho các trường dữ liệu bên dưới.</p>
              
              {selectedCampaignId === 'all' && (
                <div className="mb-6 bg-blue-50 p-4 rounded-xl border border-blue-100">
                  <label className="block text-sm font-bold text-blue-900 mb-2">Ghi chú: Bạn đang ở chế độ xem "Tất cả Đợt CV".<br/>Vui lòng chọn đợt công việc muốn gắn cho các trạm này:</label>
                  <select 
                    required
                    value={mapCampaignId} 
                    onChange={(e) => setMapCampaignId(e.target.value)}
                    className="w-full border border-blue-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-medium"
                  >
                    <option value="" disabled>-- Chọn Đợt Công Việc --</option>
                    {campaigns?.filter(c => c.status === 'active').map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-4 mb-6">
                {[
                  { key: 'infrastructureCode', label: 'Mã CSHT' },
                  { key: 'name', label: 'Tên trạm (*)' },
                  { key: 'infrastructureDepartment', label: 'Phòng Hạ Tầng' },
                  { key: 'latitude', label: 'Vĩ độ (Lat) (*)' },
                  { key: 'longitude', label: 'Kinh độ (Lng) (*)' },
                  { key: 'address', label: 'Địa chỉ' },
                  { key: 'managerName', label: 'Người quản lý' },
                  { key: 'managerPhone', label: 'Số điện thoại' },
                  { key: 'status', label: 'Trạng thái kiểm tra' }
                ].map(field => (
                  <div key={field.key} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    <label className="sm:w-1/3 font-medium text-gray-700">{field.label}</label>
                    <select 
                      className="flex-1 border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      value={columnMapping[field.key] || ''}
                      onChange={(e) => setColumnMapping({...columnMapping, [field.key]: e.target.value})}
                    >
                      <option value="">-- Bỏ qua --</option>
                      {uploadHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-3">
                <Button variant="secondary" onClick={() => setShowMappingModal(false)}>Hủy</Button>
                <Button onClick={processUpload} disabled={!columnMapping.name || !columnMapping.latitude || !columnMapping.longitude || (selectedCampaignId === 'all' && !mapCampaignId)}>
                  Xác nhận & Nhập dữ liệu
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

