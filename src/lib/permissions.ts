import { AppUser, AppRole } from '../types';

export const OWNER_EMAILS: string[] = [
  'vle94152@gmail.com',
  'b26215268@gmail.com'
];

export function isOwnerEmail(email?: string | null): boolean {
  if (!email) return false;
  return OWNER_EMAILS.includes(email.toLowerCase().trim());
}

export const OWNER_EMAIL = OWNER_EMAILS[0];

export const DEFAULT_BUILTIN_ROLES: AppRole[] = [
  {
    id: 'admin',
    name: 'Quản trị viên (Admin)',
    description: 'Toàn quyền cấu hình hệ thống, quản lý người dùng, phân quyền, giao việc.',
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
      'action.report'
    ]
  },
  {
    id: 'manager',
    name: 'Quản lý (Manager)',
    description: 'Quản lý vận hành, lập kế hoạch, giao trạm, theo dõi tiến độ, xem báo cáo.',
    permissions: [
      'admin.stations',
      'admin.campaigns',
      'admin.tasks',
      'admin.surveys',
      'admin.equipment',
      'view.all_stations',
      'view.reports',
      'action.report'
    ]
  },
  {
    id: 'staff',
    name: 'Nhân viên / Kỹ sư (Staff)',
    description: 'Sử dụng App đi hiện trường, xem lộ trình cá nhân, check-in và điền báo cáo.',
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
    'admin.tasks'
  ];
  return managementPermissions.some(perm => hasPermission(userEmail, currentAppUser, roles, perm));
}
