export interface AppUser {
  id: string; // The uid from Firebase Auth
  email: string | null;
  displayName: string | null;
  role: string;
  status?: 'active' | 'pending' | 'blocked'; // Trạng thái tài khoản
  allowedTaskGroupIds?: string[]; // Các loại công việc nhân viên được phép làm
  permissions?: string[]; // Flexible permissions list
  department?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AppRole {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
}

export const APP_PERMISSIONS = [
  { id: 'admin.users', label: 'Quản lý người dùng & phân quyền' },
  { id: 'admin.roles', label: 'Quản lý vai trò (Roles)' },
  { id: 'admin.campaigns', label: 'Quản lý Đợt công việc' },
  { id: 'admin.stations', label: 'Quản lý Trạm & Hạ tầng' },
  { id: 'admin.tasks', label: 'Quản lý Danh mục công việc (Task)' },
  { id: 'admin.equipment', label: 'Quản lý Danh mục Thiết bị' },
  { id: 'admin.surveys', label: 'Quản lý Thông số Khảo sát' },
  { id: 'view.all_stations', label: 'Xem tất cả Trạm (không cần được giao)' },
  { id: 'view.reports', label: 'Xem Thống kê & Báo cáo' },
  { id: 'action.report', label: 'Thực hiện báo cáo (Field worker)' }
];


export interface Campaign {
  id: string;
  name: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
  status: 'active' | 'closed';
  createdAt: string;
}

export interface Station {
  id: string;
  campaignId?: string;
  infrastructureCode?: string;
  name: string;
  infrastructureDepartment?: string;
  latitude: number;
  longitude: number;
  address: string;
  managerName: string;
  managerPhone: string;
  assigneeId?: string; // ID assigned to worker
  icon?: string;
  status?: 'checked' | 'unchecked';
  additionalFields?: Record<string, string>;
  note?: string;
  region?: string;
  tags?: string[];
  networkTypes?: string[];
}

export interface Workspace {
  id: string;
  name: string;
}

export interface TaskGroup {
  id: string; // id_nhom_cv
  name: string; // ten_nhom
  modules?: string[]; // e.g. ['EQUIPMENT', 'PHOTO', 'NOTE']
  requiresEquipment?: boolean; // Legacy fallback
  workspace?: 'Indoor' | 'Outdoor' | 'Full'; // Legacy fallback
  applicableCategories?: string[]; // Dynamic N-N mapping for equipment categories
}

export interface AuditLog {
  id?: string;
  reportId: string;
  stationId: string;
  userId: string;
  userEmail: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  changes: string; // e.g. "Sửa trạng thái từ chưa sang rồi" or JSON string
  timestamp: string; // ISO string
}

export interface Attachment {
  id: string; // id_dinh_kem
  url: string; // duong_dan_file
  type: string; // loai_file (image/jpeg, etc)
  category?: 'panorama' | 'power' | 'grounding' | 'damage' | 'general'; // Phân loại ảnh
  note?: string; // Ghi chú ảnh
}

export interface ReportHistory {
  userId: string;
  userName: string;
  timestamp: string;
  content: string;
}

export interface EquipmentDict {
  id: string; // id_thiet_bi
  name: string; // ten_thiet_bi
  validSpaces: string[]; // ['Indoor', 'Outdoor']
  unit?: string; // don_vi_tinh (cái, mét, bộ, ...)
}

export interface ReportDetail {
  id: string; // local UI ID or db ID
  spaceId: string; // id_khong_gian (Indoor, Outdoor)
  equipmentId: string; // id_thiet_bi (RRU, Anten, etc.)
  quantity: number; // so_luong
  status: string; // tinh_trang_thiet_bi
  unit?: string; // don_vi_tinh
  note?: string; // ghi_chu_chi_tiet
}

export interface InfrastructureCheck {
  acStatus: 'Tốt' | 'Nóng' | 'Hỏng';
  powerStatus: 'Tốt' | 'Mất điện' | 'Đứt cáp' | 'Ắc quy lỗi';
  securityStatus: 'An toàn' | 'Mất khóa' | 'Cửa hỏng';
  leakStatus: 'Khô ráo' | 'Dột rụng' | 'Ngập nước';
  note: string;
}

export interface SurveyParameter {
  id: string;
  label: string;
  type: 'number' | 'text';
  unit?: string;
  order: number;
}

export interface Report {
  id: string; // id_bao_cao
  userId: string; // id_nhan_vien (FK)
  userEmail?: string;
  stationId: string; // id_tram (FK)
  taskGroupId?: string; // id_nhom_cv / id_loai_cv (FK)
  stationName?: string; // Denormalized for easier display
  date: string; // YYYY-MM-DD
  workSpace?: string; // 'Indoor' | 'Outdoor' | 'Full'
  content: string; // ghi_chu_tong_quat / noi_dung_cv
  details?: string; // (Legacy/Text details)
  equipmentDetails?: ReportDetail[]; // BaoCao_ChiTiet (1-N)
  infrastructureCheck?: InfrastructureCheck; // Legacy/Checklist
  surveyResults?: Record<string, any>; // Dynamic survey values
  status: 'completed' | 'pending';
  completedAt?: string; // thoi_gian_hoan_thanh
  createdAt?: string; // thoi_gian_tao_bc
  updatedAt?: string;
  attachments?: Attachment[]; // 1-Nhiều từ BaoCao đến DinhKem
  history?: ReportHistory[];
  googleDriveUrl?: string; // Link thư mục Google Drive chứa album ảnh chất lượng cao / số lượng lớn
}

export interface Assignment {
  id: string;
  assigneeId: string;
  assignedBy: string;
  stationId: string;
  campaignId: string | null;
  taskGroupId: string;
  startDate: string;
  deadline: string;
  routeOrder?: number;
  status: 'pending' | 'checked_in' | 'completed';
  checkInLocation?: {
    latitude: number;
    longitude: number;
  };
  checkInTime?: string;
  createdAt: string;
}

export type Tab = 'dashboard' | 'stations' | 'planner' | 'settings' | 'admin' | 'reports' | 'reportManager';

export interface ValidationWarning {
  id: string;
  isRead: boolean;
  name: string;
  infrastructureCode?: string;
  address: string;
  latitude: number;
  longitude: number;
  issue?: string;
  issues?: string[];
  recommendation: string;
}
