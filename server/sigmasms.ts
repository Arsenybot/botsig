/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SigmaUserResponse } from '../src/types.js';

const SIGMA_API_BASE = 'https://user.sigmasms.ru/api';

export const DEMO_SIGMA_TOKEN = 'demo_sigma_token_9f81a7b6c5d4e3f2';

export function isDemoToken(token?: string | null): boolean {
  if (!token) return false;
  const clean = token.trim().toLowerCase();
  return (
    clean === DEMO_SIGMA_TOKEN.toLowerCase() ||
    clean.startsWith('demo_') ||
    clean.startsWith('demo-') ||
    clean.includes('demo_token') ||
    clean === '263eeb0e5bed8ba1a54ab3a9728bb7ce20f067d6364c294c81bc95acef4e4ee0'
  );
}

export function getDemoCheckResult(): SigmaCheckResult {
  return {
    success: true,
    id: 'demo-user-8842',
    username: 'demo_company',
    fullName: 'Демо-клиент SigmaSMS',
    phone: '+7 (999) 123-45-67',
    email: 'demo@sigmasms.ru',
    balance: 1450.50,
    isActive: true,
    durationMs: 16,
    raw: {
      id: 'demo-user-8842',
      username: 'demo_company',
      balance: 1450.50,
      isActive: true,
      data: {
        firstName: 'Демо-клиент',
        lastName: 'SigmaSMS',
        phone: '+7 (999) 123-45-67',
        email: 'demo@sigmasms.ru',
        company: 'ООО «Тест-Маркет»',
      },
    },
  };
}

export interface SigmaCheckResult {
  success: boolean;
  id?: string;
  username?: string;
  fullName?: string;
  phone?: string;
  email?: string;
  balance?: number;
  isActive?: boolean;
  error?: string;
  statusCode?: number;
  raw?: any;
  durationMs: number;
}

/**
 * Step 1: GET https://user.sigmasms.ru/api/users/me
 * Retrieves current authenticated user ID and initial data
 */
export async function getSigmaMe(token: string): Promise<SigmaCheckResult> {
  const startTime = Date.now();
  const cleanToken = token.trim();

  if (!cleanToken) {
    return {
      success: false,
      error: 'Токен SigmaSMS не указан',
      durationMs: 0,
    };
  }

  // Intercept demo token without performing a real network request
  if (isDemoToken(cleanToken)) {
    return getDemoCheckResult();
  }

  try {
    const response = await fetch(`${SIGMA_API_BASE}/users/me`, {
      method: 'GET',
      headers: {
        'Authorization': cleanToken,
        'Accept': 'application/json',
      },
    });

    const durationMs = Date.now() - startTime;
    const text = await response.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = { rawResponse: text };
    }

    if (!response.ok) {
      return {
        success: false,
        error: data?.message || `Ошибка API: ${response.status} ${response.statusText}`,
        statusCode: response.status,
        raw: data,
        durationMs,
      };
    }

    const userData = data as SigmaUserResponse;
    const fullName = [userData.data?.firstName, userData.data?.lastName].filter(Boolean).join(' ') || userData.username || 'Пользователь';

    return {
      success: true,
      id: userData.id,
      username: userData.username,
      fullName,
      phone: userData.data?.phone,
      email: userData.data?.email,
      balance: typeof userData.balance === 'number' ? userData.balance : 0,
      isActive: userData.isActive !== false,
      raw: userData,
      durationMs,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Сетевая ошибка при запросе к SigmaSMS API',
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Step 2: GET https://user.sigmasms.ru/api/users/{ID}
 * Retrieves full user details and live balance by user ID
 */
export async function getSigmaUserById(userId: string, token: string): Promise<SigmaCheckResult> {
  const startTime = Date.now();
  const cleanToken = token.trim();
  const cleanId = userId.trim();

  if (!cleanToken || !cleanId) {
    return {
      success: false,
      error: 'Токен или ID пользователя не указаны',
      durationMs: 0,
    };
  }

  // Intercept demo token without performing a real network request
  if (isDemoToken(cleanToken)) {
    return getDemoCheckResult();
  }

  try {
    const response = await fetch(`${SIGMA_API_BASE}/users/${cleanId}`, {
      method: 'GET',
      headers: {
        'Authorization': cleanToken,
        'Accept': 'application/json',
      },
    });

    const durationMs = Date.now() - startTime;
    const text = await response.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = { rawResponse: text };
    }

    if (!response.ok) {
      return {
        success: false,
        error: data?.message || `Ошибка API: ${response.status} ${response.statusText}`,
        statusCode: response.status,
        raw: data,
        durationMs,
      };
    }

    const userData = data as SigmaUserResponse;
    const fullName = [userData.data?.firstName, userData.data?.lastName].filter(Boolean).join(' ') || userData.username || 'Пользователь';

    return {
      success: true,
      id: userData.id,
      username: userData.username,
      fullName,
      phone: userData.data?.phone,
      email: userData.data?.email,
      balance: typeof userData.balance === 'number' ? userData.balance : 0,
      isActive: userData.isActive !== false,
      raw: userData,
      durationMs,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Сетевая ошибка при запросе к SigmaSMS API',
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Combined sequence as instructed:
 * If user ID is already known, attempts GET /users/{id} for high performance;
 * if user ID is not known or if /users/{id} fails, falls back to GET /users/me
 * and then optionally confirms /users/{id}.
 */
export async function checkSigmaBalanceRealtime(token: string, cachedUserId?: string): Promise<SigmaCheckResult> {
  if (isDemoToken(token)) {
    return getDemoCheckResult();
  }

  if (cachedUserId) {
    const idResult = await getSigmaUserById(cachedUserId, token);
    if (idResult.success) {
      return idResult;
    }
  }

  // Step 1: GET /users/me
  const meResult = await getSigmaMe(token);
  if (!meResult.success || !meResult.id) {
    return meResult;
  }

  // Step 2: GET /users/{id} to get the latest updated balance
  const userResult = await getSigmaUserById(meResult.id, token);
  if (userResult.success) {
    return userResult;
  }

  // Return meResult if secondary call had an issue
  return meResult;
}
