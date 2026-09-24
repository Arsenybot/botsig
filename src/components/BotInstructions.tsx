/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Send, CheckCircle2, Sliders, ShieldCheck, Zap, ExternalLink } from 'lucide-react';

export const BotInstructions: React.FC = () => {
  return (
    <div id="bot-instructions-card" className="bg-gradient-to-br from-slate-900 via-slate-900/90 to-blue-950/40 border border-slate-800 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-3 pb-2 border-b border-slate-800">
        <h2 className="text-base font-semibold text-white flex items-center gap-2">
          <Send className="w-4 h-4 text-blue-400" />
          Инструкция по тестированию Telegram-бота
        </h2>
        <a
          href="https://t.me/SigmaBa1ance_bot"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
        >
          <span>Открыть в Telegram</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
        
        {/* Step 1 */}
        <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-850">
          <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center mb-2">
            1
          </div>
          <h4 className="font-semibold text-white mb-1">Запустите бота</h4>
          <p className="text-slate-400">
            Перейдите в <a href="https://t.me/SigmaBa1ance_bot" target="_blank" rel="noreferrer" className="text-blue-400 underline">@SigmaBa1ance_bot</a> и отправьте команду <code className="text-blue-300 font-mono">/start</code>.
          </p>
        </div>

        {/* Step 2 */}
        <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-850">
          <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center mb-2">
            2
          </div>
          <h4 className="font-semibold text-white mb-1">Привяжите токен SigmaSMS</h4>
          <p className="text-slate-400">
            Отправьте API-токен сообщением или нажмите кнопку <i>"✨ Использовать демонстрационный токен"</i>.
          </p>
        </div>

        {/* Step 3 */}
        <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-850">
          <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center mb-2">
            3
          </div>
          <h4 className="font-semibold text-white mb-1">Запросите баланс</h4>
          <p className="text-slate-400">
            Нажмите кнопку <b>"💰 Баланс"</b> для моментального получения актуального баланса аккаунта в реальном времени.
          </p>
        </div>

        {/* Step 4 */}
        <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-850">
          <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center mb-2">
            4
          </div>
          <h4 className="font-semibold text-white mb-1">Настройте 10+ порогов</h4>
          <p className="text-slate-400">
            В меню <b>"🔔 Уровни оповещений"</b> выберите нужные пороги (5, 10, 25, 50, 100 ₽...) или добавьте свое значение.
          </p>
        </div>

      </div>
    </div>
  );
};
