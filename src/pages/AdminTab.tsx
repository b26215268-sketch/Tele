import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, Settings2, Trash2, ClipboardList, Plus, MapPin, ChevronDown, Crown, Briefcase, HardHat, ShieldCheck, Search, Filter, CheckCircle2, UserPlus, User as UserIcon, Shield, X, Clock, CheckSquare, Square, AlertCircle, Layers } from 'lucide-react';
import { collection, addDoc, updateDoc, doc, deleteDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { EquipmentDict, TaskGroup, Workspace, SurveyParameter, Station, Report, ValidationWarning, Campaign, AppUser, APP_PERMISSIONS, AppRole } from '../types';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { cn, removeVietnameseTones } from '../lib/utils';
import { StationsTab } from './StationsTab';
import { isOwnerEmail, getRoleInfo, ROLE_DEFINITIONS } from '../lib/permissions';

export function AdminTab({ equipmentDict, taskGroups, workspaces, surveyParameters, stations, reports, validationWarnings, setValidationWarnings, campaigns, selectedCampaignId, appUsers, currentAppUser, roles }: { equipmentDict: EquipmentDict[], taskGroups: TaskGroup[], workspaces: Workspace[], surveyParameters: SurveyParameter[], stations: Station[], reports: Report[], validationWarnings: ValidationWarning[] | null, setValidationWarnings: (warnings: ValidationWarning[] | null) => void, campaigns: Campaign[], selectedCampaignId: string, appUsers: AppUser[], currentAppUser: AppUser | null, roles: AppRole[] }) {
  // Helper to check permission inside AdminTab
  const checkPermission = (permId: string) => {
    if (isOwnerEmail(currentAppUser?.email)) return true;
    if (!currentAppUser) return false;
    
    const userRole = roles.find(r => r.id === currentAppUser.role);
    if (userRole) {
      return userRole.permissions?.includes(permId) || false;
    }

    if (currentAppUser.role === 'admin' && !currentAppUser.permissions) return true; // Legacy admin
    return currentAppUser.permissions?.includes(permId) || false;
  };

  const hasUsersAccess = checkPermission('admin.users');
  const hasCampaignsAccess = checkPermission('admin.campaigns');
  const hasStationsAccess = checkPermission('admin.stations');
  const hasTasksAccess = checkPermission('admin.tasks');

  // Workspace States
  const [newWorkspace, setNewWorkspace] = useState('');
  const [isAddingWorkspace, setIsAddingWorkspace] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);

  // Equipment States
  const [newEqName, setNewEqName] = useState('');
  const [newEqSpaces, setNewEqSpaces] = useState<string[]>([]);
  const [newEqUnit, setNewEqUnit] = useState('cái');
  const [isAddingEq, setIsAddingEq] = useState(false);
  const [editingEq, setEditingEq] = useState<EquipmentDict | null>(null);

  // Task Group States
  const [newTaskGroup, setNewTaskGroup] = useState('');
  const [newTaskGroupModules, setNewTaskGroupModules] = useState<string[]>(['EQUIPMENT', 'NOTE']);
  const [newTaskGroupCategories, setNewTaskGroupCategories] = useState<string[]>([]);
  const [isAddingTaskGroup, setIsAddingTaskGroup] = useState(false);
  const [editingTaskGroup, setEditingTaskGroup] = useState<TaskGroup | null>(null);

  // Campaign States
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Partial<Campaign> | null>(null);
  const [showClosedCampaigns, setShowClosedCampaigns] = useState(false);

  // Survey Parameter States
  const [newSurveyLabel, setNewSurveyLabel] = useState('');
  const [newSurveyType, setNewSurveyType] = useState<'number' | 'text'>('text');
  const [newSurveyUnit, setNewSurveyUnit] = useState('');
  const [isAddingSurveyParam, setIsAddingSurveyParam] = useState(false);
  const [editingSurveyParam, setEditingSurveyParam] = useState<SurveyParameter | null>(null);

  // General tab state
  const [activeConfigTab, setActiveConfigTab] = useState<'campaigns' | 'stations' | 'eq' | 'tg' | 'survey' | 'users' | 'roles'>(
    hasStationsAccess ? 'stations' : 
    hasCampaignsAccess ? 'campaigns' : 
    hasTasksAccess ? 'tg' : 
    hasUsersAccess ? 'users' : 'stations'
  );

  const [expandedMenu, setExpandedMenu] = useState<'system' | 'operation' | 'tasks' | null>(
    (activeConfigTab === 'users' || activeConfigTab === 'roles') ? 'system' :
    (activeConfigTab === 'campaigns' || activeConfigTab === 'stations') ? 'operation' :
    (activeConfigTab === 'tg' || activeConfigTab === 'eq' || activeConfigTab === 'survey') ? 'tasks' :
    (hasUsersAccess ? 'system' : 
     (hasCampaignsAccess || hasStationsAccess) ? 'operation' : 
     hasTasksAccess ? 'tasks' : null)
  );

  const toggleMenu = (key: 'system' | 'operation' | 'tasks') => {
    setExpandedMenu(prev => prev === key ? null : key);
  };

  const isParentActive = (key: 'system' | 'operation' | 'tasks') => {
    if (key === 'system') return activeConfigTab === 'users' || activeConfigTab === 'roles';
    if (key === 'operation') return activeConfigTab === 'campaigns' || activeConfigTab === 'stations';
    if (key === 'tasks') return activeConfigTab === 'tg' || activeConfigTab === 'eq' || activeConfigTab === 'survey';
    return false;
  };
  
  const handleSeedRoles = async () => {
    try {
      const defaultRoles = [
        {
          id: 'admin',
          name: 'Quản trị viên (Admin)',
          description: 'Toàn quyền cấu hình hệ thống, quản lý người dùng, giao việc.',
          permissions: ['admin.users', 'admin.roles', 'admin.stations', 'admin.campaigns', 'admin.surveys', 'admin.equipment', 'admin.taskGroup', 'view.all_stations', 'view.reports', 'action.report']
        },
        {
          id: 'manager',
          name: 'Quản lý (Manager)',
          description: 'Quản lý vận hành, lập kế hoạch, giao trạm, xem báo cáo.',
          permissions: ['admin.stations', 'admin.campaigns', 'admin.surveys', 'view.all_stations', 'view.reports']
        },
        {
          id: 'staff',
          name: 'Nhân viên (Staff)',
          description: 'Sử dụng App đi hiện trường, nhận việc, điền form báo cáo.',
          permissions: ['action.report']
        }
      ];

      for (const r of defaultRoles) {
        await setDoc(doc(db, 'roles', r.id), r);
      }
      alert('Tự động tạo 3 roles mẫu (admin, manager, staff) thành công!');
    } catch (err: any) {
      alert(`Lỗi tạo role: ${err.message}`);
    }
  };

  // Roles Tab States
  const [isAddingRole, setIsAddingRole] = useState(false);
  const [editingRole, setEditingRole] = useState<AppRole | null>(null);
  const [newRoleForm, setNewRoleForm] = useState<Partial<AppRole>>({ name: '', description: '', permissions: [] });
  const [eqSearchTerm, setEqSearchTerm] = useState('');
  const [selectedShelf, setSelectedShelf] = useState<string>('All');
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);

  // Users Tab States
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState('staff');
  const [newUserAllowedTaskGroups, setNewUserAllowedTaskGroups] = useState<string[]>([]);
  const [newUserStatus, setNewUserStatus] = useState<'active' | 'pending'>('active');
  const [editingTaskGroupsUser, setEditingTaskGroupsUser] = useState<AppUser | null>(null);
  const [tempSelectedTaskGroups, setTempSelectedTaskGroups] = useState<string[]>([]);
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | 'pending' | 'admin' | 'manager' | 'staff'>('all');
  const [userSuccessMessage, setUserSuccessMessage] = useState<string | null>(null);

  const handleAddUser = async () => {
    if (!newUserEmail.trim()) {
      alert('Vui lòng nhập email nhân viên.');
      return;
    }
    try {
      const email = newUserEmail.trim().toLowerCase();
      const existing = appUsers.find(u => u.email?.toLowerCase() === email);
      if (existing) {
        await updateDoc(doc(db, 'users', existing.id), {
          role: newUserRole,
          status: newUserStatus,
          allowedTaskGroupIds: newUserAllowedTaskGroups,
          displayName: newUserName.trim() || existing.displayName || email.split('@')[0],
          updatedAt: new Date().toISOString()
        });
        setUserSuccessMessage(`Đã cập nhật thông tin và phân quyền cho ${email}!`);
      } else {
        const id = `user_${Date.now()}`;
        await setDoc(doc(db, 'users', id), {
          id,
          email,
          displayName: newUserName.trim() || email.split('@')[0],
          role: newUserRole,
          status: newUserStatus,
          allowedTaskGroupIds: newUserAllowedTaskGroups,
          createdAt: new Date().toISOString()
        });
        setUserSuccessMessage(`Đã thêm tài khoản ${email} thành công!`);
      }
      setTimeout(() => setUserSuccessMessage(null), 3500);
      setIsAddingUser(false);
      setNewUserEmail('');
      setNewUserName('');
      setNewUserRole('staff');
      setNewUserAllowedTaskGroups([]);
      setNewUserStatus('active');
    } catch (err: any) {
      alert(`Lỗi thêm nhân viên: ${err.message}`);
    }
  };

  const handleApproveUser = async (targetUser: AppUser, approvedRole: string, allowedTGs?: string[]) => {
    try {
      await updateDoc(doc(db, 'users', targetUser.id), {
        status: 'active',
        role: approvedRole,
        ...(allowedTGs !== undefined ? { allowedTaskGroupIds: allowedTGs } : {}),
        updatedAt: new Date().toISOString()
      });
      setUserSuccessMessage(`Đã kích hoạt tài khoản ${targetUser.displayName || targetUser.email} thành công!`);
      setTimeout(() => setUserSuccessMessage(null), 3500);
    } catch (err: any) {
      alert(`Lỗi phê duyệt: ${err.message}`);
    }
  };

  const handleUpdateUserStatus = async (userId: string, newStatus: 'active' | 'pending' | 'blocked') => {
    try {
      await updateDoc(doc(db, 'users', userId), {
        status: newStatus,
        updatedAt: new Date().toISOString()
      });
      setUserSuccessMessage(`Đã cập nhật trạng thái sang ${newStatus === 'active' ? 'Hoạt động' : newStatus === 'pending' ? 'Chờ duyệt' : 'Đã khóa'}!`);
      setTimeout(() => setUserSuccessMessage(null), 3000);
    } catch (err: any) {
      alert(`Lỗi: ${err.message}`);
    }
  };

  const handleSaveUserTaskGroups = async () => {
    if (!editingTaskGroupsUser) return;
    try {
      await updateDoc(doc(db, 'users', editingTaskGroupsUser.id), {
        allowedTaskGroupIds: tempSelectedTaskGroups,
        updatedAt: new Date().toISOString()
      });
      setUserSuccessMessage(`Đã cập nhật loại công việc cho ${editingTaskGroupsUser.displayName || editingTaskGroupsUser.email}!`);
      setTimeout(() => setUserSuccessMessage(null), 3500);
      setEditingTaskGroupsUser(null);
    } catch (err: any) {
      alert(`Lỗi lưu loại công việc: ${err.message}`);
    }
  };

  const [confirmDialog, setConfirmDialog] = useState<{isOpen: boolean, title: string, message: string, onConfirm: () => void}>({
    isOpen: false, title: '', message: '', onConfirm: () => {}
  });

  const AVAILABLE_MODULES = [
    { id: 'INFRASTRUCTURE', label: '1. Khảo sát Thông số trạm' },
    { id: 'EQUIPMENT', label: '2. Bảng Vật tư chi tiết' },
    { id: 'PHOTO', label: '3. Chụp / Tải ảnh' },
    { id: 'NOTE', label: '4. Ghi chú chung' }
  ];

  // --- Equipment Handlers ---
  const toggleSpace = (space: string, isEditing: boolean) => {
    if (isEditing && editingEq) {
      setEditingEq({
        ...editingEq,
        validSpaces: editingEq.validSpaces.includes(space) 
          ? editingEq.validSpaces.filter(s => s !== space) 
          : [...editingEq.validSpaces, space]
      });
    } else {
      setNewEqSpaces(prev => prev.includes(space) ? prev.filter(s => s !== space) : [...prev, space]);
    }
  };

  const handleAddEquipment = async () => {
    if (!newEqName || newEqSpaces.length === 0) {
      setConfirmDialog({
        isOpen: true, title: "Lỗi nhập liệu", message: "Vui lòng nhập tên thiết bị và chọn ít nhất 1 nhóm vật tư!",
        onConfirm: () => setConfirmDialog(prev => ({...prev, isOpen: false}))
      });
      return;
    }
    try {
      await addDoc(collection(db, 'equipment_dictionary'), { name: newEqName, validSpaces: newEqSpaces, unit: newEqUnit || 'cái' });
      setNewEqName('');
      setNewEqSpaces([]);
      setNewEqUnit('cái');
      setIsAddingEq(false);
    } catch (e) { console.error("Lỗi:", e); }
  };

  const handleUpdateEquipment = async () => {
    if (!editingEq || !editingEq.name || editingEq.validSpaces.length === 0) {
      setConfirmDialog({
        isOpen: true, title: "Lỗi nhập liệu", message: "Vui lòng nhập đầy đủ thông tin!",
        onConfirm: () => setConfirmDialog(prev => ({...prev, isOpen: false}))
      });
      return;
    }
    try {
      await updateDoc(doc(db, 'equipment_dictionary', editingEq.id), {
        name: editingEq.name,
        validSpaces: editingEq.validSpaces,
        unit: editingEq.unit || 'cái'
      });
      setEditingEq(null);
    } catch (e) { console.error("Lỗi cập nhật:", e); }
  };

  const handleDeleteEquipment = (id: string) => {
    setConfirmDialog({
      isOpen: true,
      title: "Xác nhận xóa",
      message: "Bạn có chắc chắn muốn xóa thiết bị này khỏi danh mục?",
      onConfirm: async () => {
        try { await deleteDoc(doc(db, 'equipment_dictionary', id)); } catch (e) { console.error("Lỗi:", e); }
        setConfirmDialog(prev => ({...prev, isOpen: false}));
      }
    });
  };

  // --- Task Group Handlers ---
  const handleAddTaskGroup = async () => {
    if (!newTaskGroup) { 
      setConfirmDialog({ isOpen: true, title: "Lỗi", message: "Vui lòng nhập tên loại công việc", onConfirm: () => setConfirmDialog(p => ({...p, isOpen: false})) });
      return; 
    }
    try {
      await addDoc(collection(db, 'task_groups'), { 
        name: newTaskGroup, 
        modules: newTaskGroupModules,
        workspace: 'Indoor', // Legacy fallback
        applicableCategories: newTaskGroupCategories
      });
      setNewTaskGroup('');
      setNewTaskGroupModules(['EQUIPMENT', 'NOTE']);
      setNewTaskGroupCategories([]);
      setIsAddingTaskGroup(false);
    } catch (e) { console.error("Lỗi:", e); }
  };

  const handleUpdateTaskGroup = async () => {
    if (!editingTaskGroup || !editingTaskGroup.name) return;
    try {
      await updateDoc(doc(db, 'task_groups', editingTaskGroup.id), { 
        name: editingTaskGroup.name,
        modules: editingTaskGroup.modules || [],
        applicableCategories: editingTaskGroup.applicableCategories || []
      });
      setEditingTaskGroup(null);
    } catch (e) { console.error("Lỗi:", e); }
  };

  const handleDeleteTaskGroup = (id: string) => {
    setConfirmDialog({
      isOpen: true, title: "Xác nhận xóa", message: "Xóa loại công việc này?",
      onConfirm: async () => {
        try { await deleteDoc(doc(db, 'task_groups', id)); } catch (e) { console.error("Lỗi:", e); }
        setConfirmDialog(p => ({...p, isOpen: false}));
      }
    });
  };

  // --- Workspace Handlers ---
  const handleAddWorkspace = async () => {
    if (!newWorkspace) {
      setConfirmDialog({ isOpen: true, title: "Lỗi", message: "Vui lòng nhập tên nhóm vật tư", onConfirm: () => setConfirmDialog(p => ({...p, isOpen: false})) });
      return;
    }
    try {
      await addDoc(collection(db, 'workspaces'), { name: newWorkspace });
      setNewWorkspace('');
      setIsAddingWorkspace(false);
    } catch(e) { console.error("Lỗi:", e); }
  };

  const handleUpdateWorkspace = async () => {
    if (!editingWorkspace || !editingWorkspace.name) return;
    try {
      await updateDoc(doc(db, 'workspaces', editingWorkspace.id), { name: editingWorkspace.name });
      setEditingWorkspace(null);
    } catch(e) { console.error("Lỗi:", e); }
  };

  const handleDeleteWorkspace = (id: string) => {
    setConfirmDialog({
      isOpen: true, title: "Xác nhận xóa", message: "Xóa nhóm vật tư này?",
      onConfirm: async () => {
        try { await deleteDoc(doc(db, 'workspaces', id)); } catch (e) { console.error("Lỗi:", e); }
        setConfirmDialog(p => ({...p, isOpen: false}));
      }
    });
  };

  // --- Survey Parameter Handlers ---
  const handleAddSurveyParam = async () => {
    if (!newSurveyLabel) return;
    try {
      await addDoc(collection(db, 'survey_parameters'), {
        label: newSurveyLabel,
        type: newSurveyType,
        unit: newSurveyUnit,
        order: surveyParameters.length
      });
      setNewSurveyLabel('');
      setNewSurveyType('text');
      setNewSurveyUnit('');
      setIsAddingSurveyParam(false);
    } catch (e) {
      console.error("Lỗi thêm thông số khảo sát:", e);
    }
  };

  const handleUpdateSurveyParam = async () => {
    if (!editingSurveyParam || !editingSurveyParam.label) return;
    try {
      await updateDoc(doc(db, 'survey_parameters', editingSurveyParam.id), {
        label: editingSurveyParam.label,
        type: editingSurveyParam.type,
        unit: editingSurveyParam.unit,
        order: editingSurveyParam.order
      });
      setEditingSurveyParam(null);
    } catch (e) {
      console.error("Lỗi cập nhật thông số khảo sát:", e);
    }
  };

  const handleDeleteSurveyParam = (id: string) => {
    setConfirmDialog({
      isOpen: true,
      title: "Xác nhận xóa",
      message: "Bạn có chắc chắn muốn xóa thông số khảo sát này?",
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'survey_parameters', id));
        } catch (e) {
          console.error("Lỗi xóa thông số khảo sát:", e);
        }
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} className="space-y-6 w-full">
      {/* Confirm Modal */}
      <AnimatePresence>
        {confirmDialog.isOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[100]">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl">
              <h3 className="text-xl font-bold text-gray-900 mb-2">{confirmDialog.title}</h3>
              <p className="text-gray-600 mb-6">{confirmDialog.message}</p>
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setConfirmDialog(p => ({...p, isOpen: false}))}>Hủy</Button>
                <Button className="flex-1" onClick={confirmDialog.onConfirm}>Xác nhận</Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-gray-900">Quản trị Hệ thống</h2>
      </div>

      <Card className="p-0 overflow-hidden flex flex-col md:flex-row min-h-[700px] border border-gray-200">
        {/* Sidebar */}
        <div className="w-full md:w-64 bg-gray-50 border-r border-gray-100 flex flex-col shrink-0">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-bold text-gray-900 flex items-center gap-2">
              <Database className="w-5 h-5 text-blue-600" />
              Thiết lập chung
            </h3>
          </div>
          
          <div className="p-3 space-y-4 flex-1 overflow-y-auto custom-scrollbar">
            {hasUsersAccess && (
              <div className={cn("rounded-xl transition-colors", isParentActive('system') && "bg-gray-100/80")}>
                <button 
                  onClick={() => toggleMenu('system')}
                  className="flex items-center justify-between w-full text-left px-3 py-2 group"
                >
                  <div className={cn("text-[11px] font-bold uppercase tracking-wider transition-colors", isParentActive('system') ? "text-blue-600" : "text-gray-400 group-hover:text-gray-600")}>Hệ thống & Phân quyền</div>
                  <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", isParentActive('system') ? "text-blue-600" : "text-gray-400", expandedMenu !== 'system' && "-rotate-90")} />
                </button>
                <AnimatePresence initial={false}>
                  {expandedMenu === 'system' && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-1 pb-2">
                        <button onClick={() => setActiveConfigTab('users')} className={cn("w-full text-left px-5 py-2 rounded-lg text-sm font-medium transition-colors", activeConfigTab === 'users' ? "text-blue-700 bg-blue-50" : "text-gray-600 hover:bg-gray-200/50 hover:text-gray-900")}>Nhân viên (Users)</button>
                        <button onClick={() => setActiveConfigTab('roles')} className={cn("w-full text-left px-5 py-2 rounded-lg text-sm font-medium transition-colors", activeConfigTab === 'roles' ? "text-blue-700 bg-blue-50" : "text-gray-600 hover:bg-gray-200/50 hover:text-gray-900")}>Vai trò & Quyền (Roles)</button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
            
            {(hasCampaignsAccess || hasStationsAccess) && (
              <div className={cn("rounded-xl transition-colors", isParentActive('operation') && "bg-gray-100/80")}>
                <button 
                  onClick={() => toggleMenu('operation')}
                  className="flex items-center justify-between w-full text-left px-3 py-2 group"
                >
                  <div className={cn("text-[11px] font-bold uppercase tracking-wider transition-colors", isParentActive('operation') ? "text-blue-600" : "text-gray-400 group-hover:text-gray-600")}>Vận hành</div>
                  <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", isParentActive('operation') ? "text-blue-600" : "text-gray-400", expandedMenu !== 'operation' && "-rotate-90")} />
                </button>
                <AnimatePresence initial={false}>
                  {expandedMenu === 'operation' && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-1 pb-2">
                        {hasCampaignsAccess && <button onClick={() => setActiveConfigTab('campaigns')} className={cn("w-full text-left px-5 py-2 rounded-lg text-sm font-medium transition-colors", activeConfigTab === 'campaigns' ? "text-blue-700 bg-blue-50" : "text-gray-600 hover:bg-gray-200/50 hover:text-gray-900")}>Đợt công việc (Campaigns)</button>}
                        {hasStationsAccess && <button onClick={() => setActiveConfigTab('stations')} className={cn("w-full text-left px-5 py-2 rounded-lg text-sm font-medium transition-colors", activeConfigTab === 'stations' ? "text-blue-700 bg-blue-50" : "text-gray-600 hover:bg-gray-200/50 hover:text-gray-900")}>Danh sách Trạm</button>}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
            
            {hasTasksAccess && (
              <div className={cn("rounded-xl transition-colors", isParentActive('tasks') && "bg-gray-100/80")}>
                <button 
                  onClick={() => toggleMenu('tasks')}
                  className="flex items-center justify-between w-full text-left px-3 py-2 group"
                >
                  <div className={cn("text-[11px] font-bold uppercase tracking-wider transition-colors", isParentActive('tasks') ? "text-blue-600" : "text-gray-400 group-hover:text-gray-600")}>Gói công việc chuẩn</div>
                  <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", isParentActive('tasks') ? "text-blue-600" : "text-gray-400", expandedMenu !== 'tasks' && "-rotate-90")} />
                </button>
                <AnimatePresence initial={false}>
                  {expandedMenu === 'tasks' && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-1 pb-2">
                        <button onClick={() => setActiveConfigTab('tg')} className={cn("w-full text-left px-5 py-2 rounded-lg text-sm font-medium transition-colors", activeConfigTab === 'tg' ? "text-blue-700 bg-blue-50" : "text-gray-600 hover:bg-gray-200/50 hover:text-gray-900")}>Hạng mục / Quy trình</button>
                        <button onClick={() => setActiveConfigTab('eq')} className={cn("w-full text-left px-5 py-2 rounded-lg text-sm font-medium transition-colors", activeConfigTab === 'eq' ? "text-blue-700 bg-blue-50" : "text-gray-600 hover:bg-gray-200/50 hover:text-gray-900")}>Từ điển Thiết bị</button>
                        <button onClick={() => setActiveConfigTab('survey')} className={cn("w-full text-left px-5 py-2 rounded-lg text-sm font-medium transition-colors", activeConfigTab === 'survey' ? "text-blue-700 bg-blue-50" : "text-gray-600 hover:bg-gray-200/50 hover:text-gray-900")}>Biểu mẫu Khảo sát</button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
        
        <div className="flex-1 p-4 md:p-6 bg-white min-w-0 overflow-y-auto">
          {/* TAB: CAMPAIGNS */}
          {activeConfigTab === 'campaigns' && (
            <div className="space-y-4">
               <div className="flex justify-between items-center bg-blue-50 p-4 rounded-xl border border-blue-100 mb-6">
                 <div>
                   <h4 className="font-bold text-blue-900">Quản lý các Đợt công việc (Campaigns)</h4>
                   <p className="text-sm text-blue-700">Tạo mới và quản lý các nhóm đợt công việc hoặc dự án để phân luồng dữ liệu trạm trên bản đồ.</p>
                 </div>
                 <Button onClick={() => {
                   setEditingCampaign({ status: 'active' });
                   setShowCampaignModal(true);
                 }}>Thêm đợt mới</Button>
               </div>
               
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 {campaigns.filter(c => c.status === 'active').map(c => (
                   <div key={c.id} className="flex flex-col p-4 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-sm transition-all group">
                     <div className="flex justify-between items-start mb-2">
                       <div>
                         <span className="font-bold text-gray-900 text-base">{c.name}</span>
                         <div className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                            <span className={cn("w-2 h-2 rounded-full bg-green-500")}></span>
                            Đang mở &bull; Tạo lúc {new Date(c.createdAt).toLocaleDateString()}
                         </div>
                       </div>
                       <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingCampaign(c);
                            setShowCampaignModal(true);
                          }}
                        >
                          <Settings2 className="w-4 h-4 text-gray-500 hover:text-blue-600" />
                        </Button>
                     </div>
                     
                     <div className="mt-2 text-sm text-gray-600 grid grid-cols-2 gap-2">
                        {c.startDate && <div><span className="text-gray-400">Bắt đầu:</span> {new Date(c.startDate).toLocaleDateString()}</div>}
                        {c.endDate && <div><span className="text-gray-400">Kết thúc:</span> {new Date(c.endDate).toLocaleDateString()}</div>}
                     </div>
                     {c.notes && (
                        <div className="mt-2 text-sm text-gray-600 border-t pt-2 border-gray-100">
                          <span className="text-gray-400 block mb-1">Ghi chú:</span>
                          <p className="whitespace-pre-wrap">{c.notes}</p>
                        </div>
                     )}

                     <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100 mt-auto">
                        <Button
                          variant="secondary"
                          className="flex-1 text-xs"
                          onClick={() => {
                            updateDoc(doc(db, 'campaigns', c.id), { status: 'closed' });
                          }}
                        >
                          Đóng đợt
                        </Button>
                     </div>
                   </div>
                 ))}
                 {campaigns.filter(c => c.status === 'active').length === 0 && <p className="text-gray-500 col-span-2 text-center py-4">Chưa có đợt công việc nào đang mở.</p>}
               </div>

               {campaigns.filter(c => c.status === 'closed').length > 0 && (
                 <div className="mt-8 border-t border-gray-200 pt-6">
                   <button 
                     onClick={() => setShowClosedCampaigns(!showClosedCampaigns)}
                     className="flex items-center justify-between w-full p-4 rounded-xl font-bold bg-gray-50 border border-gray-200 hover:bg-gray-100 hover:border-gray-300 transition-colors text-gray-700"
                   >
                     <div className="flex items-center gap-3">
                       <span className="bg-gray-200 text-gray-700 px-3 py-0.5 rounded-full text-sm">{campaigns.filter(c => c.status === 'closed').length}</span>
                       <span>Nhật ký Đợt công việc (Đã đóng)</span>
                     </div>
                     <svg className={cn("w-5 h-5 transition-transform", showClosedCampaigns ? "rotate-180" : "")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                     </svg>
                   </button>
                   
                   {showClosedCampaigns && (
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-75 grayscale-[20%] mt-4">
                       {campaigns.filter(c => c.status === 'closed').map(c => (
                         <div key={c.id} className="flex flex-col p-4 bg-gray-50 border border-gray-200 rounded-xl group/closed">
                           <div className="flex justify-between items-start mb-2">
                             <div>
                               <span className="font-bold text-gray-700 text-base">{c.name}</span>
                               <div className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                                  <span className={cn("w-2 h-2 rounded-full bg-gray-400")}></span>
                                  Đã đóng &bull; Tạo lúc {new Date(c.createdAt).toLocaleDateString()}
                               </div>
                             </div>
                           <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingCampaign(c);
                                setShowCampaignModal(true);
                              }}
                            >
                              <Settings2 className="w-4 h-4 text-gray-500 hover:text-blue-600" />
                            </Button>
                         </div>
                         
                         <div className="mt-2 text-sm text-gray-500 grid grid-cols-2 gap-2">
                            {c.startDate && <div><span className="text-gray-400">Bắt đầu:</span> {new Date(c.startDate).toLocaleDateString()}</div>}
                            {c.endDate && <div><span className="text-gray-400">Kết thúc:</span> {new Date(c.endDate).toLocaleDateString()}</div>}
                         </div>

                         <div className="flex gap-2 mt-4 pt-4 border-t border-gray-200 mt-auto">
                            <Button
                              variant="secondary"
                              className="flex-1 text-xs bg-white hover:bg-gray-100 border-gray-300"
                              onClick={() => {
                                updateDoc(doc(db, 'campaigns', c.id), { status: 'active' });
                              }}
                            >
                              Mở lại
                            </Button>
                            <Button
                              variant="secondary"
                              className="flex-1 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 border-gray-300"
                              onClick={() => {
                                const hasStations = stations.some(s => s.campaignId === c.id);
                                if (hasStations) {
                                  alert('Không thể xóa đợt công việc này vì đã có trạm liên kết. Vui lòng giữ ở trạng thái "Đã đóng" để bảo toàn dữ liệu.');
                                } else {
                                  if (confirm(`Bạn có chắc chắn muốn xóa đợt công việc "${c.name}"? Hành động này không thể hoàn tác.`)) {
                                    deleteDoc(doc(db, 'campaigns', c.id));
                                  }
                                }
                              }}
                            >
                              <Trash2 className="w-4 h-4 mr-1" />
                              Xóa
                            </Button>
                         </div>
                       </div>
                     ))}
                   </div>
                 )}
               </div>
             )}
          </div>
        )}

          {/* TAB: STATIONS */}
          {activeConfigTab === 'stations' && (
             <div className="-mx-4 -my-4 sm:mx-0 sm:my-0">
               <StationsTab 
                 stations={stations} 
                 reports={reports} 
                 validationWarnings={validationWarnings} 
                 setValidationWarnings={setValidationWarnings} 
                 campaigns={campaigns} 
                 selectedCampaignId={selectedCampaignId}
                 appUsers={appUsers}
               />
             </div>
          )}

          {/* TAB: SURVEY PARAMETERS */}
          {activeConfigTab === 'survey' && (
            <div className="space-y-4">
              <div className="flex flex-row justify-between items-center bg-blue-50/50 p-3 rounded-lg border border-blue-100 gap-3">
                <div className="text-sm font-medium text-gray-700">Thông số kĩ thuật cần khảo sát</div>
                <Button className="whitespace-nowrap shrink-0 px-3 py-1.5 text-sm" onClick={() => setIsAddingSurveyParam(!isAddingSurveyParam)}>
                  {isAddingSurveyParam ? 'Hủy' : '+ Thêm thông số'}
                </Button>
              </div>

              <AnimatePresence>
                {isAddingSurveyParam && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="p-4 border rounded-lg bg-gray-50 space-y-4 overflow-hidden">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="sm:col-span-1">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Tên thông số (Label)</label>
                        <Input value={newSurveyLabel} onChange={(e: any) => setNewSurveyLabel(e.target.value)} placeholder="VD: Hướng Sector 1" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Kiểu dữ liệu</label>
                        <select className="w-full border p-1.5 rounded-md text-sm border-gray-200 h-10 bg-white" value={newSurveyType} onChange={(e: any) => setNewSurveyType(e.target.value)}>
                          <option value="text">Văn bản (Text)</option>
                          <option value="number">Số (Number)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Đơn vị (Không bắt buộc)</label>
                        <Input value={newSurveyUnit} onChange={(e: any) => setNewSurveyUnit(e.target.value)} placeholder="VD: m, độ, tầng..." />
                      </div>
                    </div>
                    <Button onClick={handleAddSurveyParam} className="w-full">Lưu thông số khảo sát mới</Button>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {surveyParameters.map(param => (
                  <div key={param.id} className="border border-gray-200 p-3 rounded-lg hover:shadow-sm transition-all bg-white relative group">
                    {editingSurveyParam?.id === param.id ? (
                      <div className="space-y-3">
                        <Input value={editingSurveyParam.label} onChange={(e: any) => setEditingSurveyParam({...editingSurveyParam, label: e.target.value})} className="h-8 text-sm" placeholder="Tên" />
                        <div className="flex gap-2">
                          <select className="flex-1 border p-1 rounded-md text-xs border-gray-200 h-8" value={editingSurveyParam.type} onChange={(e: any) => setEditingSurveyParam({...editingSurveyParam, type: e.target.value as any})}>
                            <option value="text">Text</option>
                            <option value="number">Number</option>
                          </select>
                          <Input value={editingSurveyParam.unit || ''} onChange={(e: any) => setEditingSurveyParam({...editingSurveyParam, unit: e.target.value})} placeholder="Đơn vị" className="w-20 h-8 text-xs" />
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={handleUpdateSurveyParam} className="w-full h-8 text-xs">Lưu</Button>
                          <Button size="sm" variant="secondary" onClick={() => setEditingSurveyParam(null)} className="w-full h-8 text-xs">Hủy</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="pr-14">
                          <div className="font-bold text-gray-900 text-sm">{param.label}</div>
                          <div className="flex gap-2 mt-1.5">
                            <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border uppercase">{param.type}</span>
                            {param.unit && <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border">Đơn vị: {param.unit}</span>}
                          </div>
                        </div>
                        <div className="absolute top-2 right-2 flex opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setEditingSurveyParam(param)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded">
                            <Settings2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDeleteSurveyParam(param.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {surveyParameters.length === 0 && !isAddingSurveyParam && (
                  <div className="col-span-full py-12 text-center border-2 border-dashed rounded-xl border-gray-200 bg-gray-50/50">
                    <ClipboardList className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                    <p className="text-gray-500 text-sm">Chưa có thông số khảo sát nào được thiết lập.</p>
                    <button onClick={() => setIsAddingSurveyParam(true)} className="text-blue-600 text-sm font-semibold mt-2 hover:underline">Bắt đầu thiết lập biểu mẫu</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: EQUIPMENT */}
          {activeConfigTab === 'eq' && (
            <div className="space-y-4">
              <div className="flex flex-row justify-between items-center bg-blue-50/50 p-3 rounded-lg border border-blue-100 gap-3">
                <div className="text-sm font-medium text-gray-700">Danh mục thiết bị</div>
                <div className="flex gap-2">
                  <Button variant="secondary" className="whitespace-nowrap shrink-0 px-3 py-1.5 text-sm" onClick={() => setShowWorkspaceModal(true)}>
                    <Settings2 className="w-4 h-4 md:mr-1" /> <span className="hidden md:inline">Cấu hình Nhóm</span>
                  </Button>
                  <Button className="whitespace-nowrap shrink-0 px-3 py-1.5 text-sm" onClick={() => setIsAddingEq(!isAddingEq)}>
                    {isAddingEq ? 'Hủy' : '+ Thêm mới'}
                  </Button>
                </div>
              </div>

              {/* WORKSAPCES MODAL */}
              <AnimatePresence>
                {showWorkspaceModal && (
                  <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[100]">
                    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-xl max-h-[85vh] overflow-y-auto">
                      <div className="flex justify-between items-center mb-6 border-b pb-4">
                        <h3 className="text-xl font-bold text-gray-900">Cấu hình Nhóm vật tư</h3>
                        <button onClick={() => setShowWorkspaceModal(false)} className="text-gray-500 hover:bg-gray-100 p-2 rounded-full">
                          Đóng
                        </button>
                      </div>
                      
                      <div className="space-y-4">
                        <div className="flex flex-row justify-between items-center bg-blue-50/50 p-3 rounded-lg border border-blue-100 gap-3">
                          <div className="text-sm font-medium text-gray-700">Các nhóm vật tư để phân loại thiết bị</div>
                          <Button className="whitespace-nowrap shrink-0 px-3 py-1.5 text-sm" onClick={() => setIsAddingWorkspace(!isAddingWorkspace)}>
                            {isAddingWorkspace ? 'Hủy' : '+ Thêm mới'}
                          </Button>
                        </div>
                        
                        <AnimatePresence>
                          {isAddingWorkspace && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="p-4 border rounded-lg bg-gray-50 flex flex-col gap-3 overflow-hidden">
                              <div className="flex gap-2">
                                <Input value={newWorkspace} onChange={(e: any) => setNewWorkspace(e.target.value)} placeholder="Tên nhóm (VD: Indoor, Outdoor, Trên cột...)" className="flex-1" />
                                <Button onClick={handleAddWorkspace}>Lưu</Button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                          {workspaces.map(ws => (
                            <div key={ws.id} className="border p-3 rounded-lg group flex flex-col hover:border-gray-300 gap-2 relative bg-white min-h-[50px] justify-center">
                              {editingWorkspace?.id === ws.id ? (
                                <div className="flex gap-2 w-full">
                                  <Input value={editingWorkspace.name} onChange={(e: any) => setEditingWorkspace({...editingWorkspace, name: e.target.value})} className="h-8 text-sm flex-1" />
                                  <Button size="sm" onClick={handleUpdateWorkspace} className="h-8 text-xs px-2">Lưu</Button>
                                  <Button size="sm" variant="secondary" onClick={() => setEditingWorkspace(null)} className="h-8 text-xs px-2">Hủy</Button>
                                </div>
                              ) : (
                                <>
                                  <div className="font-medium text-sm text-gray-900 pr-14">{ws.name}</div>
                                  <div className="absolute top-1.5 right-1.5 flex opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => setEditingWorkspace(ws)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded bg-gray-50 hover:bg-blue-50">
                                      <Settings2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button onClick={() => handleDeleteWorkspace(ws.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded bg-gray-50 hover:bg-red-50 ml-1">
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {isAddingEq && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="p-4 border rounded-lg bg-gray-50 space-y-4 overflow-hidden">
                    <div className="flex flex-col sm:flex-row gap-4">
                      <div className="flex-1">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Tên thiết bị</label>
                        <Input value={newEqName} onChange={(e: any) => setNewEqName(e.target.value)} placeholder="VD: Acquy tia chớp" />
                      </div>
                      <div className="w-full sm:w-32">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Đơn vị (ĐVT)</label>
                        <div className="relative">
                          <input 
                            list="unit-suggestions-add"
                            className="w-full border p-1.5 rounded-md text-sm border-gray-200 h-10 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500" 
                            value={newEqUnit} 
                            onChange={(e: any) => setNewEqUnit(e.target.value)}
                            placeholder="Gõ hoặc chọn..."
                          />
                          <datalist id="unit-suggestions-add">
                            {Array.from(new Set(equipmentDict.map(eq => eq.unit).filter(Boolean))).map(u => (
                              <option key={u} value={u} />
                            ))}
                          </datalist>
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Nhóm vật tư áp dụng</label>
                      <div className="flex flex-wrap gap-4">
                        {workspaces.map(ws => (
                          <label key={ws.id} className="flex items-center gap-2 cursor-pointer bg-white px-3 py-1.5 rounded-lg border shadow-sm hover:border-blue-300">
                            <input type="checkbox" checked={newEqSpaces.includes(ws.name)} onChange={() => toggleSpace(ws.name, false)} className="w-4 h-4 text-blue-600 rounded" />
                            <span className="text-sm font-medium text-gray-700">{ws.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <Button onClick={handleAddEquipment} className="w-full">Lưu thiết bị mới</Button>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex gap-2 overflow-x-auto pb-1 mb-2 scrollbar-none">
                <button
                  onClick={() => setSelectedShelf('All')}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors border",
                    selectedShelf === 'All' ? "bg-blue-600 text-white border-blue-600 shadow-sm" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-gray-300"
                  )}
                >
                  Tất cả
                </button>
                {workspaces.map(ws => (
                  <button
                    key={ws.id}
                    onClick={() => setSelectedShelf(ws.name)}
                    className={cn(
                      "px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors border",
                      selectedShelf === ws.name ? "bg-blue-600 text-white border-blue-600 shadow-sm" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-gray-300"
                    )}
                  >
                    Nhóm: {ws.name}
                  </button>
                ))}
              </div>

              <div className="flex flex-col mb-4 gap-3 md:flex-row md:items-center">
                <input 
                  type="text" 
                  placeholder="Tìm kiếm danh mục vật tư..." 
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm flex-1 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  value={eqSearchTerm}
                  onChange={(e) => setEqSearchTerm(e.target.value)}
                />
              </div>
              
              {(() => {
                const filteredList = equipmentDict.filter(eq => {
                  if (selectedShelf !== 'All' && !(eq.validSpaces || []).includes(selectedShelf)) return false;
                  
                  const searchTerms = removeVietnameseTones(eqSearchTerm.toLowerCase().trim()).split(/\s+/).filter(Boolean);
                  if (searchTerms.length === 0) return true;
                  const searchableArray = [
                    eq.name,
                    eq.unit,
                    ...(eq.validSpaces || [])
                  ];
                  const massiveString = removeVietnameseTones(searchableArray.filter(Boolean).join(' ').toLowerCase());
                  return searchTerms.every(term => massiveString.includes(term));
                });

                const renderEqCard = (eq: EquipmentDict) => (
                  <div key={eq.id} className="border border-gray-200 p-3 rounded-lg hover:shadow-sm transition-all bg-white relative group flex flex-col justify-between h-full min-h-[90px]">
                    {editingEq?.id === eq.id ? (
                      <div className="space-y-3">
                        <div className="flex gap-2">
                          <Input value={editingEq.name} onChange={(e: any) => setEditingEq({...editingEq, name: e.target.value})} className="flex-1 h-8 text-sm font-medium" />
                          <input 
                            list="unit-suggestions-edit"
                            value={editingEq.unit || ''} 
                            onChange={(e: any) => setEditingEq({...editingEq, unit: e.target.value})} 
                            placeholder="ĐVT" 
                            className="w-20 h-8 text-sm border p-1 border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 px-2" 
                          />
                          <datalist id="unit-suggestions-edit">
                            {Array.from(new Set(equipmentDict.map(eq => eq.unit).filter(Boolean))).map(u => (
                              <option key={u} value={u} />
                            ))}
                          </datalist>
                        </div>
                        <div className="flex gap-3 flex-wrap">
                          {workspaces.map(ws => (
                            <label key={ws.id} className="flex items-center gap-1.5 cursor-pointer bg-gray-50 px-2 py-1 rounded border">
                              <input type="checkbox" checked={editingEq.validSpaces.includes(ws.name)} onChange={() => toggleSpace(ws.name, true)} className="w-3.5 h-3.5" />
                              <span className="text-xs text-gray-600 font-medium">{ws.name}</span>
                            </label>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={handleUpdateEquipment} className="w-full h-8 text-xs">Lưu</Button>
                          <Button size="sm" variant="secondary" onClick={() => setEditingEq(null)} className="w-full h-8 text-xs">Hủy</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="pr-14">
                          <div className="font-medium text-gray-900 text-sm">
                            {eq.name}
                            {eq.unit && <span className="ml-2 text-xs font-normal text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded border">đvt: {eq.unit}</span>}
                          </div>
                          <div className="flex gap-1 mt-1.5 flex-wrap">
                            {eq.validSpaces.map(sp => (
                              <span key={sp} className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium border", (eq.validSpaces || []).length > 1 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-blue-50 text-blue-600 border-blue-100")}>
                                {sp}
                              </span>
                            ))}
                          </div>
                          {(eq.validSpaces || []).length > 1 && selectedShelf !== 'All' && (
                            <div className="mt-2 text-[10px] text-gray-500 italic border-t pt-1.5 bg-gray-50/50 rounded-b-lg -mx-3 mb-[-12px] px-3 pb-2 w-[calc(100%+24px)]">
                              Dùng chung với: {eq.validSpaces.filter(s => s !== selectedShelf).join(', ')}
                            </div>
                          )}
                        </div>
                        <div className="absolute top-2 right-2 flex opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setEditingEq(eq)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded">
                            <Settings2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDeleteEquipment(eq.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );

                if (selectedShelf === 'All') {
                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {filteredList.map(renderEqCard)}
                    </div>
                  );
                }

                const exclusiveEqs = filteredList.filter(eq => (eq.validSpaces || []).length === 1);
                const sharedEqs = filteredList.filter(eq => (eq.validSpaces || []).length > 1);

                return (
                  <div className="space-y-6">
                    {exclusiveEqs.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-blue-500"></span> Vật tư đặc thù (Chỉ có ở Thiết bị: {selectedShelf})
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                          {exclusiveEqs.map(renderEqCard)}
                        </div>
                      </div>
                    )}
                    
                    {sharedEqs.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-amber-500"></span> Vật tư dùng chung (Thuộc nhiều nhóm)
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                          {sharedEqs.map(renderEqCard)}
                        </div>
                      </div>
                    )}

                    {exclusiveEqs.length === 0 && sharedEqs.length === 0 && (
                      <div className="text-center py-8 text-gray-500 italic bg-gray-50 rounded-xl border border-dashed border-gray-200">
                        Không có vật tư nào trong nhóm này.
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* TAB: TASK GROUPS */}
          {activeConfigTab === 'tg' && (
            <div className="space-y-4">
               <div className="flex flex-row justify-between items-center bg-blue-50/50 p-3 rounded-lg border border-blue-100 gap-3">
                <div className="text-sm font-medium text-gray-700">Nhóm công việc</div>
                <Button className="whitespace-nowrap shrink-0 px-3 py-1.5 text-sm" onClick={() => setIsAddingTaskGroup(!isAddingTaskGroup)}>
                  {isAddingTaskGroup ? 'Hủy' : '+ Thêm mới'}
                </Button>
              </div>

              <AnimatePresence>
                {isAddingTaskGroup && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="p-4 border rounded-lg bg-gray-50 flex flex-col gap-3 overflow-hidden">
                    <div className="flex gap-2">
                      <Input value={newTaskGroup} onChange={(e: any) => setNewTaskGroup(e.target.value)} placeholder="Tên loại công việc..." className="flex-1" />
                      <Button onClick={handleAddTaskGroup}>Lưu</Button>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-700 block mb-2">Các khối chức năng (Modules) áp dụng:</span>
                      <div className="flex flex-wrap gap-4">
                        {AVAILABLE_MODULES.map(mod => (
                          <label key={mod.id} className="flex items-center gap-2 cursor-pointer w-fit text-sm text-gray-700 bg-white px-3 py-1.5 rounded-lg border shadow-sm">
                            <input 
                              type="checkbox" 
                              checked={newTaskGroupModules.includes(mod.id)} 
                              onChange={(e) => {
                                if (e.target.checked) setNewTaskGroupModules([...newTaskGroupModules, mod.id]);
                                else setNewTaskGroupModules(newTaskGroupModules.filter(id => id !== mod.id));
                              }} 
                              className="w-4 h-4 text-blue-600 rounded" 
                            />
                            <span>{mod.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-700 block mb-2">Nhóm vật tư cấu hình cho công việc này:</span>
                      <div className="flex flex-wrap gap-4">
                        {workspaces.map(ws => (
                          <label key={ws.id} className="flex items-center gap-2 cursor-pointer w-fit text-sm text-gray-700 bg-white px-3 py-1.5 rounded-lg border shadow-sm">
                            <input 
                              type="checkbox" 
                              checked={newTaskGroupCategories.includes(ws.name)} 
                              onChange={(e) => {
                                if (e.target.checked) setNewTaskGroupCategories([...newTaskGroupCategories, ws.name]);
                                else setNewTaskGroupCategories(newTaskGroupCategories.filter(cat => cat !== ws.name));
                              }} 
                              className="w-4 h-4 text-blue-600 rounded" 
                            />
                            <span>{ws.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {taskGroups.map(tg => (
                  <div key={tg.id} className="border p-3 rounded-lg group flex flex-col hover:border-gray-300 gap-2 relative bg-white min-h-[100px]">
                    {editingTaskGroup?.id === tg.id ? (
                      <div className="flex flex-col gap-3 w-full pb-8">
                        <Input value={editingTaskGroup.name} onChange={(e: any) => setEditingTaskGroup({...editingTaskGroup, name: e.target.value})} className="h-8 text-sm w-full" />
                        <div className="flex flex-col gap-2">
                          <span className="text-xs font-semibold text-gray-500">Modules:</span>
                          {AVAILABLE_MODULES.map(mod => (
                            <label key={mod.id} className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-600">
                              <input 
                                type="checkbox" 
                                checked={(editingTaskGroup.modules || []).includes(mod.id)} 
                                onChange={(e) => {
                                  const current = editingTaskGroup.modules || [];
                                  setEditingTaskGroup({
                                    ...editingTaskGroup, 
                                    modules: e.target.checked ? [...current, mod.id] : current.filter(id => id !== mod.id)
                                  });
                                }} 
                                className="w-3.5 h-3.5 text-blue-600" 
                              />
                              <span>{mod.label}</span>
                            </label>
                          ))}
                        </div>
                        <div className="flex flex-col gap-2">
                          <span className="text-xs font-semibold text-gray-500">Các nhóm vật tư áp dụng:</span>
                          <div className="flex flex-wrap gap-2">
                            {workspaces.map(ws => (
                              <label key={ws.id} className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-600">
                                <input 
                                  type="checkbox" 
                                  checked={(editingTaskGroup.applicableCategories || []).includes(ws.name)} 
                                  onChange={(e) => {
                                    const current = editingTaskGroup.applicableCategories || [];
                                    setEditingTaskGroup({
                                      ...editingTaskGroup, 
                                      applicableCategories: e.target.checked ? [...current, ws.name] : current.filter(cat => cat !== ws.name)
                                    });
                                  }} 
                                  className="w-3 h-3 text-blue-600" 
                                />
                                <span>{ws.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-2 absolute bottom-2 left-3 right-3">
                          <Button size="sm" onClick={handleUpdateTaskGroup} className="w-full h-7 text-xs">Lưu</Button>
                          <Button size="sm" variant="secondary" onClick={() => setEditingTaskGroup(null)} className="w-full h-7 text-xs">Hủy</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="pr-14 font-medium text-sm text-gray-900 border-b border-gray-100 pb-2">{tg.name}</div>
                        <div className="flex flex-col gap-1.5 mt-1">
                          {(tg.modules || []).length > 0 ? (
                            AVAILABLE_MODULES.filter(m => (tg.modules || []).includes(m.id)).map(m => (
                              <span key={m.id} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-medium border border-blue-100 flex items-center w-fit">
                                • {m.label}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-gray-400 italic">Không có module</span>
                          )}
                          <div className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded border border-gray-200 mt-1">
                            <span className="font-semibold mb-1 block">Nhóm vật tư:</span>
                            <div className="flex flex-wrap gap-1">
                              {((tg.applicableCategories && tg.applicableCategories.length > 0) ? tg.applicableCategories : (tg.workspace === 'Full' ? ['Indoor', 'Outdoor'] : (tg.workspace ? [tg.workspace] : []))).map(cat => (
                                <span key={cat} className="bg-white px-1.5 py-0.5 rounded border border-gray-200 text-[10px] break-all">
                                  {cat}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="absolute top-2 right-2 flex opacity-0 group-hover:opacity-100 transition-opacity">
                           <button onClick={() => setEditingTaskGroup(tg)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded bg-gray-50 hover:bg-blue-50">
                             <Settings2 className="w-3.5 h-3.5" />
                           </button>
                           <button onClick={() => handleDeleteTaskGroup(tg.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded bg-gray-50 hover:bg-red-50 ml-1">
                             <Trash2 className="w-3.5 h-3.5" />
                           </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB: USERS */}
          {activeConfigTab === 'users' && (
            <div className="space-y-6">
              {/* Top Banner */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 p-5 rounded-2xl border border-blue-100 shadow-sm">
                <div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-6 h-6 text-blue-600" />
                    <h4 className="font-bold text-gray-900 text-lg">Quản lý Nhân sự & Phân quyền</h4>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    Cấu hình và gán vai trò rõ ràng giữa Quản trị viên, Quản lý vận hành và Kỹ sư hiện trường.
                  </p>
                </div>
                <Button 
                  onClick={() => setIsAddingUser(true)}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-xl shadow-md shadow-blue-200 flex items-center gap-2 shrink-0"
                >
                  <UserPlus className="w-4 h-4" />
                  Thêm tài khoản nhân sự
                </Button>
              </div>

              {/* Role Explanatory Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Admin Card */}
                <div className="bg-purple-50/70 border border-purple-200/80 rounded-2xl p-4 flex flex-col justify-between shadow-xs">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-100 text-purple-800 border border-purple-200">
                        <Crown className="w-3.5 h-3.5 text-purple-600" />
                        Admin (Quản trị viên)
                      </span>
                      <span className="text-xs font-bold text-purple-900 bg-white/80 px-2 py-0.5 rounded-full border border-purple-200">
                        {appUsers?.filter(u => u.role === 'admin' || isOwnerEmail(u.email)).length || 0} người
                      </span>
                    </div>
                    <p className="text-xs text-purple-950 font-medium leading-relaxed">
                      Toàn quyền tối cao: cấu hình hệ thống, quản lý tài khoản & phân quyền, danh mục trạm, chiến dịch, xoá dữ liệu và duyệt báo cáo.
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-purple-200/60 flex items-center gap-1 text-[11px] font-semibold text-purple-700">
                    <CheckCircle2 className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                    Toàn quyền hệ thống & phân quyền
                  </div>
                </div>

                {/* Manager Card */}
                <div className="bg-blue-50/70 border border-blue-200/80 rounded-2xl p-4 flex flex-col justify-between shadow-xs">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200">
                        <Briefcase className="w-3.5 h-3.5 text-blue-600" />
                        Manager (Quản lý)
                      </span>
                      <span className="text-xs font-bold text-blue-900 bg-white/80 px-2 py-0.5 rounded-full border border-blue-200">
                        {appUsers?.filter(u => u.role === 'manager' && !isOwnerEmail(u.email)).length || 0} người
                      </span>
                    </div>
                    <p className="text-xs text-blue-950 font-medium leading-relaxed">
                      Lập kế hoạch tháng/ngày, điều phối giao trạm cho các kỹ sư, theo dõi tiến độ khảo sát toàn đội, kiểm tra và xuất báo cáo.
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-blue-200/60 flex items-center gap-1 text-[11px] font-semibold text-blue-700">
                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    Điều phối giao việc & xem báo cáo
                  </div>
                </div>

                {/* Staff Card */}
                <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-2xl p-4 flex flex-col justify-between shadow-xs">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                        <HardHat className="w-3.5 h-3.5 text-emerald-600" />
                        Staff (Kỹ sư hiện trường)
                      </span>
                      <span className="text-xs font-bold text-emerald-900 bg-white/80 px-2 py-0.5 rounded-full border border-emerald-200">
                        {appUsers?.filter(u => (u.role === 'staff' || (!u.role && !isOwnerEmail(u.email))) && !isOwnerEmail(u.email)).length || 0} người
                      </span>
                    </div>
                    <p className="text-xs text-emerald-950 font-medium leading-relaxed">
                      Xem nhiệm vụ và lộ trình cá nhân, định vị GPS dẫn đường trạm, check-in hiện trường, kiểm tra thiết bị và nộp báo cáo.
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-emerald-200/60 flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    Thực thi hiện trường & làm báo cáo
                  </div>
                </div>
              </div>

              {/* Toast message if any */}
              {userSuccessMessage && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-medium flex items-center justify-between animate-in fade-in">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{userSuccessMessage}</span>
                  </div>
                  <button onClick={() => setUserSuccessMessage(null)} className="text-emerald-500 hover:text-emerald-700">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Pending Accounts Alert & Quick Approval Section */}
              {(() => {
                const pendingUsers = (appUsers || []).filter(u => u.status === 'pending' && !isOwnerEmail(u.email));
                if (pendingUsers.length === 0) return null;

                return (
                  <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-2xl p-4 sm:p-5 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center font-bold text-xs shadow-xs shrink-0">
                          <Clock className="w-5 h-5 animate-pulse" />
                        </div>
                        <div>
                          <h4 className="font-bold text-amber-950 text-sm sm:text-base flex items-center gap-2">
                            Tài khoản Google mới chờ kích hoạt ({pendingUsers.length})
                          </h4>
                          <p className="text-xs text-amber-800">
                            Các tài khoản Google này vừa đăng nhập. Vui lòng phân vai trò và duyệt kích hoạt để nhân sự bắt đầu làm việc.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                      {pendingUsers.map(pUser => (
                        <div key={pUser.id} className="bg-white p-3.5 rounded-xl border border-amber-200 shadow-2xs flex flex-col justify-between gap-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h5 className="font-bold text-gray-900 text-xs sm:text-sm truncate">
                                {pUser.displayName || pUser.email?.split('@')[0]}
                              </h5>
                              <p className="text-xs text-gray-500 truncate">{pUser.email}</p>
                              <span className="text-[10px] text-gray-400 mt-0.5 block">
                                Đăng nhập lúc: {new Date(pUser.createdAt).toLocaleDateString('vi-VN')}
                              </span>
                            </div>
                            <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full shrink-0 border border-amber-200">
                              Chờ duyệt
                            </span>
                          </div>

                          <div className="pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 flex-1">
                              <select 
                                id={`pending-role-${pUser.id}`}
                                defaultValue={pUser.role || 'staff'}
                                className="text-xs font-semibold py-1.5 px-2 border rounded-lg bg-gray-50 border-gray-200 w-full"
                              >
                                <option value="staff">🛠️ Kỹ sư (Staff)</option>
                                <option value="manager">💼 Quản lý (Manager)</option>
                                <option value="admin">👑 Admin</option>
                              </select>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                size="sm"
                                className="text-xs py-1 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                                onClick={() => {
                                  const selectEl = document.getElementById(`pending-role-${pUser.id}`) as HTMLSelectElement;
                                  const chosenRole = selectEl ? selectEl.value : 'staff';
                                  handleApproveUser(pUser, chosenRole);
                                }}
                              >
                                <CheckSquare className="w-3.5 h-3.5 mr-1" /> Duyệt
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                className="text-xs py-1 px-2 text-red-600 hover:bg-red-50 border-gray-200"
                                onClick={() => handleUpdateUserStatus(pUser.id, 'blocked')}
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

              {/* Search & Role Filter Toolbar */}
              <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between bg-gray-50/70 p-3 rounded-2xl border border-gray-200">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Tìm theo tên nhân viên, email..."
                    value={userSearchTerm}
                    onChange={(e) => setUserSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {userSearchTerm && (
                    <button onClick={() => setUserSearchTerm('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Filter Tabs */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                  <button
                    onClick={() => setUserRoleFilter('all')}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap",
                      userRoleFilter === 'all' 
                        ? "bg-gray-900 text-white shadow-xs" 
                        : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
                    )}
                  >
                    Tất cả ({appUsers?.length || 0})
                  </button>

                  <button
                    onClick={() => setUserRoleFilter('pending')}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1",
                      userRoleFilter === 'pending' 
                        ? "bg-amber-600 text-white shadow-xs" 
                        : "bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200"
                    )}
                  >
                    <Clock className="w-3 h-3" />
                    Chờ duyệt ({appUsers?.filter(u => u.status === 'pending' && !isOwnerEmail(u.email)).length || 0})
                  </button>

                  <button
                    onClick={() => setUserRoleFilter('admin')}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1",
                      userRoleFilter === 'admin' 
                        ? "bg-purple-700 text-white shadow-xs" 
                        : "bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200"
                    )}
                  >
                    <Crown className="w-3 h-3" />
                    Admin
                  </button>
                  <button
                    onClick={() => setUserRoleFilter('manager')}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1",
                      userRoleFilter === 'manager' 
                        ? "bg-blue-700 text-white shadow-xs" 
                        : "bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200"
                    )}
                  >
                    <Briefcase className="w-3 h-3" />
                    Manager
                  </button>
                  <button
                    onClick={() => setUserRoleFilter('staff')}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1",
                      userRoleFilter === 'staff' 
                        ? "bg-emerald-700 text-white shadow-xs" 
                        : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                    )}
                  >
                    <HardHat className="w-3 h-3" />
                    Staff
                  </button>
                </div>
              </div>

              {/* Users Grid */}
              {(() => {
                const searchLower = removeVietnameseTones(userSearchTerm.toLowerCase().trim());
                const filtered = (appUsers || []).filter(u => {
                  const roleKey = u.role || 'staff';
                  if (userRoleFilter === 'pending') {
                    if (u.status !== 'pending') return false;
                  } else if (userRoleFilter !== 'all' && roleKey !== userRoleFilter) {
                    return false;
                  }
                  if (!searchLower) return true;
                  const targetStr = removeVietnameseTones(`${u.displayName || ''} ${u.email || ''}`).toLowerCase();
                  return targetStr.includes(searchLower);
                });

                if (filtered.length === 0) {
                  return (
                    <div className="text-center py-12 bg-gray-50 rounded-2xl border border-dashed border-gray-200 text-gray-500">
                      <UserIcon className="w-10 h-10 mx-auto text-gray-300 mb-2" />
                      <p className="font-semibold text-sm">Không tìm thấy tài khoản nhân sự phù hợp.</p>
                      <p className="text-xs text-gray-400 mt-1">Thử đổi từ khóa tìm kiếm hoặc lọc vai trò khác.</p>
                    </div>
                  );
                }

                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filtered.map(u => {
                      const isOwner = isOwnerEmail(u.email);
                      const currentRoleKey = isOwner ? 'admin' : (u.role || 'staff');
                      const roleMeta = getRoleInfo(currentRoleKey);
                      const userStatus = isOwner ? 'active' : (u.status || 'active');
                      
                      return (
                        <div 
                          key={u.id} 
                          className="p-5 border border-gray-200 rounded-2xl bg-white shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between gap-4"
                        >
                          <div>
                            {/* Card Top: Avatar & Details */}
                            <div className="flex items-start justify-between gap-3 mb-3">
                              <div className="flex items-center gap-3">
                                <div className={cn(
                                  "w-11 h-11 rounded-xl flex items-center justify-center font-bold text-white shadow-xs shrink-0 text-base",
                                  currentRoleKey === 'admin' ? "bg-gradient-to-tr from-purple-600 to-indigo-600" :
                                  currentRoleKey === 'manager' ? "bg-gradient-to-tr from-blue-600 to-cyan-600" :
                                  "bg-gradient-to-tr from-emerald-600 to-teal-600"
                                )}>
                                  {u.displayName?.charAt(0).toUpperCase() || u.email?.charAt(0).toUpperCase() || 'U'}
                                </div>
                                <div className="min-w-0">
                                  <h5 className="font-bold text-gray-900 text-sm truncate flex items-center gap-1.5">
                                    {u.displayName || u.email?.split('@')[0]}
                                    {isOwner && (
                                      <span className="text-[10px] bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.2 rounded font-bold">
                                        Chủ sở hữu
                                      </span>
                                    )}
                                  </h5>
                                  <p className="text-xs text-gray-500 truncate" title={u.email || ''}>
                                    {u.email}
                                  </p>
                                </div>
                              </div>

                              {/* Delete button (only if not owner) */}
                              {!isOwner && (
                                <button
                                  onClick={() => {
                                    setConfirmDialog({
                                      isOpen: true,
                                      title: 'Xóa tài khoản?',
                                      message: `Bạn có chắc chắn muốn xóa tài khoản ${u.email}? Hành động này không thể hoàn tác.`,
                                      onConfirm: async () => {
                                        try {
                                          await deleteDoc(doc(db, 'users', u.id));
                                          setUserSuccessMessage(`Đã xóa tài khoản ${u.email}`);
                                          setTimeout(() => setUserSuccessMessage(null), 3000);
                                        } catch (err: any) {
                                          alert(`Lỗi: ${err.message}`);
                                        }
                                        setConfirmDialog(p => ({ ...p, isOpen: false }));
                                      }
                                    });
                                  }}
                                  className="text-gray-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 transition-colors"
                                  title="Xóa tài khoản"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>

                            {/* Current Role Badge & Status */}
                            <div className="mb-3 space-y-1.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={cn(
                                  "inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border",
                                  roleMeta.badgeClass
                                )}>
                                  {currentRoleKey === 'admin' && <Crown className="w-3.5 h-3.5" />}
                                  {currentRoleKey === 'manager' && <Briefcase className="w-3.5 h-3.5" />}
                                  {currentRoleKey === 'staff' && <HardHat className="w-3.5 h-3.5" />}
                                  {roleMeta.name}
                                </span>

                                {!isOwner && (
                                  <span className={cn(
                                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border",
                                    userStatus === 'pending' ? "bg-amber-50 text-amber-800 border-amber-300" :
                                    userStatus === 'blocked' ? "bg-red-50 text-red-800 border-red-300" :
                                    "bg-emerald-50 text-emerald-800 border-emerald-200"
                                  )}>
                                    {userStatus === 'pending' ? '⏳ Chờ kích hoạt' : userStatus === 'blocked' ? '🚫 Đã khóa' : '🟢 Hoạt động'}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-gray-500 line-clamp-1">
                                {roleMeta.scope}
                              </p>
                            </div>

                            {/* Allowed Task Groups Section */}
                            <div className="pt-2.5 border-t border-gray-100">
                              <div className="flex items-center justify-between mb-1.5">
                                <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1">
                                  <Layers className="w-3 h-3 text-blue-600" /> Loại công việc:
                                </label>
                                <button
                                  onClick={() => {
                                    setEditingTaskGroupsUser(u);
                                    setTempSelectedTaskGroups(u.allowedTaskGroupIds || taskGroups.map(tg => tg.id));
                                  }}
                                  className="text-[11px] text-blue-600 hover:text-blue-800 font-semibold hover:underline"
                                >
                                  Cấu hình ({u.allowedTaskGroupIds && u.allowedTaskGroupIds.length > 0 ? `${u.allowedTaskGroupIds.length}/${taskGroups.length}` : 'Tất cả'})
                                </button>
                              </div>

                              <div className="flex flex-wrap gap-1">
                                {!u.allowedTaskGroupIds || u.allowedTaskGroupIds.length === 0 ? (
                                  <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200 font-medium">
                                    ✓ Được làm tất cả ({taskGroups.length} loại CV)
                                  </span>
                                ) : (
                                  u.allowedTaskGroupIds.map(tgId => {
                                    const tgObj = taskGroups.find(t => t.id === tgId);
                                    return (
                                      <span key={tgId} className="text-[10px] bg-emerald-50 text-emerald-800 px-1.5 py-0.5 rounded border border-emerald-200 font-medium">
                                        {tgObj?.name || tgId}
                                      </span>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Role Selection & Status Controls */}
                          <div className="pt-3 border-t border-gray-100 space-y-2.5">
                            <div>
                              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                                Chuyển vai trò
                              </label>
                              <select
                                disabled={isOwner}
                                className={cn(
                                  "w-full border rounded-xl py-2 px-3 text-xs sm:text-sm font-semibold outline-none transition-all shadow-2xs",
                                  isOwner 
                                    ? "bg-gray-100 text-gray-500 border-gray-200 cursor-not-allowed" 
                                    : "bg-white text-gray-800 border-gray-300 focus:ring-2 focus:ring-blue-500 hover:border-gray-400"
                                )}
                                value={currentRoleKey}
                                onChange={async (e) => {
                                  const newRole = e.target.value;
                                  try {
                                    const userRef = doc(db, 'users', u.id);
                                    await updateDoc(userRef, { role: newRole });
                                    setUserSuccessMessage(`Đã cập nhật vai trò cho ${u.displayName || u.email} thành ${getRoleInfo(newRole).name}!`);
                                    setTimeout(() => setUserSuccessMessage(null), 3500);
                                  } catch (err: any) {
                                    alert(`Có lỗi xảy ra: ${err.message}`);
                                  }
                                }}
                              >
                                <option value="admin">👑 Quản trị viên (Admin)</option>
                                <option value="manager">💼 Quản lý (Manager)</option>
                                <option value="staff">🛠️ Kỹ sư hiện trường (Staff)</option>
                                {(roles || []).filter(r => !['admin', 'manager', 'staff'].includes(r.id)).map(r => (
                                  <option key={r.id} value={r.id}>{r.name}</option>
                                ))}
                              </select>
                            </div>

                            {/* Status switch */}
                            {!isOwner && (
                              <div className="flex items-center justify-between pt-1">
                                <span className="text-[11px] font-medium text-gray-500">Trạng thái:</span>
                                <select
                                  value={userStatus}
                                  onChange={(e) => handleUpdateUserStatus(u.id, e.target.value as any)}
                                  className="text-xs font-semibold py-1 px-2 border rounded-lg bg-gray-50 border-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                >
                                  <option value="active">🟢 Đang hoạt động</option>
                                  <option value="pending">⏳ Chờ duyệt</option>
                                  <option value="blocked">🚫 Tạm khóa</option>
                                </select>
                              </div>
                            )}

                            {isOwner && (
                              <p className="text-[10px] text-amber-600 mt-1 font-medium">
                                * Tài khoản Chủ sở hữu mặc định giữ toàn quyền Admin.
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Add User Modal */}
              <AnimatePresence>
                {isAddingUser && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-xs">
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl border border-gray-100"
                    >
                      <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-2">
                          <UserPlus className="w-5 h-5 text-blue-600" />
                          <h3 className="text-lg font-bold text-gray-900">Thêm Tài khoản Nhân sự</h3>
                        </div>
                        <button onClick={() => setIsAddingUser(false)} className="text-gray-400 hover:text-gray-600 p-1">
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                            Email Google / Đăng nhập <span className="text-red-500">*</span>
                          </label>
                          <Input 
                            value={newUserEmail} 
                            onChange={e => setNewUserEmail(e.target.value)} 
                            placeholder="vd: kysu.nam@gmail.com" 
                            type="email"
                            className="text-sm font-medium"
                          />
                          <p className="text-[11px] text-gray-500 mt-1">
                            Nhân viên dùng email này để đăng nhập Google vào ứng dụng.
                          </p>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                            Họ và Tên hiển thị
                          </label>
                          <Input 
                            value={newUserName} 
                            onChange={e => setNewUserName(e.target.value)} 
                            placeholder="vd: Nguyễn Văn Nam" 
                            className="text-sm font-medium"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                            Vai trò phân quyền <span className="text-red-500">*</span>
                          </label>
                          <div className="space-y-2">
                            <label className={cn(
                              "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all",
                              newUserRole === 'staff' ? "border-emerald-500 bg-emerald-50/50" : "border-gray-200 hover:bg-gray-50"
                            )}>
                              <input 
                                type="radio" 
                                name="newRole" 
                                value="staff" 
                                checked={newUserRole === 'staff'} 
                                onChange={() => setNewUserRole('staff')}
                                className="mt-1 text-emerald-600 focus:ring-emerald-500"
                              />
                              <div>
                                <div className="font-bold text-xs text-gray-900 flex items-center gap-1">
                                  <HardHat className="w-3.5 h-3.5 text-emerald-600" />
                                  Kỹ sư hiện trường (Staff) - Khuyến nghị
                                </div>
                                <div className="text-[11px] text-gray-500 mt-0.5">
                                  Xem trạm cá nhân được giao, dẫn đường GPS, check-in và điền báo cáo khảo sát.
                                </div>
                              </div>
                            </label>

                            <label className={cn(
                              "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all",
                              newUserRole === 'manager' ? "border-blue-500 bg-blue-50/50" : "border-gray-200 hover:bg-gray-50"
                            )}>
                              <input 
                                type="radio" 
                                name="newRole" 
                                value="manager" 
                                checked={newUserRole === 'manager'} 
                                onChange={() => setNewUserRole('manager')}
                                className="mt-1 text-blue-600 focus:ring-blue-500"
                              />
                              <div>
                                <div className="font-bold text-xs text-gray-900 flex items-center gap-1">
                                  <Briefcase className="w-3.5 h-3.5 text-blue-600" />
                                  Quản lý vận hành (Manager)
                                </div>
                                <div className="text-[11px] text-gray-500 mt-0.5">
                                  Lập kế hoạch tháng/ngày, điều phối giao trạm cho kỹ sư, xem và xuất báo cáo.
                                </div>
                              </div>
                            </label>

                            <label className={cn(
                              "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all",
                              newUserRole === 'admin' ? "border-purple-500 bg-purple-50/50" : "border-gray-200 hover:bg-gray-50"
                            )}>
                              <input 
                                type="radio" 
                                name="newRole" 
                                value="admin" 
                                checked={newUserRole === 'admin'} 
                                onChange={() => setNewUserRole('admin')}
                                className="mt-1 text-purple-600 focus:ring-purple-500"
                              />
                              <div>
                                <div className="font-bold text-xs text-gray-900 flex items-center gap-1">
                                  <Crown className="w-3.5 h-3.5 text-purple-600" />
                                  Quản trị viên (Admin)
                                </div>
                                <div className="text-[11px] text-gray-500 mt-0.5">
                                  Toàn quyền hệ thống: quản lý tài khoản, vai trò, chiến dịch và xoá dữ liệu.
                                </div>
                              </div>
                            </label>
                          </div>
                        </div>

                        {/* Allowed Task Groups Configuration in Add Modal */}
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                              Loại công việc được phép ({newUserAllowedTaskGroups.length === 0 ? 'Tất cả' : `${newUserAllowedTaskGroups.length}/${taskGroups.length}`})
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                if (newUserAllowedTaskGroups.length === taskGroups.length) {
                                  setNewUserAllowedTaskGroups([]);
                                } else {
                                  setNewUserAllowedTaskGroups(taskGroups.map(tg => tg.id));
                                }
                              }}
                              className="text-[11px] text-blue-600 hover:text-blue-800 font-semibold"
                            >
                              {newUserAllowedTaskGroups.length === taskGroups.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                            </button>
                          </div>
                          <p className="text-[11px] text-gray-500 mb-2">
                            Nhân viên chỉ nhìn thấy và thực hiện các biểu mẫu tương ứng với các loại công việc được tích chọn.
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto p-2 bg-gray-50 rounded-xl border border-gray-200">
                            {taskGroups.map(tg => {
                              const isChecked = newUserAllowedTaskGroups.includes(tg.id);
                              return (
                                <label 
                                  key={tg.id} 
                                  className={cn(
                                    "flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors",
                                    isChecked ? "bg-white border-blue-400 font-bold text-blue-900 shadow-2xs" : "bg-white/60 border-gray-200 text-gray-600 hover:bg-white"
                                  )}
                                >
                                  <input 
                                    type="checkbox" 
                                    checked={isChecked}
                                    onChange={() => {
                                      if (isChecked) {
                                        setNewUserAllowedTaskGroups(prev => prev.filter(id => id !== tg.id));
                                      } else {
                                        setNewUserAllowedTaskGroups(prev => [...prev, tg.id]);
                                      }
                                    }}
                                    className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                                  />
                                  <span className="truncate">{tg.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>

                        {/* Account Status in Add Modal */}
                        <div>
                          <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                            Trạng thái kích hoạt ban đầu
                          </label>
                          <select 
                            value={newUserStatus}
                            onChange={(e) => setNewUserStatus(e.target.value as any)}
                            className="w-full text-xs font-semibold py-2 px-3 border rounded-xl bg-white border-gray-300"
                          >
                            <option value="active">🟢 Kích hoạt ngay (Nhân sự vào dùng được luôn)</option>
                            <option value="pending">⏳ Chờ duyệt (Nhân sự đăng nhập phải chờ Admin duyệt)</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
                        <Button variant="outline" onClick={() => setIsAddingUser(false)}>Hủy</Button>
                        <Button onClick={handleAddUser} className="bg-blue-600 hover:bg-blue-700 text-white font-bold">
                          Lưu tài khoản
                        </Button>
                      </div>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>

              {/* Configure Allowed Task Groups Modal for Existing Users */}
              <AnimatePresence>
                {editingTaskGroupsUser && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-xs">
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-xl border border-gray-100 max-h-[90vh] flex flex-col"
                    >
                      <div className="flex justify-between items-center mb-3">
                        <div className="flex items-center gap-2">
                          <Layers className="w-5 h-5 text-blue-600" />
                          <h3 className="text-base sm:text-lg font-bold text-gray-900">
                            Phân quyền loại công việc
                          </h3>
                        </div>
                        <button onClick={() => setEditingTaskGroupsUser(null)} className="text-gray-400 hover:text-gray-600 p-1">
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      <div className="bg-blue-50/70 p-3 rounded-xl border border-blue-200/80 mb-4">
                        <p className="text-xs text-blue-900 font-medium">
                          Nhân viên: <strong>{editingTaskGroupsUser.displayName || editingTaskGroupsUser.email}</strong>
                        </p>
                        <p className="text-[11px] text-blue-700 mt-1">
                          Khi nhân sự này vào làm báo cáo (Khảo sát), họ chỉ nhìn thấy và điền các biểu mẫu cho những loại công việc được chọn dưới đây.
                        </p>
                      </div>

                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-gray-700">
                          Đã chọn: {tempSelectedTaskGroups.length}/{taskGroups.length} loại công việc
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setTempSelectedTaskGroups(taskGroups.map(tg => tg.id))}
                            className="text-xs text-blue-600 hover:underline font-semibold"
                          >
                            Chọn tất cả
                          </button>
                          <span className="text-gray-300">|</span>
                          <button
                            type="button"
                            onClick={() => setTempSelectedTaskGroups([])}
                            className="text-xs text-gray-500 hover:underline"
                          >
                            Bỏ chọn hết
                          </button>
                        </div>
                      </div>

                      <div className="space-y-2 overflow-y-auto flex-1 pr-1 border border-gray-100 p-2 rounded-xl bg-gray-50/50">
                        {taskGroups.map(tg => {
                          const isSelected = tempSelectedTaskGroups.includes(tg.id);
                          const hasEquipment = tg.modules?.includes('EQUIPMENT') ?? (tg.requiresEquipment !== false);
                          const hasInfra = tg.modules?.includes('INFRASTRUCTURE');
                          const hasPhoto = tg.modules?.includes('PHOTO') ?? true;

                          return (
                            <label
                              key={tg.id}
                              className={cn(
                                "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all",
                                isSelected ? "bg-white border-blue-400 shadow-xs" : "bg-white/60 border-gray-200 hover:bg-white text-gray-600"
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  if (isSelected) {
                                    setTempSelectedTaskGroups(prev => prev.filter(id => id !== tg.id));
                                  } else {
                                    setTempSelectedTaskGroups(prev => [...prev, tg.id]);
                                  }
                                }}
                                className="mt-1 rounded text-blue-600 focus:ring-blue-500 w-4 h-4 shrink-0"
                              />
                              <div className="min-w-0 flex-1">
                                <div className={cn("text-xs sm:text-sm font-bold flex items-center gap-2", isSelected ? "text-blue-900" : "text-gray-800")}>
                                  <span>{tg.name}</span>
                                </div>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {hasEquipment && (
                                    <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.2 rounded border border-indigo-200">
                                      📦 Vật tư ({tg.workspace || 'Full'})
                                    </span>
                                  )}
                                  {hasInfra && (
                                    <span className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.2 rounded border border-purple-200">
                                      📊 Thông số kỹ thuật
                                    </span>
                                  )}
                                  {hasPhoto && (
                                    <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.2 rounded border border-amber-200">
                                      📷 Ảnh chụp
                                    </span>
                                  )}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>

                      <div className="flex justify-end gap-3 mt-4 pt-3 border-t border-gray-100">
                        <Button variant="outline" onClick={() => setEditingTaskGroupsUser(null)}>
                          Hủy
                        </Button>
                        <Button onClick={handleSaveUserTaskGroups} className="bg-blue-600 hover:bg-blue-700 text-white font-bold">
                          Lưu phân quyền công việc
                        </Button>
                      </div>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* TAB: ROLES */}
          {activeConfigTab === 'roles' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center bg-blue-50 p-4 rounded-xl border border-blue-100 mb-6">
                <div>
                  <h4 className="font-bold text-blue-900">Quản lý Vai trò (Roles)</h4>
                  <p className="text-sm text-blue-700/70 mt-1">Định nghĩa các vai trò và phân quyền tương ứng</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="border-blue-200 text-blue-700 hover:bg-blue-100 bg-white" onClick={handleSeedRoles}>
                    Tạo Roles mẫu
                  </Button>
                  <Button onClick={() => { setNewRoleForm({ name: '', description: '', permissions: [] }); setIsAddingRole(true); }}>
                    <Plus className="w-4 h-4 mr-2" />
                    Thêm Vai trò
                  </Button>
                </div>
              </div>

              {isAddingRole && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
                  <div className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-xl max-h-[90vh] overflow-y-auto">
                    <h3 className="text-lg font-bold text-gray-900 mb-4">{newRoleForm.id ? 'Sửa Vai trò' : 'Thêm Vai trò mới'}</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Tên Vai trò <span className="text-red-500">*</span></label>
                        <Input value={newRoleForm.name || ''} onChange={e => setNewRoleForm({...newRoleForm, name: e.target.value})} placeholder="VD: Quản lý khu vực" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả</label>
                        <Input value={newRoleForm.description || ''} onChange={e => setNewRoleForm({...newRoleForm, description: e.target.value})} placeholder="Mô tả quyền hạn" />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Quyền hạn (Permissions) <span className="text-red-500">*</span></label>
                        <div className="border border-gray-200 rounded-xl p-3 max-h-[300px] overflow-y-auto space-y-2">
                          {APP_PERMISSIONS.map(permission => {
                            const hasPermission = newRoleForm.permissions?.includes(permission.id);
                            return (
                              <label key={permission.id} className="flex items-start gap-2 cursor-pointer group">
                                <div className="pt-0.5">
                                  <input 
                                    type="checkbox"
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                                    checked={hasPermission}
                                    onChange={(e) => {
                                      let currentPermissions = newRoleForm.permissions || [];
                                      if (e.target.checked) {
                                        setNewRoleForm({...newRoleForm, permissions: [...currentPermissions, permission.id]});
                                      } else {
                                        setNewRoleForm({...newRoleForm, permissions: currentPermissions.filter(p => p !== permission.id)});
                                      }
                                    }}
                                  />
                                </div>
                                <span className="text-sm text-gray-700 group-hover:text-blue-700 transition-colors">{permission.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex justify-end gap-3 mt-6">
                      <Button variant="outline" onClick={() => setIsAddingRole(false)}>Hủy</Button>
                      <Button
                        onClick={async () => {
                          if (!newRoleForm.name) return alert('Vui lòng nhập tên vai trò');
                          try {
                            if (newRoleForm.id) {
                              await updateDoc(doc(db, 'roles', newRoleForm.id), {
                                name: newRoleForm.name,
                                description: newRoleForm.description,
                                permissions: newRoleForm.permissions,
                              });
                            } else {
                              await addDoc(collection(db, 'roles'), {
                                name: newRoleForm.name,
                                description: newRoleForm.description,
                                permissions: newRoleForm.permissions,
                                createdAt: new Date().toISOString()
                              });
                            }
                            setIsAddingRole(false);
                            setNewRoleForm({ name: '', description: '', permissions: [] });
                          } catch (err: any) {
                            alert('Lỗi: ' + err.message);
                          }
                        }}
                      >
                        Lưu Vai trò
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {(roles || []).map(r => (
                  <div key={r.id} className="p-4 border border-gray-200 rounded-xl bg-white shadow-sm flex flex-col gap-2">
                    <div className="flex justify-between items-start">
                      <div className="font-bold text-gray-900">{r.name}</div>
                      <div className="flex gap-2">
                        <button onClick={() => { setNewRoleForm(r); setIsAddingRole(true); }} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg">
                          <Settings2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => {
                          setConfirmDialog({
                            isOpen: true,
                            title: 'Xóa vai trò?',
                            message: `Bạn có chắc chắn muốn xóa vai trò "${r.name}"? Chỉ có thể xóa nếu không có người dùng nào đang gán vai trò này.`,
                            onConfirm: async () => {
                              try {
                                // check if any users are using this role
                                const hasUsers = appUsers.some(u => u.role === r.id);
                                if(hasUsers) {
                                  alert('Không thể xóa vai trò đang có người sử dụng. Hãy đổi vai trò cho họ trước.');
                                  return;
                                }
                                await deleteDoc(doc(db, 'roles', r.id));
                                setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                              } catch (err: any) {
                                alert('Lỗi: ' + err.message);
                              }
                            }
                          })
                        }} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {r.description && <div className="text-sm text-gray-500">{r.description}</div>}
                    <div className="mt-2 text-xs text-blue-700 bg-blue-50 px-2 py-1 rounded inline-block w-fit">
                      {r.permissions?.length || 0} quyền
                    </div>
                    <div className="text-xs text-gray-500 mt-2 line-clamp-3">
                      {r.permissions?.map(p => APP_PERMISSIONS.find(ap => ap.id === p)?.label || p).join(', ')}
                    </div>
                  </div>
                ))}
                {(!roles || roles.length === 0) && (
                  <div className="col-span-full text-center py-8 text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                    Chưa có vai trò nào được tạo. Nhấn "Thêm vai trò" để bắt đầu thiết lập.
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
        {showCampaignModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
              <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <h3 className="text-lg font-bold text-gray-900">{editingCampaign?.id ? 'Sửa Đợt công việc' : 'Thêm Đợt công việc mới'}</h3>
                <button 
                  onClick={() => setShowCampaignModal(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <span className="text-2xl leading-none">&times;</span>
                </button>
              </div>
              
              <form 
                className="p-5 space-y-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!editingCampaign?.name) return;
                  
                  if (editingCampaign.id) {
                    const { id, ...data } = editingCampaign;
                    await updateDoc(doc(db, 'campaigns', id), data);
                  } else {
                    await addDoc(collection(db, 'campaigns'), { 
                      ...editingCampaign, 
                      status: 'active', 
                      createdAt: new Date().toISOString() 
                    });
                  }
                  setShowCampaignModal(false);
                }}
              >
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tên Điệp vụ / Đợt công việc <span className="text-red-500">*</span></label>
                  <Input 
                    required
                    placeholder="VD: Khảo sát trạm HN - T5/2026"
                    value={editingCampaign?.name || ''}
                    onChange={(e: any) => setEditingCampaign({ ...editingCampaign, name: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Bắt đầu</label>
                    <Input 
                      type="date"
                      value={editingCampaign?.startDate || ''}
                      onChange={(e: any) => setEditingCampaign({ ...editingCampaign, startDate: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Kết thúc dự kiến</label>
                    <Input 
                      type="date"
                      value={editingCampaign?.endDate || ''}
                      onChange={(e: any) => setEditingCampaign({ ...editingCampaign, endDate: e.target.value })}
                    />
                  </div>
                </div>

                {editingCampaign?.id && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Trạng thái</label>
                    <select
                      className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      value={editingCampaign.status}
                      onChange={(e) => setEditingCampaign({ ...editingCampaign, status: e.target.value as 'active' | 'closed' })}
                    >
                      <option value="active">Đang mở</option>
                      <option value="closed">Đã đóng</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ghi chú thêm</label>
                  <textarea
                    className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none min-h-[80px]"
                    placeholder="Mô tả hoặc yêu cầu cụ thể cho đợt này..."
                    value={editingCampaign?.notes || ''}
                    onChange={(e) => setEditingCampaign({ ...editingCampaign, notes: e.target.value })}
                  ></textarea>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 mt-6">
                  <Button type="button" variant="secondary" onClick={() => setShowCampaignModal(false)}>Hủy</Button>
                  <Button type="submit">Lưu lại</Button>
                </div>
              </form>
            </div>
          </div>
        )}

      </Card>
    </motion.div>
  );
}
