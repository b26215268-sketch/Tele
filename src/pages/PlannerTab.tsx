import React, { useState, useEffect, useMemo } from 'react';
import { format, addDays, subDays, parseISO } from 'date-fns';
import { collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import { Map as MapIcon, List, Calendar, MapPin, CheckCircle, CalendarClock, Loader2, X, Crosshair, ArrowRight, Trash2, Edit2, Navigation, User as UserIcon, Phone, ClipboardCheck, Save, Eye, EyeOff, Share2, Plus, Search, Clock, ShieldAlert } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, Tooltip as LeafletTooltip } from 'react-leaflet';
import { db } from '../firebase';
import { Station, Report, Assignment, AppUser, AppRole, TaskGroup } from '../types';
import { User } from 'firebase/auth';
import { GoogleGenAI } from "@google/genai";
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { BRAND_COLORS, getStationIcon, formatStationName } from '../lib/constants';
import { cn, removeVietnameseTones } from '../lib/utils';
import { MapUpdater, LocateControl, StationCodeToggleControl, MapResizer, MapLayerSwitcherControl, MAP_TILE_PROVIDERS, MapType, startPointIcon } from '../components/MapComponents';
import { isManagerOrAdmin } from '../lib/permissions';

export function PlannerTab({ stations, assignments, appUsers, user, reports, taskGroups, currentAppUser, roles, campaigns, selectedCampaignId, onOpenCreateReport }: { stations: Station[], assignments: Assignment[], appUsers: AppUser[], user: User, reports: Report[], taskGroups: TaskGroup[], currentAppUser: AppUser | null, roles: AppRole[], campaigns?: import('../types').Campaign[], selectedCampaignId?: string, onOpenCreateReport: (stationId: string, assignmentId?: string) => void }) {
  const [mapType, setMapType] = useState<MapType>('google');
  
  // Plan mode: 'month' (default for bulk assigning whole month) vs 'day' (daily AI route)
  const [planMode, setPlanMode] = useState<'month' | 'day'>('month');
  
  // Monthly assignment state
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const getEndOfMonth = (monthVal: string) => {
    const [y, m] = monthVal.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return `${monthVal}-${String(lastDay).padStart(2, '0')}`;
  };
  const [monthDeadline, setMonthDeadline] = useState(() => getEndOfMonth(format(new Date(), 'yyyy-MM')));
  const [selectedMonthlyStationIds, setSelectedMonthlyStationIds] = useState<string[]>([]);
  const [monthlySearch, setMonthlySearch] = useState('');
  const [monthlyFilter, setMonthlyFilter] = useState<'all' | 'unassigned' | 'assigned_to_selected' | 'unchecked' | 'checked'>('all');
  const [isSavingMonthly, setIsSavingMonthly] = useState(false);

  const handleMonthChange = (monthVal: string) => {
    setSelectedMonth(monthVal);
    if (monthVal) {
      setMonthDeadline(getEndOfMonth(monthVal));
    }
  };

  // Daily assignment state
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedAssignee, setSelectedAssignee] = useState<string>(user.uid);
  const [selectedTaskGroupId, setSelectedTaskGroupId] = useState<string>(() => {
    return taskGroups[0]?.id || '';
  });
  
  const [selectedStationIds, setSelectedStationIds] = useState<string[]>([]);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizeProgress, setOptimizeProgress] = useState('');
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const [optimizedRoute, setOptimizedRoute] = useState<string[] | null>(null);
  const [routeGeometry, setRouteGeometry] = useState<[number, number][] | null>(null);
  const [routeDistances, setRouteDistances] = useState<number[] | null>(null);
  
  const [confirmSavePlan, setConfirmSavePlan] = useState(false);
  const [stationToRemove, setStationToRemove] = useState<Station | null>(null);
  const [confirmDeletePlan, setConfirmDeletePlan] = useState(false);
  
  const [showOptimizeModal, setShowOptimizeModal] = useState(false);
  const [startLocation, setStartLocation] = useState('');
  const [startCoords, setStartCoords] = useState<[number, number] | null>(null);
  const [showStationCode, setShowStationCode] = useState(false);
  const [stationSearchTerm, setStationSearchTerm] = useState('');

  // Check permissions: Only Admin and Manager (or owner) can plan and assign
  const isAdminOrManager = isManagerOrAdmin(user?.email, currentAppUser, roles);

  const currentAssignments = useMemo(() => {
    if (!isAdminOrManager) {
      const uUid = user?.uid?.toLowerCase();
      const cId = currentAppUser?.id?.toLowerCase();
      const uEmail = user?.email?.toLowerCase();
      const uName = (user?.displayName || currentAppUser?.displayName || '')?.toLowerCase();
      return assignments.filter(a => {
        if (a.deadline !== selectedDate) return false;
        const clean = a.assigneeId?.toLowerCase() || '';
        if (uUid && clean === uUid) return true;
        if (cId && clean === cId) return true;
        if (uEmail && clean === uEmail) return true;
        if (uEmail?.includes('manh') && clean.includes('manh')) return true;
        if (uName && (clean === uName || clean.includes(uName))) return true;
        return false;
      });
    }
    return assignments.filter(a => a.deadline === selectedDate && a.assigneeId === selectedAssignee);
  }, [assignments, selectedDate, selectedAssignee, isAdminOrManager, user, currentAppUser]);

  const handleGetCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setStartCoords([latitude, longitude]);
          setStartLocation(`Vị trí hiện tại (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`);
        },
        (error) => {
          console.error("Error getting location:", error);
          alert("Không thể lấy vị trí hiện tại. Vui lòng kiểm tra quyền truy cập vị trí.");
        }
      );
    } else {
      alert("Trình duyệt của bạn không hỗ trợ GPS.");
    }
  };

  useEffect(() => {
    const ids = currentAssignments.map(a => a.stationId);
    setSelectedStationIds(ids);
    setOptimizedRoute(ids);
  }, [selectedDate, selectedAssignee]); // Don't trigger on currentAssignments change directly or it loops when user modifies selectedStationIds. Wait, actually we can just seed it when the date/assignee changes.


  useEffect(() => {
    const fetchRouteGeometry = async () => {
      const activeIds = optimizedRoute || selectedStationIds;
      if (activeIds.length < 2 && !startCoords) {
        setRouteGeometry(null);
        setRouteDistances(null);
        return;
      }
      const routeStations = activeIds.map(id => stations.find(s => s.id === id)).filter(Boolean) as Station[];
      let coordinates = routeStations.map(s => `${s.longitude},${s.latitude}`).join(';');
      
      if (startCoords) {
        coordinates = `${startCoords[1]},${startCoords[0]};` + coordinates;
      }

      if (coordinates.split(';').length < 2) {
        setRouteGeometry(null);
        setRouteDistances(null);
        return;
      }

      try {
        const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?geometries=geojson&overview=full`);
        const data = await res.json();
        if (data.routes && data.routes[0]) {
          const latLngs = data.routes[0].geometry.coordinates.map((c: [number, number]) => [c[1], c[0]] as [number, number]);
          setRouteGeometry(latLngs);
          if (data.routes[0].legs) {
             const distances = data.routes[0].legs.map((leg: any) => leg.distance);
             setRouteDistances(distances);
          } else {
             setRouteDistances(null);
          }
        }
      } catch (err) {
        console.error("Failed to fetch route geometry", err);
      }
    };
    fetchRouteGeometry();
  }, [optimizedRoute, selectedStationIds, stations, startCoords]);

  const executeRemoveStation = async () => {
    if (!stationToRemove) return;
    const id = stationToRemove.id;
    const newIds = selectedStationIds.filter(sid => sid !== id);
    setSelectedStationIds(newIds);
    
    let newOptimizedRoute = optimizedRoute;
    if (optimizedRoute) {
      newOptimizedRoute = optimizedRoute.filter(sid => sid !== id);
      setOptimizedRoute(newOptimizedRoute);
    }

    try {
       const existingAssignment = currentAssignments.find(a => a.stationId === id);
       if (existingAssignment) {
         await deleteDoc(doc(db, 'assignments', existingAssignment.id));
       }
    } catch (err) {
      console.error("Error deleting assignment:", err);
      alert("Có lỗi xảy ra khi cập nhật lộ trình.");
    }
    
    setStationToRemove(null);
  };

  const handleSavePlan = async () => {
    if (selectedStationIds.length === 0) {
      alert('Vui lòng chọn ít nhất 1 trạm để lưu kế hoạch.');
      return;
    }
    
    if (isAdminOrManager && !selectedTaskGroupId) {
      alert('Vui lòng chọn Hạng mục / Gói công việc.');
      return;
    }

    try {
      const idsToSave = Array.from(new Set(optimizedRoute || selectedStationIds)).filter(Boolean);
      
      if (isAdminOrManager && selectedTaskGroupId) {
        // Delete assignments that were removed from the plan
        for (const existing of currentAssignments) {
          if (!idsToSave.includes(existing.stationId) && existing.status === 'pending') {
            await deleteDoc(doc(db, 'assignments', existing.id));
          }
        }

        // Add or update assignments
        for (let i = 0; i < idsToSave.length; i++) {
          const sid = idsToSave[i];
          const existingAssignment = currentAssignments.find(a => a.stationId === sid);
          
          if (!existingAssignment) {
            await addDoc(collection(db, 'assignments'), {
              assigneeId: selectedAssignee,
              assignedBy: user.uid,
              stationId: sid,
              campaignId: null,
              taskGroupId: selectedTaskGroupId,
              startDate: selectedDate,
              deadline: selectedDate,
              routeOrder: i,
              status: 'pending',
              createdAt: new Date().toISOString()
            } as Omit<Assignment, 'id'>);
          } else {
            // Update its route order just in case it changed
            if (existingAssignment.routeOrder !== i || existingAssignment.taskGroupId !== selectedTaskGroupId) {
              await updateDoc(doc(db, 'assignments', existingAssignment.id), {
                routeOrder: i,
                taskGroupId: selectedTaskGroupId
              });
            }
          }
        }
      }

      setConfirmSavePlan(false);
      alert('Đã lưu lộ trình/giao việc thành công!');
    } catch (err) {
      console.error(err);
      alert('Lỗi khi lưu kế hoạch.');
    }
  };

  const handleDeletePlan = async () => {
    if (currentAssignments.length === 0) return;
    setConfirmDeletePlan(true);
  };

  const executeDeletePlan = async () => {
    try {
      for (const assignment of currentAssignments) {
        if (assignment.status === 'pending') {
          await deleteDoc(doc(db, 'assignments', assignment.id));
        }
      }
      setSelectedStationIds([]);
      setOptimizedRoute(null);
      setRouteGeometry(null);
      setConfirmDeletePlan(false);
      alert('Đã xóa kế hoạch (chỉ các mục chưa xử lý được xóa)!');
    } catch (err) {
      console.error(err);
      alert('Lỗi khi xóa lộ trình.');
    }
  };

  const handleOptimizeClick = () => {
    if (selectedStationIds.length < 2) return;
    setShowOptimizeModal(true);
  };

  const executeOptimizeRoute = async () => {
    if (selectedStationIds.length < 2) return;
    setShowOptimizeModal(false);
    setIsOptimizing(true);
    setOptimizeError(null);
    setOptimizeProgress('Khởi tạo AI...');
    
    try {
      const selectedStations = stations.filter(s => selectedStationIds.includes(s.id));
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const prompt = `Tôi có danh sách các trạm viễn thông sau:
      ${selectedStations.map(s => `- ID: ${s.id}, Tên: ${s.name}, Tọa độ: ${s.latitude}, ${s.longitude}`).join('\n')}
      
      Vị trí xuất phát của tôi là: ${startLocation || 'Không xác định, hãy tự chọn điểm bắt đầu phù hợp nhất từ danh sách trạm'}.
      
      Hãy sắp xếp thứ tự các trạm này để tạo thành một lộ trình tối ưu nhất (ngắn nhất) bắt đầu từ vị trí xuất phát. 
      Chỉ trả về danh sách các ID trạm theo đúng thứ tự, cách nhau bởi dấu phẩy. Không giải thích gì thêm.`;

      setOptimizeProgress('Đang phân tích tọa độ và tính toán khoảng cách...');
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { tools: [{ googleMaps: {} }] }
      });

      setOptimizeProgress('Đang hoàn thiện lộ trình...');
      const result = response.text?.trim().split(',').map(id => id.trim());
      if (result && result.length === selectedStationIds.length) {
        setOptimizedRoute(result);
        setSelectedStationIds(result);
      } else {
        throw new Error('AI trả về kết quả không hợp lệ.');
      }
    } catch (err) {
      console.error('Optimization error:', err);
      setOptimizeError('Không thể tối ưu lộ trình lúc này. Vui lòng thử lại sau.');
    } finally {
      setIsOptimizing(false);
      setOptimizeProgress('');
    }
  };

  const activeIds = Array.from(new Set(optimizedRoute || selectedStationIds));
  const [showAddStationModal, setShowAddStationModal] = useState(false);

  // Monthly filtered stations
  const filteredMonthlyStations = useMemo(() => {
    return stations.filter(s => {
      if (monthlySearch.trim()) {
        const term = monthlySearch.toLowerCase();
        const termNoTone = removeVietnameseTones(term);
        const nameMatch = s.name.toLowerCase().includes(term) || removeVietnameseTones(s.name.toLowerCase()).includes(termNoTone);
        const codeMatch = s.infrastructureCode?.toLowerCase().includes(term);
        const addrMatch = s.address?.toLowerCase().includes(term) || removeVietnameseTones((s.address || '').toLowerCase()).includes(termNoTone);
        if (!nameMatch && !codeMatch && !addrMatch) return false;
      }

      if (monthlyFilter === 'unassigned') return !s.assigneeId;
      if (monthlyFilter === 'assigned_to_selected') return s.assigneeId === selectedAssignee;
      if (monthlyFilter === 'checked') return s.status === 'checked';
      if (monthlyFilter === 'unchecked') return s.status !== 'checked';

      return true;
    });
  }, [stations, monthlySearch, monthlyFilter, selectedAssignee]);

  const handleSaveMonthlyPlan = async () => {
    if (selectedMonthlyStationIds.length === 0) {
      alert('Vui lòng chọn ít nhất 1 trạm để giao việc.');
      return;
    }
    if (!selectedTaskGroupId) {
      alert('Vui lòng chọn Hạng mục / Gói công việc (ví dụ: Khảo sát trạm gốc BTS).');
      return;
    }

    setIsSavingMonthly(true);
    try {
      const startDate = `${selectedMonth}-01`;
      const targetCampaignId = selectedCampaignId && selectedCampaignId !== 'all' ? selectedCampaignId : null;

      // 1. Update station assigneeId in Firestore
      for (const sid of selectedMonthlyStationIds) {
        await updateDoc(doc(db, 'stations', sid), {
          assigneeId: selectedAssignee
        });
      }

      // 2. Create or update assignment for each station
      for (const sid of selectedMonthlyStationIds) {
        const existingAssign = assignments.find(a => 
          a.stationId === sid && 
          a.assigneeId === selectedAssignee && 
          (a.deadline?.startsWith(selectedMonth) || a.startDate?.startsWith(selectedMonth))
        );

        if (!existingAssign) {
          await addDoc(collection(db, 'assignments'), {
            assigneeId: selectedAssignee,
            assignedBy: user.uid,
            stationId: sid,
            campaignId: targetCampaignId,
            taskGroupId: selectedTaskGroupId,
            startDate: startDate,
            deadline: monthDeadline,
            status: 'pending',
            createdAt: new Date().toISOString()
          } as Omit<Assignment, 'id'>);
        } else {
          await updateDoc(doc(db, 'assignments', existingAssign.id), {
            deadline: monthDeadline,
            taskGroupId: selectedTaskGroupId,
            campaignId: targetCampaignId || existingAssign.campaignId || null
          });
        }
      }

      const assigneeObj = appUsers.find(u => u.id === selectedAssignee);
      const assigneeName = assigneeObj?.displayName || assigneeObj?.email || 'kỹ sư';
      alert(`Đã giao thành công ${selectedMonthlyStationIds.length} trạm cho ${assigneeName} trong tháng ${selectedMonth} (Hạn chót: ${monthDeadline})!\n\nKỹ sư có thể mở app bất kỳ ngày nào trong tháng để khảo sát từng trạm.`);
    } catch (err) {
      console.error('Error saving monthly assignment:', err);
      alert('Có lỗi khi lưu phân công công việc.');
    } finally {
      setIsSavingMonthly(false);
    }
  };

  const filteredStationsForAdd = stations.filter(s => 
    !activeIds.includes(s.id) && 
    (s.name.toLowerCase().includes(stationSearchTerm.toLowerCase()) || 
     s.infrastructureCode?.toLowerCase().includes(stationSearchTerm.toLowerCase()) ||
     removeVietnameseTones(s.name.toLowerCase()).includes(removeVietnameseTones(stationSearchTerm.toLowerCase())))
  );



  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      transition={{ duration: 0.15 }}
      className="space-y-6 w-full relative"
    >
      {/* Optimization Loading Overlay */}
      {isOptimizing && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl flex flex-col items-center text-center">
            <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Đang tối ưu lộ trình</h3>
            <p className="text-sm text-gray-600">{optimizeProgress}</p>
          </div>
        </div>
      )}

      {/* Mode Selector for Admin/Manager */}
      {isAdminOrManager && (
        <div className="flex bg-slate-100 p-1 rounded-xl w-fit border border-slate-200/60 shadow-sm">
          <button
            onClick={() => setPlanMode('month')}
            className={cn(
              "px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all flex items-center gap-2",
              planMode === 'month' ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            )}
          >
            <CalendarClock className="w-4 h-4 text-blue-600" />
            Giao việc cả tháng / Theo đợt
          </button>
          <button
            onClick={() => setPlanMode('day')}
            className={cn(
              "px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all flex items-center gap-2",
              planMode === 'day' ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            )}
          >
            <Navigation className="w-4 h-4 text-emerald-600" />
            Lộ trình theo ngày (AI tối ưu)
          </button>
        </div>
      )}

      {planMode === 'month' && isAdminOrManager && (
        /* MONTHLY ASSIGNMENT VIEW */
        <div className="space-y-6">
          {/* Month Configuration Card */}
          <Card className="p-4 sm:p-5 bg-gradient-to-r from-blue-50/90 to-indigo-50/60 border-blue-200 shadow-sm">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-blue-950 text-base sm:text-lg flex items-center gap-2">
                  <CalendarClock className="w-5 h-5 text-blue-600" />
                  Giao việc nguyên tháng cho Kỹ sư
                </h3>
                <p className="text-xs text-blue-700/80 mt-0.5">
                  Giao hàng loạt trạm cho 1 kỹ sư phụ trách trong tháng/đợt. Kỹ sư tự chủ động sắp xếp thời gian khảo sát từng trạm.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* Month selector */}
                <div className="bg-white px-3 py-2 rounded-xl border border-blue-200 shadow-sm flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-blue-600 shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-[10px] text-gray-400 font-bold uppercase leading-tight">Tháng thực hiện</span>
                    <input 
                      type="month"
                      value={selectedMonth}
                      onChange={(e) => handleMonthChange(e.target.value)}
                      className="text-xs font-bold text-gray-800 outline-none bg-transparent"
                    />
                  </div>
                </div>

                {/* Deadline */}
                <div className="bg-white px-3 py-2 rounded-xl border border-blue-200 shadow-sm flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-[10px] text-gray-400 font-bold uppercase leading-tight">Hạn chót hoàn thành</span>
                    <input 
                      type="date"
                      value={monthDeadline}
                      onChange={(e) => setMonthDeadline(e.target.value)}
                      className="text-xs font-bold text-gray-800 outline-none bg-transparent"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Row 2: Select Assignee & TaskGroup */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4 pt-4 border-t border-blue-200/60">
              <div>
                <label className="block text-xs font-bold text-blue-900 mb-1">Kỹ sư nhận việc (*)</label>
                <select
                  className="w-full bg-white border border-blue-200 rounded-xl px-3 py-2 text-xs sm:text-sm font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                  value={selectedAssignee}
                  onChange={(e) => setSelectedAssignee(e.target.value)}
                >
                  <option value={user.uid}>Chính tôi ({user.displayName || user.email})</option>
                  <optgroup label="Danh sách Nhân sự / Kỹ sư">
                    {appUsers.filter(u => u.id !== user.uid).map(u => (
                      <option key={u.id} value={u.id}>{u.displayName || u.email} ({u.role})</option>
                    ))}
                  </optgroup>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-blue-900 mb-1">Hạng mục công việc (*)</label>
                <select
                  className="w-full bg-white border border-blue-200 rounded-xl px-3 py-2 text-xs sm:text-sm font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                  value={selectedTaskGroupId}
                  onChange={(e) => setSelectedTaskGroupId(e.target.value)}
                >
                  <option value="" disabled>-- Chọn Hạng mục / Gói công việc --</option>
                  {taskGroups.map(tg => (
                    <option key={tg.id} value={tg.id}>{tg.name}</option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2 lg:col-span-1 flex items-end">
                <Button 
                  disabled={isSavingMonthly || selectedMonthlyStationIds.length === 0 || !selectedTaskGroupId}
                  onClick={handleSaveMonthlyPlan}
                  className="w-full h-10 rounded-xl font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-200 flex items-center justify-center gap-2"
                >
                  {isSavingMonthly ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Lưu & Giao {selectedMonthlyStationIds.length} trạm trong tháng {selectedMonth}
                </Button>
              </div>
            </div>
          </Card>

          {/* Filter & Selection Toolbar */}
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              {/* Search */}
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Tìm nhanh theo tên trạm, mã CSHT, địa chỉ..."
                  value={monthlySearch}
                  onChange={(e) => setMonthlySearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Quick select buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => {
                    const allFilteredIds = filteredMonthlyStations.map(s => s.id);
                    setSelectedMonthlyStationIds(Array.from(new Set([...selectedMonthlyStationIds, ...allFilteredIds])));
                  }}
                  className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-semibold transition-colors"
                >
                  Chọn tất cả ({filteredMonthlyStations.length})
                </button>
                <button
                  onClick={() => {
                    const filteredIds = new Set(filteredMonthlyStations.map(s => s.id));
                    setSelectedMonthlyStationIds(selectedMonthlyStationIds.filter(id => !filteredIds.has(id)));
                  }}
                  className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 text-xs font-semibold transition-colors"
                >
                  Bỏ chọn
                </button>
                <button
                  onClick={() => {
                    const userStationIds = stations.filter(s => s.assigneeId === selectedAssignee).map(s => s.id);
                    setSelectedMonthlyStationIds(userStationIds);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-semibold transition-colors"
                >
                  Trạm của KS này ({stations.filter(s => s.assigneeId === selectedAssignee).length})
                </button>
              </div>
            </div>

            {/* Filter pills */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {[
                { id: 'all', label: `Tất cả (${stations.length})` },
                { id: 'unassigned', label: `Chưa giao ai (${stations.filter(s => !s.assigneeId).length})` },
                { id: 'assigned_to_selected', label: `Của kỹ sư này (${stations.filter(s => s.assigneeId === selectedAssignee).length})` },
                { id: 'unchecked', label: `Chưa khảo sát (${stations.filter(s => s.status !== 'checked').length})` },
                { id: 'checked', label: `Đã khảo sát (${stations.filter(s => s.status === 'checked').length})` }
              ].map(p => (
                <button
                  key={p.id}
                  onClick={() => setMonthlyFilter(p.id as any)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-semibold transition-all",
                    monthlyFilter === p.id 
                      ? "bg-blue-600 text-white shadow-sm" 
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Split view: Map + Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Map column (5 cols) */}
            <div className="lg:col-span-5 h-[420px] lg:h-[620px] rounded-2xl overflow-hidden border border-gray-200 relative shadow-sm">
              <MapContainer 
                center={[10.8231, 106.6297]} 
                zoom={10} 
                style={{ height: '100%', width: '100%' }}
                touchZoom={true}
                dragging={true}
                scrollWheelZoom={true}
              >
                <MapResizer />
                <TileLayer
                  key={mapType}
                  url={MAP_TILE_PROVIDERS[mapType].url}
                  attribution={MAP_TILE_PROVIDERS[mapType].attribution}
                  subdomains={MAP_TILE_PROVIDERS[mapType].subdomains || ['a', 'b', 'c']}
                  maxZoom={MAP_TILE_PROVIDERS[mapType].maxZoom || 19}
                />
                <LocateControl />
                <StationCodeToggleControl show={showStationCode} onToggle={setShowStationCode} />
                <MapLayerSwitcherControl mapType={mapType} onChange={setMapType} />
                
                {selectedMonthlyStationIds.length > 0 && (
                  <MapUpdater positions={
                    selectedMonthlyStationIds.map(id => {
                      const s = stations.find(st => st.id === id);
                      if (!s) return null;
                      const lat = Number(s.latitude);
                      const lng = Number(s.longitude);
                      return (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) ? [lat, lng] as [number, number] : null;
                    }).filter(Boolean) as [number, number][]
                  } />
                )}

                {filteredMonthlyStations.map(station => {
                  const lat = Number(station.latitude);
                  const lng = Number(station.longitude);
                  if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return null;
                  const isSelected = selectedMonthlyStationIds.includes(station.id);

                  return (
                    <Marker
                      key={station.id}
                      position={[lat, lng]}
                      icon={getStationIcon(station, isSelected)}
                      eventHandlers={{
                        click: () => {
                          setSelectedMonthlyStationIds(prev => 
                            prev.includes(station.id) ? prev.filter(id => id !== station.id) : [...prev, station.id]
                          );
                        }
                      }}
                    >
                      <Popup>
                        <div className="p-1 min-w-[180px]">
                          <div className="font-bold text-gray-900 text-sm">{station.name}</div>
                          {station.infrastructureCode && <div className="text-xs text-blue-600 font-mono mt-0.5">{station.infrastructureCode}</div>}
                          <div className="text-xs text-gray-500 mt-1">{station.address}</div>
                          <button
                            onClick={() => {
                              setSelectedMonthlyStationIds(prev => 
                                prev.includes(station.id) ? prev.filter(id => id !== station.id) : [...prev, station.id]
                              );
                            }}
                            className={cn("mt-2 w-full py-1.5 rounded-lg text-xs font-bold", isSelected ? "bg-red-50 text-red-600" : "bg-blue-600 text-white")}
                          >
                            {isSelected ? 'Bỏ chọn trạm này' : 'Chọn trạm này'}
                          </button>
                          <button
                            onClick={() => {
                              const assign = assignments.find(a => a.stationId === station.id);
                              onOpenCreateReport(station.id, assign?.id);
                            }}
                            className="mt-1.5 w-full py-1.5 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <ClipboardCheck className="w-3.5 h-3.5" />
                            Thực hiện công việc
                          </button>
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}
              </MapContainer>
            </div>

            {/* Cards list column (7 cols) */}
            <div className="lg:col-span-7 space-y-3">
              <div className="flex items-center justify-between px-1">
                <div className="text-sm font-bold text-gray-800">
                  Hiển thị {filteredMonthlyStations.length} trạm
                </div>
                <div className="text-xs font-bold text-blue-700 bg-blue-50 px-3 py-1 rounded-full border border-blue-200">
                  Đã chọn {selectedMonthlyStationIds.length} trạm
                </div>
              </div>

              <div className="h-[420px] lg:h-[580px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {filteredMonthlyStations.map(station => {
                  const isSelected = selectedMonthlyStationIds.includes(station.id);
                  const assignee = appUsers.find(u => u.id === station.assigneeId);
                  const isChecked = station.status === 'checked';

                  return (
                    <div
                      key={station.id}
                      onClick={() => {
                        setSelectedMonthlyStationIds(prev => 
                          prev.includes(station.id) ? prev.filter(id => id !== station.id) : [...prev, station.id]
                        );
                      }}
                      className={cn(
                        "p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3",
                        isSelected
                          ? "bg-blue-50/70 border-blue-300 shadow-sm"
                          : "bg-white border-gray-100 hover:border-gray-300 hover:bg-gray-50/50"
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={cn(
                          "w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors",
                          isSelected ? "bg-blue-600 border-blue-600" : "bg-white border-gray-300"
                        )}>
                          {isSelected && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-gray-900 truncate">{station.name}</span>
                            {station.infrastructureCode && (
                              <span className="text-[10px] font-mono font-semibold bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">
                                {station.infrastructureCode}
                              </span>
                            )}
                            <span className={cn(
                              "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                              isChecked ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                            )}>
                              {isChecked ? 'Đã kiểm tra' : 'Chưa kiểm tra'}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 truncate mt-0.5">{station.address || 'Chưa có địa chỉ'}</div>
                          <div className="text-[11px] text-gray-500 mt-1 flex items-center gap-2">
                            <span className="text-slate-400">Phụ trách:</span>
                            {assignee ? (
                              <span className="font-semibold text-blue-800">{assignee.displayName || assignee.email}</span>
                            ) : (
                              <span className="italic text-gray-400">Chưa giao</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-1">
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${station.latitude},${station.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="p-2 text-blue-600 hover:bg-blue-100 rounded-xl transition-colors"
                          title="Chỉ đường"
                        >
                          <Navigation className="w-4 h-4" />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DAILY ROUTE VIEW */}
      {(!isAdminOrManager || planMode === 'day') && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-2xl font-bold text-gray-900">{isAdminOrManager ? 'Lập Kế Hoạch Theo Ngày' : 'Lộ trình hàng ngày'}</h2>
            <div className="flex flex-wrap items-center gap-2">
              {isAdminOrManager && (
                <>
                  <select
                    className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    value={selectedAssignee}
                    onChange={(e) => setSelectedAssignee(e.target.value)}
                  >
                    <option value={user.uid}>Công việc của tôi</option>
                    <optgroup label="Nhân sự">
                      {appUsers.filter(u => u.id !== user.uid).map(u => (
                        <option key={u.id} value={u.id}>{u.displayName || u.email}</option>
                      ))}
                    </optgroup>
                  </select>

                  <select
                    className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    value={selectedTaskGroupId}
                    onChange={(e) => setSelectedTaskGroupId(e.target.value)}
                  >
                    <option value="" disabled>-- Chọn Hạng mục công việc --</option>
                    {taskGroups.map(tg => (
                      <option key={tg.id} value={tg.id}>{tg.name}</option>
                    ))}
                  </select>
                </>
              )}
              
              <div className="flex items-center gap-2 bg-white p-1 px-3 rounded-lg border border-gray-200">
                <Calendar className="w-4 h-4 text-gray-400" />
                <input 
                  type="date" 
                  className="bg-transparent border-none focus:ring-0 text-sm font-medium p-0"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
              </div>
            </div>
          </div>

      {optimizeError && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3">
          <div className="bg-red-100 p-1 rounded-full shrink-0 mt-0.5">
            <X className="w-4 h-4 text-red-600" />
          </div>
          <div className="flex-1">
            <h4 className="font-bold text-sm">Lỗi tối ưu</h4>
            <p className="text-sm mt-1">{optimizeError}</p>
          </div>
          <button onClick={() => setOptimizeError(null)} className="shrink-0 text-red-400 hover:text-red-600">
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      <Card className="p-4 bg-blue-50 border-blue-100">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="bg-blue-600 p-2 rounded-lg mt-1">
              <Navigation className="text-white w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-blue-900 mt-1">Lộ trình ngày {format(parseISO(selectedDate), 'dd/MM/yyyy')}</h3>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left column: Map and current route */}
        <div className="flex-1 space-y-6">
          <div className="h-[400px] w-full rounded-xl overflow-hidden border border-gray-200 z-0 relative">
            <MapContainer 
              center={[10.8231, 106.6297]} 
              zoom={11} 
              style={{ height: '100%', width: '100%' }}
              touchZoom={true}
              dragging={true}
              scrollWheelZoom={true}
            >
              <MapResizer />
              <TileLayer
                key={mapType}
                url={MAP_TILE_PROVIDERS[mapType].url}
                attribution={MAP_TILE_PROVIDERS[mapType].attribution}
                subdomains={MAP_TILE_PROVIDERS[mapType].subdomains || ['a', 'b', 'c']}
                maxZoom={MAP_TILE_PROVIDERS[mapType].maxZoom || 19}
              />
              <LocateControl />
              <StationCodeToggleControl show={showStationCode} onToggle={setShowStationCode} />
              <MapLayerSwitcherControl mapType={mapType} onChange={setMapType} />
              {(activeIds.length > 0 || startCoords) && (
                <MapUpdater positions={[
                  ...(startCoords ? [startCoords] : []),
                  ...activeIds.map(id => {
                    const s = stations.find(st => st.id === id);
                    if (!s) return null;
                    const lat = Number(s.latitude);
                    const lng = Number(s.longitude);
                    return (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) ? [lat, lng] as [number, number] : null;
                  }).filter(Boolean) as [number, number][]
                ]} />
              )}
              {startCoords && (
                <Marker position={startCoords} icon={startPointIcon}>
                  <LeafletTooltip direction="top" offset={[0, -20]} opacity={0.9} permanent={true} className="text-xs font-medium border-none shadow-sm rounded px-1.5 py-0.5 bg-emerald-600 text-white">
                    Vị trí xuất phát
                  </LeafletTooltip>
                </Marker>
              )}
              {activeIds.map((sid, index) => {
                const station = stations.find(s => s.id === sid);
                if (!station) return null;
                const lat = Number(station.latitude);
                const lng = Number(station.longitude);
                if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return null;
                
                return (
                  <Marker 
                    key={station.id} 
                    position={[lat, lng]} 
                    icon={getStationIcon(station, true)}
                  >
                    <LeafletTooltip 
                      direction="top" 
                      offset={[0, -32]} 
                      opacity={0.9} 
                      permanent={true}
                      className="text-xs font-bold border-none shadow-sm rounded px-1.5 py-0.5 bg-blue-600 text-white"
                    >
                      {showStationCode ? `${index + 1}. ${station.name}` : `${index + 1}`}
                    </LeafletTooltip>
                    <Popup>
                      <div className="space-y-2 min-w-[200px]">
                        <div className="flex items-center gap-2">
                          {station.icon && <img src={station.icon} alt="" className="w-6 h-6 rounded-md object-cover" />}
                          <div>
                            <h4 className="font-bold text-base text-gray-900 m-0">{station.name}</h4>
                          </div>
                        </div>
                        <p className="text-sm text-gray-600 m-0">{station.address}</p>
                        <div className="text-sm pt-2 border-t border-gray-100">
                          <div className="flex items-center gap-1.5 mb-1">
                            <UserIcon className="w-3.5 h-3.5 text-gray-400" />
                            <span className="font-medium">{station.managerName || 'Chưa cập nhật'}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <a href={`tel:${station.managerPhone}`} className="flex items-center gap-1.5 text-blue-600 hover:underline">
                              <Phone className="w-3.5 h-3.5" />
                              {station.managerPhone || 'Chưa cập nhật'}
                            </a>
                            <div className="flex items-center gap-1">
                              <a 
                                href={`https://www.google.com/maps/dir/?api=1&destination=${station.latitude},${station.longitude}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-full transition-colors flex items-center"
                                title="Chỉ đường"
                              >
                                <Navigation className="w-4 h-4" />
                              </a>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 mt-3">
                          <button
                            onClick={() => {
                              const assign = assignments.find(a => a.stationId === station.id);
                              onOpenCreateReport(station.id, assign?.id);
                            }}
                            className="flex items-center justify-center gap-1.5 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-lg transition-colors border-none cursor-pointer text-xs shadow-sm"
                          >
                            <ClipboardCheck className="w-4 h-4" />
                            Thực hiện công việc
                          </button>
                          <button
                            onClick={() => setStationToRemove(station)}
                            className="flex items-center justify-center gap-1.5 w-full bg-rose-50 text-rose-600 font-medium py-1.5 rounded-lg hover:bg-rose-100 transition-colors border-none cursor-pointer text-xs"
                          >
                            <X className="w-3.5 h-3.5" />
                            Xóa khỏi lộ trình
                          </button>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
              {routeGeometry && routeGeometry.length > 1 && (
                <Polyline positions={routeGeometry} color="#2563eb" weight={4} opacity={0.8} />
              )}
            </MapContainer>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-gray-800 flex items-center gap-2">
                <List className="w-5 h-5 text-blue-600" />
                Lộ trình chi tiết
              </h4>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleOptimizeClick}
                disabled={isOptimizing || activeIds.length < 2}
                className="text-blue-600 border-blue-200"
              >
                {isOptimizing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Navigation className="w-4 h-4 mr-2" />}
                Tối ưu lộ trình (AI)
              </Button>
            </div>

            <div className="space-y-3">
              {startCoords && routeDistances && routeDistances.length > 0 && (
                <div className="flex gap-4">
                  <div className="flex flex-col items-center shrink-0 w-8">
                    <div className="w-8 h-8 rounded-full bg-green-100 text-green-700 flex items-center justify-center border border-green-200">
                      <MapPin className="w-4 h-4" />
                    </div>
                    <div className="w-0.5 flex-1 bg-gray-200 my-1 relative min-h-[2rem]">
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white border border-gray-200 text-gray-500 text-[10px] font-bold px-1.5 py-0.5 rounded-full z-10">
                        {(routeDistances[0] / 1000).toFixed(1)}km
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 py-1 text-sm font-medium text-gray-500">Vị trí xuất phát của bạn</div>
                </div>
              )}

              {activeIds.map((sid, index) => {
                const station = stations.find(s => s.id === sid);
                if (!station) return null;
                
                const assignment = currentAssignments.find(a => a.stationId === sid);
                const isSaved = !!assignment;
                const isCompleted = assignment?.status === 'completed';

                let nextDistance = null;
                if (routeDistances) {
                   if (startCoords && index < activeIds.length - 1) nextDistance = routeDistances[index + 1];
                   else if (!startCoords && index < activeIds.length - 1) nextDistance = routeDistances[index];
                }

                return (
                  <div key={sid} className="flex gap-4">
                    <div className="flex flex-col items-center shrink-0 w-8">
                      <div className={cn("w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm", isCompleted ? "bg-green-600 text-white" : "bg-blue-600 text-white")}>
                        {index + 1}
                      </div>
                      {index < activeIds.length - 1 && (
                        <div className="w-0.5 flex-1 bg-gray-200 my-1 relative min-h-[3rem]">
                          {nextDistance !== null && (
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white border border-gray-200 text-gray-500 text-[10px] font-bold px-1.5 py-0.5 rounded-full z-10">
                              {(nextDistance / 1000).toFixed(1)}km
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <Card className="flex-1 p-4 hover:shadow-md transition-shadow">
                      <div className="flex justify-between items-start">
                        <div className="space-y-1">
                          <h5 className="font-bold text-gray-900 leading-tight">{station.name}</h5>
                          <p className="text-xs text-gray-500">{station.address}</p>
                          <div className="flex items-center gap-3 mt-2">
                             <div className="text-[10px] text-gray-400 flex items-center gap-1">
                               <UserIcon className="w-3 h-3" />
                               {station.managerName || 'N/A'}
                             </div>
                             <div className="text-[10px] text-gray-400 flex items-center gap-1">
                               <Phone className="w-3 h-3" />
                               {station.managerPhone || 'N/A'}
                             </div>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                           <div className="flex gap-1.5">
                             <a 
                               href={`https://www.google.com/maps/dir/?api=1&destination=${station.latitude},${station.longitude}`}
                               target="_blank"
                               rel="noopener noreferrer"
                               className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                             >
                               <Navigation className="w-4 h-4" />
                             </a>
                             <button 
                               onClick={() => setStationToRemove(station)}
                               className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
                             >
                               <Trash2 className="w-4 h-4" />
                             </button>
                           </div>
                           {isSaved && (
                             <button 
                               onClick={() => onOpenCreateReport(station.id, assignment?.id)}
                               className={cn("px-3 py-1.5 rounded-lg text-[11px] font-bold text-center", isCompleted ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700")}
                             >
                               {isCompleted ? 'Hoàn thành' : 'Thực hiện'}
                             </button>
                           )}
                        </div>
                      </div>
                    </Card>
                  </div>
                );
              })}

              {activeIds.length === 0 && (
                <div className="text-center py-12 bg-white rounded-2xl border-2 border-dashed border-gray-200">
                  <MapPin className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 font-medium">Chưa có trạm nào trong lộ trình.</p>
                  <p className="text-sm text-gray-400 mt-1">Chọn trạm từ danh sách bên phải để bắt đầu.</p>
                </div>
              )}
            </div>

            <div className="flex gap-4 pt-4 border-t border-gray-100">
               <Button onClick={() => setConfirmSavePlan(true)} className="flex-1 py-4 h-auto text-base font-bold shadow-lg shadow-blue-100">
                 <Save className="w-5 h-5 mr-2" />
                 {isAdminOrManager ? 'Lưu & Giao việc' : 'Lưu kế hoạch'}
               </Button>
               {currentAssignments.length > 0 && (
                 <Button variant="outline" onClick={() => setConfirmDeletePlan(true)} className="px-6 py-4 h-auto text-red-600 border-red-100 hover:bg-red-50">
                    <Trash2 className="w-5 h-5" />
                 </Button>
               )}
            </div>
          </div>
        </div>

        {/* Right column: Station selector (Admin only) */}
        {isAdminOrManager && (
          <div className="w-full lg:w-[350px] space-y-4">
            <Card className="p-4 sticky top-6">
              <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Plus className="w-5 h-5 text-blue-600" />
                Thêm trạm vào kế hoạch
              </h4>
              
              <div className="relative mb-4">
                <Input 
                  placeholder="Tìm trạm (Tên, Mã trạm, Địa chỉ)..." 
                  value={stationSearchTerm}
                  onChange={(e: any) => setStationSearchTerm(e.target.value)}
                  className="pl-10"
                />
                <MapPin className="w-5 h-5 text-gray-400 absolute left-3 top-2.5" />
              </div>

              <div className="h-[500px] overflow-y-auto custom-scrollbar space-y-2 pr-1">
                {stations
                  .filter(s => 
                    s.name.toLowerCase().includes(stationSearchTerm.toLowerCase()) || 
                    s.infrastructureCode?.toLowerCase().includes(stationSearchTerm.toLowerCase()) ||
                    removeVietnameseTones(s.name.toLowerCase()).includes(removeVietnameseTones(stationSearchTerm.toLowerCase()))
                  )
                  .map(s => {
                    const isSelected = selectedStationIds.includes(s.id);
                    return (
                      <div 
                        key={s.id} 
                        onClick={() => {
                          if (isSelected) {
                            setSelectedStationIds(selectedStationIds.filter(id => id !== s.id));
                            if (optimizedRoute) setOptimizedRoute(optimizedRoute.filter(id => id !== s.id));
                          } else {
                            setSelectedStationIds([...selectedStationIds, s.id]);
                            setOptimizedRoute(null);
                          }
                        }}
                        className={cn(
                          "p-3 rounded-xl border transition-all cursor-pointer group",
                          isSelected 
                            ? "bg-blue-50 border-blue-200 shadow-sm" 
                            : "bg-white border-gray-100 hover:border-blue-200 hover:bg-gray-50"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-5 h-5 rounded border flex items-center justify-center transition-colors",
                            isSelected ? "bg-blue-600 border-blue-600" : "bg-white border-gray-300 group-hover:border-blue-400"
                          )}>
                            {isSelected && <CheckCircle className="w-4 h-4 text-white" />}
                          </div>
                          <div>
                            <div className="text-sm font-bold text-gray-900">{s.name}</div>
                            <div className="text-[11px] text-gray-500 truncate w-48">{s.address}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </Card>
          </div>
        )}
      </div>
      </div>
      )}

      {/* Confirmation Modals */}
      <AnimatePresence>
        {confirmSavePlan && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          >
            <motion.div 
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl"
            >
              <h3 className="text-xl font-bold text-gray-900 mb-2">Xác nhận lưu kế hoạch</h3>
              <p className="text-gray-600 mb-6">
                Bạn có chắc chắn muốn lưu kế hoạch lộ trình cho ngày <strong>{format(parseISO(selectedDate), 'dd/MM/yyyy')}</strong> không?
              </p>
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setConfirmSavePlan(false)}>
                  Hủy
                </Button>
                <Button className="flex-1" onClick={handleSavePlan}>
                  Đồng ý
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {confirmDeletePlan && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          >
            <motion.div 
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl"
            >
              <h3 className="text-xl font-bold text-gray-900 mb-2">Xóa kế hoạch</h3>
              <p className="text-gray-600 mb-6">
                Bạn có chắc chắn muốn xóa kế hoạch của ngày <strong>{format(parseISO(selectedDate), 'dd/MM/yyyy')}</strong> không?
              </p>
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setConfirmDeletePlan(false)}>
                  Hủy
                </Button>
                <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white" onClick={executeDeletePlan}>
                  Đồng ý xóa
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {stationToRemove && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          >
            <motion.div 
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl"
            >
              <h3 className="text-xl font-bold text-gray-900 mb-2">Xóa khỏi lộ trình</h3>
              <p className="text-gray-600 mb-6">
                Bạn có chắc chắn muốn xóa trạm <strong>{stationToRemove.name}</strong> khỏi lộ trình không?
              </p>
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setStationToRemove(null)}>
                  Hủy
                </Button>
                <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white" onClick={executeRemoveStation}>
                  Đồng ý xóa
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showOptimizeModal && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
          >
            <motion.div 
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl"
            >
              <h3 className="text-xl font-bold text-gray-900 mb-2">Tối ưu lộ trình</h3>
              <p className="text-gray-600 mb-4 text-sm">
                Nhập vị trí xuất phát của bạn (địa chỉ hoặc tọa độ) để AI có thể tính toán lộ trình ngắn nhất.
              </p>
              <div className="mb-6 space-y-3">
                <input
                  type="text"
                  placeholder="Ví dụ: 123 Nguyễn Văn Linh, Đà Nẵng"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  value={startLocation}
                  onChange={(e) => setStartLocation(e.target.value)}
                />
                <div className="flex items-center justify-center">
                  <span className="text-gray-400 text-sm">Hoặc</span>
                </div>
                <Button 
                  variant="outline" 
                  className="w-full flex items-center justify-center gap-2"
                  onClick={handleGetCurrentLocation}
                >
                  <Navigation className="w-4 h-4" />
                  Sử dụng vị trí hiện tại (GPS)
                </Button>
              </div>
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setShowOptimizeModal(false)}>
                  Hủy
                </Button>
                <Button className="flex-1" onClick={executeOptimizeRoute}>
                  Bắt đầu tối ưu
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}{/* Removed add station modal */}
      </AnimatePresence>
    </motion.div>
  );
}
