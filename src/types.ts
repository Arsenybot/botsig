/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AlertThreshold {
  value: number; // threshold in RUB (can be negative, e.g. -100000)
  enabled: boolean;
  lastTriggeredAt?: number | null; // timestamp when threshold was triggered
}

export interface SigmaTokenAccount {
  id: string; // unique id e.g. "tok_1"
  token: string; // resolved in memory on server; masked when sent to client
  maskedToken?: string; // e.g. "263e••••••••••••••••••••••••••••••••••••••••••••••••••••••••4ee0"
  secretRef?: string; // isolated vault reference pointer
  tokenHash?: string; // sha256 fingerprint for deduplication
  isEncrypted?: boolean; // indicator of AES-256-GCM protection
  name?: string; // label e.g. "Основной", "ООО Компания"
  sigmaUserId?: string;
  sigmaUsername?: string;
  sigmaFullName?: string;
  currentBalance?: number | null;
  previousBalance?: number | null;
  lastCheckedAt?: number | null;
  lastCheckStatus?: 'ok' | 'error' | 'pending';
  lastCheckError?: string;
  thresholds: AlertThreshold[];
  createdAt: number;
}

export interface BotUser {
  chatId: number;
  telegramUsername?: string;
  telegramFirstName?: string;
  tokens?: SigmaTokenAccount[]; // multiple tokens per account
  activeTokenIndex?: number; // currently selected token in slider/pager
  sigmaToken?: string;
  maskedToken?: string; // masked token for security
  secretRef?: string; // isolated vault pointer
  tokenHash?: string;
  sigmaUserId?: string;
  sigmaUsername?: string;
  sigmaFullName?: string;
  currentBalance?: number | null;
  previousBalance?: number | null;
  lastCheckedAt?: number | null;
  lastCheckStatus?: 'ok' | 'error' | 'pending';
  lastCheckError?: string;
  thresholds: AlertThreshold[];
  state?: 'idle' | 'awaiting_token' | 'awaiting_custom_threshold' | 'awaiting_token_name';
  stateData?: any;
  isSimulated?: boolean;
  hasStarted?: boolean;
  hasEnteredToken?: boolean;
  createdAt: number;
  updatedAt: number;
  alertsCount?: number;
}

export interface SigmaUserResponse {
  id: string;
  username: string;
  data?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    meta?: Record<string, any>;
    partnership?: Record<string, any>;
  };
  referralCode?: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
  ResellerId?: string | null;
  $verified?: boolean;
  balance: number;
}

export interface BotLogEntry {
  id: string;
  timestamp: number;
  type: 'info' | 'check' | 'alert' | 'command' | 'error';
  chatId?: number;
  username?: string;
  message: string;
  details?: any;
}

export interface BotConfig {
  telegramBotToken: string;
  defaultSigmaToken: string;
  checkIntervalSeconds: number;
  isPollingActive: boolean;
  isBotActive?: boolean;
  maxConcurrentChecks: number;
}

export interface BotStatus {
  botInfo: {
    id: number;
    username: string;
    firstName: string;
    isOnline: boolean;
  } | null;
  isPolling: boolean;
  isMonitoring?: boolean;
  isBotActive: boolean;
  config: {
    telegramBotToken: string;
    defaultSigmaToken: string;
    checkIntervalSeconds: number;
    maxConcurrentChecks: number;
  };
  stats: {
    totalChecks: number;
    totalAlerts: number;
    lastBatchCheckTimestamp: number | null;
    totalUsers: number;
    activeUsersWithToken: number;
  };
  uptimeSeconds: number;
  defaultThresholds?: AlertThreshold[];
}
