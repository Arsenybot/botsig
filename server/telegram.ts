/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { storage, DEFAULT_THRESHOLDS } from './storage.js';
import { getSigmaMe, getSigmaUserById, checkSigmaBalanceRealtime } from './sigmasms.js';
import { SigmaTokenAccount } from '../src/types.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

export function escapeHtml(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface TelegramBotInfo {
  id: number;
  username: string;
  firstName: string;
  isOnline: boolean;
}

class TelegramBotService {
  private token: string = '';
  private isRunning: boolean = false;
  private pollOffset: number = 0;
  private botInfo: TelegramBotInfo | null = null;
  private abortController: AbortController | null = null;
  private pollingFailureCount: number = 0;

  constructor() {
    this.token = storage.getConfig().telegramBotToken;
  }

  public getBotInfo(): TelegramBotInfo | null {
    return this.botInfo;
  }

  public isPolling(): boolean {
    return this.isRunning;
  }

  public updateToken(newToken: string) {
    this.token = newToken.trim();
    storage.updateConfig({ telegramBotToken: this.token });
    if (this.isRunning) {
      this.stop();
      this.start();
    }
  }

  public async start() {
    if (this.isRunning) return;
    this.token = storage.getConfig().telegramBotToken;

    if (!this.token) {
      console.warn('[Telegram] No bot token configured.');
      return;
    }

    try {
      const me = await this.apiCall<{ id: number; username: string; first_name: string }>('getMe');
      if (me && me.id) {
        this.botInfo = {
          id: me.id,
          username: me.username,
          firstName: me.first_name,
          isOnline: true,
        };
        console.log(`[Telegram] Bot @${me.username} successfully connected.`);
        storage.logEvent({
          type: 'info',
          message: `Telegram бот @${me.username} (${me.first_name}) запущен и готов к приему сообщений.`,
        });
      }
    } catch (err: any) {
      console.error('[Telegram] Failed to initialize bot with getMe:', err.message);
      storage.logEvent({
        type: 'error',
        message: `Ошибка подключения Telegram бота: ${err.message}`,
      });
      return;
    }

    try {
      await this.apiCall('deleteWebhook', { drop_pending_updates: true });
      console.log('[Telegram] Webhook cleared before starting polling.');
    } catch (e) {
      console.warn('[Telegram] Could not delete webhook (probably none set):', e);
    }
    
    this.isRunning = true;
    this.abortController = new AbortController();
    this.pollLoop();
  }

  public stop() {
    this.isRunning = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.botInfo) {
      this.botInfo.isOnline = false;
    }
    console.log('[Telegram] Bot polling stopped.');
  }

  private async apiCall<T = any>(method: string, body?: any): Promise<T> {
    const url = `${TELEGRAM_API_BASE}/bot${this.token}/${method}`;
    const abortSignals: AbortSignal[] = [AbortSignal.timeout(35000)];
    if (this.abortController) {
      abortSignals.push(this.abortController.signal);
    }
    const combinedSignal = AbortSignal.any(abortSignals);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: combinedSignal,
    });

    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.description || `Telegram API error on ${method}`);
    }
    return data.result as T;
  }

  private async pollLoop() {
    while (this.isRunning) {
      try {
        const updates = await this.apiCall<any[]>('getUpdates', {
          offset: this.pollOffset,
          timeout: 20,
          allowed_updates: ['message', 'callback_query'],
        });

        this.pollingFailureCount = 0;

        if (Array.isArray(updates) && updates.length > 0) {
          for (const update of updates) {
            this.pollOffset = update.update_id + 1;
            await this.handleUpdate(update);
          }
        }
      } catch (err: any) {
        if (!this.isRunning) break;
        this.pollingFailureCount++;

        // Detect harmless long-polling socket dropouts or timeouts
        const isNetworkDrop =
          err.message?.includes('fetch failed') ||
          err.name === 'AbortError' ||
          err.name === 'TimeoutError' ||
          err.cause?.code === 'UND_ERR_SOCKET' ||
          err.cause?.code === 'ECONNRESET' ||
          err.cause?.code === 'ETIMEDOUT';

        if (isNetworkDrop && this.pollingFailureCount <= 2) {
          await new Promise(res => setTimeout(res, 1000));
          continue;
        }

        const backoffMs = Math.min(20000, 1000 * Math.pow(1.3, Math.min(this.pollingFailureCount, 5)));
        console.warn(`[Telegram] Reconnecting poll (${err.message || 'network reset'}). Next attempt in ${Math.round(backoffMs / 1000)}s...`);
        await new Promise(res => setTimeout(res, backoffMs));
      }
    }
  }

  private async handleUpdate(update: any) {
    try {
      if (update.message) {
        await this.handleMessage(update.message);
      } else if (update.callback_query) {
        await this.handleCallbackQuery(update.callback_query);
      }
    } catch (err: any) {
      console.error('[Telegram] Error processing update:', err);
    }
  }

  private getMainMenuKeyboard() {
    return {
      keyboard: [
        [{ text: '💰 Баланс всех токенов' }, { text: '🎛 Пороги алертов (слайдер)' }],
        [{ text: '🔑 Мои токены' }, { text: '➕ Добавить токен' }],
        [{ text: 'ℹ️ Помощь' }],
      ],
      resize_keyboard: true,
      persistent: true,
    };
  }

  private async handleMessage(msg: any) {
    const chatId = msg.chat?.id;
    if (!chatId) return;

    const text = (msg.text || '').trim();
    const fromUsername = msg.from?.username || '';
    const fromFirstName = msg.from?.first_name || '';

    // Register or retrieve user
    let user = storage.getUser(chatId);
    if (!user) {
      user = storage.createOrUpdateUser(chatId, {
        telegramUsername: fromUsername,
        telegramFirstName: fromFirstName,
      });
    } else {
      // Update username if changed
      if (fromUsername && user.telegramUsername !== fromUsername) {
        user = storage.createOrUpdateUser(chatId, { telegramUsername: fromUsername });
      }
    }

    const hasTokens = (user.tokens && user.tokens.length > 0) || (!!user.sigmaToken && user.sigmaToken.length > 0);

    const isTokenCandidate =
      user.state === 'awaiting_token' ||
      (!hasTokens && text.length > 20 && !text.startsWith('/')) ||
      (text.length >= 32 && /^[a-fA-F0-9_-]+$/.test(text));

    storage.logEvent({
      type: 'command',
      chatId,
      username: fromUsername,
      message: isTokenCandidate
        ? 'Получен ввод API-токена (скрыт в целях безопасности)'
        : `Получено сообщение: "${text}"`,
    });

    // Handle Commands
    if (text === '/start') {
      await this.handleStartCommand(chatId, fromFirstName, user);
      return;
    }

    if (text === '/help' || text === 'ℹ️ Помощь') {
      await this.handleHelpCommand(chatId);
      return;
    }

    if (text === '/balance' || text === '💰 Баланс' || text === '💰 Баланс всех токенов') {
      await this.handleBalanceCheck(chatId, user);
      return;
    }

    if (text === '/alerts' || text === '🔔 Уровни оповещений' || text === '🎛 Пороги алертов (слайдер)') {
      await this.handleAlertsMenu(chatId, user);
      return;
    }

    if (text === '/token' || text === '/tokens' || text === '🔑 Мой токен' || text === '🔑 Мои токены') {
      await this.handleTokensMenu(chatId, user);
      return;
    }

    if (text === '/addtoken' || text === '➕ Добавить токен') {
      storage.setUserState(chatId, 'awaiting_token');
      await this.sendMessage(
        chatId,
        `➕ <b>Добавление нового токена SigmaSMS</b>\n\n` +
        `Отправьте API-токен из личного кабинета <a href="https://user.sigmasms.ru">user.sigmasms.ru</a> ответным сообщением.\n\n` +
        `<i>Вы можете подключить несколько токенов для разных филиалов, юрлиц или проектов к одному Telegram-аккаунту!</i>`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✨ Использовать демонстрационный токен', callback_data: 'use_demo_token' }],
              [{ text: '❌ Отмена', callback_data: 'open_alerts' }],
            ],
          },
        }
      );
      return;
    }

    // Handle user states
    if (user.state === 'awaiting_custom_threshold') {
      await this.handleCustomThresholdInput(chatId, text, user);
      return;
    }

    if (user.state === 'awaiting_token_name') {
      await this.handleTokenNameInput(chatId, text, user);
      return;
    }

    // If user has no token or is in awaiting_token state or sent token candidate
    if (!hasTokens || user.state === 'awaiting_token' || isTokenCandidate) {
      await this.handlePotentialTokenInput(chatId, text, user, msg.message_id);
      return;
    }

    // Unknown command fallback
    await this.sendMessage(chatId, '❓ Неизвестная команда. Пожалуйста, воспользуйтесь меню ниже или отправьте /help.', {
      reply_markup: this.getMainMenuKeyboard(),
    });
  }

  private async handleStartCommand(chatId: number, firstName: string, user: any) {
    const hasTokens = (user.tokens && user.tokens.length > 0) || (!!user.sigmaToken && user.sigmaToken.length > 0);

    storage.createOrUpdateUser(chatId, { hasStarted: true });

    if (!hasTokens) {
      storage.setUserState(chatId, 'awaiting_token');

      const welcomeMsg = `👋 <b>Добро пожаловать, ${escapeHtml(firstName || 'пользователь')}!</b>

Я бот для мониторинга баланса <b>SigmaSMS</b> в реальном времени с поддержкой нескольких токенов и гибких порогов оповещений.

🔐 <b>Для начала работы, пожалуйста, укажите ваш API-токен SigmaSMS.</b>

📌 <b>Как получить токен:</b>
1. Перейдите в личный кабинет <a href="https://user.sigmasms.ru">user.sigmasms.ru</a>
2. Откройте настройки API в профиле
3. Скопируйте ваш API-токен

👉 <b>Отправьте токен ответным сообщением в этот чат.</b>
<i>(Вы сможете добавить любое количество токенов позже и переключаться между ними в слайдере!)</i>`;

      await this.sendMessage(chatId, welcomeMsg, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✨ Использовать демонстрационный токен', callback_data: 'use_demo_token' }],
          ],
        },
      });
    } else {
      const tokensCount = user.tokens?.length || 1;
      const welcomeBackMsg = `👋 <b>С возвращением, ${escapeHtml(firstName || 'пользователь')}!</b>

✅ Подключено токенов: <b>${tokensCount} шт.</b>
👤 Текущий аккаунт: <b>${escapeHtml(user.sigmaFullName || user.sigmaUsername || 'Подключен')}</b>
💰 Баланс: <b>${user.currentBalance != null ? escapeHtml(user.currentBalance) + ' ₽' : 'Не проверялся'}</b>

Выберите нужное действие в меню ниже:`;

      await this.sendMessage(chatId, welcomeBackMsg, {
        reply_markup: this.getMainMenuKeyboard(),
      });
    }
  }

  private async handlePotentialTokenInput(chatId: number, tokenCandidate: string, user: any, userMessageId?: number) {
    const cleanToken = tokenCandidate.trim();

    // Delete message with token to protect user's secret in chat history
    if (userMessageId) {
      await this.deleteMessage(chatId, userMessageId);
    }

    if (cleanToken.length < 15) {
      await this.sendMessage(
        chatId,
        '⚠️ Отправленный текст слишком короткий для токена SigmaSMS. Пожалуйста, отправьте корректный API-токен (обычно длинная шестнадцатеричная строка из личного кабинета).'
      );
      return;
    }

    const waitMsg = await this.sendMessage(chatId, '⏳ Проверяю ваш токен через API SigmaSMS (GET /api/users/me)...');

    // Test token with SigmaSMS
    const result = await checkSigmaBalanceRealtime(cleanToken);

    if (!result.success) {
      await this.editMessage(
        chatId,
        waitMsg.message_id,
        `❌ <b>Ошибка проверки токена!</b>\n\n` +
        `API вернуло: ${escapeHtml(result.error || 'Неверный токен авторизации')}.\n` +
        `Пожалуйста, проверьте токен в кабинете <a href="https://user.sigmasms.ru">user.sigmasms.ru</a> и отправьте его снова.`
      );
      return;
    }

    // Save token to user's tokens list
    const { user: updatedUser, tokenAccount, isNew } = storage.addTokenToUser(chatId, cleanToken, result);

    const userDisplay = `${escapeHtml(result.fullName || result.username || tokenAccount.name)}${result.username ? ` (@${escapeHtml(result.username)})` : ''}`;
    const allTokensCount = updatedUser.tokens?.length || 1;

    await this.editMessage(
      chatId,
      waitMsg.message_id,
      `🎉 <b>Токен успешно ${isNew ? 'добавлен' : 'обновлен'} и проверен!</b>\n` +
      `🔒 <i>(Исходное сообщение с токеном удалено из чата для вашей безопасности)</i>\n\n` +
      `🏷 <b>Аккаунт:</b> ${userDisplay}\n` +
      `💰 <b>Текущий баланс:</b> <b>${escapeHtml(result.balance)} ₽</b>\n` +
      `💼 <b>Всего токенов у вас:</b> ${allTokensCount} шт.\n\n` +
      `🔔 <i>Оповещения будут приходить в этот чат от всех ваших токенов независимо! Переключайтесь между ними в слайдере порогов.</i>`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '💰 Проверить баланс всех токенов', callback_data: 'refresh_balance' }],
            [{ text: '🎛 Настроить пороги (слайдер)', callback_data: 'open_alerts' }],
            [{ text: '➕ Добавить еще токен', callback_data: 'prompt_add_token' }],
          ],
        },
      }
    );

    // Also send the permanent reply keyboard
    await this.sendMessage(chatId, 'Используйте кнопки меню для быстрого доступа:', {
      reply_markup: this.getMainMenuKeyboard(),
    });

    storage.logEvent({
      type: 'info',
      chatId,
      message: `Пользователь подключил токен Sigma (${userDisplay}, баланс: ${result.balance} ₽, всего токенов: ${allTokensCount})`,
    });
  }

  /**
   * Checks and displays balances for ALL tokens connected to this user
   */
  public async handleBalanceCheck(chatId: number, user: any, messageIdToEdit?: number) {
    const tokens = storage.getUserTokens(chatId);

    if (tokens.length === 0 && !user.sigmaToken) {
      storage.setUserState(chatId, 'awaiting_token');
      await this.sendMessage(
        chatId,
        '⚠️ У вас пока не подключен токен SigmaSMS. Пожалуйста, отправьте ваш API-токен:',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✨ Использовать демонстрационный токен', callback_data: 'use_demo_token' }],
            ],
          },
        }
      );
      return;
    }

    const tokensToCheck: SigmaTokenAccount[] = tokens.length > 0
      ? tokens
      : [
          {
            id: 'tok_main',
            token: user.maskedToken || user.sigmaToken || '',
            maskedToken: user.maskedToken,
            secretRef: user.secretRef,
            tokenHash: user.tokenHash,
            name: user.sigmaFullName || user.sigmaUsername || 'Основной',
            sigmaUserId: user.sigmaUserId,
            sigmaUsername: user.sigmaUsername,
            sigmaFullName: user.sigmaFullName,
            currentBalance: user.currentBalance ?? null,
            thresholds: user.thresholds || [],
            createdAt: user.createdAt || Date.now(),
          },
        ];

    let waitMsg: any;
    if (messageIdToEdit) {
      await this.editMessage(chatId, messageIdToEdit, `⏳ Запрашиваю актуальный баланс по всем токенам (${tokensToCheck.length} шт.)...`);
      waitMsg = { message_id: messageIdToEdit };
    } else {
      waitMsg = await this.sendMessage(chatId, `⏳ Запрашиваю актуальный баланс по всем токенам (${tokensToCheck.length} шт.)...`);
    }

    // Check all tokens in parallel
    const results = await Promise.all(
      tokensToCheck.map(async (tok, idx) => {
        const realToken = storage.resolveToken(user, tok);
        if (!realToken) {
          return { tok, idx, success: false, error: 'Токен отсутствует или заблокирован' };
        }
        const res = await checkSigmaBalanceRealtime(realToken, tok.sigmaUserId);
        if (res.success && res.balance != null) {
          storage.updateTokenBalance(chatId, tok.id, res.balance, res.id, res.username, res.fullName);
        }
        return { tok, idx, success: res.success, res };
      })
    );

    const now = new Date();
    const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    let totalBalance = 0;
    let successfulCount = 0;
    let tokenRowsText = '';

    for (const item of results) {
      const { tok, idx, success, res } = item;
      const customName = tok.name?.trim();
      const sigmaOwner = res?.fullName || tok.sigmaFullName || res?.username || tok.sigmaUsername || '';

      let titleHeader = '';
      if (customName && sigmaOwner && customName !== sigmaOwner) {
        titleHeader = `🏷 <b>${escapeHtml(customName)}</b> <i>(👤 ${escapeHtml(sigmaOwner)})</i>`;
      } else if (customName) {
        titleHeader = `🏷 <b>${escapeHtml(customName)}</b>`;
      } else if (sigmaOwner) {
        titleHeader = `👤 <b>${escapeHtml(sigmaOwner)}</b>`;
      } else {
        titleHeader = `🔹 <b>Аккаунт #${idx + 1}</b>`;
      }

      if (success && res && res.balance != null) {
        totalBalance += res.balance;
        successfulCount++;

        const balanceBadge = res.balance <= 0 ? '🚨 ОТРИЦАТЕЛЬНЫЙ' : res.balance <= 10 ? '⚠️ КРИТИЧЕСКИЙ' : res.balance <= 50 ? '🟡 НИЗКИЙ' : '✅ В НОРМЕ';
        const activeThresholds = tok.thresholds?.filter((t: any) => t.enabled).length || 0;

        tokenRowsText += `━━━━━━━━━━━━━━━━━━━━\n` +
          `🔹 <b>[${idx + 1}/${tokensToCheck.length}]</b> ${titleHeader}\n` +
          `💰 Баланс: <b>${escapeHtml(res.balance)} ₽</b> [${balanceBadge}]\n` +
          `🔔 Активных порогов: <b>${activeThresholds} шт.</b>\n`;
      } else {
        tokenRowsText += `━━━━━━━━━━━━━━━━━━━━\n` +
          `⚠️ <b>[${idx + 1}/${tokensToCheck.length}]</b> ${titleHeader}\n` +
          `❌ Ошибка: ${escapeHtml(res?.error || 'Не удалось получить данные')}\n`;
      }
    }

    const totalBadge = totalBalance <= 0 ? '🚨' : totalBalance <= 100 ? '⚠️' : '✅';
    const totalFormatted = totalBalance.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const text = `💳 <b>Сводка по всем токенам SigmaSMS</b>\n\n` +
      `💼 <b>Всего подключено аккаунтов:</b> ${tokensToCheck.length} шт. (успешно: ${successfulCount})\n` +
      `${totalBadge} <b>Суммарный баланс:</b> <b>${totalFormatted} ₽</b>\n` +
      `⏰ <b>Обновлено:</b> ${timeStr}\n\n` +
      `${tokenRowsText}`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🔄 Обновить все балансы', callback_data: 'refresh_balance' },
        ],
        [
          { text: '🎛 Настройка порогов (слайдер)', callback_data: 'open_alerts' },
          { text: '➕ Добавить токен', callback_data: 'prompt_add_token' },
        ],
        [
          { text: '🌐 Открыть user.sigmasms.ru', url: 'https://user.sigmasms.ru' },
        ],
      ],
    };

    await this.editMessage(chatId, waitMsg.message_id, text, { reply_markup: keyboard });

    storage.logEvent({
      type: 'check',
      chatId,
      message: `Запрос баланса всех токенов: суммарно ${totalFormatted} ₽ по ${tokensToCheck.length} акк.`,
    });
  }

  /**
   * Thresholds management menu with SLIDER / ARROWS navigation between tokens
   */
  public async handleAlertsMenu(chatId: number, user: any, messageIdToEdit?: number) {
    const tokens = storage.getUserTokens(chatId);

    if (tokens.length === 0 && !user.sigmaToken) {
      storage.setUserState(chatId, 'awaiting_token');
      const text = '⚠️ У вас пока нет подключенных токенов SigmaSMS. Пожалуйста, отправьте API-токен:';
      if (messageIdToEdit) {
        await this.editMessage(chatId, messageIdToEdit, text);
      } else {
        await this.sendMessage(chatId, text);
      }
      return;
    }

    const tokensList: SigmaTokenAccount[] = tokens.length > 0
      ? tokens
      : [
          {
            id: 'tok_main',
            token: user.maskedToken || user.sigmaToken || '',
            maskedToken: user.maskedToken,
            secretRef: user.secretRef,
            tokenHash: user.tokenHash,
            name: user.sigmaFullName || user.sigmaUsername || 'Основной',
            sigmaUserId: user.sigmaUserId,
            sigmaUsername: user.sigmaUsername,
            sigmaFullName: user.sigmaFullName,
            currentBalance: user.currentBalance ?? null,
            thresholds: user.thresholds || DEFAULT_THRESHOLDS,
            createdAt: user.createdAt || Date.now(),
          },
        ];

    const count = tokensList.length;
    const activeIndex = Math.min(Math.max(0, user.activeTokenIndex || 0), count - 1);
    const activeToken = tokensList[activeIndex];
    const thresholds = activeToken.thresholds || DEFAULT_THRESHOLDS;
    const currentBalance = activeToken.currentBalance;

    const maskedToken = activeToken.maskedToken || (
      activeToken.token && activeToken.token.length > 10
        ? `${activeToken.token.substring(0, 4)}...${activeToken.token.slice(-3)}`
        : '••••••••'
    );

    const customName = activeToken.name?.trim();
    const sigmaFullName = activeToken.sigmaFullName || activeToken.sigmaUsername || '';
    const hasCustomName = customName && customName !== 'Основной' && customName !== sigmaFullName;
    const enabledCount = thresholds.filter((t: any) => t.enabled).length;

    let text = `🎛 <b>Настройка порогов оповещений</b>\n\n` +
      `📍 <b>Аккаунт: [${activeIndex + 1} из ${count}]</b>\n` +
      `🏷 <b>Название токена:</b> <b>${escapeHtml(customName || 'Без названия')}</b>\n` +
      (sigmaFullName ? `👤 <b>Владелец Sigma:</b> <b>${escapeHtml(sigmaFullName)}</b>\n` : '') +
      `💰 <b>Баланс аккаунта:</b> ${currentBalance != null ? `<b>${escapeHtml(currentBalance)} ₽</b>` : '<i>не проверен</i>'}\n` +
      `📊 <b>Активно порогов:</b> ${enabledCount} из ${thresholds.length} шт.\n\n` +
      `<i>Используйте стрелочки ◀️ ▶️ в слайдере ниже для переключения между аккаунтами. Каждый аккаунт настраивается отдельно!</i>`;

    const buttons: any[] = [];

    // SLIDER NAVIGATION ROW (Arrows switcher)
    if (count > 1) {
      const slideTitle = customName && customName.length <= 15 ? customName : `Акк. ${activeIndex + 1}/${count}`;
      buttons.push([
        { text: '◀️ Пред.', callback_data: 'token_slide_prev' },
        { text: `🏷 ${slideTitle}`, callback_data: `token_info:${activeToken.id}` },
        { text: 'След. ▶️', callback_data: 'token_slide_next' },
      ]);
    }

    // THRESHOLDS GRID (3 per row)
    let currentRow: any[] = [];
    for (const t of thresholds) {
      const statusIcon = t.enabled ? '✅' : '❌';
      const formattedVal = t.value < 0
        ? `-${Math.abs(t.value).toLocaleString('ru-RU')}`
        : `${t.value.toLocaleString('ru-RU')}`;

      currentRow.push({
        text: `${statusIcon} ${formattedVal} ₽`,
        callback_data: `toggle_t:${activeToken.id}:${t.value}`,
      });

      if (currentRow.length === 3) {
        buttons.push(currentRow);
        currentRow = [];
      }
    }
    if (currentRow.length > 0) {
      buttons.push(currentRow);
    }

    // Action buttons for THIS token
    buttons.push([
      { text: '➕ Свой порог', callback_data: `add_custom_prompt:${activeToken.id}` },
      { text: '🔄 Сбросить пороги токена', callback_data: `reset_thresholds:${activeToken.id}` },
    ]);

    // Token management buttons
    const renameLabel = hasCustomName
      ? `✏️ Изменить название («${customName.slice(0, 14)}»)`
      : `✏️ Назвать токен`;
    const tokenMgmtRow: any[] = [
      { text: renameLabel, callback_data: `rename_token_prompt:${activeToken.id}` },
    ];
    if (count > 1) {
      tokenMgmtRow.push({ text: '🗑 Удалить этот токен', callback_data: `delete_token:${activeToken.id}` });
    }
    buttons.push(tokenMgmtRow);

    // Bottom navigation
    buttons.push([
      { text: '➕ Добавить еще токен', callback_data: 'prompt_add_token' },
      { text: '💰 Баланс всех токенов', callback_data: 'refresh_balance' },
    ]);

    const keyboard = { inline_keyboard: buttons };

    if (messageIdToEdit) {
      await this.editMessage(chatId, messageIdToEdit, text, { reply_markup: keyboard });
    } else {
      await this.sendMessage(chatId, text, { reply_markup: keyboard });
    }
  }

  /**
   * Tokens management list view
   */
  private async handleTokensMenu(chatId: number, user: any) {
    const tokens = storage.getUserTokens(chatId);

    if (tokens.length === 0 && !user.sigmaToken) {
      storage.setUserState(chatId, 'awaiting_token');
      await this.sendMessage(chatId, '⚠️ У вас пока не подключено ни одного токена. Отправьте ваш API-токен SigmaSMS:');
      return;
    }

    const tokensList: any[] = tokens.length > 0
      ? tokens
      : [
          {
            id: 'tok_main',
            token: user.sigmaToken,
            name: user.sigmaFullName || user.sigmaUsername || 'Основной',
            sigmaFullName: user.sigmaFullName,
            sigmaUsername: user.sigmaUsername,
            currentBalance: user.currentBalance,
          },
        ];

    let listText = `🔑 <b>Ваши токены SigmaSMS (${tokensList.length} шт.):</b>\n\n`;

    tokensList.forEach((t, i) => {
      const isCurrent = i === (user.activeTokenIndex || 0);
      const customName = t.name?.trim();
      const sigmaOwner = t.sigmaFullName || t.sigmaUsername || '';
      const displayTitle = customName || sigmaOwner || `Аккаунт #${i + 1}`;
      const ownerSubtitle = customName && sigmaOwner && customName !== sigmaOwner ? ` (👤 ${escapeHtml(sigmaOwner)})` : '';

      listText += `${isCurrent ? '👉 ' : '▫️ '}<b>${i + 1}. 🏷 ${escapeHtml(displayTitle)}</b>${ownerSubtitle}\n` +
        `   Баланс: <b>${t.currentBalance != null ? t.currentBalance + ' ₽' : 'Не проверен'}</b>\n\n`;
    });

    listText += `<i>Переключайтесь между токенами в слайдере порогов для раздельной настройки уведомлений!</i>`;

    await this.sendMessage(chatId, listText, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎛 Открыть слайдер порогов', callback_data: 'open_alerts' }],
          [{ text: '➕ Добавить новый токен', callback_data: 'prompt_add_token' }],
          [{ text: '💰 Проверить балансы всех токенов', callback_data: 'refresh_balance' }],
        ],
      },
    });
  }

  private async handleHelpCommand(chatId: number) {
    const text = `ℹ️ <b>Справка по боту мониторинга SigmaSMS</b>\n\n` +
      `🤖 <b>Основные возможности:</b>\n` +
      `• 🔑 <b>Мульти-токены:</b> подключение нескольких аккаунтов SigmaSMS к одному Telegram-профилю\n` +
      `• 🎛 <b>Удобный слайдер:</b> переключение между токенами с помощью стрелочек ◀️ ▶️\n` +
      `• 📊 <b>Раздельные пороги:</b> индивидуальные уровни оповещений для каждого токена\n` +
      `• ➖ <b>Отрицательные пороги:</b> поддержка кредитных и постоплатных аккаунтов (например: -100 000 ₽, -50 000 ₽, 0 ₽)\n` +
      `• 💰 <b>Сводка по всем токенам:</b> проверка баланса одновременно по всем подключенным кабинетам\n` +
      `• 🚨 <b>Прямой переход:</b> ссылка на личный кабинет <a href="https://user.sigmasms.ru">user.sigmasms.ru</a> в каждом алерте\n\n` +
      `📋 <b>Команды бота:</b>\n` +
      `/balance — Баланс всех токенов в реальном времени\n` +
      `/alerts — Слайдер и настройка порогов оповещений\n` +
      `/tokens — Список всех ваших токенов\n` +
      `/addtoken — Добавить еще один токен\n` +
      `/help — Эта справка`;

    await this.sendMessage(chatId, text, {
      reply_markup: this.getMainMenuKeyboard(),
    });
  }

  private async handleCustomThresholdInput(chatId: number, text: string, user: any) {
    const val = parseFloat(text.replace(',', '.').replace(/\s/g, '').trim());

    if (isNaN(val) || val < -10000000 || val > 10000000) {
      await this.sendMessage(
        chatId,
        '⚠️ Пожалуйста, введите корректное числовое значение в рублях (поддерживаются как положительные, так и отрицательные значения, например: <code>-100000</code>, <code>-50000</code>, <code>0</code>, <code>50</code>, <code>500</code>). Попробуйте снова или отправьте /alerts для отмены.'
      );
      return;
    }

    const roundedVal = Math.round(val * 100) / 100;
    const targetTokenId = user.stateData?.tokenId;

    if (targetTokenId) {
      storage.addCustomTokenThreshold(chatId, targetTokenId, roundedVal);
    } else {
      storage.addCustomThreshold(chatId, roundedVal);
    }
    storage.setUserState(chatId, 'idle');

    const formattedSign = roundedVal < 0
      ? `-${Math.abs(roundedVal).toLocaleString('ru-RU')}`
      : `${roundedVal.toLocaleString('ru-RU')}`;

    await this.sendMessage(
      chatId,
      `✅ Порог <b>${formattedSign} ₽</b> успешно добавлен и включен!`,
      {
        reply_markup: this.getMainMenuKeyboard(),
      }
    );

    const updatedUser = storage.getUser(chatId);
    if (updatedUser) {
      await this.handleAlertsMenu(chatId, updatedUser);
    }
  }

  private async handleTokenNameInput(chatId: number, text: string, user: any) {
    const newName = text.trim();
    const tokenId = user.stateData?.tokenId;

    if (newName.length > 0 && tokenId) {
      storage.setTokenName(chatId, tokenId, newName);
    }

    storage.setUserState(chatId, 'idle');
    await this.sendMessage(
      chatId,
      `✅ Название токена успешно установлено: <b>«${escapeHtml(newName)}»</b>\n\nТеперь оно отображается в настройках порогов, сводке балансов и уведомлениях.`,
      {
        reply_markup: this.getMainMenuKeyboard(),
      }
    );

    const updatedUser = storage.getUser(chatId);
    if (updatedUser) {
      await this.handleAlertsMenu(chatId, updatedUser);
    }
  }

  private async handleCallbackQuery(query: any) {
    const chatId = query.message?.chat?.id;
    const messageId = query.message?.message_id;
    const data = query.data;

    if (!chatId) return;

    try {
      await this.apiCall('answerCallbackQuery', { callback_query_id: query.id });
    } catch {}

    const user = storage.getUser(chatId);
    if (!user) return;

    if (data === 'use_demo_token') {
      const demoToken = storage.getConfig().defaultSigmaToken;
      await this.handlePotentialTokenInput(chatId, demoToken, user);
      return;
    }

    if (data === 'refresh_balance') {
      await this.handleBalanceCheck(chatId, user, messageId);
      return;
    }

    if (data === 'open_alerts') {
      storage.setUserState(chatId, 'idle');
      await this.handleAlertsMenu(chatId, user, messageId);
      return;
    }

    if (data === 'prompt_add_token' || data === 'change_token') {
      storage.setUserState(chatId, 'awaiting_token');
      await this.sendMessage(
        chatId,
        `➕ <b>Отправьте новый API-токен SigmaSMS сообщением в этот чат:</b>\n\n` +
        `<i>(Токен можно скопировать в <a href="https://user.sigmasms.ru">user.sigmasms.ru</a> -> Профиль -> API)</i>`
      );
      return;
    }

    // SLIDER: Previous token
    if (data === 'token_slide_prev') {
      const currentIdx = user.activeTokenIndex || 0;
      storage.setActiveTokenIndex(chatId, currentIdx - 1);
      const updatedUser = storage.getUser(chatId);
      if (updatedUser) {
        await this.handleAlertsMenu(chatId, updatedUser, messageId);
      }
      return;
    }

    // SLIDER: Next token
    if (data === 'token_slide_next') {
      const currentIdx = user.activeTokenIndex || 0;
      storage.setActiveTokenIndex(chatId, currentIdx + 1);
      const updatedUser = storage.getUser(chatId);
      if (updatedUser) {
        await this.handleAlertsMenu(chatId, updatedUser, messageId);
      }
      return;
    }

    // Toggle threshold for specific token
    if (data.startsWith('toggle_t:')) {
      const parts = data.split(':');
      // Can be toggle_t:tokenId:val or toggle_t:val
      if (parts.length >= 3) {
        const tokenId = parts[1];
        const val = parseFloat(parts[2]);
        if (!isNaN(val)) {
          storage.toggleTokenThreshold(chatId, tokenId, val);
        }
      } else {
        const val = parseFloat(parts[1]);
        if (!isNaN(val)) {
          storage.toggleThreshold(chatId, val);
        }
      }
      const updatedUser = storage.getUser(chatId);
      if (updatedUser) {
        await this.handleAlertsMenu(chatId, updatedUser, messageId);
      }
      return;
    }

    // Prompt custom threshold
    if (data.startsWith('add_custom_prompt')) {
      const parts = data.split(':');
      const tokenId = parts[1] || user.tokens?.[user.activeTokenIndex || 0]?.id;
      storage.setUserState(chatId, 'awaiting_custom_threshold', { tokenId });

      await this.sendMessage(
        chatId,
        '➕ <b>Введите числовое значение нового порога в рублях:</b>\n\n' +
        'Поддерживаются как положительные, так и отрицательные значения (для постоплаты):\n' +
        'Например: <code>-100000</code>, <code>-50000</code>, <code>-10000</code>, <code>0</code>, <code>25</code>, <code>750</code>'
      );
      return;
    }

    // Reset thresholds for specific token
    if (data.startsWith('reset_thresholds')) {
      const parts = data.split(':');
      const tokenId = parts[1];
      if (tokenId) {
        storage.resetTokenThresholds(chatId, tokenId);
      } else {
        storage.resetThresholdsToDefault(chatId);
      }
      const updatedUser = storage.getUser(chatId);
      if (updatedUser) {
        await this.handleAlertsMenu(chatId, updatedUser, messageId);
      }
      return;
    }

    // Rename token prompt
    if (data.startsWith('rename_token_prompt:')) {
      const tokenId = data.split(':')[1];
      const tok = user.tokens?.find((t: any) => t.id === tokenId);
      const currentLabel = tok?.name ? ` (сейчас: <b>${escapeHtml(tok.name)}</b>)` : '';
      storage.setUserState(chatId, 'awaiting_token_name', { tokenId });
      await this.sendMessage(
        chatId,
        `✏️ Введите понятное название для этого токена${currentLabel} (например: <i>Интернет-магазин</i>, <i>Отдел продаж</i> или <i>Основной</i>):\n\nОтправьте текст ответным сообщением:`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Отмена', callback_data: 'open_alerts' }],
            ],
          },
        }
      );
      return;
    }

    // Delete token
    if (data.startsWith('delete_token:')) {
      const tokenId = data.split(':')[1];
      storage.removeTokenFromUser(chatId, tokenId);
      await this.sendMessage(chatId, '🗑 Токен успешно удален из вашего списка мониторинга.');
      const updatedUser = storage.getUser(chatId);
      if (updatedUser) {
        await this.handleAlertsMenu(chatId, updatedUser, messageId);
      }
      return;
    }
  }

  /**
   * Dispatches real-time threshold alert to user
   */
  public async sendAlertNotification(chatId: number, data: {
    threshold: number;
    currentBalance: number;
    previousBalance?: number | null;
    username: string;
    tokenLabel?: string;
    userId: string;
  }): Promise<boolean> {
    const formattedThreshold = data.threshold < 0
      ? `-${Math.abs(data.threshold).toLocaleString('ru-RU')}`
      : `${data.threshold.toLocaleString('ru-RU')}`;

    const formattedBalance = data.currentBalance < 0
      ? `-${Math.abs(data.currentBalance).toLocaleString('ru-RU')}`
      : `${data.currentBalance.toLocaleString('ru-RU')}`;

    const tokenHeader = data.tokenLabel
      ? `🏷 <b>Название токена:</b> <b>${escapeHtml(data.tokenLabel)}</b>\n`
      : '';

    const text = `🚨 <b>ВНИМАНИЕ! Баланс SigmaSMS достиг порога!</b>\n\n` +
      `${tokenHeader}` +
      `👤 Клиент: <b>${escapeHtml(data.username)}</b>\n` +
      `⚠️ Сработал порог: <b>${formattedThreshold} ₽</b>\n` +
      `💰 Текущий баланс: <b>${formattedBalance} ₽</b>${data.previousBalance != null ? ` (ранее: ${data.previousBalance} ₽)` : ''}\n` +
      `⏰ Время: ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}\n\n` +
      `Пожалуйста, пополните счет в личном кабинете SigmaSMS, чтобы рассылки не останавливались!`;

    try {
      await this.sendMessage(chatId, text, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🌐 Открыть личный кабинет (user.sigmasms.ru)', url: 'https://user.sigmasms.ru' }],
            [
              { text: '💰 Баланс всех токенов', callback_data: 'refresh_balance' },
              { text: '🎛 Настроить пороги', callback_data: 'open_alerts' },
            ],
          ],
        },
      });

      storage.logEvent({
        type: 'alert',
        chatId,
        username: data.username,
        message: `Отправлен алерт [${data.tokenLabel || data.username}]: баланс ${data.currentBalance} ₽ <= порога ${data.threshold} ₽`,
      });

      return true;
    } catch (err: any) {
      console.error(`[Telegram] Failed to send alert to chat ${chatId}:`, err.message);
      storage.logEvent({
        type: 'error',
        chatId,
        message: `Не удалось отправить алерт в Telegram: ${err.message}`,
      });
      return false;
    }
  }

  public async sendMessage(chatId: number, text: string, options: any = {}) {
    const parseMode = options.parse_mode !== undefined ? options.parse_mode : 'HTML';
    try {
      return await this.apiCall('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        ...options,
      });
    } catch (err: any) {
      if (parseMode && err.message?.includes("can't parse entities")) {
        console.warn(`[Telegram] HTML/Markdown parse failed, fallback to plain text:`, err.message);
        const plainText = text.replace(/<[^>]*>/g, '');
        const { parse_mode, ...restOptions } = options;
        return await this.apiCall('sendMessage', {
          chat_id: chatId,
          text: plainText,
          ...restOptions,
        });
      }
      throw err;
    }
  }

  public async editMessage(chatId: number, messageId: number, text: string, options: any = {}) {
    const parseMode = options.parse_mode !== undefined ? options.parse_mode : 'HTML';
    try {
      return await this.apiCall('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: parseMode,
        ...options,
      });
    } catch (err: any) {
      if (parseMode && err.message?.includes("can't parse entities")) {
        console.warn(`[Telegram] HTML/Markdown edit failed, fallback to plain text:`, err.message);
        const plainText = text.replace(/<[^>]*>/g, '');
        const { parse_mode, ...restOptions } = options;
        try {
          return await this.apiCall('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: plainText,
            ...restOptions,
          });
        } catch {}
      }
      // If message is not modified or not found, send new message
      return this.sendMessage(chatId, text, options);
    }
  }

  public async deleteMessage(chatId: number, messageId: number) {
    try {
      return await this.apiCall('deleteMessage', {
        chat_id: chatId,
        message_id: messageId,
      });
    } catch (err: any) {
      // Ignore if cannot delete (e.g. message too old or missing rights)
      return false;
    }
  }
}

export const telegramBot = new TelegramBotService();
