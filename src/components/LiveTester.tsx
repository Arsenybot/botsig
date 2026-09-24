/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Play, Check, AlertCircle, Clock, Key, ArrowRight, ShieldCheck, Copy } from 'lucide-react';

interface LiveTesterProps {
  defaultToken: string;
}

export const LiveTester: React.FC<LiveTesterProps> = ({ defaultToken }) => {
  const [token, setToken] = useState(
    defaultToken || 'demo_sigma_token_9f81a7b6c5d4e3f2'
  );
  const [userId, setUserId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  const runTest = async (mode: 'full' | 'me_only' | 'user_by_id') => {
    setIsLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/sigmasms/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token.trim(),
          userId: userId.trim(),
          mode,
        }),
      });

      const data = await res.json();
      setResult(data);

      if (data.id && !userId) {
        setUserId(data.id);
      }
    } catch (err: any) {
      setResult({
        success: false,
        error: err.message || 'Ошибка сети',
        durationMs: 0,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div id="live-api-tester" className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-800">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400" />
            Интерактивный тестер API SigmaSMS
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Проверка логики: сначала <code className="text-blue-300 font-mono">GET /users/me</code> → получение ID → потом <code className="text-blue-300 font-mono">GET /users/&#123;ID&#125;</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Демо токен:</span>
          <button
            onClick={() => setToken('demo_sigma_token_9f81a7b6c5d4e3f2')}
            className="text-xs text-blue-400 hover:text-blue-300 underline font-mono"
          >
            demo_sigma_token...
          </button>
        </div>
      </div>

      {/* Input controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="lg:col-span-2">
          <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
            <span>Authorization Token (Токен авторизации)</span>
            <span className="text-slate-500 font-normal">Заголовок: Authorization</span>
          </label>
          <div className="relative">
            <input
              id="input-sigma-token"
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Введите токен SigmaSMS"
              className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-lg px-3.5 py-2 text-xs font-mono text-slate-200 outline-none pr-10"
            />
            <button
              onClick={() => copyToClipboard(token)}
              className="absolute right-2 top-2 text-slate-400 hover:text-slate-200 p-1"
              title="Скопировать токен"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
            <span>ID пользователя (опционально)</span>
            <span className="text-slate-500 font-normal">&#123;ID&#125;</span>
          </label>
          <input
            id="input-sigma-userid"
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="10002714-6e1d-43cd-8fde..."
            className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-lg px-3.5 py-2 text-xs font-mono text-slate-200 outline-none"
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          id="btn-run-full-flow"
          onClick={() => runTest('full')}
          disabled={isLoading || !token}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors shadow-sm"
        >
          <Play className={`w-3.5 h-3.5 ${isLoading ? 'animate-pulse' : ''}`} />
          {isLoading ? 'Запрос выполняется...' : 'Полный цикл: /users/me → /users/{id}'}
        </button>

        <button
          id="btn-run-me-only"
          onClick={() => runTest('me_only')}
          disabled={isLoading || !token}
          className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-xs font-medium transition-colors"
        >
          Только GET /api/users/me
        </button>

        <button
          id="btn-run-user-by-id"
          onClick={() => runTest('user_by_id')}
          disabled={isLoading || !token || !userId}
          className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
        >
          Только GET /api/users/{userId || '{id}'}
        </button>
      </div>

      {/* Result Panel */}
      {result && (
        <div className="mt-3 bg-slate-950 border border-slate-800 rounded-lg p-3.5 text-xs">
          <div className="flex items-center justify-between pb-2 border-b border-slate-850 mb-3">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${
                  result.success
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                }`}
              >
                {result.success ? <Check className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                {result.success ? 'Успешно 200 OK' : 'Ошибка запроса'}
              </span>
              <span className="text-slate-400 flex items-center gap-1 font-mono">
                <Clock className="w-3 h-3" />
                {result.durationMs} мс
              </span>
            </div>

            {result.balance !== undefined && (
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Баланс:</span>
                <span className="font-bold text-emerald-400 text-sm font-mono">{result.balance} ₽</span>
              </div>
            )}
          </div>

          {result.success ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3 text-slate-300 bg-slate-900/60 p-2.5 rounded border border-slate-800">
              <div>
                <span className="text-slate-500 block text-[10px]">Имя / Username:</span>
                <span className="font-semibold text-white">{result.fullName || result.username}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Email:</span>
                <span className="text-slate-300 truncate block">{result.email || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Телефон:</span>
                <span className="text-slate-300">{result.phone || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Статус:</span>
                <span className="text-emerald-400">{result.isActive ? '🟢 Активен' : '🔴 Неактивен'}</span>
              </div>
            </div>
          ) : (
            <div className="p-2.5 bg-rose-950/30 border border-rose-800/40 rounded text-rose-300 mb-3">
              {result.error}
            </div>
          )}

          <div>
            <span className="text-slate-500 text-[10px] block mb-1">Сырой ответ сервера (JSON):</span>
            <pre className="bg-slate-900 p-2.5 rounded text-[11px] font-mono text-slate-300 overflow-x-auto max-h-48 border border-slate-800">
              {JSON.stringify(result.raw || result, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
