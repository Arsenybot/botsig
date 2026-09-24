/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin123';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'qwerty0912';

const AUTH_SECRET = process.env.AUTH_SECRET || process.env.ENCRYPTION_MASTER_KEY || 'sigmabalance-admin-secret-key-salt-2026';

// Blacklist for logged out tokens
const revokedTokens = new Set<string>();

/**
 * Constant-time string comparison to prevent timing attacks
 */
function safeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Validate username and password
 */
export function validateAdminCredentials(user: string, pass: string): boolean {
  const isUserValid = safeCompare(user.trim(), ADMIN_USERNAME);
  const isPassValid = safeCompare(pass, ADMIN_PASSWORD);
  return isUserValid && isPassValid;
}

interface TokenPayload {
  u: string;
  iat: number;
  exp: number;
  nonce: string;
}

/**
 * Generates an HMAC-SHA256 signed session token
 */
export function generateAdminToken(username: string): string {
  const payload: TokenPayload = {
    u: username,
    iat: Date.now(),
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
    nonce: crypto.randomBytes(8).toString('hex'),
  };

  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payloadStr).digest('base64url');

  return `${payloadStr}.${signature}`;
}

/**
 * Verifies the token signature and expiration
 */
export function verifyAdminToken(token: string): { valid: boolean; username?: string } {
  if (!token || typeof token !== 'string') return { valid: false };
  if (revokedTokens.has(token)) return { valid: false };

  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false };

  const [payloadStr, signature] = parts;
  const expectedSignature = crypto.createHmac('sha256', AUTH_SECRET).update(payloadStr).digest('base64url');

  if (!safeCompare(signature, expectedSignature)) {
    return { valid: false };
  }

  try {
    const payload: TokenPayload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString('utf-8'));
    if (!payload.exp || Date.now() > payload.exp) {
      return { valid: false };
    }
    if (payload.u !== ADMIN_USERNAME) {
      return { valid: false };
    }
    return { valid: true, username: payload.u };
  } catch {
    return { valid: false };
  }
}

/**
 * Revokes a token on logout
 */
export function revokeAdminToken(token: string): void {
  if (token) {
    revokedTokens.add(token);
    // Auto-clean old revoked tokens if set gets large
    if (revokedTokens.size > 2000) {
      revokedTokens.clear();
    }
  }
}

/**
 * Express middleware to protect administrative API endpoints
 */
export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Требуется авторизация администратора',
    });
    return;
  }

  const token = authHeader.substring(7).trim();
  const verification = verifyAdminToken(token);

  if (!verification.valid) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Сессия устарела или недействительна. Пожалуйста, войдите снова',
    });
    return;
  }

  (req as any).adminUser = verification.username;
  next();
}
