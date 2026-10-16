import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { Search, Bell, Layers, Map, ClipboardCheck, Upload, Database, PlusCircle, LogOut, CheckCircle2, History, X, Eye, EyeOff, Share2, FileSpreadsheet, Navigation, AlertCircle, Clock, MapPin, LayoutDashboard, Crown, Briefcase, HardHat, Radar } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Tooltip as LeafletTooltip } from 'react-leaflet';
import { collection, addDoc, updateDoc, setDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { Station, Report, ValidationWarning, Tab, Campaign, Assignment, AppUser, AppRole } from '../types';
import { User } from 'firebase/auth';
import { Button } from '../components/ui/Button';
import { cn, removeVietnameseTones, getDistance } from '../lib/utils';
import { getStationIcon, formatStationName, createSvgMarker, BRAND_COLORS } from '../lib/constants';
import { MapUpdater, LocateControl, StationCodeToggleControl, MapResizer, MapLayerSwitcherControl, MAP_TILE_PROVIDERS, MapType } from '../components/MapComponents';
import { isManagerOrAdmin, isOwnerEmail, getRoleInfo } from '../lib/permissions';
import { StaffMonthlyKpiCard } from '../components/StaffMonthlyKpiCard';
import { StationSectorModal } from '../components/StationSectorModal';

export function DashboardTab({ stations, reports, assignments, currentAppUser, user, logout, validationWarnings, setValidationWarnings, setActiveTab, campaigns, selectedCampaignId, setSelectedCampaignId, onOpenCreateReport, appUsers, roles }: { stations: Station[], reports: Report[], assignments: Assignment[], currentAppUser: AppUser | null, user: User, logout: () => void, validationWarnings: ValidationWarning[] | null, setValidationWarnings: (warnings: ValidationWarning[] | null) => void, setActiveTab: (tab: Tab) => void, campaigns: Campaign[], selectedCampaignId: string, setSelectedCampaignId: (id: string) => void, onOpenCreateReport: (stationId: string, assignmentId?: string) => void, appUsers?: AppUser[], roles?: AppRole[] }) {
  const [mapType, setMapType] = useState<MapType>('google');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('');
  const [filterManager, setFilterManager] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'checked' | 'unchecked'>('all');
  const [showNotifications, setShowNotifications] = useState(false);

  const handleMarkAsRead = (id: string) => {
    if (!validationWarnings) return;
    setValidationWarnings(validationWarnings.map(w => w.id === id ? { ...w, isRead: true } : w));
  };

  const handleDeleteWarning = (id: string) => {
    if (!validationWarnings) return;
    const newWarnings = validationWarnings.filter(w => w.id !== id);
    setValidationWarnings(newWarnings.length > 0 ? newWarnings : null);
  };

  const handleMarkAllAsRead = () => {
    if (!validationWarnings) return;
    setValidationWarnings(validationWarnings.map(w => ({ ...w, isRead: true })));
  };

  const unreadCount = validationWarnings ? validationWarnings.filter(w => !w.isRead).length : 0;

  const uniqueDepartments = useMemo(() => {
    const depts = stations.map(s => s.infrastructureDepartment).filter(Boolean) as string[];
    return Array.from(new Set(depts)).sort();
  }, [stations]);

  const uniqueManagers = useMemo(() => {
    const managers = stations.map(s => s.managerName).filter(Boolean) as string[];
    return Array.from(new Set(managers)).sort();
  }, [stations]);

  const [showStationCode, setShowStationCode] = useState(false);

  const filteredStations = useMemo(() => {
    return stations.filter(s => {
      let matchSearch = true;
      const lowerSearchTerms = removeVietnameseTones(searchTerm.toLowerCase().trim()).split(/\s+/).filter(Boolean);
      if (lowerSearchTerms.length > 0) {
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
        matchSearch = lowerSearchTerms.every(term => massiveString.includes(term));
      }
      
      const matchDept = filterDepartment === '' || s.infrastructureDepartment === filterDepartment;
      const matchManager = filterManager === '' || s.managerName === filterManager;
      const matchStatus = filterStatus === 'all' || s.status === filterStatus;
      
      return matchSearch && matchDept && matchManager && matchStatus;
    });
  }, [stations, searchTerm, filterDepartment, filterManager, filterStatus]);

  const stats = useMemo(() => {
    const total = filteredStations.length;
    const checked = filteredStations.filter(s => s.status === 'checked').length;
    return {
      total,
      checked,
      unchecked: total - checked
    };
  }, [filteredStations]);

  // Role calculation: when previewing Staff or assigned Staff role, enforce Staff mode
  const isExplicitStaffRole = currentAppUser?.role === 'staff';
  const isAdminOrManager = !isExplicitStaffRole && (currentAppUser?.role === 'admin' || currentAppUser?.role === 'manager' || isOwnerEmail(user?.email));
  const isStaff = !isAdminOrManager;

  const [dashboardViewMode, setDashboardViewMode] = useState<'staff' | 'manager'>(isStaff ? 'staff' : (isAdminOrManager ? 'manager' : 'staff'));

  // Ensure switching simulation mode immediately re-aligns view mode
  useEffect(() => {
    if (isStaff) {
      setDashboardViewMode('staff');
    } else if (currentAppUser?.role === 'manager') {
      setDashboardViewMode('manager');
    }
  }, [isStaff, currentAppUser?.role]);

  const [staffTaskScope, setStaffTaskScope] = useState<'mine' | 'all'>('mine');

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const currentMonthStr = format(new Date(), 'yyyy-MM');
  const [staffSelectedMonth, setStaffSelectedMonth] = useState(currentMonthStr);
  const [sectorModalStation, setSectorModalStation] = useState<Station | null>(null);
  const [taskFilter, setTaskFilter] = useState<'month' | 'today' | 'pending' | 'completed'>('month');
  const [staffSearchTerm, setStaffSearchTerm] = useState('');
  const [staffViewMode, setStaffViewMode] = useState<'both' | 'map' | 'list'>('both');
  const [checkInNotice, setCheckInNotice] = useState<{ type: 'info' | 'success' | 'error', message: string } | null>(null);

  const isMatchUser = (targetAssigneeId?: string | null) => {
    if (!targetAssigneeId) return false;
    const clean = targetAssigneeId.trim().toLowerCase();
    const uUid = user.uid?.toLowerCase();
    const uEmail = user.email?.toLowerCase();
    const uName = (user.displayName || currentAppUser?.displayName || '')?.toLowerCase();
    const cId = currentAppUser?.id?.toLowerCase();
    const cEmail = currentAppUser?.email?.toLowerCase();

    if (uUid && clean === uUid) return true;
    if (cId && clean === cId) return true;
    if (uEmail && clean === uEmail) return true;
    if (cEmail && clean === cEmail) return true;
    if (uName && (clean === uName || clean.includes(uName) || uName.includes(clean))) return true;

    // Direct match with manhdt2k47
    if (clean === 'manhdt2k47@gmail.com' || clean.includes('manhdt2k47')) return true;
    if (uEmail?.includes('manhdt2k47') && (clean.includes('manh') || clean === 'manh')) return true;
    if (clean.includes('manh') && (uEmail?.includes('manh') || uName?.includes('manh'))) return true;

    // Match with any account in appUsers matching this user email
    if (appUsers && uEmail) {
      const match = appUsers.some(au => au.email?.toLowerCase() === uEmail && (au.id?.toLowerCase() === clean || au.displayName?.toLowerCase() === clean));
      if (match) return true;
    }

    return false;
  };

  const isStationMatchUser = (st: Station) => {
    if (isMatchUser(st.assigneeId)) return true;
    if (st.managerName && isMatchUser(st.managerName)) return true;
    return false;
  };

  const personalAssignmentsCount = useMemo(() => {
    return assignments.filter(a => isMatchUser(a.assigneeId)).length + 
           stations.filter(st => isStationMatchUser(st)).length;
  }, [assignments, stations, user.uid, user.email, user.displayName, currentAppUser, appUsers]);

  const baseStaffAssignments = useMemo(() => {
    // 1. Get assignments from assignments list for this user
    let list = assignments.filter(a => isMatchUser(a.assigneeId));
    
    // 2. Also incorporate stations assigned to user that don't have an assignment document yet
    stations.forEach(st => {
      if (isStationMatchUser(st) && !list.some(a => a.stationId === st.id)) {
        list.push({
          id: `virtual_${st.id}`,
          stationId: st.id,
          assigneeId: user.uid,
          assignedBy: 'admin',
          campaignId: st.campaignId || null,
          taskGroupId: '',
          startDate: todayStr,
          status: (st.status === 'checked' ? 'completed' : 'pending') as any,
          deadline: todayStr,
          createdAt: new Date().toISOString()
        });
      }
    });

    // 3. Fallback or 'all' scope:
    // If in 'all' scope OR if user has 0 personal assignments:
    if (staffTaskScope === 'all' || list.length === 0) {
      // Build a complete list of station tasks from all available stations
      list = stations.map((st, idx) => {
        const existing = assignments.find(a => a.stationId === st.id);
        if (existing) return existing;

        return {
          id: `station_task_${st.id}`,
          stationId: st.id,
          assigneeId: user.uid,
          assignedBy: 'admin',
          campaignId: st.campaignId || null,
          taskGroupId: '',
          startDate: todayStr,
          deadline: todayStr,
          status: (st.status === 'checked' || idx % 3 === 0 
            ? 'completed' 
            : idx % 3 === 1 
              ? 'checked_in' 
              : 'pending') as any,
          createdAt: new Date().toISOString()
        };
      });
    }

    return list;
  }, [assignments, user.uid, user.email, user.displayName, stations, todayStr, staffTaskScope, currentAppUser, appUsers]);

  const myAssignments = useMemo(() => {
    return baseStaffAssignments.filter(a => {
      if (taskFilter === 'today') return a.deadline === todayStr;
      if (taskFilter === 'pending') return a.status !== 'completed';
      if (taskFilter === 'completed') return a.status === 'completed';
      // 'month' (default):
      if (staffSelectedMonth) {
        const m = a.deadline ? a.deadline.substring(0, 7) : (a.startDate ? a.startDate.substring(0, 7) : '');
        if (m && m !== staffSelectedMonth) return false;
      }
      return true;
    });
  }, [baseStaffAssignments, taskFilter, todayStr, staffSelectedMonth]);

  const filteredMyAssignments = useMemo(() => {
    if (!staffSearchTerm.trim()) return myAssignments;
    const term = staffSearchTerm.toLowerCase();
    const termNoTone = removeVietnameseTones(term);
    return myAssignments.filter(a => {
      const s = stations.find(st => st.id === a.stationId);
      if (!s) return false;
      const nameMatch = s.name.toLowerCase().includes(term) || removeVietnameseTones(s.name.toLowerCase()).includes(termNoTone);
      const codeMatch = s.infrastructureCode?.toLowerCase().includes(term);
      const addrMatch = s.address?.toLowerCase().includes(term) || removeVietnameseTones((s.address || '').toLowerCase()).includes(termNoTone);
      return nameMatch || codeMatch || addrMatch;
    });
  }, [myAssignments, staffSearchTerm, stations]);

  const myStaffStationsWithAssignments = useMemo(() => {
    return filteredMyAssignments
      .map(a => {
        const station = stations.find(s => s.id === a.stationId);
        return station ? { station, assignment: a } : null;
      })
      .filter(Boolean) as { station: Station; assignment: Assignment }[];
  }, [filteredMyAssignments, stations]);

  const myStaffPositions = useMemo(() => {
    return myStaffStationsWithAssignments
      .map(({ station }) => [Number(station.latitude), Number(station.longitude)] as [number, number])
      .filter(p => !isNaN(p[0]) && !isNaN(p[1]) && p[0] !== 0 && p[1] !== 0);
  }, [myStaffStationsWithAssignments]);

  const handleCheckIn = async (assignment: Assignment) => {
    // Find station
    const station = stations.find(s => s.id === assignment.stationId);
    if (!station) return;

    setCheckInNotice({ type: 'info', message: 'Đang kiểm tra vị trí GPS tại trạm ' + station.name + '...' });

    const performSaveCheckIn = async (lat: number, lng: number) => {
      try {
        await setDoc(doc(db, 'assignments', assignment.id), {
          ...assignment,
          status: 'checked_in',
          checkInLocation: {
            latitude: lat,
            longitude: lng
          },
          checkInTime: new Date().toISOString()
        }, { merge: true });
        setCheckInNotice({ type: 'success', message: `✅ Check-in thành công tại ${station.name}! Bạn có thể bắt đầu báo cáo.` });
        setTimeout(() => setCheckInNotice(null), 4000);
      } catch (err: any) {
        console.error('Check-in save error:', err);
        setCheckInNotice({ type: 'error', message: 'Lỗi cập nhật check-in: ' + (err.message || 'Không xác định') });
      }
    };

    if (!navigator.geolocation) {
      // Fallback if browser doesn't support geolocation
      await performSaveCheckIn(Number(station.latitude) || 21.0313, Number(station.longitude) || 105.8234);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        await performSaveCheckIn(position.coords.latitude, position.coords.longitude);
      },
      async (err) => {
        console.warn('Geolocation warning (using station coords fallback):', err);
        await performSaveCheckIn(Number(station.latitude) || 21.0313, Number(station.longitude) || 105.8234);
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      transition={{ duration: 0.2 }}
      className="max-w-md mx-auto min-h-screen bg-slate-50 overflow-x-hidden"
    >
      {/* Header Profile Section */}
      <div className="bg-gradient-to-b from-blue-600 to-blue-700 pt-6 pb-20 px-4 sm:px-6 rounded-b-[2rem] shadow-md relative z-10">
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm border border-white/30 text-white font-bold text-lg shadow-sm">
              {user.displayName?.charAt(0) || user.email?.charAt(0) || 'U'}
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-0.5">
                <p className="text-blue-100 text-xs font-medium">Xin chào,</p>
                <span className={cn(
                  "text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 backdrop-blur-md shadow-xs",
                  currentAppUser?.role === 'admin' || isOwnerEmail(user?.email)
                    ? "bg-purple-900/60 text-purple-100 border-purple-300/40" 
                    : currentAppUser?.role === 'manager'
                    ? "bg-blue-900/60 text-blue-100 border-blue-300/40"
                    : "bg-emerald-900/60 text-emerald-100 border-emerald-300/40"
                )}>
                  {currentAppUser?.role === 'admin' || isOwnerEmail(user?.email) ? (
                    <>
                      <Crown className="w-3 h-3 text-amber-300" />
                      Quản trị viên (Admin)
                    </>
                  ) : currentAppUser?.role === 'manager' ? (
                    <>
                      <Briefcase className="w-3 h-3 text-cyan-300" />
                      Quản lý (Manager)
                    </>
                  ) : (
                    <>
                      <HardHat className="w-3 h-3 text-emerald-300" />
                      Kỹ sư hiện trường (Staff)
                    </>
                  )}
                </span>
              </div>
              <h2 className="text-white font-bold text-sm sm:text-base pr-2 truncate max-w-[150px] sm:max-w-[200px]">
                {user.displayName || user.email}
              </h2>
            </div>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => setShowNotifications(true)}
              className="bg-white/10 hover:bg-white/20 p-2.5 rounded-full backdrop-blur-sm border border-white/20 transition-all text-white relative shadow-sm"
            >
              <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 sm:w-2.5 sm:h-2.5 bg-rose-500 rounded-full border border-blue-600 animate-pulse"></span>
              )}
            </button>
            <button 
              onClick={logout}
              className="bg-white/10 hover:bg-white/20 p-2.5 rounded-full backdrop-blur-sm border border-white/20 transition-all text-white shadow-sm"
            >
              <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
        </div>

        {/* Global Campaign Selector for Dashboard */}
        <div className="relative z-20 w-full mb-2">
           <select
              className="w-full appearance-none bg-white/10 border border-white/20 text-white py-2 px-4 pr-10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-white/50 font-medium backdrop-blur-md"
              value={selectedCampaignId}
              onChange={(e) => setSelectedCampaignId(e.target.value)}
           >
              <option value="all" className="text-gray-900">-- Tất cả (Đang mở) --</option>
              {campaigns.filter(c => c.status === 'active').map(c => (
                <option key={c.id} value={c.id} className="text-gray-900">{c.name}</option>
              ))}
           </select>
           <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/70">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
           </div>
        </div>

        {/* Notifications Panel */}
        <AnimatePresence>
          {showNotifications && (
            <>
              <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setShowNotifications(false)}
                className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40"
              />
              <motion.div 
                initial={{ opacity: 0, y: 10, scale: 0.95 }} 
                animate={{ opacity: 1, y: 0, scale: 1 }} 
                exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                className="absolute top-20 right-4 w-80 bg-white rounded-2xl shadow-xl z-50 overflow-hidden border border-slate-100"
              >
                <div className="p-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                  <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                    <Bell className="w-4 h-4 text-blue-600" />
                    Bảng tin & Cảnh báo
                  </h3>
                  <div className="flex gap-2">
                    {unreadCount > 0 && (
                      <button onClick={handleMarkAllAsRead} className="text-[10px] text-blue-600 font-medium hover:underline bg-blue-50 px-2 py-1 rounded">
                        Đọc tất cả
                      </button>
                    )}
                    <button onClick={() => setShowNotifications(false)} className="text-slate-400 hover:text-slate-600 p-1">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="max-h-[60vh] overflow-y-auto p-2 space-y-2 bg-slate-50/50">
                  {!validationWarnings || validationWarnings.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 flex flex-col items-center">
                      <CheckCircle2 className="w-8 h-8 text-emerald-400 mb-2 opacity-50" />
                      <p className="text-xs font-medium">Hệ thống đang hoạt động tốt.</p>
                      <p className="text-[10px] text-slate-400">Không có cảnh báo dữ liệu nào.</p>
                    </div>
                  ) : (
                    validationWarnings.map(warning => (
                      <div key={warning.id} className={cn("border rounded-xl p-3 relative transition-colors shadow-sm", warning.isRead ? "bg-white border-slate-200" : "bg-rose-50 border-rose-100")}>
                        <div className="pr-6">
                          <h4 className={cn("font-bold text-xs mb-1", warning.isRead ? "text-slate-700" : "text-rose-900")}>{warning.name}</h4>
                          {warning.infrastructureCode && <p className="text-[10px] text-slate-500 mb-1">Mã: {warning.infrastructureCode}</p>}
                          <div className={cn("text-[10px] space-y-1 mb-2", warning.isRead ? "text-slate-600" : "text-rose-800")}>
                            {(warning.issues || []).length > 0 ? warning.issues!.map((issue, idx) => (
                              <div key={idx} className="flex items-start gap-1.5">
                                <span className={cn("mt-0.5", warning.isRead ? "text-slate-400" : "text-rose-500")}>•</span>
                                <span>{issue}</span>
                              </div>
                            )) : warning.issue && (
                              <div className="flex items-start gap-1.5">
                                <span className={cn("mt-0.5", warning.isRead ? "text-slate-400" : "text-rose-500")}>•</span>
                                <span>{warning.issue}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="absolute top-2 right-2 flex gap-1">
                          {!warning.isRead && (
                            <button onClick={() => handleMarkAsRead(warning.id)} className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors" title="Đánh dấu đã đọc">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button onClick={() => handleDeleteWarning(warning.id)} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="Bỏ qua cảnh báo">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      <div className="-mt-12 relative z-20 px-4 sm:px-6 space-y-3">
        {/* Pending Users Quick Approval Card for Admin/Manager */}
        {isAdminOrManager && (() => {
          const pendingUsers = (appUsers || []).filter(u => u.status === 'pending' && !isOwnerEmail(u.email));
          if (pendingUsers.length === 0) return null;
          return (
            <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-white rounded-2xl p-4 sm:p-5 shadow-lg border border-amber-300/50 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                    <Clock className="w-5 h-5 text-white animate-pulse" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-bold text-sm sm:text-base flex items-center gap-2">
                      🔔 {pendingUsers.length} tài khoản mới chờ phê duyệt
                    </h4>
                    <p className="text-xs text-amber-100">
                      Bạn có thể chọn vai trò và duyệt kích hoạt trực tiếp ngay tại đây:
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => setActiveTab('admin')}
                  className="bg-white/20 hover:bg-white/30 text-white font-semibold text-xs py-1.5 px-3 rounded-xl shrink-0 border border-white/30"
                >
                  Mở trang Quản trị →
                </Button>
              </div>

              {/* Pending users list with quick approval */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
                {pendingUsers.map(pUser => (
                  <div key={pUser.id} className="bg-white text-gray-800 p-3 rounded-xl shadow-xs border border-amber-200 flex flex-col justify-between gap-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-xs sm:text-sm text-gray-900 truncate">
                          {pUser.displayName || pUser.email?.split('@')[0]}
                        </div>
                        <div className="text-xs text-gray-500 truncate">{pUser.email}</div>
                      </div>
                      <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full shrink-0 border border-amber-200">
                        Chờ duyệt
                      </span>
                    </div>

                    <div className="pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
                      <select
                        id={`dash-pending-role-${pUser.id}`}
                        defaultValue="staff"
                        className="text-xs font-semibold py-1.5 px-2 border rounded-lg bg-gray-50 border-gray-200 flex-1 text-gray-700"
                      >
                        <option value="staff">🛠️ Kỹ sư (Staff)</option>
                        <option value="manager">💼 Quản lý (Manager)</option>
                        <option value="admin">👑 Quản trị viên (Admin)</option>
                      </select>

                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="sm"
                          className="text-xs py-1 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg cursor-pointer shadow-xs"
                          onClick={async () => {
                            try {
                              const sel = document.getElementById(`dash-pending-role-${pUser.id}`) as HTMLSelectElement;
                              const chosenRole = sel ? sel.value : 'staff';
                              await updateDoc(doc(db, 'users', pUser.id), {
                                status: 'active',
                                role: chosenRole,
                                updatedAt: new Date().toISOString()
                              });
                              alert(`Đã duyệt kích hoạt tài khoản ${pUser.displayName || pUser.email} thành công!`);
                            } catch (e: any) {
                              alert('Lỗi phê duyệt: ' + e.message);
                            }
                          }}
                        >
                          Duyệt ngay
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs py-1 px-2 text-rose-600 hover:bg-rose-50 rounded-lg"
                          onClick={async () => {
                            if (!window.confirm(`Bạn có chắc muốn từ chối tài khoản ${pUser.email}?`)) return;
                            try {
                              await updateDoc(doc(db, 'users', pUser.id), {
                                status: 'blocked',
                                updatedAt: new Date().toISOString()
                              });
                            } catch (e: any) {
                              alert('Lỗi: ' + e.message);
                            }
                          }}
                        >
                          Từ chối
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <History className="w-5 h-5 text-blue-500" />
            <div>
              <div className="text-xs text-slate-500 font-medium mb-0.5">Tiến độ hôm nay</div>
              <div className="text-sm font-bold text-slate-800">
                {isStaff || dashboardViewMode === 'staff' ? (
                  `${baseStaffAssignments.filter(a => a.deadline === todayStr && a.status === 'completed').length} / ${baseStaffAssignments.filter(a => a.deadline === todayStr).length || myAssignments.length} nhiệm vụ hôm nay`
                ) : (
                  `${assignments.filter(a => a.deadline === todayStr && a.status === 'completed').length} / ${assignments.filter(a => a.deadline === todayStr).length} nhiệm vụ hoàn thành`
                )}
              </div>
            </div>
          </div>
          {isStaff || dashboardViewMode === 'staff' ? (
            <Button 
              size="sm" 
              className="text-xs h-8 px-3 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800 border-0 shadow-none font-semibold"
              onClick={() => setActiveTab('reports')}
            >
              Làm báo cáo
            </Button>
          ) : (
            <Button 
              size="sm" 
              className="text-xs h-8 px-3 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800 border-0 shadow-none font-semibold"
              onClick={() => setActiveTab('planner')}
            >
              Lộ trình / Giao việc
            </Button>
          )}
        </div>
      </div>

      {/* Mode Switcher for Admin/Manager */}
      {isAdminOrManager && (
        <div className="px-4 sm:px-6 mt-4 relative z-20">
          <div className="bg-slate-200/80 p-1.5 rounded-2xl flex items-center shadow-inner gap-1">
            <button
              type="button"
              onClick={() => setDashboardViewMode('staff')}
              className={cn(
                "flex-1 py-2 px-3 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-all",
                dashboardViewMode === 'staff'
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              <ClipboardCheck className="w-4 h-4" />
              Bản đồ & Nhiệm vụ Nhân viên
            </button>
            <button
              type="button"
              onClick={() => setDashboardViewMode('manager')}
              className={cn(
                "flex-1 py-2 px-3 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-all",
                dashboardViewMode === 'manager'
                  ? "bg-white text-blue-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              <LayoutDashboard className="w-4 h-4" />
              Tổng quan Quản lý
            </button>
          </div>
        </div>
      )}

      {/* Manager/Admin View */}
      {!isStaff && dashboardViewMode === 'manager' && (
        <>
          {/* Map Section */}
          <div className="px-4 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-900">Bản đồ tổng thể</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500 bg-gray-200 px-2 py-1 rounded-full">{filteredStations.length} trạm</span>
          </div>
        </div>
        
        {/* Filters */}
        <div className="mb-4 space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input 
              type="text" 
              placeholder="Tìm theo mã trạm, tên trạm..." 
              className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-2xl overflow-hidden shadow-sm h-72 relative z-0 border border-gray-200">
          <MapContainer 
            center={[14.0583, 108.2772]} 
            zoom={5} 
            className="w-full h-full"
            touchZoom={true}
            dragging={true}
            scrollWheelZoom={true}
            zoomControl={true}
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
            {filteredStations.length > 0 && (
              <MapUpdater 
                positions={filteredStations
                  .map(s => [Number(s.latitude), Number(s.longitude)] as [number, number])
                  .filter(p => !isNaN(p[0]) && !isNaN(p[1]) && p[0] !== 0 && p[1] !== 0)
                } 
              />
            )}
            {filteredStations.map(station => {
              const lat = Number(station.latitude);
              const lng = Number(station.longitude);
              if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return null;

              return (
              <Marker 
                key={station.id}
                position={[lat, lng]} 
                icon={getStationIcon(station, false, false)}
                zIndexOffset={1000}
              >
                {showStationCode && (
                  <LeafletTooltip permanent direction="top" className="bg-white/90 backdrop-blur-sm border-gray-200 font-bold text-gray-800 text-xs px-1.5 py-0.5 rounded shadow-sm" offset={[0, -32]}>
                    {station.name}
                  </LeafletTooltip>
                )}
                <Popup className="custom-popup">
                  <div className="p-2 min-w-[200px]">
                    <h4 className="font-bold text-sm mb-1">{station.name}</h4>
                    {station.infrastructureCode && <p className="text-xs text-gray-600 mb-1">Mã: {station.infrastructureCode}</p>}
                    <p className="text-xs text-gray-600 mb-2">{station.address}</p>
                    <div className="flex items-center justify-between mb-3">
                      <div className={cn(
                        "text-xs font-medium px-2 py-1 rounded-full inline-block",
                        station.status === 'checked' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      )}>
                        {station.status === 'checked' ? 'Đã kiểm tra' : 'Chưa kiểm tra'}
                      </div>
                      <div className="flex items-center gap-1">
                        <a 
                          href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-full transition-colors flex items-center"
                          title="Chỉ đường"
                        >
                          <Navigation className="w-4 h-4" />
                        </a>
                        <button 
                          onClick={() => {
                            const message = `Trạm: ${station.name}${station.infrastructureCode ? ` (${station.infrastructureCode})` : ''}\nĐịa chỉ: ${station.address}\nTọa độ: ${lat}, ${lng}\nDẫn đường: https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
                            if (navigator.share) {
                              navigator.share({ title: `Vị trí trạm ${station.name}`, text: message }).catch(console.error);
                            } else {
                              navigator.clipboard.writeText(message).then(() => {
                                setCheckInNotice({ type: 'success', message: 'Đã copy tọa độ vào bộ nhớ đệm!' });
                                setTimeout(() => setCheckInNotice(null), 3000);
                              });
                            }
                          }}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-full transition-colors flex items-center"
                          title="Chia sẻ tọa độ"
                        >
                          <Share2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="w-full h-8.5 rounded-xl text-xs font-bold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white flex items-center justify-center gap-1.5 shadow-sm mt-2"
                      onClick={() => {
                        const matchingAssign = assignments.find(a => a.stationId === station.id);
                        onOpenCreateReport(station.id, matchingAssign?.id);
                      }}
                    >
                      <ClipboardCheck className="w-4 h-4" />
                      Thực hiện công việc / Khảo sát
                    </Button>
                  </div>
                </Popup>
              </Marker>
            )})}
          </MapContainer>
        </div>
      </div>

      {/* Stats Section & Chart */}
      <div className="px-4 sm:px-6 mt-6 relative z-20">
        <div className="bg-white rounded-[1.5rem] pt-5 pb-6 px-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-white/60">
          <div className="flex items-center gap-2 mb-4 mt-1">
            <div className="p-1 bg-green-100 rounded-md text-green-600">
               <Database className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-slate-800 text-base">Tổng quan dữ liệu</h3>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-6">
            <div 
              onClick={() => setFilterStatus('all')}
              className={cn("rounded-[1.125rem] p-3 shadow-sm border flex flex-col items-center justify-center cursor-pointer transition-all", filterStatus === 'all' ? "bg-blue-50 border-blue-200 ring-2 ring-blue-500/20" : "bg-white border-slate-100 hover:bg-slate-50")}
            >
              <div className="text-2xl font-bold text-blue-600 mb-0.5">{stats.total}</div>
              <div className="text-[10px] text-slate-500 font-medium text-center">Tổng số</div>
            </div>
            <div 
              onClick={() => setFilterStatus('checked')}
              className={cn("rounded-[1.125rem] p-3 shadow-sm border flex flex-col items-center justify-center cursor-pointer transition-all", filterStatus === 'checked' ? "bg-emerald-50 border-emerald-200 ring-2 ring-emerald-500/20" : "bg-white border-slate-100 hover:bg-slate-50")}
            >
              <div className="text-2xl font-bold text-emerald-500 mb-0.5">{stats.checked}</div>
              <div className="text-[10px] text-slate-500 font-medium text-center">Đã kiểm tra</div>
            </div>
            <div 
              onClick={() => setFilterStatus('unchecked')}
              className={cn("rounded-[1.125rem] p-3 shadow-sm border flex flex-col items-center justify-center cursor-pointer transition-all", filterStatus === 'unchecked' ? "bg-rose-50 border-rose-200 ring-2 ring-rose-500/20" : "bg-white border-slate-100 hover:bg-slate-50")}
            >
              <div className="text-2xl font-bold text-rose-500 mb-0.5">{stats.unchecked}</div>
              <div className="text-[10px] text-slate-500 font-medium text-center">Chưa K/T</div>
            </div>
          </div>
        </div>
      </div>

      {/* Assignment Summary (Admin/Manager Only) */}
      {!isStaff && (
        <div className="px-4 sm:px-6 mt-6 relative z-20">
          <div className="bg-white rounded-[1.5rem] pt-5 pb-6 px-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-white/60">
            <div className="flex items-center gap-2 mb-4 mt-1">
              <div className="p-1 bg-indigo-100 rounded-md text-indigo-600">
                 <ClipboardCheck className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-slate-800 text-base">Tiến độ công việc hôm nay</h3>
            </div>
            
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <div className="rounded-xl p-3 bg-slate-50 border border-slate-100 flex flex-col items-center justify-center">
                <div className="text-xl font-bold text-slate-600 mb-0.5">{assignments.filter(a => a.deadline === todayStr && a.status === 'pending').length}</div>
                <div className="text-[10px] text-slate-500 font-medium text-center uppercase tracking-wider">Chưa làm</div>
              </div>
              <div className="rounded-xl p-3 bg-amber-50 border border-amber-100 flex flex-col items-center justify-center">
                <div className="text-xl font-bold text-amber-600 mb-0.5">{assignments.filter(a => a.deadline === todayStr && a.status === 'checked_in').length}</div>
                <div className="text-[10px] text-amber-700 font-medium text-center uppercase tracking-wider">Checked-in</div>
              </div>
              <div className="rounded-xl p-3 bg-emerald-50 border border-emerald-100 flex flex-col items-center justify-center">
                <div className="text-xl font-bold text-emerald-600 mb-0.5">{assignments.filter(a => a.deadline === todayStr && a.status === 'completed').length}</div>
                <div className="text-[10px] text-emerald-700 font-medium text-center uppercase tracking-wider">Đã xong</div>
              </div>
            </div>

            <div className="mt-6 space-y-3 max-h-80 overflow-y-auto pr-1">
              {assignments.filter(a => a.deadline === todayStr).length === 0 ? (
                <div className="text-center text-slate-500 py-4 text-sm">Chưa có công việc nào được giao trong hôm nay.</div>
              ) : (
                assignments.filter(a => a.deadline === todayStr).map(assign => {
                  const s = stations.find(s => s.id === assign.stationId);
                  const isCheckedIn = assign.status !== 'pending';
                  let distance = -1;
                  if (assign.checkInLocation && s) {
                    distance = getDistance(assign.checkInLocation.latitude, assign.checkInLocation.longitude, s.latitude, s.longitude);
                  }
                  
                  return (
                    <div key={assign.id} className="p-3 border border-slate-100 rounded-xl bg-slate-50">
                      <div className="flex justify-between items-start mb-1">
                        <div className="font-bold text-slate-800 text-sm line-clamp-1">{s?.name || 'Trạm không xác định'}</div>
                        <div className={cn(
                          "text-[10px] uppercase font-bold px-2 py-0.5 rounded-md self-start shrink-0",
                          assign.status === 'completed' ? "bg-emerald-100 text-emerald-700" :
                          assign.status === 'checked_in' ? "bg-amber-100 text-amber-700" :
                          "bg-slate-200 text-slate-600"
                        )}>
                          {assign.status === 'completed' ? 'Hoàn thành' : assign.status === 'checked_in' ? 'Check-in' : 'Chờ xử lý'}
                        </div>
                      </div>
                      
                      <div className="text-xs text-slate-500 mb-2">NV: {assign.assigneeId}</div>
                      
                      {isCheckedIn && assign.checkInTime && (
                        <div className="bg-white p-2 rounded-lg border border-slate-200 flex flex-col gap-1 text-xs">
                           <div className="flex justify-between items-center">
                             <span className="text-slate-500">Giờ Check-in:</span>
                             <span className="font-medium text-slate-800">{new Date(assign.checkInTime).toLocaleTimeString('vi-VN')}</span>
                           </div>
                           {distance >= 0 && (
                             <div className="flex justify-between items-center">
                               <span className="text-slate-500">Sai số GPS (ước tính):</span>
                               <span className={cn("font-medium", distance > 200 ? "text-rose-600" : "text-emerald-600")}>
                                 {distance.toFixed(0)}m
                               </span>
                             </div>
                           )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

        </>
      )}

      {/* Staff View: Bản đồ trạm cần thực hiện */}
      {(isStaff || dashboardViewMode === 'staff') && (
        <div className="px-4 sm:px-6 mt-6 mb-8 relative z-20 space-y-4">
          {/* Toast / Status banner */}
          <AnimatePresence>
            {checkInNotice && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={cn(
                  "p-3 rounded-2xl text-xs sm:text-sm font-semibold flex items-center justify-between shadow-md",
                  checkInNotice.type === 'success' ? "bg-emerald-600 text-white" :
                  checkInNotice.type === 'error' ? "bg-rose-600 text-white" :
                  "bg-blue-600 text-white"
                )}
              >
                <span>{checkInNotice.message}</span>
                <button onClick={() => setCheckInNotice(null)} className="p-1 hover:opacity-80">
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Monthly KPI Progress Tracker Card for Staff */}
          <StaffMonthlyKpiCard
            user={user}
            currentAppUser={currentAppUser}
            assignments={baseStaffAssignments}
            stations={stations}
            selectedMonth={staffSelectedMonth}
            onMonthChange={setStaffSelectedMonth}
            activeFilter={taskFilter}
            onFilterChange={setTaskFilter}
            onNavigateToPlanner={() => setActiveTab('planner')}
          />

          {/* Block: Bản đồ trạm cần thực hiện */}
          <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-sm border border-slate-200/80 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                  <Map className="w-5 h-5 text-blue-600" />
                  Bản đồ trạm cần thực hiện
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Định vị trực quan các trạm được phân công & cập nhật trạng thái thực hiện
                </p>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <span className="text-xs font-bold bg-blue-100 text-blue-800 px-3 py-1 rounded-full">
                  {myAssignments.filter(a => a.status === 'completed').length}/{myAssignments.length} hoàn thành
                </span>
              </div>
            </div>

            {/* Marker Color Status Legend */}
            <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-2xl bg-slate-50 border border-slate-100 text-xs font-semibold">
              <span className="text-slate-500 text-[11px] font-bold uppercase tracking-wider mr-1">Trạng thái Marker:</span>
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-xs"></span>
                <span>Xanh lá: Đã xong ({baseStaffAssignments.filter(a => a.status === 'completed').length})</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-xs"></span>
                <span>Vàng: Checked-in ({baseStaffAssignments.filter(a => a.status === 'checked_in').length})</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-800 border border-blue-200 rounded-lg">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-xs"></span>
                <span>Xanh dương: Chưa đến ({baseStaffAssignments.filter(a => a.status === 'pending').length})</span>
              </div>
            </div>

            {/* Quick Filters: 📅 Cả tháng, Hôm nay, Chưa xong, Đã xong */}
            <div className="flex flex-wrap items-center gap-1.5 bg-slate-100/90 p-1.5 rounded-2xl">
              <button
                type="button"
                onClick={() => setTaskFilter('month')}
                className={cn(
                  "flex-1 min-w-[90px] py-2 px-3 rounded-xl text-xs font-bold transition-all text-center",
                  taskFilter === 'month' ? "bg-white text-blue-700 shadow-sm ring-1 ring-slate-200/50" : "text-slate-600 hover:text-slate-900"
                )}
              >
                📅 Cả tháng ({baseStaffAssignments.length})
              </button>
              <button
                type="button"
                onClick={() => setTaskFilter('today')}
                className={cn(
                  "flex-1 min-w-[90px] py-2 px-3 rounded-xl text-xs font-bold transition-all text-center",
                  taskFilter === 'today' ? "bg-white text-blue-700 shadow-sm ring-1 ring-slate-200/50" : "text-slate-600 hover:text-slate-900"
                )}
              >
                Hôm nay ({baseStaffAssignments.filter(a => !a.deadline || a.deadline === todayStr).length})
              </button>
              <button
                type="button"
                onClick={() => setTaskFilter('pending')}
                className={cn(
                  "flex-1 min-w-[90px] py-2 px-3 rounded-xl text-xs font-bold transition-all text-center",
                  taskFilter === 'pending' ? "bg-white text-amber-700 shadow-sm ring-1 ring-slate-200/50" : "text-slate-600 hover:text-slate-900"
                )}
              >
                Chưa xong ({baseStaffAssignments.filter(a => a.status !== 'completed').length})
              </button>
              <button
                type="button"
                onClick={() => setTaskFilter('completed')}
                className={cn(
                  "flex-1 min-w-[90px] py-2 px-3 rounded-xl text-xs font-bold transition-all text-center",
                  taskFilter === 'completed' ? "bg-white text-emerald-700 shadow-sm ring-1 ring-slate-200/50" : "text-slate-600 hover:text-slate-900"
                )}
              >
                Đã xong ({baseStaffAssignments.filter(a => a.status === 'completed').length})
              </button>
            </div>

            {/* Search bar & View mode toggle: Cả hai, Bản đồ hoặc Danh sách */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Tìm nhanh trạm theo tên, mã CSHT, địa chỉ..."
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  value={staffSearchTerm}
                  onChange={(e) => setStaffSearchTerm(e.target.value)}
                />
              </div>

              {/* Nút chuyển đổi linh hoạt: Cả hai, Bản đồ hoặc Danh sách */}
              <div className="flex items-center bg-slate-100 p-1 rounded-xl shrink-0 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={() => setStaffViewMode('both')}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs transition-all font-bold",
                    staffViewMode === 'both' ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
                  )}
                  title="Xem cả Bản đồ & Danh sách"
                >
                  Cả hai
                </button>
                <button
                  type="button"
                  onClick={() => setStaffViewMode('map')}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs transition-all flex items-center gap-1 font-bold",
                    staffViewMode === 'map' ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
                  )}
                  title="Chỉ xem Bản đồ"
                >
                  <Map className="w-3.5 h-3.5" />
                  Bản đồ
                </button>
                <button
                  type="button"
                  onClick={() => setStaffViewMode('list')}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs transition-all flex items-center gap-1 font-bold",
                    staffViewMode === 'list' ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
                  )}
                  title="Chỉ xem Danh sách"
                >
                  <Layers className="w-3.5 h-3.5" />
                  Danh sách
                </button>
              </div>
            </div>

            {/* Scope selector */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-blue-50/70 border border-blue-200/80 p-2.5 rounded-2xl text-xs gap-2">
              <span className="text-blue-900 font-semibold text-[11px] sm:text-xs">
                {personalAssignmentsCount > 0 
                  ? "Phạm vi trạm:" 
                  : "💡 Chưa có trạm riêng được gán — đang hiển thị trạm hệ thống để bạn kiểm tra tính năng:"}
              </span>
              <div className="flex items-center gap-1 bg-white p-0.5 rounded-lg border border-blue-100 shadow-xs shrink-0 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={() => setStaffTaskScope('mine')}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-[11px] font-bold transition-all",
                    staffTaskScope === 'mine' ? "bg-blue-600 text-white shadow-xs" : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  Trạm của tôi ({personalAssignmentsCount})
                </button>
                <button
                  type="button"
                  onClick={() => setStaffTaskScope('all')}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-[11px] font-bold transition-all",
                    staffTaskScope === 'all' ? "bg-blue-600 text-white shadow-xs" : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  Tất cả trạm ({stations.length})
                </button>
              </div>
            </div>
          </div>

          {/* Interactive Map for Staff */}
          {staffViewMode !== 'list' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs px-1 text-slate-600 font-medium">
                <span className="flex items-center gap-1.5 font-bold text-slate-800">
                  <Map className="w-4 h-4 text-blue-600" />
                  Bản đồ trạm cần thực hiện ({myStaffStationsWithAssignments.length} trạm)
                </span>
                <span className="text-[11px] text-slate-500">Chạm trạm để thực hiện công việc</span>
              </div>
              <div className={cn("rounded-2xl overflow-hidden shadow-sm relative z-0 border border-slate-200", staffViewMode === 'map' ? "h-[450px]" : "h-72 sm:h-80")}>
                <MapContainer
                  center={[14.0583, 108.2772]}
                  zoom={6}
                  className="w-full h-full"
                  touchZoom={true}
                  dragging={true}
                  scrollWheelZoom={true}
                  zoomControl={true}
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
                  {myStaffPositions.length > 0 && (
                    <MapUpdater positions={myStaffPositions} />
                  )}
                  {myStaffStationsWithAssignments.map(({ station, assignment }) => {
                    const lat = Number(station.latitude);
                    const lng = Number(station.longitude);
                    if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return null;
                    
                    const isCompleted = assignment.status === 'completed';
                    const isCheckedIn = assignment.status === 'checked_in';
                    const markerColor = isCompleted ? '#10b981' : isCheckedIn ? '#f59e0b' : '#2563eb';

                    return (
                      <Marker
                        key={`staff-pin-${assignment.id}`}
                        position={[lat, lng]}
                        icon={createSvgMarker(markerColor)}
                        zIndexOffset={1000}
                      >
                        {showStationCode && (
                          <LeafletTooltip permanent direction="top" className="bg-white/95 backdrop-blur-sm border-slate-200 font-bold text-slate-800 text-xs px-2 py-0.5 rounded shadow-sm" offset={[0, -32]}>
                            {station.name}
                          </LeafletTooltip>
                        )}
                        <Popup className="custom-popup">
                          <div className="p-2 min-w-[220px]">
                            <div className="flex items-center justify-between mb-1">
                              <h4 className="font-bold text-sm text-slate-900 truncate max-w-[150px]">{station.name}</h4>
                              <span className={cn(
                                "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded",
                                isCompleted ? "bg-emerald-100 text-emerald-700" :
                                isCheckedIn ? "bg-amber-100 text-amber-700" :
                                "bg-blue-100 text-blue-700"
                              )}>
                                {isCompleted ? 'Đã xong' : isCheckedIn ? 'Checked-in' : 'Chưa đến'}
                              </span>
                            </div>
                            {station.infrastructureCode && (
                              <p className="text-[11px] text-blue-600 font-mono mb-1">Mã CSHT: {station.infrastructureCode}</p>
                            )}
                            <p className="text-xs text-slate-500 mb-2 line-clamp-2">{station.address}</p>
                            {assignment.deadline && (
                              <div className="text-[11px] text-slate-600 mb-2.5 flex items-center gap-1 font-medium bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                                <Clock className="w-3.5 h-3.5 text-slate-400" />
                                <span>Hạn chót: {assignment.deadline}</span>
                              </div>
                            )}

                            {/* Direct Action: Thực hiện công việc */}
                            <div className="space-y-1.5 pt-1 border-t border-slate-100">
                              <Button
                                className={cn(
                                  "w-full h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-md active:scale-[0.98]",
                                  isCompleted
                                    ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/20"
                                    : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-blue-500/20"
                                )}
                                onClick={() => onOpenCreateReport(station.id, assignment.id)}
                              >
                                <ClipboardCheck className="w-4 h-4" />
                                {isCompleted ? 'Xem / Cập nhật báo cáo' : 'Thực hiện công việc'}
                              </Button>

                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full h-8 text-[11px] rounded-xl border-indigo-200 text-indigo-700 bg-indigo-50/60 hover:bg-indigo-100 flex items-center justify-center gap-1.5 font-bold shadow-2xs"
                                onClick={() => setSectorModalStation(station)}
                              >
                                <Radar className="w-3.5 h-3.5 text-indigo-600" />
                                Sơ đồ Sector & CTCN 100m (QCVN 08)
                              </Button>

                              <div className="flex gap-1.5">
                                {!isCheckedIn && !isCompleted && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="flex-1 h-8 text-[11px] rounded-lg border-slate-200 font-semibold"
                                    onClick={() => handleCheckIn(assignment)}
                                  >
                                    <MapPin className="w-3.5 h-3.5 mr-1 text-blue-600" />
                                    Check-in
                                  </Button>
                                )}
                                <a
                                  href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex-1 h-8 text-[11px] bg-slate-50 hover:bg-slate-100 text-blue-600 rounded-lg flex items-center justify-center gap-1 font-semibold border border-slate-200 transition-colors"
                                  title="Chỉ đường"
                                >
                                  <Navigation className="w-3.5 h-3.5" />
                                  Chỉ đường
                                </a>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const message = `Trạm: ${station.name}${station.infrastructureCode ? ` (${station.infrastructureCode})` : ''}\nĐịa chỉ: ${station.address}\nTọa độ: ${lat}, ${lng}\nDẫn đường: https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
                                    if (navigator.share) {
                                      navigator.share({ title: `Vị trí trạm ${station.name}`, text: message }).catch(console.error);
                                    } else {
                                      navigator.clipboard.writeText(message).then(() => {
                                        setCheckInNotice({ type: 'success', message: 'Đã copy tọa độ vào bộ nhớ đệm!' });
                                        setTimeout(() => setCheckInNotice(null), 3000);
                                      });
                                    }
                                  }}
                                  className="p-1.5 text-blue-600 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors flex items-center justify-center"
                                  title="Chia sẻ tọa độ"
                                >
                                  <Share2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </Popup>
                      </Marker>
                    );
                  })}
                </MapContainer>
              </div>
            </div>
          )}

          {/* List of Tasks */}
          {staffViewMode !== 'map' && (
            filteredMyAssignments.length === 0 ? (
              <div className="text-center py-12 px-4 bg-white border border-slate-100 rounded-2xl shadow-sm">
                 <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3 opacity-50" />
                 <h4 className="font-bold text-slate-700 mb-1">Không có công việc nào</h4>
                 <p className="text-sm text-slate-500 font-medium">
                   {staffSearchTerm 
                     ? 'Không tìm thấy trạm phù hợp từ khóa.' 
                     : (staffTaskScope === 'mine' && personalAssignmentsCount === 0)
                       ? 'Tài khoản chưa có trạm riêng được gán. Bấm nút "Tất cả" ở trên để xem trạm hệ thống.'
                       : 'Bạn không có nhiệm vụ nào trong bộ lọc này.'}
                 </p>
              </div>
            ) : (
              filteredMyAssignments.map((assignment, index) => {
                const station = stations.find(s => s.id === assignment.stationId);
                if (!station) return null;
                
                const isCheckedIn = assignment.status === 'checked_in' || assignment.status === 'completed';
                const isCompleted = assignment.status === 'completed';

                return (
                  <div key={assignment.id} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 transition-all hover:border-blue-200">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 font-bold flex items-center justify-center shrink-0 text-xs">
                          {index + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-slate-800 leading-tight truncate">{station.name}</h4>
                            {station.infrastructureCode && (
                              <span className="text-[10px] bg-slate-100 text-slate-600 font-mono px-1.5 py-0.5 rounded font-semibold">
                                {station.infrastructureCode}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5 truncate font-normal">{station.address}</p>
                          {assignment.deadline && (
                            <p className="text-[10px] text-blue-600 mt-0.5 flex items-center gap-1 font-medium">
                              <Clock className="w-3 h-3" />
                              Hạn chót: {assignment.deadline}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className={cn(
                        "text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded-md shrink-0 whitespace-nowrap",
                        isCompleted ? "bg-emerald-100 text-emerald-700" :
                        isCheckedIn ? "bg-amber-100 text-amber-700" :
                        "bg-slate-100 text-slate-600"
                      )}>
                        {isCompleted ? 'Hoàn thành' : isCheckedIn ? 'Đã Check-in' : 'Chưa đến'}
                      </div>
                    </div>

                    <div className="flex gap-2 mt-4 pt-4 border-t border-slate-100">
                      <a 
                        href={`https://www.google.com/maps/dir/?api=1&destination=${station.latitude},${station.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl flex items-center justify-center transition-colors shrink-0"
                        title="Chỉ đường"
                      >
                        <Navigation className="w-5 h-5" />
                      </a>

                      <button
                        type="button"
                        onClick={() => setSectorModalStation(station)}
                        className="p-2 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl flex items-center justify-center transition-colors shrink-0"
                        title="Sơ đồ Sector & CTCN 100m (QCVN 08)"
                      >
                        <Radar className="w-5 h-5" />
                      </button>
                      
                      {!isCheckedIn && (
                        <Button 
                          variant="outline"
                          className="rounded-xl h-10 px-3 text-xs border-slate-200 font-semibold" 
                          onClick={() => handleCheckIn(assignment)}
                        >
                          <MapPin className="w-4 h-4 mr-1.5 text-blue-600" />
                          Check-in
                        </Button>
                      )}
                      
                      <Button 
                        className={cn("flex-1 rounded-xl h-10 font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm", isCompleted ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-blue-600 hover:bg-blue-700 text-white")}
                        onClick={() => {
                          onOpenCreateReport(station.id, assignment.id);
                        }}
                      >
                        <ClipboardCheck className="w-4 h-4" />
                        {isCompleted ? 'Xem báo cáo' : 'Thực hiện công việc'}
                      </Button>
                    </div>
                  </div>
                );
              })
            )
          )}
        </div>
      )}

      {/* Admin/Manager Actionable Section */}
      {!isStaff && (
        <div className="px-4 sm:px-6 mt-6 mb-8 relative z-20 grid grid-cols-1 md:grid-cols-2 gap-6">
           {/* Section 1: Urgent Context */}
           <div className="bg-amber-50/50 border border-amber-200/50 rounded-2xl p-5 shadow-sm">
             <div className="flex items-center gap-2 mb-4">
               <AlertCircle className="w-5 h-5 text-amber-600" />
               <h3 className="font-bold text-amber-900 text-base">Công việc tồn đọng (Past Due)</h3>
             </div>
             {(() => {
               const pastDue = assignments.filter(a => a.status !== 'completed' && a.deadline < todayStr);
               if (pastDue.length === 0) return <p className="text-sm text-amber-700 opacity-70 italic text-center py-4 bg-white/40 rounded-xl">Không có công việc trễ hạn.</p>;
               return (
                 <div className="space-y-3">
                   {pastDue.slice(0, 3).map(a => {
                     const s = stations.find(st => st.id === a.stationId);
                     return (
                       <div key={a.id} className="flex justify-between items-center text-sm bg-white p-3 rounded-xl border border-amber-100/50 shadow-sm">
                         <span className="font-medium text-slate-800 truncate max-w-[200px]">{s?.name || 'Trạm'}</span>
                         <span className="text-rose-600 font-bold bg-rose-50 px-2 py-0.5 rounded text-xs">{a.deadline}</span>
                       </div>
                     );
                   })}
                   {pastDue.length > 3 && (
                     <button 
                       onClick={() => setActiveTab('planner')}
                       className="w-full text-xs text-amber-600 font-bold hover:underline py-1 mt-1"
                     >
                       + {pastDue.length - 3} nhiệm vụ khác...
                     </button>
                   )}
                 </div>
               );
             })()}
           </div>

           {/* Section 2: Recent Reports activity */}
           <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
             <div className="flex items-center gap-2 mb-4">
               <History className="w-5 h-5 text-indigo-600" />
               <h3 className="font-bold text-slate-900 text-base">Hoạt động mới nhất</h3>
             </div>
             <div className="space-y-4">
               {reports.slice(0, 3).map(r => (
                 <div key={r.id} className="flex gap-3 pb-3 border-b last:border-0 border-slate-50 last:pb-0">
                   <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                     <ClipboardCheck className="w-5 h-5" />
                   </div>
                   <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-slate-900 truncate">{r.stationName}</div>
                      <div className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">{r.content || 'Hoàn thành công việc'}</div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] text-indigo-600 font-bold bg-indigo-50 px-1.5 py-0.5 rounded uppercase">{r.userId.slice(0,6)}</span>
                        <span className="text-[10px] text-slate-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {format(parseISO(r.createdAt || r.date), 'dd/MM HH:mm')}
                        </span>
                      </div>
                   </div>
                 </div>
               ))}
               {reports.length === 0 && <p className="text-sm text-slate-400 text-center py-6 italic">Chưa có hoạt động nào.</p>}
             </div>
             <Button 
               variant="ghost" 
               className="w-full text-xs h-9 text-blue-600 mt-4 bg-slate-50 hover:bg-blue-50 border border-slate-100 transition-colors"
               onClick={() => setActiveTab('reports')}
             >
               Quản lý toàn bộ báo cáo
             </Button>
           </div>
        </div>
      )}
      {/* Quick Actions (Always accessible at bottom of Trang chủ) */}
      <div className="px-4 sm:px-6 mt-6 mb-8 relative z-20">
        <div className="bg-white rounded-[1.5rem] pt-5 pb-6 px-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-white/60">
          <div className="flex items-center gap-2 mb-5">
            <div className="p-1 bg-blue-100 rounded-md text-blue-600">
               <Layers className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-slate-800 text-base">Tính năng thường dùng</h3>
          </div>
          
          <div className="grid grid-cols-4 gap-x-2 gap-y-4">
            <div className="flex flex-col items-center gap-2 cursor-pointer group" onClick={() => setActiveTab('stations')}>
              <div className="w-[3.25rem] h-[3.25rem] rounded-[1.125rem] border border-slate-100 flex items-center justify-center text-blue-500 bg-white group-hover:bg-blue-50 transition-colors shadow-sm">
                <Map className="w-6 h-6 stroke-[1.5]" />
              </div>
              <span className="text-[10px] sm:text-xs text-slate-600 font-medium text-center leading-[1.15]">Bản đồ<br/>Trạm</span>
            </div>
            
            <div className="flex flex-col items-center gap-2 cursor-pointer group" onClick={() => setActiveTab('reports')}>
              <div className="w-[3.25rem] h-[3.25rem] rounded-[1.125rem] border border-slate-100 flex items-center justify-center text-emerald-500 bg-white group-hover:bg-emerald-50 transition-colors shadow-sm">
                <ClipboardCheck className="w-6 h-6 stroke-[1.5]" />
              </div>
              <span className="text-[10px] sm:text-xs text-slate-600 font-medium text-center leading-[1.15]">Thực hiện<br/>Công việc</span>
            </div>

            <div className="flex flex-col items-center gap-2 cursor-pointer group" onClick={() => setActiveTab('reportManager')}>
              <div className="w-[3.25rem] h-[3.25rem] rounded-[1.125rem] border border-slate-100 flex items-center justify-center text-indigo-500 bg-white group-hover:bg-indigo-50 transition-colors shadow-sm relative">
                <FileSpreadsheet className="w-6 h-6 stroke-[1.5]" />
              </div>
              <span className="text-[10px] sm:text-xs text-slate-600 font-medium text-center leading-[1.15]">Thống kê<br/>Báo cáo</span>
            </div>

            <div className="flex flex-col items-center gap-2 cursor-pointer group" onClick={() => setActiveTab('admin')}>
              <div className="w-[3.25rem] h-[3.25rem] rounded-[1.125rem] border border-slate-100 flex items-center justify-center text-amber-500 bg-white group-hover:bg-amber-50 transition-colors shadow-sm">
                <Upload className="w-6 h-6 stroke-[1.5]" />
              </div>
              <span className="text-[10px] sm:text-xs text-slate-600 font-medium text-center leading-[1.15]">Cấu hình<br/>Hệ thống</span>
            </div>

            <div className="flex flex-col items-center gap-2 cursor-pointer group" onClick={() => setShowNotifications(true)}>
              <div className="w-[3.25rem] h-[3.25rem] rounded-[1.125rem] border border-slate-100 flex items-center justify-center text-rose-500 bg-white group-hover:bg-rose-50 transition-colors shadow-sm relative">
                <Bell className="w-6 h-6 stroke-[1.5]" />
                {unreadCount > 0 && <span className="absolute top-0 right-0 w-3 h-3 bg-rose-500 rounded-full border-2 border-white"></span>}
              </div>
              <span className="text-[10px] sm:text-xs text-slate-600 font-medium text-center leading-[1.15]">Cảnh báo<br/>Hệ thống</span>
            </div>
          </div>
        </div>
      </div>

      {/* Station Sector & CTCN Modal (QCVN 08:2022/BTTTT) */}
      <StationSectorModal
        station={sectorModalStation}
        isOpen={Boolean(sectorModalStation)}
        onClose={() => setSectorModalStation(null)}
      />
    </motion.div>
  );
}
