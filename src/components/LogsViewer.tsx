/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { BotLogEntry } from '../types.js';
import { Terminal, RefreshCw, AlertCircle, CheckCircle2, MessageSquare, Info, Trash2 } from 'lucide-react';

interface LogsViewerProps {
  logs: BotLogEntry[];
  onRefresh: () => void;
  onClearHistory?: () => void;
  isClearing?: boolean;
}

export const LogsViewer: React.FC<LogsViewerProps> = ({ logs, onRefresh, onClearHistory, isClearing }) => {
  const [filter, setFilter] = useState<'all' | 'alert' | 'check' | 'command' | 'error'>('all');
  const [confirmClear, setConfirmClear] = useState(false);

  const filteredLogs = logs.filter((log) => {
    if (filter === 'all') return true;
    return log.type === filter;
  });

  const handleClearClick = () => {
    if (confirmClear) {
      onClearHistory?.();
      setConfirmClear(false);
    } else {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 5000);
    }
  };

  const getLogIcon = (type: BotLogEntry['type']) => {
    switch (type) {
      case 'alert':
        return <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />;
      case 'check':
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
      case 'command':
        return <MessageSquare className="w-3.5 h-3.5 text-indigo-400 shrink-0" />;
      case 'error':
        return <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />;
      default:
        return <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
    }
  };

  return (
    <div id="logs-viewer" className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-emerald-400" />
          <h2 className="text-base font-semibold text-white">Журнал событий бэкенда (Live Logs)</h2>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
            <button
              onClick={() => setFilter('all')}
              className={`px-2 py-0.5 rounded text-[11px] ${filter === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400'}`}
            >
              Все
            </button>
            <button
              onClick={() => setFilter('alert')}
              className={`px-2 py-0.5 rounded text-[11px] ${filter === 'alert' ? 'bg-rose-900/50 text-rose-300' : 'text-slate-400'}`}
            >
              Алерты
            </button>
            <button
              onClick={() => setFilter('check')}
              className={`px-2 py-0.5 rounded text-[11px] ${filter === 'check' ? 'bg-emerald-900/50 text-emerald-300' : 'text-slate-400'}`}
            >
              Проверки
            </button>
            <button
              onClick={() => setFilter('command')}
              className={`px-2 py-0.5 rounded text-[11px] ${filter === 'command' ? 'bg-indigo-900/50 text-indigo-300' : 'text-slate-400'}`}
            >
              Команды
            </button>
          </div>

          <button
            onClick={onRefresh}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
            title="Обновить логи"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          {onClearHistory && (
            <button
              onClick={handleClearClick}
              disabled={isClearing}
              className={`px-2.5 py-1.5 border rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                confirmClear
                  ? 'bg-rose-600 hover:bg-rose-500 border-rose-500 text-white font-semibold animate-pulse'
                  : 'bg-slate-800 hover:bg-rose-950/60 hover:text-rose-200 border-slate-700 hover:border-rose-700/60 text-slate-300'
              }`}
              title={confirmClear ? 'Нажмите еще раз для подтверждения' : 'Очистить всю историю событий и логов'}
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span>{confirmClear ? 'Подтвердить очистку?' : 'Очистить историю'}</span>
            </button>
          )}
        </div>
      </div>

      <div className="bg-slate-950 rounded-lg p-3 font-mono text-xs max-h-64 overflow-y-auto space-y-2 border border-slate-850">
        {filteredLogs.length === 0 ? (
          <div className="text-slate-500 text-center py-6">Логи событий пока пусты</div>
        ) : (
          filteredLogs.map((log) => (
            <div key={log.id} className="flex items-start gap-2 text-slate-300 hover:bg-slate-900/50 p-1 rounded">
              <span className="text-slate-600 text-[10px] shrink-0 pt-0.5">
                {new Date(log.timestamp).toLocaleTimeString('ru-RU')}
              </span>
              {getLogIcon(log.type)}
              <span className="flex-1 break-words">
                {log.chatId && (
                  <span className="text-indigo-400 font-semibold mr-1.5">[Chat {log.chatId}]</span>
                )}
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
