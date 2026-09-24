/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const TOKEN_STORAGE_KEY = 'sigmabalance_admin_token';
const USER_STORAGE_KEY = 'sigmabalance_admin_user';

let authChangeListeners: Array<(authenticated: boolean) => void> = [];

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser(): { username: string } | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredAuth(token: string, user: { username: string }): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    notifyAuthChange(true);
  } catch {}
}

export function clearStoredAuth(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    notifyAuthChange(false);
  } catch {}
}

export function onAuthChange(callback: (authenticated: boolean) => void): () => void {
  authChangeListeners.push(callback);
  return () => {
    authChangeListeners = authChangeListeners.filter((cb) => cb !== callback);
  };
}

function notifyAuthChange(authenticated: boolean): void {
  authChangeListeners.forEach((cb) => {
    try {
      cb(authenticated);
    } catch {}
  });
}

/**
 * Wrapper around window.fetch that automatically injects Authorization header
 * and triggers logout if 401 Unauthorized is returned.
 */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = getStoredToken();
  const headers = new Headers(init?.headers || {});

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    clearStoredAuth();
  }

  return response;
}

export async function loginAdmin(username: string, password: string): Promise<{ success: boolean; message?: string }> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();
    if (res.ok && data.success && data.token) {
      setStoredAuth(data.token, data.user || { username });
      return { success: true };
    }

    return {
      success: false,
      message: data.message || 'Неверный логин или пароль',
    };
  } catch (err: any) {
    return {
      success: false,
      message: 'Ошибка связи с сервером при входе: ' + (err?.message || ''),
    };
  }
}

export async function checkAdminSession(): Promise<boolean> {
  const token = getStoredToken();
  if (!token) return false;

  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated) {
        return true;
      }
    }
  } catch {}

  clearStoredAuth();
  return false;
}

export async function logoutAdmin(): Promise<void> {
  const token = getStoredToken();
  if (token) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {}
  }
  clearStoredAuth();
}
