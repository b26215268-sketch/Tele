import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  where, 
  orderBy,
  Timestamp,
  getDoc,
  getDocs,
  getDocFromServer,
  setDoc,
  arrayUnion
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged,
  User,
  updateProfile
} from 'firebase/auth';
import { db, auth } from './firebase';
import { Station, Report, Tab, ValidationWarning, EquipmentDict, TaskGroup, ReportDetail, SurveyParameter, Campaign, AppUser, AppRole, Assignment } from './types';
import { hasPermission, isManagerOrAdmin, DEFAULT_BUILTIN_ROLES, isOwnerEmail } from './lib/permissions';
import { 
  MapPin, 
  Phone, 
  User as UserIcon, 
  Plus, 
  Trash2, 
  Route, 
  ClipboardList, 
  History, 
  LogOut, 
  ChevronRight,
  Calendar,
  CheckCircle2,
  Clock,
  Navigation,
  Search,
  ArrowRight,
  Menu,
  X,
  Upload,
  LayoutDashboard,
  Map,
  List,
  ChevronDown,
  Eye,
  EyeOff,
  ClipboardCheck,
  Share2,
  Copy,
  Mail,
  MessageCircle,
  Download,
  FileSpreadsheet,
  Settings,
  Award,
  Bell,
  QrCode,
  Building2,
  PlusCircle,
  Receipt,
  CarFront,
  Settings2,
  Car,
  Home,
  Cloud,
  FileText,
  BookOpen,
  Wallet,
  Shield,
  Database,
  Zap,
  Ticket,
  Percent,
  Star,
  Activity,
  Layers,
  Save
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, startOfMonth, endOfMonth, isSameMonth, parseISO, startOfWeek, endOfWeek, isWithinInterval } from 'date-fns';
import { cn } from './lib/utils';
import { GoogleGenAI } from "@google/genai";
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, Tooltip as LeafletTooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

import { OperationType, FirestoreErrorInfo, handleFirestoreError } from './lib/firebase-utils';

// Fix for default marker icon in react-leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

import { Button } from './components/ui/Button';
import { Input } from './components/ui/Input';
import { Card } from './components/ui/Card';
import { getStationIcon, formatStationName } from './lib/constants';

// --- Components ---

import { MapUpdater } from './components/MapComponents';
import { ReportsTab } from './pages/ReportsTab';
import { StationsTab } from './pages/StationsTab';
import { PlannerTab } from './pages/PlannerTab';
import { AdminTab } from './pages/AdminTab';
import { DashboardTab } from './pages/DashboardTab';
import { ReportManagementTab } from './pages/ReportManagementTab';

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('all');
  const [stations, setStations] = useState<Station[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [equipmentDict, setEquipmentDict] = useState<EquipmentDict[]>([]);
  const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([]);
  const [workspaces, setWorkspaces] = useState<{id: string, name: string}[]>([]);
  const [surveyParameters, setSurveyParameters] = useState<SurveyParameter[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<ValidationWarning[] | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCreateReportModalOpen, setIsCreateReportModalOpen] = useState(false);

  // Auth & User Management
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [currentAppUser, setCurrentAppUser] = useState<AppUser | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);

  const [prefilledStationId, setPrefilledStationId] = useState<string>('');
  const [prefilledAssignmentId, setPrefilledAssignmentId] = useState<string>('');

  const [simulatedRole, setSimulatedRole] = useState<'admin' | 'manager' | 'staff' | null>(null);

  // Real user permission vs Preview simulation
  const isActualAdmin = isOwnerEmail(user?.email) || currentAppUser?.role === 'admin';
  const realRole = isActualAdmin ? 'admin' : (currentAppUser?.role === 'manager' ? 'manager' : 'staff');

  const effectiveRole = isActualAdmin && simulatedRole ? simulatedRole : realRole;
  const effectiveIsAdmin = effectiveRole === 'admin';
  const effectiveIsManager = effectiveRole === 'manager';
  const effectiveIsStaff = effectiveRole === 'staff';
  const effectiveIsAdminOrManager = effectiveIsAdmin || effectiveIsManager;

  const effectiveAppUser = useMemo<AppUser | null>(() => {
    if (!currentAppUser) return null;
    return {
      ...currentAppUser,
      role: effectiveRole
    };
  }, [currentAppUser, effectiveRole]);

  // Helper to check permission
  const checkPermission = (permId: string) => {
    if (effectiveIsAdmin) return true;
    return hasPermission(user?.email, effectiveAppUser, roles, permId);
  };

  const hasAdminAccess = effectiveIsAdmin;
  const canAccessPlanner = true;
  const canAccessReports = effectiveIsAdminOrManager;

  // Auto-redirect unauthorized users from restricted tabs
  useEffect(() => {
    if (activeTab === 'admin' && !hasAdminAccess) {
      setActiveTab('dashboard');
    }
    if (activeTab === 'reportManager' && !canAccessReports) {
      setActiveTab('dashboard');
    }
  }, [activeTab, hasAdminAccess, canAccessReports]);

  // Auto-reset selected campaign if it gets closed
  useEffect(() => {
    if (selectedCampaignId !== 'all') {
      const camp = campaigns.find(c => c.id === selectedCampaignId);
      if (!camp || camp.status === 'closed') {
        setSelectedCampaignId('all');
      }
    }
  }, [campaigns, selectedCampaignId]);

  // Auto-select latest active campaign when loaded
  useEffect(() => {
    if (campaigns.length > 0 && selectedCampaignId === 'all') {
      const activeCampaigns = campaigns.filter(c => c.status === 'active');
      if (activeCampaigns.length > 0) {
        // Sort by creation date descending
        activeCampaigns.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setSelectedCampaignId(activeCampaigns[0].id);
      }
    }
  }, [campaigns]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      try {
        setUser(u);
        if (u) {
          const userRef = doc(db, 'users', u.uid);
          const userSnap = await getDoc(userRef);
          const emailLower = u.email?.toLowerCase();
          const isOwner = isOwnerEmail(emailLower);

          if (!userSnap.exists()) {
            // Check if there is an existing record created by admin by email
            let existingRole = isOwner ? 'admin' : 'staff';
            let existingPermissions: string[] | undefined = undefined;
            let existingAllowedTaskGroupIds: string[] | undefined = undefined;
            let existingStatus: 'active' | 'pending' | 'blocked' = isOwner ? 'active' : 'pending';
            let existingDisplayName = u.displayName || (emailLower?.includes('manh') ? 'Kỹ sư Mạnh' : u.email?.split('@')[0]) || 'Kỹ sư';
            let isPreAdded = false;

            if (emailLower) {
              try {
                const q = query(collection(db, 'users'), where('email', '==', emailLower));
                const querySnap = await getDocs(q);
                if (!querySnap.empty) {
                  const matchedDoc = querySnap.docs[0];
                  const data = matchedDoc.data() as AppUser;
                  isPreAdded = true;
                  if (data.role) existingRole = data.role;
                  if (data.permissions) existingPermissions = data.permissions;
                  if (data.displayName) existingDisplayName = data.displayName;
                  if (data.allowedTaskGroupIds) existingAllowedTaskGroupIds = data.allowedTaskGroupIds;
                  existingStatus = data.status || 'active'; // Pre-added accounts by admin default to active
                  if (matchedDoc.id !== u.uid) {
                    try {
                      await deleteDoc(matchedDoc.ref);
                    } catch (e) {
                      console.warn("Could not delete legacy placeholder user doc:", e);
                    }
                  }
                }
              } catch (queryErr) {
                console.warn("Could not query legacy user doc by email:", queryErr);
              }
            }

            // Unknown accounts not created beforehand by Admin and not Owner are put in Pending state
            if (!isOwner && !isPreAdded) {
              existingStatus = 'pending';
            }

            const newUser: AppUser = {
              id: u.uid,
              email: u.email,
              displayName: existingDisplayName,
              role: existingRole,
              status: existingStatus,
              ...(existingAllowedTaskGroupIds ? { allowedTaskGroupIds: existingAllowedTaskGroupIds } : {}),
              ...(existingPermissions ? { permissions: existingPermissions } : {}),
              createdAt: new Date().toISOString()
            };
            await setDoc(userRef, newUser);
            setCurrentAppUser(newUser);
          } else {
            const existingData = userSnap.data() as AppUser;
            let needsUpdate = false;
            const updatePayload: Partial<AppUser> = {};

            // Auto-promote owner account so they always have admin module access & active status
            if (isOwner) {
              if (existingData.role !== 'admin') {
                updatePayload.role = 'admin';
                existingData.role = 'admin';
                needsUpdate = true;
              }
              if (existingData.status !== 'active') {
                updatePayload.status = 'active';
                existingData.status = 'active';
                needsUpdate = true;
              }
            } else if (!existingData.status) {
              // Legacy accounts default to active
              updatePayload.status = 'active';
              existingData.status = 'active';
              needsUpdate = true;
            }

            // Backwards compatibility: treat worker as staff
            if (existingData.role === 'worker') {
              updatePayload.role = 'staff';
              existingData.role = 'staff';
              needsUpdate = true;
            }

            if (needsUpdate) {
              await updateDoc(userRef, updatePayload);
            }
            setCurrentAppUser(existingData);
          }
        } else {
          setCurrentAppUser(null);
        }
      } catch (err) {
        console.error("Auth sync error:", err);
        if (u) {
          const emailLower = u.email?.toLowerCase();
          const isOwner = isOwnerEmail(emailLower);
          setCurrentAppUser({
            id: u.uid,
            email: u.email,
            displayName: u.displayName || u.email?.split('@')[0] || 'Kỹ sư',
            role: isOwner ? 'admin' : 'staff',
            createdAt: new Date().toISOString()
          });
        }
      } finally {
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) return;
    const usersUnsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      const usersList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AppUser));
      setAppUsers(usersList);
      if (user) {
        const current = usersList.find(u => u.id === user.uid || (u.email && u.email.toLowerCase() === user.email?.toLowerCase()));
        if (current) setCurrentAppUser(current);
      }
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'users'));

    const rolesUnsubscribe = onSnapshot(collection(db, 'roles'), async (snapshot) => {
      if (snapshot.empty) {
        // Auto-seed default roles so roles collection is never empty
        for (const r of DEFAULT_BUILTIN_ROLES) {
          try {
            await setDoc(doc(db, 'roles', r.id), r);
          } catch (e) {
            console.warn("Could not auto-seed role:", r.id, e);
          }
        }
      } else {
        setRoles(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AppRole)));
      }
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'roles'));

    return () => {
      usersUnsubscribe();
      rolesUnsubscribe();
    };
  }, [user]);

  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const login = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error: any) {
      if (error.code !== 'auth/cancelled-popup-request') {
        console.error('Login failed:', error);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };
  const logout = () => signOut(auth);

  // Firestore Data
  useEffect(() => {
    if (!user) return;

    const campaignsUnsubscribe = onSnapshot(collection(db, 'campaigns'), (snapshot) => {
      setCampaigns(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Campaign)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'campaigns'));

    const stationsUnsubscribe = onSnapshot(collection(db, 'stations'), async (snapshot) => {
      if (snapshot.empty) {
        try {
          let campaignId = '';
          const campSnap = await getDocs(collection(db, 'campaigns'));
          if (campSnap.empty) {
            const campRef = await addDoc(collection(db, 'campaigns'), {
              name: 'Chiến dịch Khảo sát & Bảo dưỡng BTS 2026',
              description: 'Chiến dịch trọng điểm kiểm tra, nâng cấp hạ tầng viễn thông',
              status: 'active',
              startDate: '2026-01-01',
              endDate: '2026-12-31',
              createdAt: new Date().toISOString()
            });
            campaignId = campRef.id;
          } else {
            campaignId = campSnap.docs[0].id;
          }

          const todayStr = format(new Date(), 'yyyy-MM-dd');
          const sampleStations = [
            {
              name: 'Trạm BTS Kim Mã',
              infrastructureCode: 'HNI_0012',
              latitude: 21.0313,
              longitude: 105.8234,
              address: 'Số 182 Kim Mã, Ba Đình, Hà Nội',
              managerName: 'Kỹ sư Mạnh',
              managerPhone: '0912345678',
              department: 'Hà Nội',
              status: 'checked',
              campaignId,
              assigneeId: 'manh'
            },
            {
              name: 'Trạm BTS Hoàn Kiếm',
              infrastructureCode: 'HNI_0045',
              latitude: 21.0285,
              longitude: 105.8542,
              address: 'Số 15 Đinh Tiên Hoàng, Hoàn Kiếm, Hà Nội',
              managerName: 'Kỹ sư Mạnh',
              managerPhone: '0912345679',
              department: 'Hà Nội',
              status: 'unchecked',
              campaignId,
              assigneeId: 'manh'
            },
            {
              name: 'Trạm BTS Cầu Giấy',
              infrastructureCode: 'HNI_0089',
              latitude: 21.0362,
              longitude: 105.7905,
              address: 'Số 268 Cầu Giấy, Cầu Giấy, Hà Nội',
              managerName: 'Kỹ sư Mạnh',
              managerPhone: '0912345680',
              department: 'Hà Nội',
              status: 'unchecked',
              campaignId,
              assigneeId: 'manh'
            },
            {
              name: 'Trạm BTS Bến Thành',
              infrastructureCode: 'SGN_0102',
              latitude: 10.7725,
              longitude: 106.6980,
              address: 'Chợ Bến Thành, Lê Lợi, Bến Thành, Quận 1, TP. HCM',
              managerName: 'Kỹ sư Mạnh',
              managerPhone: '0908123456',
              department: 'TP.HCM',
              status: 'checked',
              campaignId,
              assigneeId: 'manh'
            },
            {
              name: 'Trạm BTS Landmark 81',
              infrastructureCode: 'SGN_0215',
              latitude: 10.7951,
              longitude: 106.7218,
              address: '720A Điện Biên Phủ, Phường 22, Bình Thạnh, TP. HCM',
              managerName: 'Kỹ sư Mạnh',
              managerPhone: '0908123457',
              department: 'TP.HCM',
              status: 'unchecked',
              campaignId,
              assigneeId: 'manh'
            },
            {
              name: 'Trạm BTS Cầu Rồng',
              infrastructureCode: 'DNG_0033',
              latitude: 16.0610,
              longitude: 108.2272,
              address: 'Đường Nguyễn Văn Linh, Hải Châu, Đà Nẵng',
              managerName: 'Kỹ sư Mạnh',
              managerPhone: '0905123456',
              department: 'Đà Nẵng',
              status: 'unchecked',
              campaignId,
              assigneeId: 'manh'
            }
          ];

          const createdStations = [];
          for (const s of sampleStations) {
            const docRef = await addDoc(collection(db, 'stations'), s);
            createdStations.push({ id: docRef.id, ...s });
          }

          const statuses: ('completed' | 'checked_in' | 'pending')[] = ['completed', 'checked_in', 'pending', 'checked_in', 'completed', 'pending'];
          for (let i = 0; i < createdStations.length; i++) {
            await addDoc(collection(db, 'assignments'), {
              stationId: createdStations[i].id,
              assigneeId: user?.uid || 'manh',
              assignedBy: 'admin',
              campaignId,
              taskGroupId: '',
              startDate: todayStr,
              deadline: todayStr,
              status: statuses[i],
              createdAt: new Date().toISOString()
            });
          }
        } catch (e) {
          console.error("Failed to seed initial stations", e);
        }
      } else {
        setStations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Station)));
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'stations');
    });

    const reportsUnsubscribe = onSnapshot(
      collection(db, 'reports'), 
      (snapshot) => {
        const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Report));
        list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        setReports(list);
      }, (error) => {
        console.warn('Reports listener notice:', error);
      }
    );

    const assignmentsUnsubscribe = onSnapshot(
      collection(db, 'assignments'),
      (snapshot) => {
        setAssignments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Assignment)));
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'assignments');
      }
    );

    const equipUnsubscribe = onSnapshot(collection(db, 'equipment_dictionary'), async (snapshot) => {
      if (snapshot.empty) {
        // Seed initial data if empty
        const initialEquipments: Omit<EquipmentDict, 'id'>[] = [
          { name: 'Khối Baseband', validSpaces: ['Indoor'] },
          { name: 'Khối Nguồn', validSpaces: ['Indoor'] },
          { name: 'Khối MU', validSpaces: ['Indoor'] },
          { name: 'Khối RF', validSpaces: ['Outdoor', 'Indoor'] },
          { name: 'RRU', validSpaces: ['Outdoor'] },
          { name: 'Anten', validSpaces: ['Outdoor'] },
          { name: 'Sợi quang', validSpaces: ['Indoor', 'Outdoor'] },
          { name: 'Jumper', validSpaces: ['Indoor', 'Outdoor'] },
          { name: 'Dây nguồn', validSpaces: ['Indoor', 'Outdoor'] },
          { name: 'Dây Jet', validSpaces: ['Indoor', 'Outdoor'] },
          { name: 'Dây tiếp đất', validSpaces: ['Indoor', 'Outdoor'] }
        ];
        try {
          for (const eq of initialEquipments) {
            await addDoc(collection(db, 'equipment_dictionary'), eq);
          }
        } catch (e) {
          console.error("Failed to seed equipment dictionary", e);
        }
      } else {
        const dict = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as EquipmentDict));
        setEquipmentDict(dict);
        
        // Ensure missing required items exist
        const requiredMissing = [];
        if (!dict.some(d => d.name.toLowerCase() === 'dây jet')) {
          requiredMissing.push({ name: 'Dây Jet', validSpaces: ['Indoor', 'Outdoor'] });
        }
        if (!dict.some(d => d.name.toLowerCase() === 'dây tiếp đất')) {
          requiredMissing.push({ name: 'Dây tiếp đất', validSpaces: ['Indoor', 'Outdoor'] });
        }
        if (requiredMissing.length > 0) {
          requiredMissing.forEach(eq => addDoc(collection(db, 'equipment_dictionary'), eq).catch(console.error));
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'equipment_dictionary');
    });

    const taskGroupUnsubscribe = onSnapshot(collection(db, 'task_groups'), async (snapshot) => {
      if (snapshot.empty) {
        const initialTaskGroups = [
          { name: 'Lắp đặt', modules: ['EQUIPMENT', 'NOTE'] }, 
          { name: 'Tích hợp', modules: ['EQUIPMENT', 'NOTE'] }, 
          { name: 'Sửa chữa', modules: ['EQUIPMENT', 'NOTE'] }, 
          { name: 'Khảo sát', modules: ['NOTE'] },
          { name: 'Thu hồi', modules: ['EQUIPMENT', 'NOTE'] }
        ];
        for (const tg of initialTaskGroups) {
          await addDoc(collection(db, 'task_groups'), tg);
        }
      } else {
        setTaskGroups(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as TaskGroup)));
      }
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'task_groups'));

    const workspacesUnsubscribe = onSnapshot(collection(db, 'workspaces'), async (snapshot) => {
      if (snapshot.empty) {
        const initialWorkspaces = [{ name: 'Indoor' }, { name: 'Outdoor' }];
        for (const ws of initialWorkspaces) {
          await addDoc(collection(db, 'workspaces'), ws);
        }
      } else {
        setWorkspaces(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as {id: string, name: string})));
      }
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'workspaces'));

    const surveyParamsUnsubscribe = onSnapshot(collection(db, 'survey_parameters'), (snapshot) => {
      setSurveyParameters(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SurveyParameter)).sort((a, b) => a.order - b.order));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'survey_parameters'));

    return () => {
      campaignsUnsubscribe();
      stationsUnsubscribe();
      reportsUnsubscribe();
      assignmentsUnsubscribe();
      equipUnsubscribe();
      taskGroupUnsubscribe();
      workspacesUnsubscribe();
      surveyParamsUnsubscribe();
    };
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6 text-center">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full"
        >
          <div className="bg-blue-600 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-8 shadow-lg shadow-blue-200">
            <Route className="text-white w-10 h-10" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Telecom Station Manager</h1>
          <p className="text-gray-600 mb-8">Quản lý trạm viễn thông, tối ưu hóa tuyến đường và báo cáo công việc hàng ngày.</p>
          <Button onClick={login} disabled={isLoggingIn} className="w-full py-4 text-lg">
            {isLoggingIn ? 'Đang mở đăng nhập...' : 'Đăng nhập với Google'}
          </Button>
        </motion.div>
      </div>
    );
  }

  // Pending approval screen: If the user logged in but has not been approved by Admin yet
  if (currentAppUser?.status === 'pending' && !isOwnerEmail(user.email)) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50 via-sky-50 to-gray-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-white rounded-3xl p-6 sm:p-8 shadow-xl border border-amber-200 text-center"
        >
          <div className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center mx-auto mb-5 text-amber-600">
            <Clock className="w-8 h-8 animate-pulse" />
          </div>
          <span className="inline-block text-xs font-bold uppercase tracking-wider px-3 py-1 bg-amber-100 text-amber-800 rounded-full mb-3">
            Chờ Quản trị viên kích hoạt
          </span>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Tài khoản chưa được kích hoạt</h2>
          <p className="text-sm text-gray-600 mb-6 leading-relaxed">
            Xin chào <strong className="text-gray-900">{user.displayName || user.email}</strong>! Bạn đã đăng nhập thành công qua Google. Tuy nhiên tài khoản này chưa được Quản trị viên (Admin) hoặc Quản lý (Manager) kích hoạt và phân công danh mục công việc.
          </p>

          <div className="bg-gray-50 rounded-2xl p-4 text-left text-xs space-y-2 border border-gray-100 mb-6">
            <div className="flex justify-between">
              <span className="text-gray-500">Email:</span>
              <span className="font-semibold text-gray-800">{user.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Mã người dùng:</span>
              <span className="font-mono text-gray-600 truncate max-w-[200px]">{user.uid}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Trạng thái:</span>
              <span className="font-bold text-amber-600 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> Chờ phê duyệt (Pending)
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <Button 
              onClick={async () => {
                try {
                  const snap = await getDoc(doc(db, 'users', user.uid));
                  if (snap.exists()) {
                    const uData = snap.data() as AppUser;
                    setCurrentAppUser(uData);
                    if (uData.status === 'active') {
                      alert('Tài khoản đã được kích hoạt thành công!');
                    } else {
                      alert('Tài khoản vẫn đang ở trạng thái chờ duyệt. Vui lòng liên hệ Admin.');
                    }
                  }
                } catch (e: any) {
                  console.error(e);
                }
              }} 
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700"
            >
              Kiểm tra trạng thái kích hoạt
            </Button>
            <Button 
              variant="secondary" 
              onClick={logout} 
              className="w-full py-2.5 text-gray-600 hover:text-gray-800"
            >
              <LogOut className="w-4 h-4 mr-2" /> Đăng xuất tài khoản khác
            </Button>
          </div>
          
          <p className="text-[11px] text-gray-400 mt-5">
            Admin có thể phê duyệt và gán loại công việc cho bạn ngay trong mục "Quản trị hệ thống".
          </p>
        </motion.div>
      </div>
    );
  }

  // Blocked account screen
  if (currentAppUser?.status === 'blocked' && !isOwnerEmail(user.email)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-white rounded-3xl p-6 sm:p-8 shadow-xl border border-red-200 text-center"
        >
          <div className="w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center mx-auto mb-5 text-red-600">
            <Shield className="w-8 h-8" />
          </div>
          <span className="inline-block text-xs font-bold uppercase tracking-wider px-3 py-1 bg-red-100 text-red-800 rounded-full mb-3">
            Tài khoản bị khóa
          </span>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Truy cập bị từ chối</h2>
          <p className="text-sm text-gray-600 mb-6 leading-relaxed">
            Tài khoản <strong className="text-gray-900">{user.email}</strong> đã bị tạm khóa bởi Quản trị viên. Vui lòng liên hệ bộ phận quản lý hệ thống nếu bạn cho rằng đây là một sự nhầm lẫn.
          </p>
          <Button variant="secondary" onClick={logout} className="w-full py-2.5">
            <LogOut className="w-4 h-4 mr-2" /> Đăng xuất
          </Button>
        </motion.div>
      </div>
    );
  }

  const activeCampaignIds = campaigns.filter(c => c.status === 'active').map(c => c.id);
  
  const campaignFilteredStations = selectedCampaignId === 'all' 
    ? stations.filter(s => !s.campaignId || activeCampaignIds.includes(s.campaignId)) 
    : stations.filter(s => s.campaignId === selectedCampaignId);

  const isStationAssignedToUser = (s: Station) => {
    if (!user) return false;
    const uid = user.uid;
    const email = user.email?.toLowerCase();
    const dName = (user.displayName || currentAppUser?.displayName || '')?.toLowerCase();

    if (s.assigneeId === uid) return true;
    if (email && s.assigneeId?.toLowerCase() === email) return true;
    if (dName && s.assigneeId?.toLowerCase() === dName) return true;
    if (s.managerName && (s.managerName === dName || (email && s.managerName.toLowerCase() === email))) return true;
    if (s.assigneeId && s.assigneeId.toLowerCase().includes('manh') && (email?.includes('manh') || dName?.includes('manh'))) return true;

    return assignments.some(a => {
      if (a.stationId !== s.id) return false;
      if (a.assigneeId === uid) return true;
      if (email && a.assigneeId?.toLowerCase() === email) return true;
      if (dName && a.assigneeId?.toLowerCase() === dName) return true;
      if (a.assigneeId && a.assigneeId.toLowerCase().includes('manh') && (email?.includes('manh') || dName?.includes('manh'))) return true;
      return false;
    });
  };

  // Apply Role Base Access Control for staff
  let baseFilteredStations = campaignFilteredStations;
  if (!effectiveIsAdminOrManager && !checkPermission('view.all_stations')) {
    const userOnlyStations = campaignFilteredStations.filter(isStationAssignedToUser);
    baseFilteredStations = userOnlyStations.length > 0 ? userOnlyStations : campaignFilteredStations;
  }

  const filteredStations = baseFilteredStations;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#bde0fe] via-[#e0f2fe] to-gray-50 pb-24">
      {/* Role Simulation Banner for Admins */}
      {simulatedRole && (
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-4 py-2 text-xs font-semibold flex items-center justify-between shadow-md sticky top-0 z-50">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 shrink-0" />
            <span>
              Chế độ xem trước: <strong className="underline uppercase tracking-wide">{simulatedRole === 'admin' ? 'Quản trị viên (Admin)' : simulatedRole === 'manager' ? 'Quản lý (Manager)' : 'Kỹ sư hiện trường (Staff)'}</strong>. Giao diện, menu và quyền hạn đang phản ánh vai trò này.
            </span>
          </div>
          <button
            onClick={() => setSimulatedRole(null)}
            className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg text-white text-xs font-bold transition-colors ml-3 shrink-0 flex items-center gap-1 cursor-pointer"
          >
            Quay lại quyền Admin
          </button>
        </div>
      )}

      {/* Header */}
      {activeTab !== 'dashboard' && (
        <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="bg-blue-600 p-1.5 rounded-lg">
                <Route className="text-white w-5 h-5" />
              </div>
              <span className="font-bold text-gray-900 hidden sm:inline">TSM App</span>
            </div>

            <div className="flex-1 max-w-xs mx-4">
              <div className="relative">
                 <select
                    className="w-full appearance-none bg-gray-50 border border-gray-200 text-gray-700 py-1.5 px-3 pr-8 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                    value={selectedCampaignId}
                    onChange={(e) => setSelectedCampaignId(e.target.value)}
                 >
                    <option value="all">-- Tất cả (Đang mở) --</option>
                    {campaigns.filter(c => c.status === 'active').map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                 </select>
                 <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
              </div>
            </div>
            
            <div className="flex items-center gap-2 sm:gap-4">
              {/* Role Indicator & Simulator */}
              {isActualAdmin ? (
                <div className="flex items-center gap-1.5 bg-gray-100 p-1 rounded-xl border border-gray-200">
                  <span className="text-[10px] font-bold text-gray-500 uppercase px-1 hidden md:inline">Xem vai trò:</span>
                  <button
                    onClick={() => setSimulatedRole(null)}
                    className={cn(
                      "px-2 py-1 rounded-lg text-xs font-bold transition-all",
                      !simulatedRole ? "bg-purple-700 text-white shadow-2xs" : "text-gray-600 hover:text-gray-900"
                    )}
                    title="Quyền Admin đầy đủ"
                  >
                    Admin
                  </button>
                  <button
                    onClick={() => setSimulatedRole('manager')}
                    className={cn(
                      "px-2 py-1 rounded-lg text-xs font-bold transition-all",
                      simulatedRole === 'manager' ? "bg-blue-700 text-white shadow-2xs" : "text-gray-600 hover:text-gray-900"
                    )}
                    title="Xem thử vai trò Manager"
                  >
                    Manager
                  </button>
                  <button
                    onClick={() => setSimulatedRole('staff')}
                    className={cn(
                      "px-2 py-1 rounded-lg text-xs font-bold transition-all",
                      simulatedRole === 'staff' ? "bg-emerald-700 text-white shadow-2xs" : "text-gray-600 hover:text-gray-900"
                    )}
                    title="Xem thử vai trò Staff"
                  >
                    Staff
                  </button>
                </div>
              ) : (
                <span className={cn(
                  "text-[10px] font-bold px-2 py-0.5 rounded-md border hidden sm:inline-block",
                  effectiveIsAdmin ? "bg-purple-100 text-purple-800 border-purple-200" :
                  effectiveIsManager ? "bg-blue-100 text-blue-800 border-blue-200" :
                  "bg-emerald-100 text-emerald-800 border-emerald-200"
                )}>
                  {effectiveIsAdmin ? '👑 Admin' : effectiveIsManager ? '💼 Manager' : '🛠️ Staff'}
                </span>
              )}

              <span className="text-sm text-gray-500 hidden sm:block truncate max-w-[100px]">{user.displayName || user.email}</span>
              <button onClick={logout} className="p-2 text-gray-400 hover:text-red-600 transition-colors" title="Đăng xuất">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Main Content */}
      <main className={cn("mx-auto relative", activeTab === 'dashboard' ? "pb-24" : (activeTab === 'planner' || activeTab === 'admin' || activeTab === 'stations') ? "p-3 sm:p-6 pb-24 w-full" : "p-3 sm:p-6 pb-24 max-w-4xl")}>
        {activeTab === 'dashboard' && (
          <DashboardTab 
            key="dashboard" 
            stations={campaignFilteredStations.length > 0 ? campaignFilteredStations : stations} 
            reports={reports} 
            assignments={assignments} 
            currentAppUser={effectiveAppUser} 
            user={user} 
            logout={logout} 
            validationWarnings={validationWarnings} 
            setValidationWarnings={setValidationWarnings} 
            setActiveTab={setActiveTab} 
            campaigns={campaigns} 
            selectedCampaignId={selectedCampaignId} 
            setSelectedCampaignId={setSelectedCampaignId} 
            onOpenCreateReport={(stationId, assignmentId) => { 
              setPrefilledStationId(stationId); 
              setPrefilledAssignmentId(assignmentId || ''); 
              setActiveTab('reports'); 
            }} 
            appUsers={appUsers} 
            roles={roles} 
          />
        )}
        {activeTab === 'stations' && (
          <StationsTab 
            key="stations" 
            stations={filteredStations} 
            reports={reports} 
            validationWarnings={validationWarnings} 
            setValidationWarnings={setValidationWarnings} 
            campaigns={campaigns} 
            selectedCampaignId={selectedCampaignId} 
            appUsers={appUsers} 
          />
        )}
        {activeTab === 'planner' && (
          <PlannerTab 
            key="planner" 
            stations={filteredStations} 
            assignments={assignments} 
            appUsers={appUsers} 
            user={user} 
            reports={reports} 
            taskGroups={taskGroups} 
            currentAppUser={effectiveAppUser} 
            roles={roles} 
            campaigns={campaigns} 
            selectedCampaignId={selectedCampaignId} 
            onOpenCreateReport={(stationId, assignmentId) => { 
              setPrefilledStationId(stationId); 
              setPrefilledAssignmentId(assignmentId || ''); 
              setActiveTab('reports'); 
            }} 
          />
        )}
        {activeTab === 'admin' && hasAdminAccess && (
          <AdminTab 
            key="admin" 
            equipmentDict={equipmentDict} 
            taskGroups={taskGroups} 
            workspaces={workspaces} 
            surveyParameters={surveyParameters} 
            stations={filteredStations} 
            reports={reports} 
            validationWarnings={validationWarnings} 
            setValidationWarnings={setValidationWarnings} 
            campaigns={campaigns} 
            selectedCampaignId={selectedCampaignId} 
            appUsers={appUsers} 
            currentAppUser={effectiveAppUser} 
            roles={roles} 
          />
        )}
        {activeTab === 'reports' && (
          <ReportsTab 
            key="reports" 
            stations={filteredStations} 
            user={user} 
            equipmentDict={equipmentDict} 
            taskGroups={taskGroups} 
            workspaces={workspaces} 
            technologies={['2G', '3G', '4G', '5G']} 
            initialStationId={prefilledStationId} 
            initialAssignmentId={prefilledAssignmentId} 
            reports={reports} 
            surveyParameters={surveyParameters} 
            assignments={assignments} 
            currentAppUser={effectiveAppUser}
            isAdminOrManager={effectiveIsAdminOrManager}
          />
        )}
        {activeTab === 'reportManager' && canAccessReports && (
          <ReportManagementTab 
            key="reportManager" 
            reports={reports} 
            stations={stations} 
            taskGroups={taskGroups} 
            equipmentDict={equipmentDict} 
            currentAppUser={effectiveAppUser} 
            user={user} 
          />
        )}
      </main>

      {/* Bottom Navigation with clear role-based structure */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white shadow-[0_-10px_40px_rgba(0,0,0,0.08)] rounded-t-[2rem] z-40 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-4xl mx-auto flex justify-around items-end px-2 sm:px-6 relative h-[4.5rem]">
          <NavButton 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')} 
            icon={<Home />} 
            label="Trang chủ" 
          />
          
          <NavButton 
            active={activeTab === 'planner'} 
            onClick={() => setActiveTab('planner')} 
            icon={<Route />} 
            label={effectiveIsStaff ? "Lộ trình" : effectiveIsManager ? "Kế hoạch" : "Điều phối"} 
          />
          
          <div 
             className="relative -top-5 flex flex-col items-center group cursor-pointer w-14 sm:w-16" 
             onClick={() => { setPrefilledStationId(''); setPrefilledAssignmentId(''); setActiveTab('reports'); }}
          >
            <div className={cn(
              "w-12 h-12 sm:w-14 sm:h-14 bg-white rounded-full flex items-center justify-center shadow-lg transform transition-transform group-hover:scale-105 border-[3px] border-gray-50",
               activeTab === 'reports' ? "shadow-blue-500/30" : "shadow-gray-200/50"
            )}>
               <div className={cn(
                 "w-full h-full rounded-full flex items-center justify-center transition-colors", 
                 activeTab === 'reports' ? "bg-gradient-to-tr from-blue-600 to-cyan-500 text-white" : "text-gray-500"
               )}>
                  <span className="transform -rotate-12"><Activity className="w-5 h-5 sm:w-6 sm:h-6" /></span>
               </div>
            </div>
            <span className={cn(
               "text-[9px] sm:text-[10px] mt-1 whitespace-nowrap transition-all", 
               activeTab === 'reports' ? "font-bold text-blue-600" : "font-medium text-gray-500"
            )}>Khảo sát</span>
          </div>

          {canAccessReports && (
            <NavButton 
              active={activeTab === 'reportManager'} 
              onClick={() => setActiveTab('reportManager')} 
              icon={<FileSpreadsheet />} 
              label="Thống kê" 
            />
          )}
          
          {hasAdminAccess && (
            <NavButton 
              active={activeTab === 'admin'} 
              onClick={() => setActiveTab('admin')} 
              icon={<Database />} 
              label="Quản trị" 
            />
          )}
        </div>
      </nav>

      {/* Bottom Navigation */}
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: any) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-1 pb-2 transition-all duration-300 w-12 sm:w-14 overflow-hidden group',
        active ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'
      )}
    >
      <div className={cn(
        "relative w-8 h-8 flex items-center justify-center transition-all duration-300",
        active ? "text-blue-600" : "text-gray-500"
      )}>
        {React.cloneElement(icon, { 
          className: cn(
            'w-6 h-6 flex-shrink-0 transition-all duration-300', 
            active ? 'stroke-[2.5px]' : 'stroke-1 relative top-[1px]'
          ) 
        })}
      </div>
      <div className="nav-text-container w-full px-0.5">
        <span className={cn(
          "text-[9px] sm:text-[10px] whitespace-nowrap overflow-hidden text-ellipsis block text-center transition-all duration-300", 
          active ? "font-bold" : "font-medium"
        )}>{label}</span>
      </div>
    </button>
  );
}