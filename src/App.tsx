/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BotStatus, BotUser, BotLogEntry } from './types.js';
import { Header } from './components/Header.js';
import { OverviewCards } from './components/OverviewCards.js';
import { LiveTester } from './components/LiveTester.js';
import { UsersTable } from './components/UsersTable.js';
import { ThresholdsModal } from './components/ThresholdsModal.js';
import { ChangeBotTokenModal } from './components/ChangeBotTokenModal.js';
import { LogsViewer } from './components/LogsViewer.js';
import { BotInstructions } from './components/BotInstructions.js';
import { LoginScreen } from './components/LoginScreen.js';
import { WifiOff, RefreshCw } from 'lucide-react';
import {
  authFetch,
  checkAdminSession,
  getStoredToken,
  getStoredUser,
  logoutAdmin,
  onAuthChange,
} from './api.js';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [adminUser, setAdminUser] = useState<{ username: string } | null>(getStoredUser());

  const [status, setStatus] = useState<BotStatus | null>(null);
  const [users, setUsers] = useState<BotUser[]>([]);
  const [logs, setLogs] = useState<BotLogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(true);
  
  const [isCheckingAll, setIsCheckingAll] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isTogglingPower, setIsTogglingPower] = useState(false);
  const [checkingUserChatId, setCheckingUserChatId] = useState<number | null>(null);
  
  const [selectedUserForThresholds, setSelectedUserForThresholds] = useState<BotUser | null>(null);
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const isRefreshingRef = useRef(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Check auth session on startup and subscribe to auth changes
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setIsAuthenticated(false);
    } else {
      checkAdminSession().then((valid) => {
        setIsAuthenticated(valid);
        if (valid) {
          setAdminUser(getStoredUser());
        }
      });
    }

    const unsubscribe = onAuthChange((authed) => {
      setIsAuthenticated(authed);
      if (authed) {
        setAdminUser(getStoredUser());
      }
    });

    return () => unsubscribe();
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await authFetch('/api/bot/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        setIsConnected(true);
      } else {
        setIsConnected(false);
      }
    } catch {
      setIsConnected(false);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await authFetch('/api/bot/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
        setIsConnected(true);
      }
    } catch {
      // Graceful fallback
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await authFetch('/api/bot/logs?limit=80');
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        setIsConnected(true);
      }
    } catch {
      // Graceful fallback
    }
  }, []);

  const refreshAll = useCallback(async () => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    try {
      await Promise.allSettled([fetchStatus(), fetchUsers(), fetchLogs()]);
    } finally {
      isRefreshingRef.current = false;
    }
  }, [fetchStatus, fetchUsers, fetchLogs]);

  // Periodic polling only when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      refreshAll();
      const interval = setInterval(refreshAll, 3000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, refreshAll]);

  // Handler: logout
  const handleLogout = async () => {
    await logoutAdmin();
    setIsAuthenticated(false);
    setAdminUser(null);
    showToast('Вы вышли из учетной записи администратора');
  };

  // Handler: check all users
  const handleCheckAll = async () => {
    setIsCheckingAll(true);
    try {
      const res = await authFetch('/api/bot/check-all', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(
          `Проверено ${data.result.checkedCount} пользователей за ${data.result.durationMs} мс. Отправлено алертов: ${data.result.alertsCount}`
        );
      }
      refreshAll();
    } catch (err: any) {
      showToast('Ошибка при запуске проверки всех пользователей');
    } finally {
      setIsCheckingAll(false);
    }
  };

  // Handler: simulate users up to target
  const handleSimulateUsers = async (count: number) => {
    setIsSimulating(true);
    try {
      const res = await authFetch('/api/bot/simulate-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || `Сгенерировано ${count} пользователей для симуляции!`);
      }
      refreshAll();
    } catch (err) {
      showToast('Ошибка при симуляции пользователей');
    } finally {
      setIsSimulating(false);
    }
  };

  // Handler: clear simulated users
  const handleClearSimulated = async () => {
    try {
      const res = await authFetch('/api/bot/simulate-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear' }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('Тестовые пользователи очищены');
      }
      refreshAll();
    } catch (err) {
      showToast('Ошибка при очистке пользователей');
    }
  };

  // Handler: check single user balance
  const handleCheckUser = async (chatId: number) => {
    setCheckingUserChatId(chatId);
    try {
      const res = await authFetch(`/api/bot/check-user/${chatId}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(
          `Баланс пользователя ${chatId} обновлен: ${data.result.balance ?? 0} ₽`
        );
      } else {
        showToast(`Ошибка проверки: ${data.error}`);
      }
      refreshAll();
    } catch (err: any) {
      showToast('Ошибка при запросе к серверу');
    } finally {
      setCheckingUserChatId(null);
    }
  };

  // Handler: send test alert
  const handleSendTestAlert = async (chatId: number, balance: number) => {
    try {
      const res = await authFetch('/api/bot/send-test-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, threshold: 10, balance }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Тестовый алерт успешно отправлен в Telegram чат ${chatId}!`);
      } else {
        showToast('Не удалось отправить алерт. Возможно, бот заблокирован пользователем.');
      }
      refreshAll();
    } catch (err) {
      showToast('Ошибка при отправке алерта');
    }
  };

  // Handler: toggle threshold
  const handleToggleThreshold = async (chatId: number, value: number) => {
    try {
      const res = await authFetch(`/api/bot/user/${chatId}/thresholds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', value }),
      });
      const data = await res.json();
      if (data.success && selectedUserForThresholds) {
        setSelectedUserForThresholds({
          ...selectedUserForThresholds,
          thresholds: data.thresholds,
        });
      }
      refreshAll();
    } catch (err) {
      console.error('Error toggling threshold:', err);
    }
  };

  // Handler: add custom threshold
  const handleAddThreshold = async (chatId: number, value: number) => {
    try {
      const res = await authFetch(`/api/bot/user/${chatId}/thresholds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', value }),
      });
      const data = await res.json();
      if (data.success && selectedUserForThresholds) {
        setSelectedUserForThresholds({
          ...selectedUserForThresholds,
          thresholds: data.thresholds,
        });
        showToast(`Порог ${value} ₽ добавлен!`);
      }
      refreshAll();
    } catch (err) {
      console.error('Error adding threshold:', err);
    }
  };

  // Handler: reset thresholds
  const handleResetThresholds = async (chatId: number) => {
    try {
      const res = await authFetch(`/api/bot/user/${chatId}/thresholds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      });
      const data = await res.json();
      if (data.success && selectedUserForThresholds) {
        setSelectedUserForThresholds({
          ...selectedUserForThresholds,
          thresholds: data.thresholds,
        });
        showToast('Пороги сброшены к 10 стандартным значениям');
      }
      refreshAll();
    } catch (err) {
      console.error('Error resetting thresholds:', err);
    }
  };

  // Handler: toggle bot active/inactive (Power switch)
  const handleToggleBotPower = async () => {
    setIsTogglingPower(true);
    try {
      const res = await authFetch('/api/bot/toggle-power', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(
          data.isBotActive
            ? 'Бот включен и запущен!'
            : 'Бот успешно отключен в админке'
        );
      } else {
        showToast(`Ошибка переключения бота: ${data.error}`);
      }
      refreshAll();
    } catch (err) {
      showToast('Ошибка при переключении статуса бота');
    } finally {
      setIsTogglingPower(false);
    }
  };

  // Handler: clear history for all users
  const handleClearAllHistory = async () => {
    try {
      const res = await authFetch('/api/bot/history/clear-all', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Вся история логов и событий у всех пользователей успешно очищена');
      }
      refreshAll();
    } catch (err) {
      showToast('Ошибка при очистке истории');
    }
  };

  // Handler: clear history for single user
  const handleClearUserHistory = async (chatId: number) => {
    try {
      const res = await authFetch(`/api/bot/user/${chatId}/clear-history`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(`История и логи пользователя ${chatId} очищены`);
      }
      refreshAll();
    } catch (err) {
      showToast('Ошибка при очистке истории пользователя');
    }
  };

  // Handler: clear tokens for all users
  const handleClearAllTokens = async () => {
    try {
      const res = await authFetch('/api/bot/tokens/clear-all', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(`Сброшены и удалены токены у ${data.clearedCount} пользователей`);
      }
      refreshAll();
    } catch (err) {
      showToast('Ошибка при сбросе всех токенов');
    }
  };

  // Handler: clear token for single user
  const handleClearUserToken = async (chatId: number) => {
    try {
      const res = await authFetch(`/api/bot/user/${chatId}/clear-token`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(`Токен пользователя ${chatId} удален`);
      }
      refreshAll();
    } catch (err) {
      showToast('Ошибка при удалении токена пользователя');
    }
  };

  // Handler: delete user completely
  const handleDeleteUser = async (chatId: number) => {
    try {
      const res = await authFetch(`/api/bot/user/${chatId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast(`Пользователь ${chatId} удален из базы данных`);
      }
      refreshAll();
    } catch (err) {
      showToast('Ошибка при удалении пользователя');
    }
  };

  // Loading state while checking session
  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-3">
        <div className="w-9 h-9 border-3 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
        <span className="text-xs text-slate-400 font-medium">Проверка сессии администратора...</span>
      </div>
    );
  }

  // If unauthenticated, render the login screen
  if (!isAuthenticated) {
    return (
      <LoginScreen
        onSuccess={() => {
          setIsAuthenticated(true);
          setAdminUser(getStoredUser());
          refreshAll();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-blue-600 selection:text-white">
      
      {/* Top Header */}
      <Header
        status={status}
        onRefresh={refreshAll}
        onCheckAll={handleCheckAll}
        isCheckingAll={isCheckingAll}
        onSimulateUsers={handleSimulateUsers}
        isSimulating={isSimulating}
        onTogglePower={handleToggleBotPower}
        isTogglingPower={isTogglingPower}
        onLogout={handleLogout}
        adminUsername={adminUser?.username || 'admin123'}
      />

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        
        {/* Reconnecting Banner */}
        {!isConnected && (
          <div className="bg-amber-950/60 border border-amber-800/80 text-amber-200 px-4 py-2.5 rounded-xl flex items-center justify-between text-xs sm:text-sm">
            <div className="flex items-center gap-2">
              <WifiOff className="w-4 h-4 text-amber-400 animate-pulse" />
              <span>Переподключение к серверу бота... Проверяем соединение.</span>
            </div>
            <button
              onClick={refreshAll}
              className="px-2.5 py-1 bg-amber-900/60 hover:bg-amber-800/80 rounded border border-amber-700/60 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Повторить сейчас</span>
            </button>
          </div>
        )}
        
        {/* Toast Alert */}
        {toastMessage && (
          <div className="fixed bottom-5 right-5 z-50 bg-slate-900 border border-indigo-500/50 text-white px-4 py-2.5 rounded-xl shadow-2xl text-xs font-medium flex items-center gap-2 animate-in fade-in slide-in-from-bottom-3 duration-200">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Overview Stats Cards */}
        <OverviewCards
          status={status}
          onClearSimulated={handleClearSimulated}
          hasSimulatedUsers={users.some((u) => u.isSimulated || u.sigmaUserId?.startsWith('sim-') || u.chatId >= 100000000)}
          onChangeBotToken={() => setIsTokenModalOpen(true)}
        />

        {/* Bot Instructions */}
        <BotInstructions />

        {/* Live SigmaSMS API Playground & Tester */}
        <LiveTester defaultToken={status?.config?.defaultSigmaToken || 'demo_sigma_token_9f81a7b6c5d4e3f2'} />

        {/* Registered Users Table (with 200+ capacity) */}
        <UsersTable
          users={users}
          onCheckUser={handleCheckUser}
          onSendTestAlert={handleSendTestAlert}
          onOpenThresholds={(user) => setSelectedUserForThresholds(user)}
          checkingUserChatId={checkingUserChatId}
          onClearAllTokens={handleClearAllTokens}
          onClearAllHistory={handleClearAllHistory}
          onClearUserHistory={handleClearUserHistory}
          onClearUserToken={handleClearUserToken}
          onDeleteUser={handleDeleteUser}
        />

        {/* Live Logs & Events Stream */}
        <LogsViewer
          logs={logs}
          onRefresh={fetchLogs}
          onClearHistory={handleClearAllHistory}
        />

      </main>

      {/* Thresholds Modal */}
      {selectedUserForThresholds && (
        <ThresholdsModal
          user={selectedUserForThresholds}
          onClose={() => setSelectedUserForThresholds(null)}
          onToggleThreshold={handleToggleThreshold}
          onAddThreshold={handleAddThreshold}
          onResetThresholds={handleResetThresholds}
        />
      )}

      {/* Change Bot Token Modal */}
      {isTokenModalOpen && (
        <ChangeBotTokenModal
          status={status}
          onClose={() => setIsTokenModalOpen(false)}
          onTokenUpdated={() => {
            fetchStatus();
            fetchLogs();
            showToast('Токен Telegram-бота успешно обновлен!');
          }}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-slate-900 py-6 text-center text-xs text-slate-500">
        <p>SigmaSMS Realtime Balance Bot & Dashboard • Telegram: @SigmaBa1ance_bot</p>
      </footer>
    </div>
  );
}
