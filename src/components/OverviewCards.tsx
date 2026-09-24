/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BotStatus } from '../types.js';
import { Bot, Users, BellRing, Clock, CheckCircle2, AlertTriangle, Zap } from 'lucide-react';

interface OverviewCardsProps {
  status: BotStatus | null;
  onClearSimulated: () => void;
  hasSimulatedUsers?: boolean;
}

export const OverviewCards: React.FC<OverviewCardsProps> = ({ status, onClearSimulated, hasSimulatedUsers }) => {
  const stats = status?.stats;
  const isBotActive = status?.isBotActive !== false;
  const isOnline = isBotActive && status?.botInfo?.isOnline && status?.isPolling;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      
      {/* Bot Identity Card */}
      <div id="card-bot-status" className="bg-slate-900/80 border border-slate-800 rounded-xl p-4.5 shadow-sm">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-xs font-medium text-slate-400">Telegram Бот</span>
          <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${
            !isBotActive
              ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
              : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
          }`}>
            <Bot className="w-4 h-4" />
          </div>
        </div>
        <div className="text-lg font-bold text-white mb-1 flex items-center gap-2">
          <span>@{status?.botInfo?.username || 'SigmaBa1ance_bot'}</span>
          <span className={`w-2.5 h-2.5 rounded-full ${
            !isBotActive ? 'bg-rose-500' : isOnline ? 'bg-emerald-400' : 'bg-amber-400'
          }`} />
        </div>
        <div className="text-xs text-slate-400 space-y-1">
          <p>Статус: <span className={!isBotActive ? 'text-rose-400 font-medium' : isOnline ? 'text-emerald-400 font-medium' : 'text-amber-400'}>
            {!isBotActive ? 'Отключен в админке' : isOnline ? 'Активен (В сети)' : 'Инициализация'}
          </span></p>
          <p>ID: <span className="font-mono text-slate-300">{status?.botInfo?.id || '8948316828'}</span></p>
        </div>
      </div>

      {/* Users Capacity Card */}
      <div id="card-users-count" className="bg-slate-900/80 border border-slate-800 rounded-xl p-4.5 shadow-sm">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-xs font-medium text-slate-400">Пользователи бота</span>
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Users className="w-4 h-4" />
          </div>
        </div>
        <div className="flex items-baseline gap-2 mb-1">
          <div className="text-2xl font-bold text-white">{stats?.totalUsers ?? 0}</div>
          <span className="text-xs font-medium text-slate-400">/ 200+ емкость</span>
        </div>
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>С токеном: <b className="text-emerald-400 font-normal">{stats?.activeUsersWithToken ?? 0}</b></span>
          {hasSimulatedUsers || (stats?.totalUsers && stats.totalUsers > 2) ? (
            <button
              id="btn-clear-simulated-users"
              onClick={onClearSimulated}
              className="text-rose-400 hover:text-rose-300 underline font-medium"
              title="Удалить тестовых симулированных пользователей"
            >
              Сбросить симуляцию
            </button>
          ) : null}
        </div>
      </div>

      {/* Real-time Checks Card */}
      <div id="card-checks-count" className="bg-slate-900/80 border border-slate-800 rounded-xl p-4.5 shadow-sm">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-xs font-medium text-slate-400">Выполнено проверок</span>
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
          </div>
        </div>
        <div className="text-2xl font-bold text-white mb-1">
          {stats?.totalChecks ?? 0}
        </div>
        <p className="text-xs text-slate-400 flex items-center gap-1">
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span>Реальное время (SigmaSMS API)</span>
        </p>
      </div>

      {/* Dispatched Alerts Card */}
      <div id="card-alerts-count" className="bg-slate-900/80 border border-slate-800 rounded-xl p-4.5 shadow-sm">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-xs font-medium text-slate-400">Отправлено алертов</span>
          <div className="w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
            <BellRing className="w-4 h-4" />
          </div>
        </div>
        <div className="text-2xl font-bold text-rose-400 mb-1">
          {stats?.totalAlerts ?? 0}
        </div>
        <p className="text-xs text-slate-400 flex items-center gap-1">
          <Clock className="w-3.5 h-3.5 text-slate-500" />
          <span>Интервал: {status?.config?.checkIntervalSeconds || 60} сек</span>
        </p>
      </div>

    </div>
  );
};
