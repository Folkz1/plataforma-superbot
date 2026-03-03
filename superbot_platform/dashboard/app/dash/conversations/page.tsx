'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, Search, Clock, MessageCircle, HandMetal, RotateCcw, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { getPlatformLogo } from '@/components/PlatformLogos';
import { useTranslation } from '@/lib/i18n';

interface Conversation {
  project_id: string;
  conversation_id: string;
  contact_name: string | null;
  channel_type: string;
  status: string;
  last_event_at: string;
  last_text: string | null;
  message_count: number;
}

function relativeTime(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'agora';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function ConversationsPage() {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [tenantId, setTenantId] = useState('');
  const fingerprintRef = useRef('');

  const dateLocale = locale === 'pt' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US';

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) return;
    const user = JSON.parse(userData);
    const tId = user.role === 'admin'
      ? localStorage.getItem('active_tenant_id')
      : user.client_id;
    if (tId) {
      setTenantId(tId);
    }
  }, []);

  const loadConversations = useCallback(async (tId: string, isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      const response = await api.get('/api/conversations/', { params: { project_id: tId, limit: 200 } });
      const data = response.data || [];
      const fp = data.map((c: Conversation) => `${c.conversation_id}:${c.status}:${c.message_count}`).join('|');
      if (fp !== fingerprintRef.current) {
        fingerprintRef.current = fp;
        setConversations(data);
      }
      setError(null);
    } catch {
      if (!isBackground) setError(t.common_error);
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!tenantId) return;
    loadConversations(tenantId);
    const interval = setInterval(() => loadConversations(tenantId, true), 15000);
    return () => clearInterval(interval);
  }, [tenantId, loadConversations]);

  const filtered = useMemo(() => {
    return conversations.filter(conv => {
      const q = search.toLowerCase();
      const matchSearch = !q ||
        (conv.contact_name || '').toLowerCase().includes(q) ||
        conv.conversation_id.toLowerCase().includes(q) ||
        conv.last_text?.toLowerCase().includes(q);
      const matchStatus = statusFilter === 'all' || conv.status === statusFilter;
      const matchChannel = channelFilter === 'all' || conv.channel_type === channelFilter;
      return matchSearch && matchStatus && matchChannel;
    });
  }, [conversations, search, statusFilter, channelFilter]);

  // Channel counts for badges
  const channelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    conversations.forEach(c => {
      counts[c.channel_type] = (counts[c.channel_type] || 0) + 1;
    });
    return counts;
  }, [conversations]);

  const handleQuickStatus = async (e: React.MouseEvent, conv: Conversation, newStatus: string) => {
    e.stopPropagation();
    try {
      await api.patch(`/api/conversations/${conv.project_id}/${conv.conversation_id}/status`, {
        status: newStatus,
        reason: newStatus === 'handoff' ? 'Transferido para humano via lista' : 'Devolvido ao bot via lista'
      }, {
        params: { channel_type: conv.channel_type }
      });
      setConversations(prev => prev.map(c =>
        c.project_id === conv.project_id && c.channel_type === conv.channel_type && c.conversation_id === conv.conversation_id
          ? { ...c, status: newStatus }
          : c
      ));
    } catch (err) {
      console.error('Erro ao mudar status:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t.conv_title}</h1>
          <p className="text-xs text-gray-500">
            {filtered.length} de {conversations.length} contatos
          </p>
        </div>
        <button
          onClick={() => tenantId && loadConversations(tenantId)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Atualizar
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por nome, ID ou mensagem..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">Todos canais ({conversations.length})</option>
          {Object.entries(channelCounts).sort().map(([ch, count]) => (
            <option key={ch} value={ch}>
              {ch === 'whatsapp' ? 'WhatsApp' : ch === 'instagram' ? 'Instagram' : ch === 'messenger' ? 'Messenger' : ch} ({count})
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">{t.conv_all}</option>
          <option value="open">{t.conv_open}</option>
          <option value="waiting_customer">{t.conv_waiting}</option>
          <option value="handoff">{t.conv_handoff}</option>
          <option value="closed">{t.conv_closed}</option>
          <option value="do_not_contact">Nao contactar</option>
        </select>
      </div>

      {/* List */}
      {error ? (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">{t.conv_no_conversations}</h3>
          <p className="text-sm text-gray-500">{t.conv_no_conversations_desc}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Contato</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Canal</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Ultima msg</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Msgs</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Tempo</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Acao</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((conv) => {
                const statusStyles: Record<string, string> = {
                  open: 'bg-green-100 text-green-700',
                  waiting_customer: 'bg-yellow-100 text-yellow-700',
                  handoff: 'bg-amber-100 text-amber-700',
                  closed: 'bg-gray-100 text-gray-600',
                  resolved: 'bg-blue-100 text-blue-700',
                  do_not_contact: 'bg-red-100 text-red-700',
                };
                const statusLabels: Record<string, string> = {
                  open: 'Aberto',
                  waiting_customer: 'Aguardando',
                  handoff: 'Handoff',
                  closed: 'Fechado',
                  resolved: 'Resolvido',
                  do_not_contact: 'Bloqueado',
                };

                return (
                  <tr
                    key={`${conv.project_id}-${conv.channel_type}-${conv.conversation_id}`}
                    onClick={() => router.push(
                      `/dash/conversations/${encodeURIComponent(conv.project_id)}/${encodeURIComponent(conv.conversation_id)}?channel_type=${encodeURIComponent(conv.channel_type)}`
                    )}
                    className="hover:bg-blue-50/50 cursor-pointer transition"
                  >
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-gray-900">
                        {conv.contact_name || conv.conversation_id}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {getPlatformLogo(conv.channel_type, 16) || <MessageCircle className="w-4 h-4 text-gray-400" />}
                        <span className="text-xs text-gray-600 capitalize">{conv.channel_type}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusStyles[conv.status] || 'bg-gray-100 text-gray-600'}`}>
                        {statusLabels[conv.status] || conv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-gray-500 truncate max-w-[200px]">
                        {conv.last_text || '-'}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 tabular-nums">
                      {conv.message_count}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                      {relativeTime(conv.last_event_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {conv.status !== 'handoff' ? (
                        <button
                          onClick={(e) => handleQuickStatus(e, conv, 'handoff')}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[10px] font-medium hover:bg-amber-100 transition"
                        >
                          <HandMetal className="w-3 h-3" />
                          Assumir
                        </button>
                      ) : (
                        <button
                          onClick={(e) => handleQuickStatus(e, conv, 'open')}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded text-[10px] font-medium hover:bg-blue-100 transition"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Devolver
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
