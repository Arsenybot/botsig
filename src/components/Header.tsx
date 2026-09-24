/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { BotStatus } from '../types.js';
import { Bot, RefreshCw, Users, ExternalLink, Power, PowerOff, Trash2, KeyRound, LogOut, Shield } from 'lucide-react';

interface HeaderProps {
  status: BotStatus | null;
  onRefresh: () => void;
  onCheckAll: () => void;
  isCheckingAll: boolean;
  onSimulateUsers: (count: number) => void;
  isSimulating: boolean;
  onTogglePower: () => void;
  isTogglingPower?: boolean;
  onClearAllHistory?: () => void;
  onClearAllTokens?: () => void;
  onLogout?: () => void;
  adminUsername?: string;
}

export const Header: React.FC<HeaderProps> = ({
  status,
  onRefresh,
  onCheckAll,
  isCheckingAll,
  onSimulateUsers,
  isSimulating,
  onTogglePower,
  isTogglingPower,
  onClearAllHistory,
  onClearAllTokens,
  onLogout,
  adminUsername,
}) => {
  const [simCount, setSimCount] = useState<string>('');
  const isBotActive = status?.isBotActive !== false;
  const isOnline = isBotActive && status?.botInfo?.isOnline && status?.isPolling;

  const handleSimulate = () => {
    const count = parseInt(simCount.trim(), 10);
    if (!isNaN(count) && count > 0) {
      onSimulateUsers(count);
    }
  };

  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-30 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        
        {/* Logo & Bot Identity */}
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shadow-inner transition-colors ${
            isBotActive
              ? 'bg-blue-600/20 border-blue-500/30 text-blue-400'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
          }`}>
            {isBotActive ? <Bot className="w-6 h-6" /> : <PowerOff className="w-5 h-5 text-rose-400" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-white tracking-tight">SigmaSMS Balance Bot</h1>
              <span
                id="bot-status-badge"
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  !isBotActive
                    ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                    : isOnline
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${
                  !isBotActive
                    ? 'bg-rose-500'
                    : isOnline
                    ? 'bg-emerald-400 animate-pulse'
                    : 'bg-amber-400'
                }`} />
                {!isBotActive
                  ? 'Отключен в админке'
                  : isOnline
                  ? 'В сети (Polling)'
                  : 'Ожидание запуска'}
              </span>
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-2">
              <span>Телеграм-бот:</span>
              <a
                href="https://t.me/SigmaBa1ance_bot"
                target="_blank"
                rel="noreferrer"
                className="text-blue-400 hover:text-blue-300 font-mono flex items-center gap-1 transition-colors underline"
              >
                @SigmaBa1ance_bot
                <ExternalLink className="w-3 h-3" />
              </a>
              <span className="text-slate-600">•</span>
              <span className="text-slate-300">Провайдер: SigmaSMS API</span>
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center flex-wrap gap-2.5">
          {/* Main Bot Power Toggle */}
          <button
            id="btn-toggle-bot-power"
            onClick={onTogglePower}
            disabled={isTogglingPower}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm ${
              isBotActive
                ? 'bg-rose-950/80 hover:bg-rose-600 border border-rose-800/80 text-rose-200 hover:text-white'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white animate-pulse'
            }`}
            title={isBotActive ? 'Остановить Telegram-бота и фоновый мониторинг' : 'Запустить Telegram-бота и фоновый мониторинг'}
          >
            <Power className="w-3.5 h-3.5" />
            {isTogglingPower
              ? 'Применение...'
              : isBotActive
              ? 'Отключить бота'
              : 'Включить бота'}
          </button>

          <button
            id="btn-check-all-users"
            onClick={onCheckAll}
            disabled={isCheckingAll || !isBotActive}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
            title="Запустить параллельную проверку балансов всех пользователей"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isCheckingAll ? 'animate-spin' : ''}`} />
            {isCheckingAll ? 'Проверка...' : 'Проверить всех'}
          </button>

          {/* Manual Simulation Input + Button */}
          <div className="flex items-center rounded-lg border border-slate-700 bg-slate-950/90 p-0.5 shadow-sm">
            <input
              id="input-simulate-users-count"
              type="number"
              min="1"
              max="500"
              value={simCount}
              onChange={(e) => setSimCount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSimulate();
              }}
              placeholder="Число"
              className="w-16 sm:w-20 bg-transparent px-2.5 py-1.5 text-xs font-mono text-white placeholder-slate-500 outline-none text-center focus:text-indigo-300"
              title="Введите количество пользователей для ручного запуска симуляции"
            />
            <button
              id="btn-simulate-users"
              onClick={handleSimulate}
              disabled={isSimulating || !simCount.trim() || Number(simCount) <= 0}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
              title={
                !simCount.trim() || Number(simCount) <= 0
                  ? 'Введите число пользователей в окошко слева для запуска'
                  : `Запустить симуляцию на ${simCount} пользователей`
              }
            >
              <Users className={`w-3.5 h-3.5 ${isSimulating ? 'animate-pulse text-indigo-300' : 'text-indigo-200'}`} />
              <span>{isSimulating ? 'Запуск...' : 'Симуляция'}</span>
            </button>
          </div>

          <button
            id="btn-refresh-dashboard"
            onClick={onRefresh}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition-colors cursor-pointer"
            title="Обновить данные дашборда"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          {/* Admin User Badge & Logout */}
          {onLogout && (
            <div className="flex items-center gap-1 pl-1 border-l border-slate-800">
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-950/70 border border-slate-800 rounded-lg text-xs font-mono text-slate-300">
                <Shield className="w-3.5 h-3.5 text-blue-400" />
                <span>{adminUsername || 'admin123'}</span>
              </div>
              <button
                id="btn-admin-logout"
                onClick={onLogout}
                className="px-2.5 py-2 bg-slate-800/80 hover:bg-rose-950/70 hover:border-rose-800/80 text-slate-300 hover:text-rose-300 border border-slate-700/80 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Выйти из учетной записи администратора"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Выйти</span>
              </button>
            </div>
          )}
        </div>

      </div>
    </header>
  );
};
