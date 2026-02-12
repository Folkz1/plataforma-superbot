'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, Search, Clock, Phone, Instagram, MessageCircle } from 'lucide-react';
import { api } from '@/lib/api';

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
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

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
      setError('Erro ao carregar conversas');
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

  const getChannelIcon = (channel: string) => {
    switch (channel) {
      case 'whatsapp': return <Phone className="w-5 h-5 text-green-600" />;
      case 'instagram': return <Instagram className="w-5 h-5 text-pink-600" />;
      case 'messenger': return <MessageCircle className="w-5 h-5 text-blue-600" />;
      default: return <MessageCircle className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      open: 'bg-green-100 text-green-700',
      handoff: 'bg-amber-100 text-amber-700',
      closed: 'bg-gray-100 text-gray-600',
      resolved: 'bg-blue-100 text-blue-700',
    };
    const labels: Record<string, string> = {
      open: 'Aberto',
      handoff: 'Humano',
      closed: 'Fechado',
      resolved: 'Resolvido',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles.open}`}>
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
        <h1 className="text-2xl font-bold text-gray-900">Conversas</h1>
        <p className="text-sm text-gray-500 mt-1">{conversations.length} conversas encontradas</p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por nome, ID ou mensagem..."
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
          <option value="all">Todos</option>
          <option value="open">Abertos</option>
          <option value="handoff">Humano</option>
          <option value="closed">Fechados</option>
        </select>
      </div>

      {/* List */}
      {error ? (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">Nenhuma conversa</h3>
          <p className="text-sm text-gray-500">As conversas aparecerao quando chegarem mensagens</p>
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
                    {conv.last_text || 'Sem mensagens'}
                  </p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(conv.last_event_at).toLocaleString('pt-BR', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                      })}
                    </span>
                    <span>{conv.message_count} msgs</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
