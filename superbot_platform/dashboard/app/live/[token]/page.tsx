'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  Phone, Instagram, MessageCircle, User, Bot, Wrench, HandMetal,
  AlertTriangle, Send, RotateCcw, ArrowLeft, Search, Clock,
  X, Calendar, ChevronRight
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface Message {
  id: string;
  direction: string;
  message_type: string;
  text: string | null;
  created_at: string;
}

interface Conversation {
  project_id: string;
  conversation_id: string;
  contact_name: string | null;
  channel_type: string;
  status: string;
  last_event_at: string;
  last_text?: string | null;
  message_count?: number;
  ai_state?: string | null;
  summary_short?: string | null;
  metadata?: Record<string, any> | null;
  messages?: Message[];
}

// ==================== API helpers ====================

async function portalFetch(url: string, options?: RequestInit) {
  const resp = await fetch(`${API_URL}${url}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.detail || `Erro ${resp.status}`);
  }
  return resp.json();
}

// ==================== Main Page ====================

export default function PortalPage() {
  const params = useParams();
  const token = params.token as string;

  const [portalType, setPortalType] = useState<'portal' | 'live_view' | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Detect token type
  useEffect(() => {
    portalFetch(`/api/live/${token}`).then((data) => {
      if (data.type === 'portal') {
        setPortalType('portal');
        loadConversations();
      } else if (data.messages) {
        setPortalType('live_view');
        setSelectedConv(data);
        setLoading(false);
      }
    }).catch((err) => {
      setError(err.message);
      setLoading(false);
    });
  }, [token]);

  const loadConversations = useCallback(async () => {
    try {
      const data = await portalFetch(`/api/live/${token}/conversations?limit=100`);
      setConversations(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Poll conversations list
  useEffect(() => {
    if (portalType !== 'portal') return;
    const interval = setInterval(loadConversations, 10000);
    return () => clearInterval(interval);
  }, [portalType, loadConversations]);

  const openConversation = async (conv: Conversation) => {
    try {
      const data = await portalFetch(`/api/live/${token}/conversations/${conv.conversation_id}`);
      setSelectedConv(data);
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400">Carregando...</p>
        </div>
      </div>
    );
  }

  if (error && !conversations.length && !selectedConv) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center max-w-md mx-4">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Link Indisponivel</h1>
          <p className="text-gray-400">{error}</p>
        </div>
      </div>
    );
  }

  // Show conversation detail
  if (selectedConv) {
    return (
      <ConversationView
        token={token}
        conversation={selectedConv}
        portalType={portalType!}
        onBack={portalType === 'portal' ? () => { setSelectedConv(null); loadConversations(); } : undefined}
      />
    );
  }

  // Show conversation list (portal only)
  const filtered = conversations.filter(c => {
    const matchSearch = !search ||
      (c.contact_name || '').toLowerCase().includes(search.toLowerCase()) ||
      c.conversation_id.toLowerCase().includes(search.toLowerCase()) ||
      (c.last_text || '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <h1 className="text-lg font-bold text-white">Portal de Conversas</h1>
              <p className="text-sm text-gray-400">{conversations.length} conversas</p>
            </div>
            <div className="flex items-center gap-2 px-3 py-1 bg-green-500/20 border border-green-500/30 rounded-full">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span className="text-xs text-green-400 font-medium">Ao Vivo</span>
            </div>
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="bg-gray-800/50 border-b border-gray-700/50 px-4 py-3">
        <div className="max-w-4xl mx-auto flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Buscar por nome ou mensagem..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Todos</option>
            <option value="open">Abertos</option>
            <option value="handoff">Humano</option>
            <option value="closed">Fechados</option>
          </select>
        </div>
      </div>

      {/* Conversation List */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-4">
        <div className="space-y-2">
          {filtered.map((conv) => (
            <button
              key={`${conv.project_id}-${conv.channel_type}-${conv.conversation_id}`}
              onClick={() => openConversation(conv)}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl p-4 hover:border-blue-500/50 hover:bg-gray-800/80 transition-all text-left"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  <ChannelIcon channel={conv.channel_type} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-white truncate">
                      {conv.contact_name || conv.conversation_id}
                    </span>
                    <StatusBadge status={conv.status} />
                  </div>
                  <p className="text-gray-400 text-sm truncate">
                    {conv.last_text || 'Sem mensagens'}
                  </p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(conv.last_event_at).toLocaleString('pt-BR', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                      })}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageCircle className="w-3 h-3" />
                      {conv.message_count} msgs
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-600 mt-2" />
              </div>
            </button>
          ))}

          {filtered.length === 0 && (
            <div className="text-center py-12">
              <MessageCircle className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400">Nenhuma conversa encontrada</p>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-3">
        <div className="max-w-4xl mx-auto px-4 flex items-center justify-between">
          <p className="text-xs text-gray-500">Portal de atendimento</p>
          <p className="text-xs text-gray-600">Powered by SuperBot</p>
        </div>
      </footer>
    </div>
  );
}

// ==================== Conversation Detail View ====================

function ConversationView({
  token, conversation: initial, portalType, onBack
}: {
  token: string;
  conversation: Conversation;
  portalType: 'portal' | 'live_view';
  onBack?: () => void;
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [conv, setConv] = useState(initial);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [showFollowup, setShowFollowup] = useState(false);
  const [followupDate, setFollowupDate] = useState('');

  const messages = conv.messages || [];
  const isHandoff = conv.status === 'handoff';
  const takeoverUntil = conv.metadata?.human_takeover_until;
  const canAct = portalType === 'portal';

  // Poll for updates
  useEffect(() => {
    const refresh = async () => {
      try {
        const data = await portalFetch(`/api/live/${token}/conversations/${conv.conversation_id}`);
        setConv(data);
      } catch {}
    };
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [token, conv.conversation_id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async () => {
    if (!replyText.trim() || sending) return;
    setSendError(null);
    setSending(true);
    try {
      await portalFetch(`/api/live/${token}/conversations/${conv.conversation_id}/send`, {
        method: 'POST',
        body: JSON.stringify({ text: replyText.trim() }),
      });
      setReplyText('');
      inputRef.current?.focus();
      const data = await portalFetch(`/api/live/${token}/conversations/${conv.conversation_id}`);
      setConv(data);
    } catch (err: any) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    setStatusLoading(true);
    try {
      await portalFetch(`/api/live/${token}/conversations/${conv.conversation_id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus, reason: 'Alterado via portal' }),
      });
      const data = await portalFetch(`/api/live/${token}/conversations/${conv.conversation_id}`);
      setConv(data);
    } catch (err: any) {
      setSendError(err.message);
    } finally {
      setStatusLoading(false);
    }
  };

  const handleFollowup = async () => {
    try {
      await portalFetch(`/api/live/${token}/conversations/${conv.conversation_id}/followup`, {
        method: 'PATCH',
        body: JSON.stringify({
          next_followup_at: followupDate || null,
          followup_stage: followupDate ? 1 : 0
        }),
      });
      setShowFollowup(false);
      setFollowupDate('');
    } catch (err: any) {
      setSendError(err.message);
    }
  };

  const displayName = conv.contact_name || `Contato #${(conv.conversation_id || '').slice(-6)}`;

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <header className={`border-b sticky top-0 z-10 ${isHandoff ? 'bg-amber-900/30 border-amber-700/50' : 'bg-gray-800 border-gray-700'}`}>
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            {onBack && (
              <button onClick={onBack} className="p-2 hover:bg-gray-700 rounded-lg transition">
                <ArrowLeft className="w-5 h-5 text-gray-300" />
              </button>
            )}

            <div className="flex items-center gap-3 flex-1">
              <ChannelIcon channel={conv.channel_type} />
              <div>
                <h1 className="text-lg font-semibold text-white">{displayName}</h1>
                <p className="text-sm text-gray-400">
                  {conv.channel_type} • {messages.length} mensagens
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-3 py-1 bg-green-500/20 border border-green-500/30 rounded-full">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <span className="text-xs text-green-400 font-medium">Ao Vivo</span>
              </div>

              {canAct && (
                <>
                  <button
                    onClick={() => setShowFollowup(!showFollowup)}
                    className="p-2 hover:bg-gray-700 rounded-lg transition"
                    title="Agendar follow-up"
                  >
                    <Calendar className="w-4 h-4 text-gray-400" />
                  </button>

                  {!isHandoff ? (
                    <button
                      onClick={() => handleStatusChange('handoff')}
                      disabled={statusLoading}
                      className="flex items-center gap-2 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition text-sm font-medium disabled:opacity-50"
                    >
                      <HandMetal className="w-4 h-4" />
                      Assumir
                    </button>
                  ) : (
                    <button
                      onClick={() => handleStatusChange('open')}
                      disabled={statusLoading}
                      className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium disabled:opacity-50"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Devolver ao Bot
                    </button>
                  )}
                </>
              )}

              <StatusBadge status={conv.status} />
            </div>
          </div>

          {/* Handoff banner */}
          {isHandoff && takeoverUntil && (
            <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center gap-3">
              <Clock className="w-5 h-5 text-amber-400 shrink-0" />
              <p className="text-sm text-amber-300">
                <span className="font-medium">Bot pausado</span> ate{' '}
                {new Date(takeoverUntil).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          )}

          {/* Follow-up scheduler */}
          {showFollowup && canAct && (
            <div className="mt-3 p-4 bg-gray-800 border border-gray-600 rounded-lg">
              <p className="text-sm text-gray-300 font-medium mb-2">Agendar retorno (follow-up)</p>
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-blue-400 shrink-0" />
                <input
                  type="datetime-local"
                  value={followupDate}
                  onChange={(e) => setFollowupDate(e.target.value)}
                  className="flex-1 bg-gray-900 border border-gray-500 rounded px-3 py-2 text-sm text-white [color-scheme:dark]"
                />
                <button
                  onClick={handleFollowup}
                  className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700"
                >
                  {followupDate ? 'Agendar' : 'Limpar'}
                </button>
                <button onClick={() => setShowFollowup(false)} className="p-1.5 hover:bg-gray-700 rounded">
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </div>
          )}

          {/* AI Summary */}
          {conv.summary_short && !isHandoff && (
            <div className="mt-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-sm text-blue-300">
                <span className="font-medium">Resumo IA:</span> {conv.summary_short}
              </p>
            </div>
          )}
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6">
        <div className="space-y-3">
          {messages.map((msg) => {
            const isIncoming = msg.direction === 'in';
            const isSystem = msg.direction === 'system';
            const isToolCall = msg.message_type === 'tool_call' || msg.message_type === 'tool_result';
            const isHuman = msg.message_type === 'human_reply';

            if (isSystem) {
              return (
                <div key={msg.id} className="flex justify-center">
                  <div className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-full text-xs text-gray-400">
                    {msg.text || '[sistema]'}
                    <span className="ml-2 text-gray-500">
                      {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} className={`flex ${isIncoming ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-md ${isIncoming ? 'mr-auto' : 'ml-auto'}`}>
                  <div className={`rounded-lg p-3 ${
                    isToolCall ? 'bg-purple-500/10 border border-purple-500/20' :
                    isHuman ? 'bg-amber-500/10 border border-amber-500/20' :
                    isIncoming ? 'bg-gray-800 border border-gray-700' :
                    'bg-blue-600'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`p-1 rounded-full ${
                        isToolCall ? 'bg-purple-500/30' :
                        isHuman ? 'bg-amber-500/30' :
                        isIncoming ? 'bg-gray-700' : 'bg-blue-500'
                      }`}>
                        {isToolCall ? <Wrench className="w-3.5 h-3.5 text-purple-300" /> :
                         isHuman ? <HandMetal className="w-3.5 h-3.5 text-amber-300" /> :
                         isIncoming ? <User className="w-3.5 h-3.5 text-gray-300" /> :
                         <Bot className="w-3.5 h-3.5 text-blue-200" />}
                      </div>
                      <span className={`text-xs font-medium ${
                        isIncoming || isToolCall || isHuman ? 'text-gray-400' : 'text-blue-200'
                      }`}>
                        {isToolCall ? 'Tool' : isHuman ? 'Atendente' : isIncoming ? displayName : 'Assistente'}
                      </span>
                      <span className={`text-xs ml-auto ${
                        isIncoming || isToolCall || isHuman ? 'text-gray-500' : 'text-blue-200'
                      }`}>
                        {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {msg.text ? (
                      <p className={`text-sm whitespace-pre-wrap ${
                        isIncoming || isToolCall || isHuman ? 'text-gray-200' : 'text-white'
                      }`}>{msg.text}</p>
                    ) : (
                      <p className="text-sm italic text-gray-500">[Mensagem sem texto]</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {messages.length === 0 && (
          <div className="text-center py-12">
            <MessageCircle className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">Nenhuma mensagem ainda</p>
          </div>
        )}
      </main>

      {/* Reply box (portal only) */}
      {canAct && (
        <div className={`sticky bottom-0 border-t ${isHandoff ? 'bg-amber-900/20 border-amber-700/30' : 'bg-gray-800 border-gray-700'}`}>
          <div className="max-w-3xl mx-auto px-4 py-3">
            {sendError && (
              <div className="mb-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {sendError}
                <button onClick={() => setSendError(null)} className="ml-auto"><X className="w-4 h-4" /></button>
              </div>
            )}
            <div className="flex items-center gap-3">
              <input
                ref={inputRef}
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                placeholder={isHandoff ? 'Responder como atendente...' : 'Enviar mensagem (pausa bot por 3h)...'}
                className="flex-1 px-4 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={sending}
              />
              <button
                onClick={handleSend}
                disabled={!replyText.trim() || sending}
                className="p-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer (read-only mode) */}
      {!canAct && (
        <footer className="border-t border-gray-800 py-3">
          <div className="max-w-3xl mx-auto px-4 flex items-center justify-between">
            <p className="text-xs text-gray-500">Visualizacao em tempo real • Somente leitura</p>
            <p className="text-xs text-gray-600">Powered by SuperBot</p>
          </div>
        </footer>
      )}
    </div>
  );
}

// ==================== Shared Components ====================

function ChannelIcon({ channel }: { channel: string }) {
  switch (channel) {
    case 'whatsapp': return <Phone className="w-5 h-5 text-green-500" />;
    case 'instagram': return <Instagram className="w-5 h-5 text-pink-500" />;
    case 'messenger': return <MessageCircle className="w-5 h-5 text-blue-500" />;
    default: return <MessageCircle className="w-5 h-5 text-gray-500" />;
  }
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    open: 'bg-green-500/20 text-green-400',
    handoff: 'bg-amber-500/20 text-amber-400',
    closed: 'bg-gray-700 text-gray-400',
  };
  const labels: Record<string, string> = {
    open: 'Aberto',
    handoff: 'Humano',
    closed: 'Fechado',
  };
  return (
    <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${styles[status] || styles.closed}`}>
      {labels[status] || status}
    </span>
  );
}
