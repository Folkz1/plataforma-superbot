'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useConversation } from '@/hooks/useConversation';
import {
  ArrowLeft, MessageCircle, User, Bot, Wrench,
  RefreshCw, Send, HandMetal, RotateCcw, Share2, Copy, Check, X,
  AlertTriangle, Clock, Phone, PhoneForwarded, PauseCircle, PlayCircle, UserCircle
} from 'lucide-react';
import { api } from '@/lib/api';
import { getPlatformLogo } from '@/components/PlatformLogos';

interface Message {
  id: string;
  direction: string;
  message_type: string;
  text: string | null;
  media: unknown;
  raw_payload: unknown;
  created_at: string;
}

type MediaItem = {
  type?: string;
  url?: string;
  download_url?: string;
  share_url?: string;
  path?: string;
  original_url?: string;
  mime_type?: string;
  transcription?: string;
  analysis?: string;
};

function normalizeMedia(media: unknown): MediaItem[] {
  if (!media) return [];
  const items = Array.isArray(media)
    ? (media.filter((m) => m && typeof m === 'object') as MediaItem[])
    : (typeof media === 'object' ? [media as MediaItem] : []);

  return items.filter((item) => {
    const type = String(item.type || '').toLowerCase();
    const hasUrl = Boolean(item.url || item.download_url || item.share_url || item.original_url);
    const hasUsefulText = Boolean(item.transcription || item.analysis);
    if (hasUrl) return true;
    if (type === 'audio' && hasUsefulText) return true;
    if (type === 'image' && hasUsefulText) return true;
    return false;
  });
}

function getMediaUrl(item: MediaItem): string | null {
  return (item.url || item.download_url || item.share_url || item.original_url || null) as string | null;
}

function hasMediaUrl(item: MediaItem): boolean {
  return Boolean(item.url || item.download_url || item.share_url || item.original_url);
}

function getMessageText(msg: Message): string | null {
  if (msg.text) return msg.text;
  const raw = msg.raw_payload;
  if (!raw) return null;
  try {
    const root = raw as Record<string, any>;
    const messaging = root.entry?.[0]?.messaging?.[0];
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
  const searchParams = useSearchParams();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [replyText, setReplyText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [shareModal, setShareModal] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [transferModal, setTransferModal] = useState(false);
  const [transferReason, setTransferReason] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);
  const [profileModal, setProfileModal] = useState(false);
  const [profileData, setProfileData] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const selectedChannelType = searchParams.get('channel_type') || undefined;

  const {
    conversation, messages, loading, error, isPolling, sending,
    refresh, sendMessage, updateStatus, botPause
  } = useConversation(
    params.project_id as string,
    params.conversation_id as string,
    selectedChannelType,
    { pollInterval: 5000 }
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const isHandoff = conversation?.status === 'handoff';
  const takeoverUntil = conversation?.metadata?.human_takeover_until;
  const takeoverAgent = conversation?.metadata?.human_agent_name;
  const isBotPaused = conversation?.metadata?.bot_paused === true;
  const pausedBy = conversation?.metadata?.bot_paused_by;
  const pausedUntil = conversation?.metadata?.bot_paused_until;
  const [pauseMenuOpen, setPauseMenuOpen] = useState(false);

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

  const handleBotPause = async (hours: number | null) => {
    setStatusLoading(true);
    setPauseMenuOpen(false);
    try {
      await botPause(hours);
    } catch (err: any) {
      setSendError(err.message);
    } finally {
      setStatusLoading(false);
    }
  };

  const handleOpenProfile = async () => {
    setProfileLoading(true);
    setProfileModal(true);
    try {
      const channelParam = selectedChannelType ? `?channel_type=${encodeURIComponent(selectedChannelType)}` : '';
      const resp = await api.get(
        `/api/contacts/${params.project_id}/${params.conversation_id}/profile${channelParam}`
      );
      setProfileData(resp.data);
    } catch (err: any) {
      setSendError('Erro ao carregar perfil');
    } finally {
      setProfileLoading(false);
    }
  };

  const handleTransfer = async () => {
    setTransferLoading(true);
    setSendError(null);
    try {
      const channelParam = selectedChannelType ? `?channel_type=${encodeURIComponent(selectedChannelType)}` : '';
      await api.post(
        `/api/conversations/${params.project_id}/${params.conversation_id}/transfer${channelParam}`,
        { reason: transferReason.trim() || undefined, timeout_hours: 8 }
      );
      setTransferModal(false);
      setTransferReason('');
      refresh();
    } catch (err: any) {
      setSendError(err.response?.data?.detail || 'Erro ao transferir conversa');
    } finally {
      setTransferLoading(false);
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
                <h1 className="text-lg font-semibold text-gray-900 cursor-pointer hover:text-blue-600 transition"
                    onClick={handleOpenProfile}
                    title="Ver perfil do contato">
                  {displayName}
                </h1>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span>{conversation.channel_type} • {messages.length} mensagens</span>
                  {conversation.channel_type === 'whatsapp' && conversation.conversation_id && (
                    <a
                      href={`https://wa.me/${conversation.conversation_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-700 rounded-full text-xs font-medium hover:bg-green-100 transition"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Phone className="w-3 h-3" />
                      +{conversation.conversation_id.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, '$1 $2 $3-$4')}
                    </a>
                  )}
                </div>
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

              {/* Bot Pause Dropdown */}
              <div className="relative">
                {isBotPaused ? (
                  <button
                    onClick={() => handleBotPause(null)}
                    disabled={statusLoading}
                    className="flex items-center gap-2 px-3 py-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition text-sm font-medium disabled:opacity-50"
                  >
                    <PlayCircle className="w-4 h-4" />
                    Reativar Bot
                  </button>
                ) : (
                  <button
                    onClick={() => setPauseMenuOpen(!pauseMenuOpen)}
                    disabled={statusLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition text-sm font-medium disabled:opacity-50"
                  >
                    <PauseCircle className="w-4 h-4" />
                    Pausar Bot
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                )}

                {/* Dropdown Menu */}
                {pauseMenuOpen && !isBotPaused && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setPauseMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-xl shadow-xl border z-30 py-2">
                      <p className="px-3 py-1 text-xs text-gray-400 font-medium">PAUSAR BOT POR:</p>
                      <button
                        onClick={() => handleBotPause(3)}
                        className="w-full text-left px-3 py-2.5 hover:bg-amber-50 transition flex items-center gap-3"
                      >
                        <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
                          <Clock className="w-4 h-4 text-amber-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">3 horas</p>
                          <p className="text-xs text-gray-500">Pausa rápida</p>
                        </div>
                      </button>
                      <button
                        onClick={() => handleBotPause(24)}
                        className="w-full text-left px-3 py-2.5 hover:bg-orange-50 transition flex items-center gap-3"
                      >
                        <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center">
                          <Clock className="w-4 h-4 text-orange-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">1 dia</p>
                          <p className="text-xs text-gray-500">Atendimento humano hoje</p>
                        </div>
                      </button>
                      <button
                        onClick={() => handleBotPause(72)}
                        className="w-full text-left px-3 py-2.5 hover:bg-red-50 transition flex items-center gap-3"
                      >
                        <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
                          <Clock className="w-4 h-4 text-red-500" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">3 dias</p>
                          <p className="text-xs text-gray-500">Lead com atendente</p>
                        </div>
                      </button>
                      <div className="border-t my-1" />
                      <button
                        onClick={() => handleBotPause(360)}
                        className="w-full text-left px-3 py-2.5 hover:bg-red-50 transition flex items-center gap-3"
                      >
                        <div className="w-8 h-8 rounded-full bg-red-200 flex items-center justify-center">
                          <PauseCircle className="w-4 h-4 text-red-700" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-red-700">15 dias</p>
                          <p className="text-xs text-gray-500">Lead exclusivo do atendente</p>
                        </div>
                      </button>
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={() => setTransferModal(true)}
                disabled={statusLoading || isHandoff}
                className="flex items-center gap-2 px-3 py-1.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition text-sm font-medium disabled:opacity-50"
                title="Transferir para humano com notificacao WhatsApp"
              >
                <PhoneForwarded className="w-4 h-4" />
                Transferir
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

          {/* Bot Paused Banner */}
          {isBotPaused && (
            <div className="mt-3 p-3 bg-red-100 border border-red-300 rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-3">
                <PauseCircle className="w-5 h-5 text-red-700 shrink-0" />
                <p className="text-sm text-red-900">
                  <span className="font-medium">Bot pausado</span>
                  {pausedBy && <> por {pausedBy}</>}
                  {pausedUntil && (
                    <> até {new Date(pausedUntil).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</>
                  )}
                  {' — '}Apenas atendimento humano.
                </p>
              </div>
              <button
                onClick={() => handleBotPause(null)}
                disabled={statusLoading}
                className="px-3 py-1 bg-green-500 text-white rounded-lg text-xs font-medium hover:bg-green-600 transition disabled:opacity-50 shrink-0"
              >
                Reativar
              </button>
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

                    {(() => {
                      const mediaItems = normalizeMedia(message.media);
                      if (mediaItems.length === 0) return null;

                      return (
                        <div className="mt-3 space-y-2">
                          {mediaItems.map((item, idx) => {
                            const url = getMediaUrl(item);
                            const type = (item.type || message.message_type || 'media').toLowerCase();

                            if (type === 'audio') {
                              return (
                                <div key={idx} className="space-y-2">
                                  {hasMediaUrl(item) && url && (
                                    <audio controls preload="none" className="w-full" src={url}>
                                      Seu navegador nao suporta audio.
                                    </audio>
                                  )}
                                  <div className="flex flex-wrap gap-2 text-xs">
                                    {hasMediaUrl(item) && url && (
                                      <a
                                        href={url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={`underline ${isIncoming || isToolCall || isHuman ? 'text-gray-600 hover:text-gray-800' : 'text-blue-100 hover:text-white'}`}
                                      >
                                        Abrir audio
                                      </a>
                                    )}
                                    {item.share_url && (
                                      <a
                                        href={item.share_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={`underline ${isIncoming || isToolCall || isHuman ? 'text-gray-600 hover:text-gray-800' : 'text-blue-100 hover:text-white'}`}
                                      >
                                        Nextcloud
                                      </a>
                                    )}
                                  </div>
                                  {item.transcription && (
                                    <p className={`text-xs whitespace-pre-wrap ${isIncoming || isToolCall || isHuman ? 'text-gray-600' : 'text-blue-100'}`}>
                                      <span className="font-medium">Transcricao:</span> {item.transcription}
                                    </p>
                                  )}
                                </div>
                              );
                            }

                            if (type === 'image') {
                              if (!url) return null;
                              return (
                                <div key={idx} className="space-y-2">
                                  <a href={url} target="_blank" rel="noopener noreferrer">
                                    <img src={url} alt="Imagem anexada" className="max-h-64 rounded-lg border border-gray-200" />
                                  </a>
                                  <div className="flex flex-wrap gap-2 text-xs">
                                    <a
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className={`underline ${isIncoming || isToolCall || isHuman ? 'text-gray-600 hover:text-gray-800' : 'text-blue-100 hover:text-white'}`}
                                    >
                                      Abrir imagem
                                    </a>
                                    {item.share_url && (
                                      <a
                                        href={item.share_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={`underline ${isIncoming || isToolCall || isHuman ? 'text-gray-600 hover:text-gray-800' : 'text-blue-100 hover:text-white'}`}
                                      >
                                        Nextcloud
                                      </a>
                                    )}
                                  </div>
                                  {item.analysis && (
                                    <p className={`text-xs whitespace-pre-wrap ${isIncoming || isToolCall || isHuman ? 'text-gray-600' : 'text-blue-100'}`}>
                                      <span className="font-medium">Descricao:</span> {item.analysis}
                                    </p>
                                  )}
                                </div>
                              );
                            }

                            if (type === 'video') {
                              if (!url) return null;
                              return (
                                <div key={idx} className="space-y-2">
                                  <video controls preload="metadata" className="w-full rounded-lg border border-gray-200" src={url} />
                                  <div className="flex flex-wrap gap-2 text-xs">
                                    <a
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className={`underline ${isIncoming || isToolCall || isHuman ? 'text-gray-600 hover:text-gray-800' : 'text-blue-100 hover:text-white'}`}
                                    >
                                      Abrir video
                                    </a>
                                    {item.share_url && (
                                      <a
                                        href={item.share_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={`underline ${isIncoming || isToolCall || isHuman ? 'text-gray-600 hover:text-gray-800' : 'text-blue-100 hover:text-white'}`}
                                      >
                                        Nextcloud
                                      </a>
                                    )}
                                  </div>
                                </div>
                              );
                            }

                            if (!url) return null;

                            return (
                              <div key={idx} className="space-y-1">
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`text-xs underline ${isIncoming || isToolCall || isHuman ? 'text-gray-600 hover:text-gray-800' : 'text-blue-100 hover:text-white'}`}
                                >
                                  Baixar arquivo
                                </a>
                                {item.mime_type && (
                                  <p className={`text-[11px] ${isIncoming || isToolCall || isHuman ? 'text-gray-500' : 'text-blue-100'}`}>
                                    {item.mime_type}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
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

      {/* Transfer Modal */}
      {transferModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setTransferModal(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Transferir para Humano</h3>
              <button onClick={() => setTransferModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              A conversa sera marcada como &quot;handoff&quot; por 8 horas e uma notificacao sera enviada via WhatsApp para o responsavel do projeto.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Motivo (opcional)</label>
              <input
                type="text"
                value={transferReason}
                onChange={(e) => setTransferReason(e.target.value)}
                placeholder="Ex: Cliente quer falar com gerente"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setTransferModal(false)}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleTransfer}
                disabled={transferLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 transition disabled:opacity-50"
              >
                {transferLoading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <PhoneForwarded className="w-4 h-4" />}
                Transferir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contact Profile Modal */}
      {profileModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setProfileModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">Perfil do Contato</h2>
                <button onClick={() => setProfileModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {profileLoading ? (
                <div className="py-8 text-center text-gray-500">Carregando perfil...</div>
              ) : profileData ? (
                <div className="space-y-4">
                  {/* Contact Info */}
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center">
                      <UserCircle className="w-8 h-8 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-lg font-semibold">{profileData.contact_name}</p>
                      {profileData.phone && (
                        <a href={`https://wa.me/${profileData.phone}`} target="_blank" rel="noopener noreferrer"
                           className="text-sm text-green-600 hover:underline">
                          +{profileData.phone}
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-gray-900">{profileData.stats?.total_messages || 0}</p>
                      <p className="text-xs text-gray-500">Mensagens</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-blue-600">{profileData.stats?.messages_in || 0}</p>
                      <p className="text-xs text-gray-500">Recebidas</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-green-600">{profileData.stats?.messages_out || 0}</p>
                      <p className="text-xs text-gray-500">Enviadas</p>
                    </div>
                  </div>

                  {/* Details */}
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between py-1 border-b">
                      <span className="text-gray-500">Canal</span>
                      <span className="font-medium">{profileData.channel_type}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b">
                      <span className="text-gray-500">Status</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        profileData.status === 'open' ? 'bg-green-100 text-green-800' :
                        profileData.status === 'handoff' ? 'bg-amber-100 text-amber-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>{profileData.status}</span>
                    </div>
                    {profileData.stats?.first_message_at && (
                      <div className="flex justify-between py-1 border-b">
                        <span className="text-gray-500">Primeiro contato</span>
                        <span className="font-medium">{new Date(profileData.stats.first_message_at).toLocaleDateString('pt-BR')}</span>
                      </div>
                    )}
                    {profileData.stats?.last_message_at && (
                      <div className="flex justify-between py-1 border-b">
                        <span className="text-gray-500">Último contato</span>
                        <span className="font-medium">{new Date(profileData.stats.last_message_at).toLocaleDateString('pt-BR')}</span>
                      </div>
                    )}
                    {profileData.ai_state && (
                      <div className="flex justify-between py-1 border-b">
                        <span className="text-gray-500">Estado IA</span>
                        <span className="font-medium">{profileData.ai_state}</span>
                      </div>
                    )}
                  </div>

                  {/* Assignment Info */}
                  {profileData.assignment && (
                    <div className="bg-blue-50 rounded-lg p-3">
                      <p className="text-xs text-blue-500 font-medium mb-1">ATRIBUIÇÃO ATUAL</p>
                      <p className="text-sm font-medium">{profileData.assignment.assignee_name || 'Sem nome'}</p>
                      {profileData.assignment.stage_name && (
                        <div className="flex items-center gap-2 mt-1">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: profileData.assignment.stage_color || '#6366f1' }}></div>
                          <span className="text-xs text-gray-600">{profileData.assignment.stage_name}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Summary */}
                  {profileData.summary && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500 font-medium mb-1">RESUMO IA</p>
                      <p className="text-sm text-gray-700">{profileData.summary}</p>
                    </div>
                  )}

                  {/* User Data from bot */}
                  {profileData.user_data && Object.keys(profileData.user_data).length > 0 && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500 font-medium mb-1">DADOS COLETADOS</p>
                      <div className="space-y-1">
                        {Object.entries(profileData.user_data).map(([key, value]) => (
                          <div key={key} className="flex justify-between text-sm">
                            <span className="text-gray-500">{key}</span>
                            <span className="font-medium">{String(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Quick Actions */}
                  <div className="flex gap-2 pt-2">
                    {profileData.phone && (
                      <a href={`https://wa.me/${profileData.phone}`} target="_blank" rel="noopener noreferrer"
                         className="flex-1 text-center py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 transition">
                        WhatsApp
                      </a>
                    )}
                    <button
                      onClick={() => { setProfileModal(false); }}
                      className="flex-1 text-center py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition"
                    >
                      Fechar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-red-500">Erro ao carregar perfil</div>
              )}
            </div>
          </div>
        </div>
      )}

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
