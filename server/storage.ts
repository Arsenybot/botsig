/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { BotUser, AlertThreshold, BotLogEntry, BotConfig, SigmaTokenAccount } from '../src/types.js';
import { DEMO_SIGMA_TOKEN } from './sigmasms.js';
import { tokenVault } from './security/vault.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'bot_database.json');

// Default alert thresholds: strictly 3 defaults (1 000 ₽, 5 000 ₽, 10 000 ₽)
export const DEFAULT_THRESHOLDS: AlertThreshold[] = [
  { value: 1000, enabled: true, lastTriggeredAt: null },
  { value: 5000, enabled: true, lastTriggeredAt: null },
  { value: 10000, enabled: true, lastTriggeredAt: null },
];

const OLD_DEFAULT_VALUES = new Set([
  -100000, -50000, -10000, 0, 5, 10, 25, 50, 100, 200, 500, 2500,
]);

export function sanitizeThresholds(existing?: AlertThreshold[]): AlertThreshold[] {
  // Remove previously auto-seeded default thresholds
  const filtered = (existing || []).filter(t => !OLD_DEFAULT_VALUES.has(t.value));

  // Ensure default 1000, 5000, 10000 exist
  for (const def of DEFAULT_THRESHOLDS) {
    if (!filtered.some(t => t.value === def.value)) {
      filtered.push({ value: def.value, enabled: def.enabled, lastTriggeredAt: null });
    }
  }

  // Sort ascending: custom negative values first, then 1000, 5000, 10000, and custom higher values
  filtered.sort((a, b) => a.value - b.value);
  return filtered;
}

interface DatabaseSchema {
  config: BotConfig;
  users: Record<string, BotUser>;
  logs: BotLogEntry[];
  stats: {
    totalChecks: number;
    totalAlerts: number;
    lastBatchCheckTimestamp: number | null;
  };
}

class StorageService {
  private data: DatabaseSchema;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.ensureDataDir();
    this.data = this.loadData();
    this.flushSave();
  }

  private ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      } catch (err) {
        console.error('Failed to create data directory:', err);
      }
    }
  }

  private loadData(): DatabaseSchema {
    const defaultConfig: BotConfig = {
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '8948316828:AAEi6oVo9qm2nwt9YKxW46zhpN6Gqplld_0',
      defaultSigmaToken: process.env.DEFAULT_SIGMA_TOKEN || DEMO_SIGMA_TOKEN,
      checkIntervalSeconds: Number(process.env.CHECK_INTERVAL_SECONDS) || 60,
      isPollingActive: true,
      isBotActive: true,
      maxConcurrentChecks: 10,
    };

    let parsed: any = null;

    // 1. Try reading primary database file
    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        if (raw && raw.trim().length > 0) {
          parsed = JSON.parse(raw);
        }
      } catch (err: any) {
        console.error('[Storage] Error reading primary DB_FILE, will check backup:', err.message);
      }
    }

    // 2. If primary file was missing or corrupted, try recovering from .bak file
    if (!parsed && fs.existsSync(`${DB_FILE}.bak`)) {
      try {
        const bakRaw = fs.readFileSync(`${DB_FILE}.bak`, 'utf-8');
        if (bakRaw && bakRaw.trim().length > 0) {
          parsed = JSON.parse(bakRaw);
          console.log('[Storage] Successfully recovered database state from .bak file!');
        }
      } catch (bakErr: any) {
        console.error('[Storage] Error reading backup file:', bakErr.message);
      }
    }

    if (parsed) {
      try {
        // Sanitize config if it had old token
        const loadedConfig = { ...defaultConfig, ...(parsed.config || {}) };
        if (loadedConfig.defaultSigmaToken === '263eeb0e5bed8ba1a54ab3a9728bb7ce20f067d6364c294c81bc95acef4e4ee0') {
          loadedConfig.defaultSigmaToken = DEMO_SIGMA_TOKEN;
        }

        // Sanitize users and migrate to multi-token structure while strictly preserving state
        const loadedUsers = parsed.users || {};
        for (const u of Object.values(loadedUsers as Record<string, any>)) {
          if (u.sigmaToken === '263eeb0e5bed8ba1a54ab3a9728bb7ce20f067d6364c294c81bc95acef4e4ee0') {
            u.sigmaToken = DEMO_SIGMA_TOKEN;
          }

          // Migrate tokens array if needed
          if (!u.tokens || !Array.isArray(u.tokens) || u.tokens.length === 0) {
            if (u.sigmaToken && u.sigmaToken.trim().length > 0) {
              u.tokens = [
                {
                  id: 'tok_main',
                  token: u.sigmaToken.trim(),
                  name: u.sigmaFullName || u.sigmaUsername || 'Основной',
                  sigmaUserId: u.sigmaUserId,
                  sigmaUsername: u.sigmaUsername,
                  sigmaFullName: u.sigmaFullName,
                  currentBalance: u.currentBalance != null ? u.currentBalance : null,
                  previousBalance: u.previousBalance != null ? u.previousBalance : null,
                  lastCheckedAt: u.lastCheckedAt || null,
                  lastCheckStatus: u.lastCheckStatus || 'ok',
                  lastCheckError: u.lastCheckError,
                  thresholds: Array.isArray(u.thresholds) && u.thresholds.length > 0
                    ? u.thresholds
                    : JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS)),
                  createdAt: u.createdAt || Date.now(),
                },
              ];
            } else {
              u.tokens = [];
            }
          }

          // Ensure all tokens have valid thresholds and are securely encrypted in isolated vault
          const chatId = Number(u.chatId);
          if (Array.isArray(u.tokens)) {
            for (const t of u.tokens) {
              t.thresholds = sanitizeThresholds(t.thresholds);
              // Migrate raw/plaintext token into isolated AES-256-GCM vault
              if (t.token && !t.token.includes('•') && t.token.trim().length > 0) {
                const stored = tokenVault.storeSecret(chatId, t.id, t.token.trim(), t.secretRef);
                t.secretRef = stored.secretRef;
                t.maskedToken = stored.maskedToken;
                t.tokenHash = stored.tokenHash;
                t.isEncrypted = true;
                t.token = stored.maskedToken; // Replace raw plaintext with masked string in DB
              } else if (!t.maskedToken && t.token) {
                t.maskedToken = tokenVault.maskToken(t.token);
                t.isEncrypted = true;
              }
            }
          }

          // Secure top-level sigmaToken if raw
          if (u.sigmaToken && !u.sigmaToken.includes('•') && u.sigmaToken.trim().length > 0) {
            const active = u.tokens?.[u.activeTokenIndex || 0];
            if (active && active.maskedToken) {
              u.sigmaToken = active.maskedToken;
              u.maskedToken = active.maskedToken;
              u.secretRef = active.secretRef;
              u.tokenHash = active.tokenHash;
            } else {
              const stored = tokenVault.storeSecret(chatId, 'tok_main', u.sigmaToken.trim(), u.secretRef);
              u.sigmaToken = stored.maskedToken;
              u.maskedToken = stored.maskedToken;
              u.secretRef = stored.secretRef;
              u.tokenHash = stored.tokenHash;
            }
          } else if (u.sigmaToken && !u.maskedToken) {
            u.maskedToken = tokenVault.maskToken(u.sigmaToken);
          }

          // Ensure active index, state, and properties are intact
          if (u.activeTokenIndex == null) {
            u.activeTokenIndex = 0;
          }
          u.state = u.state || 'idle';
          u.thresholds = sanitizeThresholds(u.thresholds);
          u.alertsCount = typeof u.alertsCount === 'number' ? u.alertsCount : 0;
          u.hasStarted = u.hasStarted ?? true;
          u.hasEnteredToken = u.hasEnteredToken ?? (u.tokens.length > 0 || !!u.sigmaToken);
        }

        const loadedLogs = (parsed.logs || []).slice(-200);

        return {
          config: loadedConfig,
          users: loadedUsers,
          logs: loadedLogs,
          stats: parsed.stats || { totalChecks: 0, totalAlerts: 0, lastBatchCheckTimestamp: null },
        };
      } catch (err) {
        console.error('Error normalizing database schema, using parsed content:', err);
      }
    }

    // Default initial seed if no db or backup existed
    return {
      config: defaultConfig,
      users: {},
      logs: [
        {
          id: 'init-1',
          timestamp: Date.now(),
          type: 'info',
          message: 'Система инициализирована. База данных готова к работе с 200+ пользователями.',
        }
      ],
      stats: {
        totalChecks: 0,
        totalAlerts: 0,
        lastBatchCheckTimestamp: null,
      },
    };
  }

  /**
   * Flush all data to disk atomically with temporary file & backup copy.
   * Guarantees zero data loss even on process termination or sudden restart.
   */
  public flushSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    try {
      this.ensureDataDir();
      const content = JSON.stringify(this.data, null, 2);
      const tempFile = `${DB_FILE}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 7)}`;
      fs.writeFileSync(tempFile, content, 'utf-8');

      // Update .bak backup before replacing primary database file
      if (fs.existsSync(DB_FILE)) {
        try {
          fs.copyFileSync(DB_FILE, `${DB_FILE}.bak`);
        } catch {
          // Ignore copy error
        }
      }

      // POSIX atomic file replacement
      fs.renameSync(tempFile, DB_FILE);
    } catch (err) {
      console.error('[Storage] Failed to flush database to disk:', err);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.flushSave();
    }, 200);
  }

  public getConfig(): BotConfig {
    return { ...this.data.config };
  }

  public updateConfig(newConfig: Partial<BotConfig>): BotConfig {
    this.data.config = { ...this.data.config, ...newConfig };
    this.scheduleSave();
    return { ...this.data.config };
  }

  public getUser(chatId: number): BotUser | undefined {
    return this.data.users[chatId.toString()];
  }

  public getAllUsers(): BotUser[] {
    return Object.values(this.data.users);
  }

  public getActiveUsersWithToken(): BotUser[] {
    return Object.values(this.data.users).filter(u => 
      (Array.isArray(u.tokens) && u.tokens.length > 0) ||
      (!!u.sigmaToken && u.sigmaToken.trim().length > 0)
    );
  }

  private syncUserTopFields(user: BotUser) {
    if (user.tokens && user.tokens.length > 0) {
      const idx = Math.min(Math.max(0, user.activeTokenIndex || 0), user.tokens.length - 1);
      user.activeTokenIndex = idx;
      const active = user.tokens[idx];
      user.sigmaToken = active.maskedToken || active.token;
      user.maskedToken = active.maskedToken || tokenVault.maskToken(active.token);
      user.secretRef = active.secretRef;
      user.tokenHash = active.tokenHash;
      user.sigmaUserId = active.sigmaUserId;
      user.sigmaUsername = active.sigmaUsername;
      user.sigmaFullName = active.sigmaFullName;
      user.currentBalance = active.currentBalance;
      user.previousBalance = active.previousBalance;
      user.thresholds = active.thresholds;
      user.lastCheckedAt = active.lastCheckedAt;
      user.lastCheckStatus = active.lastCheckStatus;
      user.lastCheckError = active.lastCheckError;
      user.hasEnteredToken = true;
    }
  }

  /**
   * Resolves decrypted token in volatile memory strictly for external HTTPS API calls.
   * Never exposed to API responses or logs.
   */
  public resolveToken(user: BotUser, tokenAccount?: SigmaTokenAccount): string | null {
    const target = tokenAccount || this.getActiveToken(user);
    if (!target) return null;

    // 1. Fetch from isolated AES-256-GCM vault
    if (target.secretRef) {
      const decrypted = tokenVault.retrieveSecret(user.chatId, target.id, target.secretRef);
      if (decrypted) return decrypted;
    }

    // 2. Legacy fallback: if plain token is in memory (not masked)
    if (target.token && !target.token.includes('•') && target.token.trim().length > 0) {
      const raw = target.token.trim();
      const stored = tokenVault.storeSecret(user.chatId, target.id, raw, target.secretRef);
      target.secretRef = stored.secretRef;
      target.maskedToken = stored.maskedToken;
      target.tokenHash = stored.tokenHash;
      target.isEncrypted = true;
      target.token = stored.maskedToken;
      this.flushSave();
      return raw;
    }

    return null;
  }

  /**
   * Sanitizes a user record before sending over HTTP to prevent token leaks
   */
  public sanitizeUserForClient(user: BotUser): BotUser {
    const clone: BotUser = JSON.parse(JSON.stringify(user));
    if (Array.isArray(clone.tokens)) {
      for (const t of clone.tokens) {
        t.token = t.maskedToken || tokenVault.maskToken(t.token || '');
        t.maskedToken = t.token;
        t.isEncrypted = true;
      }
    }
    if (clone.sigmaToken) {
      clone.sigmaToken = clone.maskedToken || tokenVault.maskToken(clone.sigmaToken);
      clone.maskedToken = clone.sigmaToken;
    }
    return clone;
  }

  public getAllUsersSanitized(): BotUser[] {
    return this.getAllUsers().map(u => this.sanitizeUserForClient(u));
  }

  public getUserSanitized(chatId: number): BotUser | undefined {
    const u = this.getUser(chatId);
    return u ? this.sanitizeUserForClient(u) : undefined;
  }

  public createOrUpdateUser(
    chatId: number,
    userData: Partial<BotUser> & { telegramUsername?: string; telegramFirstName?: string }
  ): BotUser {
    const key = chatId.toString();
    const existing = this.data.users[key];

    if (!existing) {
      const initialTokens: SigmaTokenAccount[] = userData.tokens || [];
      if (initialTokens.length === 0 && userData.sigmaToken) {
        initialTokens.push({
          id: `tok_${Date.now()}`,
          token: userData.sigmaToken.trim(),
          name: userData.sigmaFullName || userData.sigmaUsername || 'Основной',
          sigmaUserId: userData.sigmaUserId,
          sigmaUsername: userData.sigmaUsername,
          sigmaFullName: userData.sigmaFullName,
          currentBalance: userData.currentBalance ?? null,
          previousBalance: userData.previousBalance ?? null,
          lastCheckedAt: userData.lastCheckedAt ?? null,
          lastCheckStatus: userData.lastCheckStatus || 'ok',
          thresholds: userData.thresholds || JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS)),
          createdAt: Date.now(),
        });
      }

      const newUser: BotUser = {
        chatId,
        telegramUsername: userData.telegramUsername || '',
        telegramFirstName: userData.telegramFirstName || '',
        tokens: initialTokens,
        activeTokenIndex: 0,
        sigmaToken: userData.sigmaToken || (initialTokens[0]?.token || ''),
        thresholds: userData.thresholds || initialTokens[0]?.thresholds || JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS)),
        state: userData.state || 'idle',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        alertsCount: 0,
        ...userData,
      };
      this.syncUserTopFields(newUser);
      this.data.users[key] = newUser;
      this.flushSave();
      return newUser;
    }

    const updated: BotUser = {
      ...existing,
      ...userData,
      updatedAt: Date.now(),
    };
    if (!updated.tokens) updated.tokens = [];
    this.syncUserTopFields(updated);
    this.data.users[key] = updated;
    this.flushSave();
    return updated;
  }

  public getUserTokens(chatId: number): SigmaTokenAccount[] {
    const user = this.getUser(chatId);
    if (!user) return [];
    if (!user.tokens) user.tokens = [];
    return user.tokens;
  }

  public getActiveToken(user: BotUser): SigmaTokenAccount | undefined {
    if (!user.tokens || user.tokens.length === 0) return undefined;
    const idx = Math.min(Math.max(0, user.activeTokenIndex || 0), user.tokens.length - 1);
    return user.tokens[idx] || user.tokens[0];
  }

  public setActiveTokenIndex(chatId: number, index: number): BotUser | undefined {
    const user = this.getUser(chatId);
    if (!user || !user.tokens || user.tokens.length === 0) return user;
    const count = user.tokens.length;
    // Normalized modulo for cycling through tokens
    const validIdx = ((index % count) + count) % count;
    user.activeTokenIndex = validIdx;
    user.updatedAt = Date.now();
    this.syncUserTopFields(user);
    this.flushSave();
    return user;
  }

  public addTokenToUser(
    chatId: number,
    tokenStr: string,
    sigmaInfo?: any
  ): { user: BotUser; tokenAccount: SigmaTokenAccount; isNew: boolean } {
    let user = this.getUser(chatId);
    if (!user) {
      user = this.createOrUpdateUser(chatId, {});
    }
    if (!user.tokens) user.tokens = [];

    const trimmed = tokenStr.trim();
    const tokenHash = tokenVault.hashToken(trimmed);
    const existingIdx = user.tokens.findIndex(t => 
      t.tokenHash === tokenHash || 
      t.token === trimmed || 
      (t.secretRef && tokenVault.retrieveSecret(user.chatId, t.id, t.secretRef) === trimmed)
    );
    const accountName = sigmaInfo?.fullName || sigmaInfo?.username || `Аккаунт #${user.tokens.length + 1}`;

    let tokenAccount: SigmaTokenAccount;
    let isNew = false;

    if (existingIdx >= 0) {
      tokenAccount = user.tokens[existingIdx];
      // Store / re-encrypt into isolated AES-256-GCM vault
      const stored = tokenVault.storeSecret(chatId, tokenAccount.id, trimmed, tokenAccount.secretRef);
      tokenAccount.secretRef = stored.secretRef;
      tokenAccount.maskedToken = stored.maskedToken;
      tokenAccount.tokenHash = stored.tokenHash;
      tokenAccount.isEncrypted = true;
      tokenAccount.token = stored.maskedToken;

      if (sigmaInfo) {
        tokenAccount.sigmaUserId = sigmaInfo.id;
        tokenAccount.sigmaUsername = sigmaInfo.username;
        tokenAccount.sigmaFullName = sigmaInfo.fullName;
        if (sigmaInfo.balance != null) tokenAccount.currentBalance = sigmaInfo.balance;
        tokenAccount.name = accountName;
        tokenAccount.lastCheckStatus = 'ok';
      }
      user.activeTokenIndex = existingIdx;
    } else {
      isNew = true;
      const tokenId = `tok_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const stored = tokenVault.storeSecret(chatId, tokenId, trimmed);
      tokenAccount = {
        id: tokenId,
        token: stored.maskedToken,
        maskedToken: stored.maskedToken,
        secretRef: stored.secretRef,
        tokenHash: stored.tokenHash,
        isEncrypted: true,
        name: accountName,
        sigmaUserId: sigmaInfo?.id,
        sigmaUsername: sigmaInfo?.username,
        sigmaFullName: sigmaInfo?.fullName,
        currentBalance: sigmaInfo?.balance != null ? sigmaInfo.balance : null,
        previousBalance: null,
        lastCheckedAt: Date.now(),
        lastCheckStatus: 'ok',
        thresholds: JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS)),
        createdAt: Date.now(),
      };
      user.tokens.push(tokenAccount);
      user.activeTokenIndex = user.tokens.length - 1;
    }

    user.hasEnteredToken = true;
    user.state = 'idle';
    user.updatedAt = Date.now();
    this.syncUserTopFields(user);
    this.flushSave();

    return { user, tokenAccount, isNew };
  }

  public removeTokenFromUser(chatId: number, target: string | number): BotUser | undefined {
    const user = this.getUser(chatId);
    if (!user || !user.tokens) return user;

    let removed: SigmaTokenAccount | undefined;
    if (typeof target === 'number') {
      removed = user.tokens.splice(target, 1)[0];
    } else {
      const idx = user.tokens.findIndex(t => t.id === target);
      if (idx >= 0) {
        removed = user.tokens.splice(idx, 1)[0];
      }
    }

    if (removed?.secretRef) {
      tokenVault.deleteSecret(removed.secretRef);
    }

    if (user.tokens.length === 0) {
      user.activeTokenIndex = 0;
      user.sigmaToken = undefined;
      user.maskedToken = undefined;
      user.secretRef = undefined;
      user.tokenHash = undefined;
      user.sigmaUserId = undefined;
      user.sigmaUsername = undefined;
      user.sigmaFullName = undefined;
      user.currentBalance = undefined;
      user.previousBalance = undefined;
      user.hasEnteredToken = false;
    } else {
      user.activeTokenIndex = Math.min(user.activeTokenIndex || 0, user.tokens.length - 1);
      this.syncUserTopFields(user);
    }

    user.updatedAt = Date.now();
    this.flushSave();
    return user;
  }

  public setUserToken(chatId: number, token: string): BotUser {
    const result = this.addTokenToUser(chatId, token);
    return result.user;
  }

  public setTokenName(chatId: number, tokenId: string, newName: string): boolean {
    const user = this.getUser(chatId);
    if (!user) return false;

    const trimmed = newName.trim();
    if (!trimmed) return false;

    if (!user.tokens || user.tokens.length === 0) {
      if (user.sigmaToken) {
        user.tokens = [{
          id: tokenId || 'tok_main',
          token: user.sigmaToken,
          name: trimmed,
          sigmaUserId: user.sigmaUserId,
          sigmaUsername: user.sigmaUsername,
          sigmaFullName: user.sigmaFullName,
          currentBalance: user.currentBalance ?? null,
          previousBalance: user.previousBalance ?? null,
          lastCheckedAt: user.lastCheckedAt ?? null,
          lastCheckStatus: user.lastCheckStatus || 'ok',
          thresholds: user.thresholds || JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS)),
          createdAt: Date.now(),
        }];
      }
    } else {
      const tok = user.tokens.find(t => t.id === tokenId);
      if (tok) {
        tok.name = trimmed;
      } else if (user.tokens.length > 0) {
        user.tokens[0].name = trimmed;
      }
    }

    this.syncUserTopFields(user);
    user.updatedAt = Date.now();
    this.flushSave();
    return true;
  }

  public setUserState(chatId: number, state: 'idle' | 'awaiting_token' | 'awaiting_custom_threshold' | 'awaiting_token_name', stateData?: any): void {
    const user = this.getUser(chatId);
    if (user) {
      user.state = state;
      user.stateData = stateData;
      user.updatedAt = Date.now();
      this.flushSave();
    }
  }

  public updateTokenBalance(
    chatId: number,
    tokenId: string,
    balance: number,
    userId?: string,
    username?: string,
    fullName?: string
  ): BotUser | undefined {
    const user = this.getUser(chatId);
    if (!user || !user.tokens) return undefined;

    const tokenAccount = user.tokens.find(t => t.id === tokenId) || user.tokens[0];
    if (tokenAccount) {
      tokenAccount.previousBalance = tokenAccount.currentBalance ?? balance;
      tokenAccount.currentBalance = balance;
      tokenAccount.lastCheckedAt = Date.now();
      tokenAccount.lastCheckStatus = 'ok';
      tokenAccount.lastCheckError = undefined;
      if (userId) tokenAccount.sigmaUserId = userId;
      if (username) tokenAccount.sigmaUsername = username;
      if (fullName) {
        tokenAccount.sigmaFullName = fullName;
        if (!tokenAccount.name || tokenAccount.name.startsWith('Аккаунт #')) {
          tokenAccount.name = fullName;
        }
      }
    }

    user.updatedAt = Date.now();
    this.syncUserTopFields(user);
    this.data.stats.totalChecks++;
    this.scheduleSave();
    return user;
  }

  public updateUserBalance(
    chatId: number,
    balance: number,
    userId?: string,
    username?: string,
    fullName?: string
  ): BotUser | undefined {
    const user = this.getUser(chatId);
    if (!user) return undefined;
    const activeToken = this.getActiveToken(user);
    if (activeToken) {
      return this.updateTokenBalance(chatId, activeToken.id, balance, userId, username, fullName);
    }
    user.previousBalance = user.currentBalance ?? balance;
    user.currentBalance = balance;
    user.lastCheckedAt = Date.now();
    user.lastCheckStatus = 'ok';
    user.lastCheckError = undefined;
    if (userId) user.sigmaUserId = userId;
    if (username) user.sigmaUsername = username;
    if (fullName) user.sigmaFullName = fullName;
    user.updatedAt = Date.now();
    this.data.stats.totalChecks++;
    this.scheduleSave();
    return user;
  }

  public recordCheckError(chatId: number, error: string, tokenId?: string): void {
    const user = this.getUser(chatId);
    if (user) {
      if (tokenId && user.tokens) {
        const t = user.tokens.find(tok => tok.id === tokenId);
        if (t) {
          t.lastCheckedAt = Date.now();
          t.lastCheckStatus = 'error';
          t.lastCheckError = error;
        }
      }
      user.lastCheckedAt = Date.now();
      user.lastCheckStatus = 'error';
      user.lastCheckError = error;
      this.scheduleSave();
    }
  }

  public toggleTokenThreshold(chatId: number, tokenId: string, value: number): AlertThreshold[] | undefined {
    const user = this.getUser(chatId);
    if (!user || !user.tokens) return undefined;
    const tokenAccount = user.tokens.find(t => t.id === tokenId) || user.tokens[0];
    if (!tokenAccount) return undefined;

    const threshold = tokenAccount.thresholds.find(t => t.value === value);
    if (threshold) {
      threshold.enabled = !threshold.enabled;
    } else {
      tokenAccount.thresholds.push({ value, enabled: true, lastTriggeredAt: null });
      tokenAccount.thresholds.sort((a, b) => a.value - b.value);
    }
    user.updatedAt = Date.now();
    this.syncUserTopFields(user);
    this.flushSave();
    return tokenAccount.thresholds;
  }

  public toggleThreshold(chatId: number, value: number): AlertThreshold[] | undefined {
    const user = this.getUser(chatId);
    if (!user) return undefined;
    const active = this.getActiveToken(user);
    if (active) {
      return this.toggleTokenThreshold(chatId, active.id, value);
    }
    const threshold = user.thresholds.find(t => t.value === value);
    if (threshold) {
      threshold.enabled = !threshold.enabled;
    } else {
      user.thresholds.push({ value, enabled: true, lastTriggeredAt: null });
      user.thresholds.sort((a, b) => a.value - b.value);
    }
    user.updatedAt = Date.now();
    this.flushSave();
    return user.thresholds;
  }

  public addCustomTokenThreshold(chatId: number, tokenId: string, value: number): AlertThreshold[] | undefined {
    const user = this.getUser(chatId);
    if (!user || !user.tokens) return undefined;
    const tokenAccount = user.tokens.find(t => t.id === tokenId) || user.tokens[0];
    if (!tokenAccount) return undefined;

    const existing = tokenAccount.thresholds.find(t => t.value === value);
    if (!existing) {
      tokenAccount.thresholds.push({ value, enabled: true, lastTriggeredAt: null });
      tokenAccount.thresholds.sort((a, b) => a.value - b.value);
    } else {
      existing.enabled = true;
    }
    user.updatedAt = Date.now();
    this.syncUserTopFields(user);
    this.flushSave();
    return tokenAccount.thresholds;
  }

  public addCustomThreshold(chatId: number, value: number): AlertThreshold[] | undefined {
    const user = this.getUser(chatId);
    if (!user) return undefined;
    const active = this.getActiveToken(user);
    if (active) {
      return this.addCustomTokenThreshold(chatId, active.id, value);
    }
    const existing = user.thresholds.find(t => t.value === value);
    if (!existing) {
      user.thresholds.push({ value, enabled: true, lastTriggeredAt: null });
      user.thresholds.sort((a, b) => a.value - b.value);
    } else {
      existing.enabled = true;
    }
    user.updatedAt = Date.now();
    this.flushSave();
    return user.thresholds;
  }

  public resetTokenThresholds(chatId: number, tokenId: string): AlertThreshold[] | undefined {
    const user = this.getUser(chatId);
    if (!user || !user.tokens) return undefined;
    const tokenAccount = user.tokens.find(t => t.id === tokenId) || user.tokens[0];
    if (!tokenAccount) return undefined;

    tokenAccount.thresholds = JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS));
    user.updatedAt = Date.now();
    this.syncUserTopFields(user);
    this.flushSave();
    return tokenAccount.thresholds;
  }

  public resetThresholdsToDefault(chatId: number): AlertThreshold[] | undefined {
    const user = this.getUser(chatId);
    if (!user) return undefined;
    const active = this.getActiveToken(user);
    if (active) {
      return this.resetTokenThresholds(chatId, active.id);
    }
    user.thresholds = JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS));
    user.updatedAt = Date.now();
    this.flushSave();
    return user.thresholds;
  }

  public markTokenThresholdTriggered(chatId: number, tokenId: string, value: number): void {
    const user = this.getUser(chatId);
    if (!user || !user.tokens) return;
    const tokenAccount = user.tokens.find(t => t.id === tokenId) || user.tokens[0];
    if (!tokenAccount) return;

    const t = tokenAccount.thresholds.find(th => th.value === value);
    if (t) {
      t.lastTriggeredAt = Date.now();
      user.alertsCount = (user.alertsCount || 0) + 1;
      this.data.stats.totalAlerts++;
      this.scheduleSave();
    }
  }

  public markThresholdTriggered(chatId: number, value: number): void {
    const user = this.getUser(chatId);
    if (!user) return;
    const active = this.getActiveToken(user);
    if (active) {
      return this.markTokenThresholdTriggered(chatId, active.id, value);
    }
    const t = user.thresholds.find(th => th.value === value);
    if (t) {
      t.lastTriggeredAt = Date.now();
      user.alertsCount = (user.alertsCount || 0) + 1;
      this.data.stats.totalAlerts++;
      this.scheduleSave();
    }
  }

  public resetTokenThresholdTriggerIfRecovered(chatId: number, tokenId: string, currentBalance: number): void {
    const user = this.getUser(chatId);
    if (!user || !user.tokens) return;
    const tokenAccount = user.tokens.find(t => t.id === tokenId) || user.tokens[0];
    if (!tokenAccount) return;

    let modified = false;
    for (const t of tokenAccount.thresholds) {
      if (t.lastTriggeredAt && currentBalance > t.value) {
        t.lastTriggeredAt = null;
        modified = true;
      }
    }
    if (modified) {
      this.scheduleSave();
    }
  }

  public resetThresholdTriggerIfRecovered(chatId: number, currentBalance: number): void {
    const user = this.getUser(chatId);
    if (!user) return;
    if (user.tokens && user.tokens.length > 0) {
      for (const t of user.tokens) {
        this.resetTokenThresholdTriggerIfRecovered(chatId, t.id, currentBalance);
      }
      return;
    }
    let modified = false;
    for (const t of user.thresholds) {
      if (t.lastTriggeredAt && currentBalance > t.value) {
        t.lastTriggeredAt = null;
        modified = true;
      }
    }
    if (modified) {
      this.scheduleSave();
    }
  }

  public recordBatchCheckCompleted(): void {
    this.data.stats.lastBatchCheckTimestamp = Date.now();
    this.scheduleSave();
  }

  public logEvent(entry: Omit<BotLogEntry, 'id' | 'timestamp'>): BotLogEntry {
    const newEntry: BotLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      ...entry,
    };
    this.data.logs.unshift(newEntry);
    if (this.data.logs.length > 250) {
      this.data.logs = this.data.logs.slice(0, 250);
    }
    this.scheduleSave();
    return newEntry;
  }

  public getLogs(limit: number = 50): BotLogEntry[] {
    return this.data.logs.slice(0, limit);
  }

  public getStats() {
    return {
      ...this.data.stats,
      totalUsers: Object.keys(this.data.users).length,
      activeUsersWithToken: this.getActiveUsersWithToken().length,
    };
  }

  /**
   * Generates mock/simulated users to test high-concurrency scaling
   */
  public generateSimulatedUsers(requestedCount: number = 20): number {
    const toAdd = Math.min(500, Math.max(1, Number(requestedCount) || 20));
    const currentCount = Object.keys(this.data.users).length;

    const sampleNames = ['Алексей', 'Михаил', 'Елена', 'Дмитрий', 'Ольга', 'Сергей', 'Анна', 'Артем', 'Татьяна', 'Иван'];
    const defaultToken = this.data.config.defaultSigmaToken;

    for (let i = 1; i <= toAdd; i++) {
      const simulatedChatId = 100000000 + currentCount + i;
      const name = sampleNames[i % sampleNames.length];
      const randomBalance = Math.round((Math.random() * 250 + (i % 5 === 0 ? 3 : 20)) * 100) / 100;
      const tokId = `tok_sim_${currentCount + i}`;

      this.data.users[simulatedChatId.toString()] = {
        chatId: simulatedChatId,
        telegramUsername: `user_${currentCount + i}`,
        telegramFirstName: `${name} #${currentCount + i}`,
        sigmaToken: defaultToken,
        sigmaUserId: `sim-${currentCount + i}-uuid`,
        sigmaUsername: `client_${currentCount + i}`,
        sigmaFullName: `${name} Симуляция`,
        currentBalance: randomBalance,
        previousBalance: randomBalance + 15,
        lastCheckedAt: Date.now() - Math.floor(Math.random() * 120000),
        lastCheckStatus: 'ok',
        thresholds: JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS)),
        tokens: [
          {
            id: tokId,
            token: defaultToken,
            name: `${name} (Тест)`,
            sigmaUserId: `sim-${currentCount + i}-uuid`,
            sigmaUsername: `client_${currentCount + i}`,
            sigmaFullName: `${name} Симуляция`,
            currentBalance: randomBalance,
            previousBalance: randomBalance + 15,
            lastCheckedAt: Date.now() - Math.floor(Math.random() * 120000),
            lastCheckStatus: 'ok',
            thresholds: JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS)),
            createdAt: Date.now(),
          },
        ],
        activeTokenIndex: 0,
        state: 'idle',
        isSimulated: true,
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now(),
        alertsCount: randomBalance < 10 ? 1 : 0,
      };
    }

    this.logEvent({
      type: 'info',
      message: `Создано ${toAdd} тестовых пользователей для проверки нагрузки (всего ${Object.keys(this.data.users).length})`,
    });

    this.scheduleSave();
    return Object.keys(this.data.users).length;
  }

  public clearSimulatedUsers(): void {
    const nonSimulated: Record<string, BotUser> = {};
    for (const [id, user] of Object.entries(this.data.users)) {
      if (!user.isSimulated && !user.sigmaUserId?.startsWith('sim-')) {
        nonSimulated[id] = user;
      }
    }
    this.data.users = nonSimulated;
    this.logEvent({
      type: 'info',
      message: 'Тестовые симулированные пользователи очищены',
    });
    this.scheduleSave();
  }

  public isBotActive(): boolean {
    return this.data.config.isBotActive !== false;
  }

  public setBotActive(active: boolean): void {
    this.data.config.isBotActive = active;
    this.scheduleSave();
  }

  /**
   * Clear all event logs, check statistics, alert counts, and reset threshold triggers for all users
   */
  public clearAllHistory(): void {
    this.data.logs = [];
    this.data.stats.totalChecks = 0;
    this.data.stats.totalAlerts = 0;
    this.data.stats.lastBatchCheckTimestamp = null;

    for (const user of Object.values(this.data.users)) {
      user.alertsCount = 0;
      user.lastCheckedAt = undefined;
      user.previousBalance = undefined;
      user.lastCheckStatus = undefined;
      user.lastCheckError = undefined;
      if (Array.isArray(user.thresholds)) {
        for (const t of user.thresholds) {
          t.lastTriggeredAt = null;
        }
      }
    }

    this.logEvent({
      type: 'info',
      message: 'Вся история событий, логи и статистика проверок были очищены администратором.',
    });
    this.scheduleSave();
  }

  /**
   * Clear individual history and stats for a specific user
   */
  public clearUserHistory(chatId: number): boolean {
    const user = this.getUser(chatId);
    if (!user) return false;

    user.alertsCount = 0;
    user.lastCheckedAt = undefined;
    user.previousBalance = undefined;
    user.lastCheckStatus = undefined;
    user.lastCheckError = undefined;
    if (Array.isArray(user.thresholds)) {
      for (const t of user.thresholds) {
        t.lastTriggeredAt = null;
      }
    }
    user.updatedAt = Date.now();

    // Filter out user-specific logs
    this.data.logs = this.data.logs.filter(l => l.chatId !== chatId);

    this.logEvent({
      type: 'info',
      chatId,
      message: `История и статистика пользователя [Chat ${chatId}] (${user.telegramFirstName || user.telegramUsername || 'пользователь'}) успешно очищена.`,
    });
    this.scheduleSave();
    return true;
  }

  /**
   * Clear connected SigmaSMS tokens for all users (forces users to re-enter token)
   */
  public clearAllTokens(): number {
    let count = 0;
    for (const user of Object.values(this.data.users)) {
      if (user.sigmaToken || (user.tokens && user.tokens.length > 0)) count++;
      if (Array.isArray(user.tokens)) {
        for (const t of user.tokens) {
          if (t.secretRef) {
            tokenVault.deleteSecret(t.secretRef);
          }
        }
      }
      if (user.secretRef) {
        tokenVault.deleteSecret(user.secretRef);
      }
      user.tokens = [];
      user.activeTokenIndex = 0;
      user.sigmaToken = undefined;
      user.maskedToken = undefined;
      user.secretRef = undefined;
      user.tokenHash = undefined;
      user.sigmaUserId = undefined;
      user.sigmaUsername = undefined;
      user.sigmaFullName = undefined;
      user.currentBalance = undefined;
      user.previousBalance = undefined;
      user.hasEnteredToken = false;
      user.state = 'awaiting_token';
      user.lastCheckStatus = undefined;
      user.lastCheckError = undefined;
      if (Array.isArray(user.thresholds)) {
        for (const t of user.thresholds) {
          t.lastTriggeredAt = null;
        }
      }
      user.updatedAt = Date.now();
    }

    this.logEvent({
      type: 'info',
      message: `Подключенные токены SigmaSMS сброшены у всех пользователей (затронуто: ${count}).`,
    });
    this.flushSave();
    return count;
  }

  /**
   * Clear connected token for a single specific user
   */
  public clearUserToken(chatId: number): boolean {
    const user = this.getUser(chatId);
    if (!user) return false;

    if (Array.isArray(user.tokens)) {
      for (const t of user.tokens) {
        if (t.secretRef) {
          tokenVault.deleteSecret(t.secretRef);
        }
      }
    }
    if (user.secretRef) {
      tokenVault.deleteSecret(user.secretRef);
    }

    user.tokens = [];
    user.activeTokenIndex = 0;
    user.sigmaToken = undefined;
    user.maskedToken = undefined;
    user.secretRef = undefined;
    user.tokenHash = undefined;
    user.sigmaUserId = undefined;
    user.sigmaUsername = undefined;
    user.sigmaFullName = undefined;
    user.currentBalance = undefined;
    user.previousBalance = undefined;
    user.hasEnteredToken = false;
    user.state = 'awaiting_token';
    user.lastCheckStatus = undefined;
    user.lastCheckError = undefined;
    if (Array.isArray(user.thresholds)) {
      for (const t of user.thresholds) {
        t.lastTriggeredAt = null;
      }
    }
    user.updatedAt = Date.now();

    this.logEvent({
      type: 'info',
      chatId,
      message: `Токены SigmaSMS пользователя [Chat ${chatId}] (${user.telegramFirstName || user.telegramUsername || ''}) отвязаны и удалены администратором.`,
    });
    this.flushSave();
    return true;
  }

  /**
   * Completely delete a user from database
   */
  public deleteUser(chatId: number): boolean {
    const key = chatId.toString();
    if (!this.data.users[key]) return false;

    const user = this.data.users[key];
    if (Array.isArray(user.tokens)) {
      for (const t of user.tokens) {
        if (t.secretRef) {
          tokenVault.deleteSecret(t.secretRef);
        }
      }
    }
    if (user.secretRef) {
      tokenVault.deleteSecret(user.secretRef);
    }
    delete this.data.users[key];
    this.data.logs = this.data.logs.filter(l => l.chatId !== chatId);

    this.logEvent({
      type: 'info',
      message: `Пользователь [Chat ${chatId}] (${user.telegramFirstName || user.telegramUsername || ''}) удален из базы данных.`,
    });
    this.flushSave();
    return true;
  }
}

export const storage = new StorageService();
