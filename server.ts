/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { storage, DEFAULT_THRESHOLDS } from './server/storage.js';
import { getSigmaMe, getSigmaUserById, checkSigmaBalanceRealtime } from './server/sigmasms.js';
import { telegramBot } from './server/telegram.js';
import { balanceMonitor } from './server/monitor.js';
import { tokenVault } from './server/security/vault.js';
import {
  validateAdminCredentials,
  generateAdminToken,
  verifyAdminToken,
  revokeAdminToken,
  requireAdminAuth,
  ADMIN_USERNAME,
} from './server/auth.js';

dotenv.config();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const serverStartTime = Date.now();

process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled rejection:', reason);
});

// Ensure database is flushed to disk cleanly before exit
process.on('SIGTERM', () => {
  console.log('[Process] SIGTERM received. Flushing database before exit...');
  storage.flushSave();
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('[Process] SIGINT received. Flushing database before exit...');
  storage.flushSave();
  process.exit(0);
});
process.on('beforeExit', () => {
  storage.flushSave();
});

async function startServer() {
  const app = express();

  // Standard CORS & headers for iframe preview compatibility
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  app.use(express.json());

  // Public health check route (used by Docker and Cloud.ru)
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: Math.floor((Date.now() - serverStartTime) / 1000),
      timestamp: Date.now(),
    });
  });

  // Public authentication routes
  app.post('/api/auth/login', (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Укажите логин и пароль' });
      }

      if (validateAdminCredentials(String(username), String(password))) {
        const token = generateAdminToken(String(username).trim());
        return res.json({
          success: true,
          token,
          user: { username: String(username).trim() },
        });
      }

      return res.status(401).json({
        success: false,
        message: 'Неверный логин или пароль администратора',
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Ошибка сервера' });
    }
  });

  app.get('/api/auth/me', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      const verification = verifyAdminToken(token);
      if (verification.valid) {
        return res.json({ authenticated: true, user: { username: verification.username } });
      }
    }
    return res.json({ authenticated: false });
  });

  app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      revokeAdminToken(token);
    }
    return res.json({ success: true, message: 'Успешный выход' });
  });

  // Protect all bot management and SigmaSMS testing routes with requireAdminAuth
  app.use('/api/bot', requireAdminAuth);
  app.use('/api/sigmasms', requireAdminAuth);

  // Get full bot status
  app.get('/api/bot/status', (req, res) => {
    try {
      const stats = storage.getStats();
      const config = storage.getConfig();
      const botInfo = telegramBot.getBotInfo();
      const isBotActive = storage.isBotActive();

      res.json({
        botInfo,
        isPolling: telegramBot.isPolling(),
        isMonitoring: isBotActive && !balanceMonitor.getIsChecking(),
        isBotActive,
        config: {
          telegramBotToken: config?.telegramBotToken ? `${config.telegramBotToken.substring(0, 10)}...` : '',
          defaultSigmaToken: config?.defaultSigmaToken ? `${config.defaultSigmaToken.substring(0, 8)}...` : '',
          checkIntervalSeconds: config?.checkIntervalSeconds || 60,
          maxConcurrentChecks: config?.maxConcurrentChecks || 10,
        },
        stats: stats || { totalChecks: 0, totalAlerts: 0, lastBatchCheckTimestamp: null, totalUsers: 0, activeUsersWithToken: 0 },
        uptimeSeconds: Math.floor((Date.now() - serverStartTime) / 1000),
        defaultThresholds: DEFAULT_THRESHOLDS,
      });
    } catch (err: any) {
      console.error('[API /api/bot/status] Error:', err);
      res.status(500).json({ error: 'Internal error', message: err?.message });
    }
  });

  // Toggle bot power (on / off)
  app.post('/api/bot/toggle-power', async (req, res) => {
    try {
      const { enabled } = req.body;
      const currentState = storage.isBotActive();
      const targetState = typeof enabled === 'boolean' ? enabled : !currentState;

      storage.setBotActive(targetState);

      if (targetState) {
        await telegramBot.start();
        balanceMonitor.start();
        storage.logEvent({
          type: 'info',
          message: 'Бот и фоновый мониторинг баланса ВКЛЮЧЕНЫ администратором.',
        });
      } else {
        telegramBot.stop();
        balanceMonitor.stop();
        storage.logEvent({
          type: 'info',
          message: 'Бот и фоновый мониторинг баланса ОТКЛЮЧЕНЫ администратором.',
        });
      }

      res.json({
        success: true,
        isBotActive: targetState,
        isPolling: telegramBot.isPolling(),
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Clear all history and logs for all users
  app.post('/api/bot/history/clear-all', (req, res) => {
    try {
      storage.clearAllHistory();
      res.json({ success: true, message: 'Вся история событий и статистика успешно очищены' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Clear history and stats for a single user
  app.post('/api/bot/user/:chatId/clear-history', (req, res) => {
    const chatId = parseInt(req.params.chatId, 10);
    const success = storage.clearUserHistory(chatId);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }
    res.json({ success: true, message: `История пользователя ${chatId} очищена` });
  });

  // Clear connected SigmaSMS tokens for all users
  app.post('/api/bot/tokens/clear-all', (req, res) => {
    try {
      const count = storage.clearAllTokens();
      res.json({
        success: true,
        count,
        message: `Все токены пользователей сброшены (${count} польз.)`,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Clear token for a single user
  app.post('/api/bot/user/:chatId/clear-token', (req, res) => {
    const chatId = parseInt(req.params.chatId, 10);
    const success = storage.clearUserToken(chatId);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }
    res.json({ success: true, message: `Токен пользователя ${chatId} удален` });
  });

  // Delete user completely from database
  app.delete('/api/bot/user/:chatId', (req, res) => {
    const chatId = parseInt(req.params.chatId, 10);
    const success = storage.deleteUser(chatId);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }
    res.json({ success: true, message: `Пользователь ${chatId} удален из базы` });
  });

  // Get users list (always masked and sanitized, plaintext tokens are never returned)
  app.get('/api/bot/users', (req, res) => {
    const users = storage.getAllUsersSanitized();
    res.json({
      total: users.length,
      users,
    });
  });

  // Get security status & vault statistics
  app.get('/api/bot/security', (req, res) => {
    try {
      const status = tokenVault.getSecurityStatus();
      res.json({
        success: true,
        ...status,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Get event logs
  app.get('/api/bot/logs', (req, res) => {
    const limit = parseInt(req.query.limit as string, 10) || 100;
    const logs = storage.getLogs(limit);
    res.json({ logs });
  });

  // Direct SigmaSMS API Tester endpoint
  app.post('/api/sigmasms/test', async (req, res) => {
    const { token, userId, mode } = req.body;
    const targetToken = token || storage.getConfig().defaultSigmaToken;

    if (!targetToken) {
      return res.status(400).json({ success: false, error: 'Токен SigmaSMS не предоставлен' });
    }

    try {
      if (mode === 'user_by_id' && userId) {
        const result = await getSigmaUserById(userId, targetToken);
        return res.json(result);
      } else if (mode === 'me_only') {
        const result = await getSigmaMe(targetToken);
        return res.json(result);
      } else {
        // Full sequence: /users/me -> /users/{id}
        const result = await checkSigmaBalanceRealtime(targetToken, userId);
        return res.json(result);
      }
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Trigger manual check for all users
  app.post('/api/bot/check-all', async (req, res) => {
    try {
      const result = await balanceMonitor.checkAllUsers();
      res.json({ success: true, result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Trigger check for single user
  app.post('/api/bot/check-user/:chatId', async (req, res) => {
    const chatId = parseInt(req.params.chatId, 10);
    const user = storage.getUser(chatId);

    if (!user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    try {
      const result = await balanceMonitor.checkSingleUser(user);
      res.json({ success: true, result, user: storage.getUserSanitized(chatId) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Send a test alert to Telegram
  app.post('/api/bot/send-test-alert', async (req, res) => {
    const { chatId, threshold, balance } = req.body;

    if (!chatId) {
      return res.status(400).json({ success: false, error: 'chatId обязателен' });
    }

    const user = storage.getUser(chatId);
    const sent = await telegramBot.sendAlertNotification(chatId, {
      threshold: Number(threshold) || 10,
      currentBalance: Number(balance) || (user?.currentBalance ?? 5.97),
      previousBalance: (Number(balance) || 5.97) + 10,
      username: user?.sigmaUsername || 'SigmaUser',
      userId: user?.sigmaUserId || '10002714-6e1d-43cd-8fde-95a0decc37f0',
    });

    res.json({ success: sent });
  });

  // Get Telegram bot token info for admin
  app.get('/api/bot/token', (req, res) => {
    try {
      const config = storage.getConfig();
      const botInfo = telegramBot.getBotInfo();
      res.json({
        token: config.telegramBotToken || '',
        isPolling: telegramBot.isPolling(),
        isBotActive: storage.isBotActive(),
        botInfo,
        defaultToken: '8948316828:AAEi6oVo9qm2nwt9YKxW46zhpN6Gqplld_0',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Change Telegram bot token with instant Telegram API verification
  app.post('/api/bot/token', async (req, res) => {
    try {
      const { token } = req.body;
      if (!token || typeof token !== 'string' || !token.trim()) {
        return res.status(400).json({ success: false, message: 'Токен бота не может быть пустым' });
      }

      const result = await telegramBot.updateToken(token.trim());
      return res.json({
        success: true,
        message: `Токен успешно обновлен! Подключен бот @${result.botInfo.username} (${result.botInfo.firstName}).`,
        botInfo: result.botInfo,
      });
    } catch (err: any) {
      console.error('[API] Error updating bot token:', err.message);
      return res.status(400).json({
        success: false,
        message: err.message || 'Ошибка проверки токена Telegram',
      });
    }
  });

  // Update configuration
  app.post('/api/bot/config', async (req, res) => {
    const { checkIntervalSeconds, telegramBotToken, defaultSigmaToken, maxConcurrentChecks } = req.body;

    const updates: any = {};
    if (checkIntervalSeconds && !isNaN(Number(checkIntervalSeconds))) {
      updates.checkIntervalSeconds = Number(checkIntervalSeconds);
      balanceMonitor.setInterval(updates.checkIntervalSeconds);
    }
    if (telegramBotToken && typeof telegramBotToken === 'string') {
      updates.telegramBotToken = telegramBotToken.trim();
      try {
        await telegramBot.updateToken(updates.telegramBotToken);
      } catch (err: any) {
        return res.status(400).json({ success: false, message: `Ошибка токена бота: ${err.message}` });
      }
    }
    if (defaultSigmaToken && typeof defaultSigmaToken === 'string') {
      updates.defaultSigmaToken = defaultSigmaToken.trim();
    }
    if (maxConcurrentChecks && !isNaN(Number(maxConcurrentChecks))) {
      updates.maxConcurrentChecks = Math.max(1, Math.min(50, Number(maxConcurrentChecks)));
    }

    const newConfig = storage.updateConfig(updates);
    res.json({ success: true, config: newConfig });
  });

  // Manage alert thresholds for user
  app.post('/api/bot/user/:chatId/thresholds', (req, res) => {
    const chatId = parseInt(req.params.chatId, 10);
    const { action, value } = req.body;

    let updated: any;
    if (action === 'toggle' && typeof value === 'number') {
      updated = storage.toggleThreshold(chatId, value);
    } else if (action === 'add' && typeof value === 'number') {
      updated = storage.addCustomThreshold(chatId, value);
    } else if (action === 'reset') {
      updated = storage.resetThresholdsToDefault(chatId);
    }

    if (!updated) {
      return res.status(400).json({ success: false, error: 'Не удалось обновить пороги' });
    }

    res.json({ success: true, thresholds: updated });
  });

  // Simulate / Stress test with users
  app.post('/api/bot/simulate-users', (req, res) => {
    const { action, count } = req.body;

    if (action === 'clear') {
      storage.clearSimulatedUsers();
      return res.json({ success: true, total: storage.getAllUsers().length, message: 'Тестовые пользователи очищены.' });
    }

    const targetCount = count && !isNaN(Number(count)) ? Math.max(1, Math.min(500, Math.floor(Number(count)))) : 10;
    const total = storage.generateSimulatedUsers(targetCount);
    res.json({ success: true, total, count: targetCount, message: `Сгенерировано ${targetCount} симулированных пользователей (всего в базе ${total}).` });
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== 'production') {
    const isHmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: isHmrDisabled ? false : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Bind to 0.0.0.0 and PORT 3000
  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`[Server] Express server running on http://0.0.0.0:${PORT}`);

    // Auto-start Telegram Bot and Monitor if enabled
    try {
      if (storage.isBotActive()) {
        await telegramBot.start();
        balanceMonitor.start();
      } else {
        console.log('[Server] Bot is currently disabled in settings. Ready to be enabled via Dashboard.');
      }
    } catch (err) {
      console.error('[Server] Failed to auto-start bot/monitor:', err);
    }
  });
}

startServer();
