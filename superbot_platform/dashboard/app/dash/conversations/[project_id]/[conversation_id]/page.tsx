'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useConversation } from '@/hooks/useConversation';
import {
  ArrowLeft, MessageCircle, User, Bot, Wrench,
  RefreshCw, Send, HandMetal, RotateCcw, Share2, Copy, Check, X,
  AlertTriangle, Clock
} from 'lucide-react';
import { api } from '@/lib/api';
import { getPlatformLogo } from '@/components/PlatformLogos';

interface Message {
  id: string;
  direction: string;
  message_type: string;
  text: string | null;
  media: any;
  raw_payload: any;
  created_at: string;
}

function getMessageText(msg: Message): string | null {
  if (msg.text) return msg.text;
  const raw = msg.raw_payload;
  if (!raw) return null;
  try {
    const messaging = raw.entry?.[0]?.messaging?.[0];
    const m = messaging?.message;
    if (m?.text) return m.text;
    if (m?.reply_to?.story) return '[Resposta a story]';
    if (m?.attachments?.length) {
      const t = m.attachments[0].type || 'attachment';
      return `[${t}]`;
    }
    if (messaging?.postback) return messaging.postback.title || '[postback]';
  } catch {}
  return null;
}

export default function ConversationViewerPage() {
  const router = useRouter();
  const params = useParams();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [replyText, setReplyText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [shareModal, setShareModal] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [copied, setCopied] = useState(false);

  const {
    conversation, messages, loading, error, isPolling, sending,
    refresh, sendMessage, updateStatus
  } = useConversation(
    params.project_id as string,
    params.conversation_id as string,
    { pollInterval: 5000 }
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const isHandoff = conversation?.status === 'handoff';
  const takeoverUntil = conversation?.metadata?.human_takeover_until;
  const takeoverAgent = conversation?.metadata?.human_agent_name;

  const handleSend = async () => {
    if (!replyText.trim() || sending) return;
    setSendError(null);
    try {
      await sendMessage(replyText.trim());
      setReplyText('');
      inputRef.current?.focus();
    } catch (err: any) {
      setSendError(err.message);
    }
  };

  const handleTakeover = async () => {
    setStatusLoading(true);
    try {
      await updateStatus('handoff', 'Takeover manual pelo dashboard');
    } catch (err: any) {
      setSendError(err.message);
    } finally {
      setStatusLoading(false);
    }
  };

  const handleReturnToBot = async () => {
    setStatusLoading(true);
    try {
      await updateStatus('open', 'Devolvido ao bot pelo dashboard');
    } catch (err: any) {
      setSendError(err.message);
    } finally {
      setStatusLoading(false);
    }
  };

  const handleShare = async () => {
    try {
      const resp = await api.post('/api/live/create-link', {
        project_id: params.project_id,
        conversation_id: params.conversation_id
      });
      const url = `${window.location.origin}/live/${resp.data.token}`;
      setShareLink(url);
      setShareModal(true);
    } catch {
      setSendError('Erro ao gerar link público');
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getChannelIcon = (channel: string) => {
    const logo = getPlatformLogo(channel, 20);
    return logo || <MessageCircle className="w-5 h-5 text-gray-600" />;
  };

  const getMessageIcon = (direction: string, message_type: string) => {
    if (message_type === 'tool_call' || message_type === 'tool_result') {
      return <Wrench className="w-4 h-4" />;
    }
    if (message_type === 'human_reply') {
      return <HandMetal className="w-4 h-4" />;
    }
    if (message_type === 'status_change') {
      return <AlertTriangle className="w-4 h-4" />;
    }
    return direction === 'in' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />;
  };

  const getMessageLabel = (msg: Message) => {
    if (msg.message_type === 'tool_call' || msg.message_type === 'tool_result') return 'Tool Call';
    if (msg.message_type === 'status_change') return 'Sistema';
    if (msg.message_type === 'human_reply') return takeoverAgent || 'Atendente';
    if (msg.direction === 'in') return displayName;
    return 'Assistente';
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Carregando conversa...</div>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Conversa não encontrada</div>
      </div>
    );
  }

  const displayName = conversation.contact_name || `Contato #${(conversation.conversation_id || '').slice(-6)}`;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className={`shadow-sm border-b sticky top-0 z-10 ${isHandoff ? 'bg-amber-50 border-amber-200' : 'bg-white'}`}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 flex-1">
              {getChannelIcon(conversation.channel_type)}
              <div>
                <h1 className="text-lg font-semibold text-gray-900">
                  {displayName}
                </h1>
                <p className="text-sm text-gray-600">
                  {conversation.channel_type} • {messages.length} mensagens
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isPolling && (
                <div className="flex items-center gap-2 px-3 py-1 bg-green-50 border border-green-200 rounded-full">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-xs text-green-700 font-medium">Ao vivo</span>
                </div>
              )}

              <button onClick={handleShare} className="p-2 hover:bg-gray-100 rounded-lg transition" title="Compartilhar link público">
                <Share2 className="w-4 h-4 text-gray-600" />
              </button>

              <button onClick={refresh} className="p-2 hover:bg-gray-100 rounded-lg transition" title="Atualizar">
                <RefreshCw className="w-4 h-4 text-gray-600" />
              </button>

              {!isHandoff ? (
                <button
                  onClick={handleTakeover}
                  disabled={statusLoading}
                  className="flex items-center gap-2 px-3 py-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition text-sm font-medium disabled:opacity-50"
                >
                  <HandMetal className="w-4 h-4" />
                  Assumir
                </button>
              ) : (
                <button
                  onClick={handleReturnToBot}
                  disabled={statusLoading}
                  className="flex items-center gap-2 px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition text-sm font-medium disabled:opacity-50"
                >
                  <RotateCcw className="w-4 h-4" />
                  Devolver ao Bot
                </button>
              )}

              <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                conversation.status === 'open' ? 'bg-green-100 text-green-800' :
                conversation.status === 'waiting_customer' ? 'bg-yellow-100 text-yellow-800' :
                conversation.status === 'handoff' ? 'bg-amber-100 text-amber-800' :
                conversation.status === 'do_not_contact' ? 'bg-red-100 text-red-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {{
                  open: 'Aberto',
                  waiting_customer: 'Aguardando Cliente',
                  handoff: 'Atendimento Humano',
                  closed: 'Fechado',
                  resolved: 'Resolvido',
                  do_not_contact: 'Não Contactar',
                }[conversation.status] || conversation.status}
              </span>
            </div>
          </div>

          {/* Handoff Banner */}
          {isHandoff && takeoverUntil && (
            <div className="mt-3 p-3 bg-amber-100 border border-amber-300 rounded-lg flex items-center gap-3">
              <Clock className="w-5 h-5 text-amber-700 shrink-0" />
              <p className="text-sm text-amber-900">
                <span className="font-medium">Bot pausado</span> — Atendimento humano por {takeoverAgent || 'atendente'} até{' '}
                {new Date(takeoverUntil).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          )}

          {/* AI Summary */}
          {conversation.summary_short && !isHandoff && (
            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-900">
                <span className="font-medium">Resumo IA:</span> {conversation.summary_short}
              </p>
            </div>
          )}
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="space-y-4">
          {messages.map((message) => {
            const isIncoming = message.direction === 'in';
            const isSystem = message.direction === 'system';
            const isToolCall = message.message_type === 'tool_call' || message.message_type === 'tool_result';
            const isHuman = message.message_type === 'human_reply';
            const text = getMessageText(message);

            if (isSystem) {
              return (
                <div key={message.id} className="flex justify-center">
                  <div className="px-4 py-2 bg-gray-100 border border-gray-200 rounded-full text-xs text-gray-600">
                    {text || '[evento do sistema]'}
                    <span className="ml-2 text-gray-400">
                      {new Date(message.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={message.id}
                className={`flex ${isIncoming ? 'justify-start' : 'justify-end'}`}
              >
                <div className={`max-w-2xl ${isIncoming ? 'mr-auto' : 'ml-auto'}`}>
                  <div className={`rounded-lg p-4 ${
                    isToolCall ? 'bg-purple-50 border border-purple-200' :
                    isHuman ? 'bg-amber-50 border border-amber-200' :
                    isIncoming ? 'bg-white border border-gray-200' :
                    'bg-blue-600 text-white'
                  }`}>
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`p-1.5 rounded-full ${
                        isToolCall ? 'bg-purple-200' :
                        isHuman ? 'bg-amber-200' :
                        isIncoming ? 'bg-gray-200' : 'bg-blue-500'
                      }`}>
                        {getMessageIcon(message.direction, message.message_type)}
                      </div>
                      <span className={`text-xs font-medium ${
                        isIncoming || isToolCall || isHuman ? 'text-gray-600' : 'text-blue-100'
                      }`}>
                        {getMessageLabel(message)}
                      </span>
                      <span className={`text-xs ml-auto ${
                        isIncoming || isToolCall || isHuman ? 'text-gray-500' : 'text-blue-100'
                      }`}>
                        {new Date(message.created_at).toLocaleTimeString('pt-BR')}
                      </span>
                    </div>

                    {text ? (
                      <p className={`text-sm whitespace-pre-wrap ${
                        isIncoming || isToolCall || isHuman ? 'text-gray-900' : 'text-white'
                      }`}>
                        {text}
                      </p>
                    ) : (
                      <p className={`text-sm italic ${
                        isIncoming || isToolCall || isHuman ? 'text-gray-400' : 'text-blue-200'
                      }`}>
                        [Mensagem sem texto]
                      </p>
                    )}

                    {isToolCall && message.raw_payload && (
                      <details className="mt-2">
                        <summary className="text-xs text-purple-700 cursor-pointer hover:text-purple-900">
                          Ver payload completo
                        </summary>
                        <pre className="mt-2 p-2 bg-purple-100 rounded text-xs overflow-x-auto">
                          {JSON.stringify(message.raw_payload, null, 2)}
                        </pre>
                      </details>
                    )}

                    {message.media && (
                      <div className="mt-2 text-xs text-gray-500">
                        Midia anexada
                      </div>
                    )}
                  </div>

                  <div className={`text-xs text-gray-500 mt-1 ${
                    isIncoming ? 'text-left' : 'text-right'
                  }`}>
                    {new Date(message.created_at).toLocaleDateString('pt-BR')}
                  </div>
                </div>
              </div>
            );
          })}

          <div ref={messagesEndRef} />
        </div>

        {messages.length === 0 && !loading && (
          <div className="text-center py-12">
            <MessageCircle className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600">Nenhuma mensagem nesta conversa</p>
          </div>
        )}
      </main>

      {/* Reply Box */}
      <div className={`sticky bottom-0 border-t ${isHandoff ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          {sendError && (
            <div className="mb-2 p-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
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
              placeholder={isHandoff ? 'Responder como atendente...' : 'Enviar mensagem (vai pausar o bot por 3h)...'}
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              disabled={sending}
            />
            <button
              onClick={handleSend}
              disabled={!replyText.trim() || sending}
              className="p-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Share Modal */}
      {shareModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShareModal(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-lg w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Link Público da Conversa</h3>
              <button onClick={() => setShareModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Qualquer pessoa com este link pode acompanhar a conversa em tempo real (somente leitura). O link expira em 72 horas.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={shareLink}
                readOnly
                className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono"
              />
              <button
                onClick={copyLink}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
