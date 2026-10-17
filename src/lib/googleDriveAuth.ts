import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '../firebase';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const provider = new GoogleAuthProvider();
provider.addScope(DRIVE_SCOPE);
provider.setCustomParameters({
  prompt: 'select_account'
});

// In-memory cache only (DO NOT store in localStorage or sessionStorage)
let cachedAccessToken: string | null = null;
let currentUser: User | null = null;
let isSigningIn = false;

type AuthChangeListener = (user: User | null, token: string | null) => void;
const listeners = new Set<AuthChangeListener>();

function notifyListeners() {
  listeners.forEach(fn => fn(currentUser, cachedAccessToken));
}

export function subscribeGoogleDriveAuth(callback: AuthChangeListener): () => void {
  listeners.add(callback);
  callback(currentUser, cachedAccessToken);
  return () => {
    listeners.delete(callback);
  };
}

// Watch Firebase Auth state
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (!user && !isSigningIn) {
    cachedAccessToken = null;
  }
  notifyListeners();
});

/**
 * Trigger Google OAuth popup to sign in and authorize Google Drive access
 */
export async function signInWithGoogleDrive(): Promise<{ user: User; accessToken: string }> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    
    if (!credential?.accessToken) {
      throw new Error('Không nhận được mã xác thực Google Drive từ phiên đăng nhập.');
    }

    cachedAccessToken = credential.accessToken;
    currentUser = result.user;
    notifyListeners();

    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Lỗi đăng nhập Google Drive:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
}

/**
 * Get current in-memory access token
 */
export function getGoogleDriveAccessToken(): string | null {
  return cachedAccessToken;
}

/**
 * Get current authenticated user
 */
export function getGoogleDriveUser(): User | null {
  return currentUser;
}

/**
 * Disconnect Google Drive session
 */
export async function signOutGoogleDrive(): Promise<void> {
  cachedAccessToken = null;
  currentUser = null;
  notifyListeners();
}
