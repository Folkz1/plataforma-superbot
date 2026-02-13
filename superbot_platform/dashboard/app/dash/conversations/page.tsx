'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, Search, Clock, MessageCircle, HandMetal, RotateCcw } from 'lucide-react';
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

export default function ConversationsPage() {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const dateLocale = locale === 'pt' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US';

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) return;
    const user = JSON.parse(userData);
    const tenantId = user.role === 'admin'
      ? localStorage.getItem('active_tenant_id')
      : user.client_id;
    if (tenantId) loadConversations(tenantId);
  }, []);

  const loadConversations = async (tenantId: string) => {
    try {
      setLoading(true);
      const response = await api.get('/api/conversations/', { params: { project_id: tenantId } });
      setConversations(response.data);
    } catch (err: any) {
      setError(t.common_error);
    } finally {
      setLoading(false);
    }
  };

  const filtered = conversations.filter(conv => {
    const matchSearch = !search ||
      (conv.contact_name || '').toLowerCase().includes(search.toLowerCase()) ||
      conv.conversation_id.toLowerCase().includes(search.toLowerCase()) ||
      conv.last_text?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || conv.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const handleQuickStatus = async (e: React.MouseEvent, conv: Conversation, newStatus: string) => {
    e.stopPropagation();
    try {
      await api.patch(`/api/conversations/${conv.project_id}/${conv.conversation_id}/status`, {
        status: newStatus,
        reason: newStatus === 'handoff' ? 'Transferido para humano via lista' : 'Devolvido ao bot via lista'
      });
      setConversations(prev => prev.map(c =>
        c.conversation_id === conv.conversation_id ? { ...c, status: newStatus } : c
      ));
    } catch (err) {
      console.error('Erro ao mudar status:', err);
    }
  };

  const getChannelIcon = (channel: string) => {
    const logo = getPlatformLogo(channel, 20);
    return logo || <MessageCircle className="w-5 h-5 text-gray-400" />;
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      open: 'bg-green-100 text-green-700',
      waiting_customer: 'bg-yellow-100 text-yellow-700',
      handoff: 'bg-amber-100 text-amber-700',
      closed: 'bg-gray-100 text-gray-600',
      resolved: 'bg-blue-100 text-blue-700',
      do_not_contact: 'bg-red-100 text-red-700',
    };
    const labels: Record<string, string> = {
      open: t.status_open,
      waiting_customer: t.status_waiting_customer,
      handoff: t.status_handoff,
      closed: t.status_closed,
      resolved: t.status_resolved,
      do_not_contact: t.status_do_not_contact,
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-600'}`}>
        {labels[status] || status}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      {/* Title */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t.conv_title}</h1>
        <p className="text-sm text-gray-500 mt-1">{conversations.length} {t.conv_found}</p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={t.conv_search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">{t.conv_all}</option>
          <option value="open">{t.conv_open}</option>
          <option value="waiting_customer">{t.conv_waiting}</option>
          <option value="handoff">{t.conv_handoff}</option>
          <option value="closed">{t.conv_closed}</option>
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
        <div className="space-y-2">
          {filtered.map((conv) => (
            <div
              key={`${conv.project_id}-${conv.channel_type}-${conv.conversation_id}`}
              onClick={() => router.push(`/dash/conversations/${conv.project_id}/${conv.conversation_id}`)}
              className="bg-white border border-gray-100 rounded-xl p-4 hover:border-blue-200 hover:shadow-sm cursor-pointer transition-all"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{getChannelIcon(conv.channel_type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-900 truncate">
                      {conv.contact_name || conv.conversation_id}
                    </span>
                    {getStatusBadge(conv.status)}
                  </div>
                  <p className="text-gray-500 text-sm truncate">
                    {conv.last_text || t.conv_no_messages}
                  </p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(conv.last_event_at).toLocaleString(dateLocale, {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                      })}
                    </span>
                    <span>{conv.message_count} {t.conv_msgs}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {conv.status !== 'handoff' ? (
                    <button
                      onClick={(e) => handleQuickStatus(e, conv, 'handoff')}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 transition text-xs font-medium"
                      title={t.conv_assume}
                    >
                      <HandMetal className="w-3.5 h-3.5" />
                      {t.conv_assume}
                    </button>
                  ) : (
                    <button
                      onClick={(e) => handleQuickStatus(e, conv, 'open')}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition text-xs font-medium"
                      title={t.conv_return}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {t.conv_return}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
