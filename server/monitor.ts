/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { storage } from './storage.js';
import { checkSigmaBalanceRealtime } from './sigmasms.js';
import { telegramBot } from './telegram.js';
import { BotUser } from '../src/types.js';

class BalanceMonitorService {
  private timer: NodeJS.Timeout | null = null;
  private isChecking: boolean = false;
  private checkIntervalSeconds: number = 60;

  constructor() {
    this.checkIntervalSeconds = storage.getConfig().checkIntervalSeconds || 60;
  }

  public start() {
    if (this.timer) clearInterval(this.timer);

    console.log(`[Monitor] Background balance monitor started (interval: ${this.checkIntervalSeconds}s).`);
    storage.logEvent({
      type: 'info',
      message: `Фоновый мониторинг баланса запущен (интервал: ${this.checkIntervalSeconds} сек., поддержка 200+ пользователей).`,
    });

    // Run first check after 5 seconds to let bot boot
    setTimeout(() => {
      this.checkAllUsers();
    }, 5000);

    this.timer = setInterval(() => {
      this.checkAllUsers();
    }, this.checkIntervalSeconds * 1000);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[Monitor] Background balance monitor stopped.');
  }

  public setInterval(seconds: number) {
    this.checkIntervalSeconds = Math.max(10, seconds);
    storage.updateConfig({ checkIntervalSeconds: this.checkIntervalSeconds });
    this.start();
  }

  public getIsChecking(): boolean {
    return this.isChecking;
  }

  /**
   * High-concurrency batch checker for all active users (supports 200+ users seamlessly)
   */
  public async checkAllUsers(): Promise<{
    checkedCount: number;
    alertsCount: number;
    durationMs: number;
    errorsCount: number;
  }> {
    if (this.isChecking) {
      console.log('[Monitor] Check already in progress, skipping tick.');
      return { checkedCount: 0, alertsCount: 0, durationMs: 0, errorsCount: 0 };
    }

    this.isChecking = true;
    const startTime = Date.now();
    const users = storage.getActiveUsersWithToken();
    const config = storage.getConfig();
    const concurrencyLimit = config.maxConcurrentChecks || 8;

    let checkedCount = 0;
    let alertsCount = 0;
    let errorsCount = 0;

    if (users.length === 0) {
      this.isChecking = false;
      return { checkedCount: 0, alertsCount: 0, durationMs: 0, errorsCount: 0 };
    }

    // Process users in chunks to respect concurrency limit
    const chunks: BotUser[][] = [];
    for (let i = 0; i < users.length; i += concurrencyLimit) {
      chunks.push(users.slice(i, i + concurrencyLimit));
    }

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (user) => {
          try {
            const checkRes = await this.checkSingleUser(user);
            checkedCount++;
            if (checkRes.alertFired) alertsCount += checkRes.alertFired;
            if (!checkRes.success) errorsCount++;
          } catch (err: any) {
            errorsCount++;
            console.error(`[Monitor] Error checking user ${user.chatId}:`, err);
          }
        })
      );

      // Brief yield between chunks to prevent CPU spikes with 200+ users
      if (chunks.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    const durationMs = Date.now() - startTime;
    storage.recordBatchCheckCompleted();
    this.isChecking = false;

    if (checkedCount > 0) {
      storage.logEvent({
        type: 'check',
        message: `Фоновая проверка завершена: проверено ${checkedCount} пользователей за ${durationMs} мс. Алертов отправлено: ${alertsCount}.`,
      });
    }

    return { checkedCount, alertsCount, durationMs, errorsCount };
  }

  /**
   * Checks all tokens for a single user and evaluates all alert thresholds for each token
   */
  public async checkSingleUser(user: BotUser): Promise<{
    success: boolean;
    balance?: number;
    alertFired: number;
    error?: string;
  }> {
    const tokens = (user.tokens && user.tokens.length > 0)
      ? user.tokens
      : user.sigmaToken
      ? [
          {
            id: 'tok_main',
            token: user.sigmaToken,
            name: user.sigmaFullName || user.sigmaUsername || 'Основной',
            sigmaUserId: user.sigmaUserId,
            sigmaUsername: user.sigmaUsername,
            sigmaFullName: user.sigmaFullName,
            currentBalance: user.currentBalance ?? null,
            previousBalance: user.previousBalance ?? null,
            lastCheckedAt: user.lastCheckedAt ?? null,
            lastCheckStatus: user.lastCheckStatus || 'ok',
            thresholds: user.thresholds || [],
            createdAt: Date.now(),
          },
        ]
      : [];

    if (tokens.length === 0) {
      return { success: false, alertFired: 0, error: 'Нет токенов' };
    }

    let totalAlertsFired = 0;
    let anySuccess = false;
    let lastError: string | undefined;

    for (let idx = 0; idx < tokens.length; idx++) {
      const tokenAccount = tokens[idx];
      const isSimulated = user.isSimulated || user.chatId >= 100000000;
      const realToken = isSimulated ? 'simulated' : storage.resolveToken(user, tokenAccount);
      if (!realToken && !isSimulated) continue;

      let newBalance: number;
      let userId: string | undefined = tokenAccount.sigmaUserId;
      let username: string | undefined = tokenAccount.sigmaUsername;
      let fullName: string | undefined = tokenAccount.sigmaFullName;

      if (isSimulated) {
        // High-speed simulated check
        const current = tokenAccount.currentBalance ?? 50;
        const delta = (Math.random() - 0.55) * 5;
        newBalance = Math.round((current + delta) * 100) / 100;
        anySuccess = true;
      } else {
        const result = await checkSigmaBalanceRealtime(realToken!, tokenAccount.sigmaUserId);
        if (!result.success) {
          lastError = result.error || 'Ошибка запроса';
          storage.recordCheckError(user.chatId, lastError, tokenAccount.id);
          continue;
        }

        newBalance = result.balance ?? 0;
        userId = result.id;
        username = result.username;
        fullName = result.fullName;
        anySuccess = true;
      }

      const prevBalance = tokenAccount.currentBalance;

      // Update token in storage
      storage.updateTokenBalance(
        user.chatId,
        tokenAccount.id,
        newBalance,
        userId,
        username,
        fullName
      );

      // Reset rearm for recovered thresholds on this token
      storage.resetTokenThresholdTriggerIfRecovered(user.chatId, tokenAccount.id, newBalance);

      // Check alert thresholds for this token
      const thresholds = tokenAccount.thresholds || [];
      const accountDisplay = tokenAccount.name || fullName || username || `Аккаунт #${idx + 1}`;

      for (const threshold of thresholds) {
        if (!threshold.enabled) continue;

        // Condition: balance reached or fell below threshold (supports negative thresholds e.g. -100k <= -50k)
        const isBelowOrAt = newBalance <= threshold.value;
        const wasAbove = prevBalance == null || prevBalance > threshold.value;
        const notYetTriggered = !threshold.lastTriggeredAt;

        if (isBelowOrAt && (wasAbove || notYetTriggered)) {
          if (user.isSimulated || user.chatId >= 100000000) {
            storage.markTokenThresholdTriggered(user.chatId, tokenAccount.id, threshold.value);
            storage.logEvent({
              type: 'alert',
              chatId: user.chatId,
              username: username || 'SimulatedUser',
              message: `[Симуляция] [${accountDisplay}] Сработал порог: баланс ${newBalance} ₽ <= ${threshold.value} ₽`,
            });
            totalAlertsFired++;
          } else {
            // Mark triggered in storage
            storage.markTokenThresholdTriggered(user.chatId, tokenAccount.id, threshold.value);

            // Send real Telegram alert to the chat with link to user.sigmasms.ru
            const sent = await telegramBot.sendAlertNotification(user.chatId, {
              threshold: threshold.value,
              currentBalance: newBalance,
              previousBalance: prevBalance,
              username: fullName || username || 'Клиент Sigma',
              tokenLabel: tokenAccount.name || `Аккаунт #${idx + 1}`,
              userId: userId || 'unknown',
            });

            if (sent) {
              totalAlertsFired++;
            }
          }
        }
      }
    }

    const updatedUser = storage.getUser(user.chatId);
    return {
      success: anySuccess,
      balance: updatedUser?.currentBalance ?? undefined,
      alertFired: totalAlertsFired,
      error: !anySuccess ? lastError : undefined,
    };
  }
}

export const balanceMonitor = new BalanceMonitorService();
