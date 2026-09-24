/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { BotUser, AlertThreshold } from '../types.js';
import { X, Plus, RotateCcw, Check, BellRing, AlertTriangle } from 'lucide-react';

interface ThresholdsModalProps {
  user: BotUser;
  onClose: () => void;
  onToggleThreshold: (chatId: number, value: number) => Promise<void>;
  onAddThreshold: (chatId: number, value: number) => Promise<void>;
  onResetThresholds: (chatId: number) => Promise<void>;
}

export const ThresholdsModal: React.FC<ThresholdsModalProps> = ({
  user,
  onClose,
  onToggleThreshold,
  onAddThreshold,
  onResetThresholds,
}) => {
  const [newValue, setNewValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const thresholds = user.thresholds || [];

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(newValue.replace(',', '.'));
    if (isNaN(val) || val <= 0) return;

    setIsSubmitting(true);
    await onAddThreshold(user.chatId, val);
    setNewValue('');
    setIsSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-5 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-slate-800">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <BellRing className="w-4 h-4 text-indigo-400" />
              Уровни оповещений (Alert Thresholds)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Для пользователя: <b className="text-white">{user.telegramFirstName || user.telegramUsername || user.chatId}</b>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current status */}
        <div className="my-3.5 p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
          <div>
            <span className="text-slate-400">Текущий баланс: </span>
            <span className="font-bold text-white font-mono">
              {user.currentBalance != null ? `${user.currentBalance} ₽` : 'Не проверен'}
            </span>
          </div>
          <div>
            <span className="text-slate-400">Всего уровней: </span>
            <span className="font-bold text-indigo-400 font-mono">{thresholds.length} шт.</span>
            <span className="text-slate-500 text-[11px]"> (по умолчанию: 1 000, 5 000, 10 000 ₽)</span>
          </div>
        </div>

        {/* Thresholds Grid */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-slate-300 mb-2">
            Нажмите на порог для включения / отключения:
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
            {thresholds.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => onToggleThreshold(user.chatId, t.value)}
                className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between transition-all ${
                  t.enabled
                    ? 'bg-indigo-600/15 border-indigo-500/40 text-indigo-200 hover:bg-indigo-600/25'
                    : 'bg-slate-950/60 border-slate-800 text-slate-500 hover:text-slate-400'
                }`}
              >
                <span className="font-mono">{t.value} ₽</span>
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                    t.enabled ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-600'
                  }`}
                >
                  {t.enabled ? '✓' : '✕'}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Add custom threshold form */}
        <form onSubmit={handleAdd} className="flex gap-2 mb-4">
          <input
            type="number"
            step="any"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="Добавить свой порог (например: 15 ₽)"
            className="flex-1 bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 outline-none"
          />
          <button
            type="submit"
            disabled={isSubmitting || !newValue}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Добавить
          </button>
        </form>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-800 text-xs">
          <button
            type="button"
            onClick={() => onResetThresholds(user.chatId)}
            className="text-slate-400 hover:text-slate-200 flex items-center gap-1.5 hover:underline"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Сбросить к стандартным (1000, 5000, 10 000 ₽)
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors"
          >
            Готово
          </button>
        </div>

      </div>
    </div>
  );
};
