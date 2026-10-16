import { AppUser, AppRole } from '../types';

export const OWNER_EMAILS: string[] = [
  'vle94152@gmail.com',
  'b26215268@gmail.com',
  'votuyen.vt2@gmail.com'
];

export function isOwnerEmail(email?: string | null): boolean {
  if (!email) return false;
  return OWNER_EMAILS.includes(email.toLowerCase().trim());
}

export const OWNER_EMAIL = OWNER_EMAILS[0];

export const ROLE_DEFINITIONS: Record<string, {
  name: string;
  shortLabel: string;
  description: string;
  badgeClass: string;
  color: string;
  scope: string;
}> = {
  admin: {
    name: 'Quản trị viên (Admin)',
    shortLabel: 'Admin',
    description: 'Toàn quyền cấu hình hệ thống, quản lý người dùng, phân quyền, chiến dịch, danh mục và dữ liệu.',
    badgeClass: 'bg-purple-100 text-purple-800 border-purple-200',
    color: '#7e22ce',
    scope: 'Toàn quyền hệ thống'
  },
  manager: {
    name: 'Quản lý (Manager)',
    shortLabel: 'Manager',
    description: 'Lập kế hoạch tháng/ngày, điều phối giao trạm cho kỹ sư, giám sát tiến độ, kiểm tra và xuất báo cáo.',
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-200',
    color: '#1d4ed8',
    scope: 'Vận hành & Điều phối'
  },
  staff: {
    name: 'Kỹ sư hiện trường (Staff)',
    shortLabel: 'Staff',
    description: 'Xem nhiệm vụ và lộ trình cá nhân, định vị GPS dẫn đường, check-in và gửi báo cáo khảo sát trạm.',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    color: '#059669',
    scope: 'Khảo sát hiện trường'
  }
};

export function getRoleInfo(roleId?: string | null) {
  const key = roleId?.toLowerCase() || 'staff';
  return ROLE_DEFINITIONS[key] || {
    name: roleId || 'Nhân viên',
    shortLabel: roleId || 'Staff',
    description: 'Người dùng trong hệ thống',
    badgeClass: 'bg-gray-100 text-gray-700 border-gray-200',
    color: '#4b5563',
    scope: 'Cơ bản'
  };
}

export const DEFAULT_BUILTIN_ROLES: AppRole[] = [
  {
    id: 'admin',
    name: 'Quản trị viên (Admin)',
    description: 'Toàn quyền cấu hình hệ thống, quản lý người dùng, phân quyền, giao việc, duyệt và xóa dữ liệu.',
    permissions: [
      'admin.users',
      'admin.roles',
      'admin.stations',
      'admin.campaigns',
      'admin.surveys',
      'admin.equipment',
      'admin.tasks',
      'view.all_stations',
      'view.reports',
      'action.report',
      'planner.dispatch'
    ]
  },
  {
    id: 'manager',
    name: 'Quản lý (Manager)',
    description: 'Quản lý vận hành, lập kế hoạch, giao trạm cho nhân viên, theo dõi tiến độ, xem và xuất báo cáo.',
    permissions: [
      'admin.stations',
      'admin.campaigns',
      'admin.tasks',
      'admin.surveys',
      'admin.equipment',
      'view.all_stations',
      'view.reports',
      'action.report',
      'planner.dispatch'
    ]
  },
  {
    id: 'staff',
    name: 'Kỹ sư / Nhân viên (Staff)',
    description: 'Thực thi hiện trường: xem lộ trình cá nhân, định vị trạm, check-in và điền báo cáo khảo sát.',
    permissions: [
      'action.report'
    ]
  }
];

/**
 * Checks whether the current user has a specific permission.
 */
export function hasPermission(
  userEmail: string | null | undefined,
  currentAppUser: AppUser | null | undefined,
  roles: AppRole[],
  permId: string
): boolean {
  // 1. Owner account always has all permissions
  if (isOwnerEmail(userEmail) || isOwnerEmail(currentAppUser?.email)) return true;

  if (!currentAppUser) return false;

  // 2. Admin role has all permissions
  if (currentAppUser.role === 'admin') return true;

  // 3. User direct permissions override
  if (currentAppUser.permissions?.includes(permId)) return true;

  // 4. Role-based permissions from Firestore roles
  const userRole = roles.find(r => r.id === currentAppUser.role);
  if (userRole && userRole.permissions?.includes(permId)) return true;

  // 5. Default fallback permissions if roles collection hasn't loaded or role has no permissions array
  const builtinRole = DEFAULT_BUILTIN_ROLES.find(r => r.id === currentAppUser.role);
  if (builtinRole && builtinRole.permissions.includes(permId)) return true;

  return false;
}

/**
 * Checks if a user has management or admin capabilities (can manage campaigns, dispatch tasks, see manager views).
 */
export function isManagerOrAdmin(
  userEmail: string | null | undefined,
  currentAppUser: AppUser | null | undefined,
  roles: AppRole[]
): boolean {
  if (isOwnerEmail(userEmail) || isOwnerEmail(currentAppUser?.email)) return true;
  if (currentAppUser?.role === 'admin' || currentAppUser?.role === 'manager') return true;

  // Check if they hold any administrative or planning permission
  const managementPermissions = [
    'admin.users',
    'admin.roles',
    'admin.stations',
    'admin.campaigns',
    'admin.tasks',
    'planner.dispatch'
  ];
  return managementPermissions.some(perm => hasPermission(userEmail, currentAppUser, roles, perm));
}

export function isStaffOnly(
  userEmail: string | null | undefined,
  currentAppUser: AppUser | null | undefined,
  roles: AppRole[]
): boolean {
  return !isManagerOrAdmin(userEmail, currentAppUser, roles);
}

export function canManageUsers(
  userEmail: string | null | undefined,
  currentAppUser: AppUser | null | undefined,
  roles: AppRole[]
): boolean {
  if (isOwnerEmail(userEmail) || isOwnerEmail(currentAppUser?.email)) return true;
  if (currentAppUser?.role === 'admin') return true;
  return hasPermission(userEmail, currentAppUser, roles, 'admin.users');
}

export function canDispatchTasks(
  userEmail: string | null | undefined,
  currentAppUser: AppUser | null | undefined,
  roles: AppRole[]
): boolean {
  return isManagerOrAdmin(userEmail, currentAppUser, roles);
}
