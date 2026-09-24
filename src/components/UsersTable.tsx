/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { BotUser, AlertThreshold } from '../types.js';
import {
  Search,
  RefreshCw,
  Send,
  SlidersHorizontal,
  AlertTriangle,
  CheckCircle,
  Clock,
  ExternalLink,
  KeyRound,
  RotateCcw,
  Trash2,
  Unlink,
  ShieldCheck,
  Lock,
} from 'lucide-react';

interface UsersTableProps {
  users: BotUser[];
  onCheckUser: (chatId: number) => void;
  onSendTestAlert: (chatId: number, balance: number) => void;
  onOpenThresholds: (user: BotUser) => void;
  checkingUserChatId: number | null;
  onClearAllTokens?: () => void;
  onClearAllHistory?: () => void;
  onClearUserHistory?: (chatId: number) => void;
  onClearUserToken?: (chatId: number) => void;
  onDeleteUser?: (chatId: number) => void;
}

export const UsersTable: React.FC<UsersTableProps> = ({
  users,
  onCheckUser,
  onSendTestAlert,
  onOpenThresholds,
  checkingUserChatId,
  onClearAllTokens,
  onClearAllHistory,
  onClearUserHistory,
  onClearUserToken,
  onDeleteUser,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'critical' | 'low' | 'with_token'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description: string;
    confirmLabel?: string;
    isDestructive?: boolean;
    onConfirm: () => void;
  } | null>(null);

  const handleConfirmClearAllTokens = () => {
    setConfirmDialog({
      title: 'Сбросить токены у ВСЕХ пользователей?',
      description: 'Вы действительно хотите удалить и сбросить подключенные токены у ВСЕХ пользователей? Клиентам потребуется заново отправить свой токен в бота.',
      confirmLabel: 'Сбросить все токены',
      isDestructive: true,
      onConfirm: () => {
        onClearAllTokens?.();
        setConfirmDialog(null);
      },
    });
  };

  const handleConfirmClearAllHistory = () => {
    setConfirmDialog({
      title: 'Очистить историю у ВСЕХ пользователей?',
      description: 'Вы действительно хотите очистить всю историю проверок, алертов и логи у всех зарегистрированных пользователей?',
      confirmLabel: 'Очистить историю',
      isDestructive: true,
      onConfirm: () => {
        onClearAllHistory?.();
        setConfirmDialog(null);
      },
    });
  };

  const handleConfirmClearUserHistory = (chatId: number, name: string) => {
    setConfirmDialog({
      title: 'Очистить историю пользователя?',
      description: `Очистить историю проверок, алертов и логи пользователя «${name}» (Chat ID: ${chatId})?`,
      confirmLabel: 'Очистить историю',
      isDestructive: false,
      onConfirm: () => {
        onClearUserHistory?.(chatId);
        setConfirmDialog(null);
      },
    });
  };

  const handleConfirmClearUserToken = (chatId: number, name: string) => {
    setConfirmDialog({
      title: 'Отвязать токен пользователя?',
      description: `Отвязать и удалить API-токен SigmaSMS у пользователя «${name}» (Chat ID: ${chatId})?`,
      confirmLabel: 'Отвязать токен',
      isDestructive: true,
      onConfirm: () => {
        onClearUserToken?.(chatId);
        setConfirmDialog(null);
      },
    });
  };

  const handleConfirmDeleteUser = (chatId: number, name: string) => {
    setConfirmDialog({
      title: 'Удалить пользователя из базы?',
      description: `Вы действительно хотите безвозвратно удалить пользователя «${name}» (Chat ID: ${chatId}) из базы данных?`,
      confirmLabel: 'Удалить пользователя',
      isDestructive: true,
      onConfirm: () => {
        onDeleteUser?.(chatId);
        setConfirmDialog(null);
      },
    });
  };

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      // Search
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        u.chatId.toString().includes(q) ||
        (u.telegramUsername && u.telegramUsername.toLowerCase().includes(q)) ||
        (u.telegramFirstName && u.telegramFirstName.toLowerCase().includes(q)) ||
        (u.sigmaUsername && u.sigmaUsername.toLowerCase().includes(q)) ||
        (u.sigmaFullName && u.sigmaFullName.toLowerCase().includes(q)) ||
        (u.sigmaUserId && u.sigmaUserId.toLowerCase().includes(q));

      if (!matchesSearch) return false;

      // Filter
      if (filterMode === 'critical') {
        return u.currentBalance != null && u.currentBalance <= 10;
      }
      if (filterMode === 'low') {
        return u.currentBalance != null && u.currentBalance <= 50;
      }
      if (filterMode === 'with_token') {
        return !!u.sigmaToken && u.sigmaToken.length > 0;
      }

      return true;
    });
  }, [users, searchQuery, filterMode]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredUsers.slice(start, start + pageSize);
  }, [filteredUsers, currentPage]);

  const getBalanceBadge = (balance?: number | null) => {
    if (balance == null) {
      return <span className="text-slate-500 font-mono text-xs">Не проверен</span>;
    }
    if (balance <= 10) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">
          <AlertTriangle className="w-3 h-3" />
          {balance.toFixed(2)} ₽
        </span>
      );
    }
    if (balance <= 50) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
          {balance.toFixed(2)} ₽
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
        <CheckCircle className="w-3 h-3" />
        {balance.toFixed(2)} ₽
      </span>
    );
  };

  return (
    <div id="users-management-table" className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-800">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-400" />
            Пользователи бота (Поддержка 200+ клиентов)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Всего пользователей: <b className="text-white">{users.length}</b> • Отфильтровано: <b className="text-indigo-400">{filteredUsers.length}</b>
          </p>
        </div>

        {/* Global Actions & Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Global Buttons for Tokens and History */}
          <div className="flex items-center gap-1.5">
            {onClearAllTokens && (
              <button
                id="btn-clear-all-tokens"
                onClick={handleConfirmClearAllTokens}
                className="px-2.5 py-1.5 bg-slate-950 hover:bg-amber-950/80 hover:text-amber-200 border border-slate-800 hover:border-amber-700/60 text-slate-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
                title="Сбросить подключенные токены SigmaSMS у всех пользователей"
              >
                <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                <span>Сбросить токены у всех</span>
              </button>
            )}

            {onClearAllHistory && (
              <button
                id="btn-clear-all-history"
                onClick={handleConfirmClearAllHistory}
                className="px-2.5 py-1.5 bg-slate-950 hover:bg-rose-950/80 hover:text-rose-200 border border-slate-800 hover:border-rose-700/60 text-slate-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
                title="Очистить историю проверок, алертов и логи у всех"
              >
                <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
                <span>Очистить историю у всех</span>
              </button>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => { setFilterMode('all'); setCurrentPage(1); }}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                filterMode === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Все ({users.length})
            </button>
            <button
              onClick={() => { setFilterMode('critical'); setCurrentPage(1); }}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                filterMode === 'critical' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Критический &le;10 ₽
            </button>
            <button
              onClick={() => { setFilterMode('low'); setCurrentPage(1); }}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                filterMode === 'low' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Низкий &le;50 ₽
            </button>
            <button
              onClick={() => { setFilterMode('with_token'); setCurrentPage(1); }}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                filterMode === 'with_token' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              С токеном
            </button>
          </div>
        </div>
      </div>

      {/* Search Input */}
      <div className="relative mb-3.5">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
        <input
          id="search-users-input"
          type="text"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
          placeholder="Поиск по имени, Telegram @username, Chat ID или Sigma ID..."
          className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg pl-9 pr-3.5 py-2 text-xs text-slate-200 placeholder-slate-500 outline-none"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950/60 text-slate-400 border-y border-slate-800">
            <tr>
              <th className="py-2.5 px-3 font-medium">Telegram Пользователь</th>
              <th className="py-2.5 px-3 font-medium">Аккаунт SigmaSMS</th>
              <th className="py-2.5 px-3 font-medium">Баланс</th>
              <th className="py-2.5 px-3 font-medium">Пороги алертов</th>
              <th className="py-2.5 px-3 font-medium">Посл. проверка</th>
              <th className="py-2.5 px-3 font-medium text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-850">
            {paginatedUsers.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-slate-500">
                  {users.length === 0
                    ? 'Пока нет зарегистрированных пользователей. Нажмите "Симуляция 200 польз." в шапке или напишите /start в Telegram боту @SigmaBa1ance_bot.'
                    : 'Ничего не найдено по текущим фильтрам.'}
                </td>
              </tr>
            ) : (
              paginatedUsers.map((user) => {
                const activeThresholds = (user.thresholds || []).filter((t) => t.enabled);
                const isChecking = checkingUserChatId === user.chatId;

                return (
                  <tr key={user.chatId} className="hover:bg-slate-850/40 transition-colors">
                    
                    {/* User Telegram */}
                    <td className="py-3 px-3">
                      <div className="font-semibold text-white flex items-center gap-1.5">
                        <span>{user.telegramFirstName || 'Пользователь'}</span>
                        {user.telegramUsername && (
                          <span className="text-indigo-400 font-normal">@{user.telegramUsername}</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        Chat ID: {user.chatId}
                      </div>
                    </td>

                    {/* Sigma Profile */}
                    <td className="py-3 px-3">
                      {user.tokens && user.tokens.length > 0 ? (
                        <div>
                          <div className="text-slate-200 font-medium flex items-center gap-1.5">
                            <span>{user.tokens[user.activeTokenIndex || 0]?.name || user.sigmaFullName || user.sigmaUsername || 'Аккаунт'}</span>
                            {user.tokens.length > 1 && (
                              <span className="text-[10px] bg-indigo-900/60 text-indigo-300 px-1.5 py-0.5 rounded-full border border-indigo-700/50">
                                {user.tokens.length} токена
                              </span>
                            )}
                          </div>
                          {user.sigmaFullName && user.tokens[user.activeTokenIndex || 0]?.name !== user.sigmaFullName && (
                            <div className="text-[11px] text-slate-400">
                              {user.sigmaFullName}
                            </div>
                          )}
                          {user.sigmaUsername && (
                            <div className="text-[10px] text-blue-400 font-mono truncate max-w-[140px]">
                              @{user.sigmaUsername}
                            </div>
                          )}
                          <div className="mt-1 flex items-center gap-1">
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-1.5 py-0.5 rounded" title="Токен зашифрован в изолированном хранилище AES-256-GCM">
                              <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                              <span>{user.tokens[user.activeTokenIndex || 0]?.maskedToken || user.maskedToken || '••••••••'}</span>
                            </span>
                          </div>
                        </div>
                      ) : user.sigmaUsername ? (
                        <div>
                          <div className="text-slate-200 font-medium">{user.sigmaFullName || user.sigmaUsername}</div>
                          <div className="text-[10px] text-blue-400 font-mono truncate max-w-[140px]">
                            @{user.sigmaUsername}
                          </div>
                          <div className="mt-1 flex items-center gap-1">
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-1.5 py-0.5 rounded">
                              <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                              <span>{user.maskedToken || '••••••••'}</span>
                            </span>
                          </div>
                        </div>
                      ) : user.sigmaToken ? (
                        <div>
                          <span className="text-amber-400 text-[11px]">Токен указан, ждет проверки</span>
                          <div className="mt-1 flex items-center gap-1">
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-1.5 py-0.5 rounded">
                              <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                              <span>{user.maskedToken || '••••••••'}</span>
                            </span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-500 text-[11px]">Токен не привязан</span>
                      )}
                    </td>

                    {/* Balance */}
                    <td className="py-3 px-3">
                      {getBalanceBadge(user.currentBalance)}
                    </td>

                    {/* Thresholds Count */}
                    <td className="py-3 px-3">
                      <button
                        onClick={() => onOpenThresholds(user)}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] border border-slate-700 transition-colors"
                      >
                        <SlidersHorizontal className="w-3 h-3 text-indigo-400" />
                        <span>{activeThresholds.length} из {(user.thresholds || []).length} активны</span>
                      </button>
                    </td>

                    {/* Last Check */}
                    <td className="py-3 px-3 text-slate-400 text-[11px]">
                      {user.lastCheckedAt ? (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-500" />
                          {new Date(user.lastCheckedAt).toLocaleTimeString('ru-RU')}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        {/* Check Balance */}
                        <button
                          onClick={() => onCheckUser(user.chatId)}
                          disabled={isChecking || !user.sigmaToken}
                          className="p-1.5 bg-slate-800 hover:bg-blue-600 disabled:opacity-40 text-slate-300 hover:text-white rounded transition-colors inline-flex items-center"
                          title="Проверить баланс сейчас"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
                        </button>

                        {/* Send Test Alert */}
                        <button
                          onClick={() => onSendTestAlert(user.chatId, user.currentBalance ?? 5.97)}
                          className="p-1.5 bg-slate-800 hover:bg-rose-600 text-slate-300 hover:text-white rounded transition-colors inline-flex items-center"
                          title="Отправить тестовый алерт в чат Telegram"
                        >
                          <Send className="w-3.5 h-3.5" />
                        </button>

                        {/* Clear Individual History */}
                        {onClearUserHistory && (
                          <button
                            onClick={() => handleConfirmClearUserHistory(user.chatId, user.telegramFirstName || user.telegramUsername || `ID ${user.chatId}`)}
                            className="p-1.5 bg-slate-800 hover:bg-purple-600 text-slate-300 hover:text-white rounded transition-colors inline-flex items-center"
                            title="Очистить историю и статистику этого пользователя"
                          >
                            <RotateCcw className="w-3.5 h-3.5 text-purple-400 hover:text-white" />
                          </button>
                        )}

                        {/* Clear Individual Token */}
                        {onClearUserToken && (
                          <button
                            onClick={() => handleConfirmClearUserToken(user.chatId, user.telegramFirstName || user.telegramUsername || `ID ${user.chatId}`)}
                            disabled={!user.sigmaToken}
                            className="p-1.5 bg-slate-800 hover:bg-amber-600 disabled:opacity-30 text-slate-300 hover:text-white rounded transition-colors inline-flex items-center"
                            title={user.sigmaToken ? 'Удалить / отвязать токен SigmaSMS' : 'Токен не привязан'}
                          >
                            <Unlink className="w-3.5 h-3.5 text-amber-400 hover:text-white" />
                          </button>
                        )}

                        {/* Delete User */}
                        {onDeleteUser && (
                          <button
                            onClick={() => handleConfirmDeleteUser(user.chatId, user.telegramFirstName || user.telegramUsername || `ID ${user.chatId}`)}
                            className="p-1.5 bg-slate-800 hover:bg-rose-700 text-slate-400 hover:text-white rounded transition-colors inline-flex items-center"
                            title="Удалить пользователя из базы"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-rose-400 hover:text-white" />
                          </button>
                        )}
                      </div>
                    </td>

                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-800 text-xs text-slate-400">
          <div>
            Показано {paginatedUsers.length} из {filteredUsers.length}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded"
            >
              Назад
            </button>
            <span className="px-2 font-mono text-slate-300">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded"
            >
              Вперед
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-bold text-white mb-2">{confirmDialog.title}</h3>
            <p className="text-xs text-slate-300 leading-relaxed mb-5">{confirmDialog.description}</p>
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-colors"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={confirmDialog.onConfirm}
                className={`px-4 py-2 rounded-lg text-xs font-semibold text-white transition-colors shadow-sm ${
                  confirmDialog.isDestructive
                    ? 'bg-rose-600 hover:bg-rose-500'
                    : 'bg-indigo-600 hover:bg-indigo-500'
                }`}
              >
                {confirmDialog.confirmLabel || 'Подтвердить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
