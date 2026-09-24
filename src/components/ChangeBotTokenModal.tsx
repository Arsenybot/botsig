/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { BotStatus } from '../types.js';
import { authFetch } from '../api.js';
import { KeyRound, Check, AlertCircle, X, ExternalLink, Eye, EyeOff, RotateCcw, Loader2, Bot } from 'lucide-react';

interface ChangeBotTokenModalProps {
  status: BotStatus | null;
  onClose: () => void;
  onTokenUpdated: () => void;
}

const DEFAULT_BOT_TOKEN = '8948316828:AAEi6oVo9qm2nwt9YKxW46zhpN6Gqplld_0';

export const ChangeBotTokenModal: React.FC<ChangeBotTokenModalProps> = ({
  status,
  onClose,
  onTokenUpdated,
}) => {
  const [tokenInput, setTokenInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingCurrent, setIsFetchingCurrent] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [activeBotInfo, setActiveBotInfo] = useState(status?.botInfo || null);

  useEffect(() => {
    let isMounted = true;
    const fetchCurrentToken = async () => {
      try {
        const res = await authFetch('/api/bot/token');
        if (res.ok) {
          const data = await res.json();
          if (isMounted && data.token) {
            setTokenInput(data.token);
            if (data.botInfo) {
              setActiveBotInfo(data.botInfo);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load current bot token:', err);
      } finally {
        if (isMounted) setIsFetchingCurrent(false);
      }
    };

    fetchCurrentToken();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanToken = tokenInput.trim();
    if (!cleanToken) {
      setErrorMsg('Пожалуйста, введите токен бота');
      return;
    }

    if (!cleanToken.includes(':')) {
      setErrorMsg('Некорректный формат токена Telegram (формат должен быть: 123456789:AA...xyz)');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await authFetch('/api/bot/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: cleanToken }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setErrorMsg(data.message || 'Ошибка подключения нового токена к Telegram API');
      } else {
        setSuccessMsg(data.message || 'Токен успешно сохранен и бот запущен!');
        if (data.botInfo) {
          setActiveBotInfo(data.botInfo);
        }
        onTokenUpdated();
        setTimeout(() => {
          onClose();
        }, 1800);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Сетевая ошибка при обновлении токена');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetToDefault = () => {
    setTokenInput(DEFAULT_BOT_TOKEN);
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600/15 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">
                Смена токена Telegram-бота
              </h3>
              <p className="text-xs text-slate-400">
                Управление подключением Telegram Bot API
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Active Bot Card */}
        <div className="my-4 p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs text-slate-400">Текущий бот в системе:</div>
              <div className="text-sm font-bold text-white flex items-center gap-1.5">
                <span>@{activeBotInfo?.username || status?.botInfo?.username || 'SigmaBa1ance_bot'}</span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400">ID бота:</div>
            <div className="text-xs font-mono text-slate-300 font-medium">
              {activeBotInfo?.id || status?.botInfo?.id || '8948316828'}
            </div>
          </div>
        </div>

        {/* Status / Error Alerts */}
        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1">{errorMsg}</div>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-2.5">
            <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="flex-1 font-medium">{successMsg}</div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-300">
                API-токен Telegram-бота:
              </label>
              <button
                type="button"
                onClick={handleResetToDefault}
                className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                title="Подставить токен по умолчанию"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Сбросить на дефолтный</span>
              </button>
            </div>

            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={tokenInput}
                onChange={(e) => {
                  setTokenInput(e.target.value);
                  setErrorMsg(null);
                }}
                disabled={isLoading || isFetchingCurrent}
                placeholder="Например: 8948316828:AAEi6oVo9qm2nwt9YKxW46zhpN6Gqplld_0"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 pr-20 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                autoComplete="off"
                spellCheck={false}
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors rounded"
                  title={showToken ? 'Скрыть токен' : 'Показать токен'}
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              При сохранении токен проверяется через метод <code>getMe</code> Telegram Bot API, после чего бот мгновенно переподключается.
            </p>
          </div>

          {/* Quick Help box */}
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-[11px] text-slate-400 space-y-1">
            <div className="font-semibold text-slate-300 flex items-center gap-1.5">
              <span>Инструкция по получению токена:</span>
            </div>
            <p>1. Откройте чат с <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-0.5">@BotFather <ExternalLink className="w-2.5 h-2.5" /></a> в Telegram.</p>
            <p>2. Отправьте команду <code>/newbot</code> или выберите существующего через <code>/mybots</code> → <i>API Token</i>.</p>
            <p>3. Скопируйте полученный ключ и вставьте в поле выше.</p>
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isLoading || isFetchingCurrent || !tokenInput.trim()}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-semibold flex items-center gap-2 transition-colors shadow-sm"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Проверка в Telegram...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Проверить и сохранить</span>
                </>
              )}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
