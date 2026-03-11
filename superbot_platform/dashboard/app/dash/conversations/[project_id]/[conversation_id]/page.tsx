'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Bot,
  Check,
  Clock,
  Copy,
  HandMetal,
  Layers3,
  MessageCircle,
  MoreHorizontal,
  PauseCircle,
  Phone,
  PhoneForwarded,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Send,
  Share2,
  TrendingUp,
  User,
  UserCircle,
  Users,
  Wrench,
  X,
} from 'lucide-react';

import { getPlatformLogo } from '@/components/PlatformLogos';
import { useConversation } from '@/hooks/useConversation';
import { api } from '@/lib/api';

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

type ViewerInfo = {
  role?: string;
  client_name?: string;
};

type OverviewMetrics = {
  total_conversations: number;
  period_conversations: number;
  active_conversations: number;
  resolution_rate: number;
  total_messages: number;
  period_messages: number;
  avg_response_time: string;
  period_days: number;
};

type StatusDistributionItem = {
  name: string;
  count: number;
};

type ChannelDistributionItem = {
  name: string;
  count: number;
  percentage: number;
};

type HourlyDistributionItem = {
  hour: number;
  count: number;
};

type ContactActivityItem = {
  project_id: string;
  conversation_id: string;
  contact_name: string;
  channel_type: string;
  status: string;
  last_event_at: string;
  last_text?: string | null;
};

type PipelineMetrics = {
  by_member: Array<{ id: string; name: string; active_count: number; completed_count: number; total_count: number }>;
  by_stage: Array<{ id: string; name: string; color?: string; position: number; active_count: number }>;
  pool_count: number;
  project_id: string;
};

type ProjectActivitySummary = {
  overview: OverviewMetrics;
  statuses: StatusDistributionItem[];
  channels: ChannelDistributionItem[];
  hourly: HourlyDistributionItem[];
  recentContacts: ContactActivityItem[];
  metrics: PipelineMetrics | null;
  loadedAt: string;
};

const STATUS_META: Record<string, { label: string; badge: string }> = {
  open: { label: 'Aberto', badge: 'bg-sky-100 text-sky-700' },
  waiting_customer: { label: 'Aguardando cliente', badge: 'bg-amber-100 text-amber-700' },
  handoff: { label: 'Com atendente', badge: 'bg-orange-100 text-orange-700' },
  closed: { label: 'Fechado', badge: 'bg-emerald-100 text-emerald-700' },
  resolved: { label: 'Resolvido', badge: 'bg-teal-100 text-teal-700' },
  do_not_contact: { label: 'Nao contactar', badge: 'bg-rose-100 text-rose-700' },
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
  phone: 'Telefone',
  email: 'Email',
  web: 'Web',
};

function getStatusLabel(status: string): string {
  return STATUS_META[status]?.label || status.replace(/_/g, ' ');
}

function getStatusBadge(status: string): string {
  return STATUS_META[status]?.badge || 'bg-slate-100 text-slate-700';
}

function getChannelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] || channel;
}

function getStartOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function formatHourLabel(hour: number): string {
  return `${hour.toString().padStart(2, '0')}:00`;
}

function formatRelativeTime(value?: string | null): string {
  if (!value) return 'Sem registro';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sem registro';

  const diffMinutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (diffMinutes < 1) return 'agora';
  if (diffMinutes < 60) return `ha ${diffMinutes} min`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `ha ${diffHours} h`;

  const diffDays = Math.round(diffHours / 24);
  return `ha ${diffDays} d`;
}

function normalizeMedia(media: unknown): MediaItem[] {
  if (!media) return [];
  const items = Array.isArray(media)
    ? (media.filter((item) => item && typeof item === 'object') as MediaItem[])
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

function getMessageText(message: Message): string | null {
  if (message.text) return message.text;

  const raw = message.raw_payload;
  if (!raw) return null;

  try {
    const root = raw as Record<string, any>;
    const messaging = root.entry?.[0]?.messaging?.[0];
    const innerMessage = messaging?.message;
    if (innerMessage?.text) return innerMessage.text;
    if (innerMessage?.reply_to?.story) return '[Resposta a story]';
    if (innerMessage?.attachments?.length) {
      const attachmentType = innerMessage.attachments[0].type || 'attachment';
      return `[${attachmentType}]`;
    }
    if (messaging?.postback) return messaging.postback.title || '[postback]';
  } catch {
    return null;
  }

  return null;
}

export default function ConversationViewerPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.project_id as string;
  const conversationId = params.conversation_id as string;
  const selectedChannelType = searchParams.get('channel_type') || undefined;
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
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [pauseMenuOpen, setPauseMenuOpen] = useState(false);
  const [viewerRole, setViewerRole] = useState<string | null>(null);
  const [activeTenantName, setActiveTenantName] = useState('');
  const [activitySummary, setActivitySummary] = useState<ProjectActivitySummary | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  const {
    conversation,
    messages,
    loading,
    isPolling,
    sending,
    refresh,
    sendMessage,
    updateStatus,
    botPause,
  } = useConversation(projectId, conversationId, selectedChannelType, { pollInterval: 5000 });

  const visibleMessages = useMemo(
    () => messages.filter((message) => !['tool_call', 'tool_result'].includes(message.message_type)),
    [messages],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleMessages.length]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const rawUser = localStorage.getItem('user');
      if (!rawUser) return;
      const user = JSON.parse(rawUser) as ViewerInfo;
      setViewerRole(user.role || null);
      setActiveTenantName(
        user.role === 'admin'
          ? (localStorage.getItem('active_tenant_name') || '')
          : (user.client_name || ''),
      );
    } catch {
      setViewerRole(null);
      setActiveTenantName('');
    }
  }, []);

  const isAdmin = viewerRole === 'admin';
  const isHandoff = conversation?.status === 'handoff';
  const takeoverUntil = conversation?.metadata?.human_takeover_until;
  const takeoverAgent = conversation?.metadata?.human_agent_name;
  const isBotPaused = conversation?.metadata?.bot_paused === true;
  const pausedBy = conversation?.metadata?.bot_paused_by;
  const pausedUntil = conversation?.metadata?.bot_paused_until;

  const loadProjectActivity = useCallback(async (silent = false) => {
    if (!projectId || !isAdmin) return;

    if (!silent) setActivityLoading(true);

    try {
      const todayIso = getStartOfToday().toISOString();
      const [overviewResp, statusResp, channelsResp, hourlyResp, contactsResp, metricsResp] = await Promise.all([
        api.get(`/api/analytics/overview/${projectId}`, { params: { days: 1 } }),
        api.get(`/api/analytics/status/${projectId}`, { params: { days: 1 } }),
        api.get(`/api/analytics/channels/${projectId}`, { params: { days: 1 } }),
        api.get(`/api/analytics/hourly/${projectId}`, { params: { days: 1 } }),
        api.get('/api/contacts/', {
          params: {
            project_id: projectId,
            limit: 8,
            last_event_from: todayIso,
          },
        }),
        api.get(`/api/pipeline/metrics/${projectId}`),
      ]);

      setActivitySummary({
        overview: overviewResp.data as OverviewMetrics,
        statuses: statusResp.data?.statuses || [],
        channels: channelsResp.data?.channels || [],
        hourly: hourlyResp.data?.hourly || [],
        recentContacts: contactsResp.data || [],
        metrics: (metricsResp.data || null) as PipelineMetrics | null,
        loadedAt: new Date().toISOString(),
      });
      setActivityError(null);
    } catch (error: any) {
      if (!silent || !activitySummary) {
        setActivityError(error?.response?.data?.detail || 'Erro ao carregar resumo do dia');
      }
    } finally {
      if (!silent) setActivityLoading(false);
    }
  }, [activitySummary, isAdmin, projectId]);

  useEffect(() => {
    if (!isAdmin) return;

    loadProjectActivity();
    const interval = setInterval(() => {
      loadProjectActivity(true);
    }, 60000);

    return () => clearInterval(interval);
  }, [isAdmin, loadProjectActivity]);

  const conversationInsights = useMemo(() => {
    const startOfDay = getStartOfToday();
    const userVisibleMessages = visibleMessages.filter((message) => message.direction !== 'system');
    const todayMessages = userVisibleMessages.filter((message) => {
      const date = new Date(message.created_at);
      return !Number.isNaN(date.getTime()) && date >= startOfDay;
    });

    return {
      totalMessages: userVisibleMessages.length,
      todayMessages: todayMessages.length,
      incomingToday: todayMessages.filter((message) => message.direction === 'in').length,
      outgoingToday: todayMessages.filter((message) => message.direction !== 'in').length,
      mediaToday: todayMessages.filter((message) => normalizeMedia(message.media).length > 0).length,
      lastTouchRelative: formatRelativeTime(conversation?.last_event_at),
      lastTouchExact: conversation?.last_event_at
        ? new Date(conversation.last_event_at).toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'Sem registro',
    };
  }, [conversation?.last_event_at, visibleMessages]);

  const statusSummary = useMemo(() => {
    return (activitySummary?.statuses || []).reduce<Record<string, number>>((accumulator, item) => {
      accumulator[item.name] = item.count;
      return accumulator;
    }, {});
  }, [activitySummary?.statuses]);

  const peakHour = useMemo(() => {
    return (activitySummary?.hourly || []).reduce<HourlyDistributionItem | null>((top, item) => {
      if (!top || item.count > top.count) return item;
      return top;
    }, null);
  }, [activitySummary?.hourly]);

  const currentHourActivity = useMemo(() => {
    const currentHour = new Date().getHours();
    return activitySummary?.hourly?.find((item) => item.hour === currentHour)?.count || 0;
  }, [activitySummary?.hourly]);

  const handleSend = async () => {
    if (!replyText.trim() || sending) return;
    setSendError(null);

    try {
      await sendMessage(replyText.trim());
      setReplyText('');
      inputRef.current?.focus();
    } catch (error: any) {
      setSendError(error.message);
    }
  };

  const handleTakeover = async () => {
    setStatusLoading(true);
    try {
      await updateStatus('handoff', 'Takeover manual pelo dashboard');
    } catch (error: any) {
      setSendError(error.message);
    } finally {
      setStatusLoading(false);
    }
  };

  const handleReturnToBot = async () => {
    setStatusLoading(true);
    try {
      await updateStatus('open', 'Devolvido ao bot pelo dashboard');
    } catch (error: any) {
      setSendError(error.message);
    } finally {
      setStatusLoading(false);
    }
  };

  const handleBotPause = async (hours: number | null) => {
    setStatusLoading(true);
    setPauseMenuOpen(false);

    try {
      await botPause(hours);
    } catch (error: any) {
      setSendError(error.message);
    } finally {
      setStatusLoading(false);
    }
  };

  const handleOpenProfile = async () => {
    setProfileLoading(true);
    setProfileModal(true);

    try {
      const channelParam = selectedChannelType ? `?channel_type=${encodeURIComponent(selectedChannelType)}` : '';
      const response = await api.get(`/api/contacts/${projectId}/${conversationId}/profile${channelParam}`);
      setProfileData(response.data);
    } catch {
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
        `/api/conversations/${projectId}/${conversationId}/transfer${channelParam}`,
        { reason: transferReason.trim() || undefined, timeout_hours: 8 },
      );
      setTransferModal(false);
      setTransferReason('');
      refresh();
    } catch (error: any) {
      setSendError(error.response?.data?.detail || 'Erro ao transferir conversa');
    } finally {
      setTransferLoading(false);
    }
  };

  const handleShare = async () => {
    try {
      const response = await api.post('/api/live/create-link', {
        project_id: projectId,
        conversation_id: conversationId,
      });
      const url = `${window.location.origin}/live/${response.data.token}`;
      setShareLink(url);
      setShareModal(true);
    } catch {
      setSendError('Erro ao gerar link publico');
    }
  };

  const handleManualRefresh = () => {
    refresh();
    if (isAdmin) loadProjectActivity(true);
  };

  const copyLink = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getChannelIcon = (channel: string) => {
    const logo = getPlatformLogo(channel, 20);
    return logo || <MessageCircle className="h-5 w-5 text-gray-600" />;
  };

  const getMessageIcon = (direction: string, messageType: string) => {
    if (messageType === 'tool_call' || messageType === 'tool_result') {
      return <Wrench className="h-4 w-4" />;
    }
    if (messageType === 'human_reply') {
      return <HandMetal className="h-4 w-4" />;
    }
    if (messageType === 'status_change') {
      return <AlertTriangle className="h-4 w-4" />;
    }
    return direction === 'in' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />;
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
        <div className="text-gray-600">Conversa nao encontrada</div>
      </div>
    );
  }

  const displayName = conversation.contact_name || `Contato #${(conversation.conversation_id || '').slice(-6)}`;

  const getMessageLabel = (message: Message) => {
    if (message.message_type === 'tool_call' || message.message_type === 'tool_result') return 'Atualizacao interna';
    if (message.message_type === 'status_change') return 'Atualizacao';
    if (message.message_type === 'human_reply') return takeoverAgent || 'Atendente';
    if (message.direction === 'in') return displayName;
    return 'Equipe';
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className={`sticky top-0 z-10 border-b shadow-sm ${isHandoff ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}>
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <button onClick={() => router.back()} className="rounded-lg p-2 transition hover:bg-gray-100">
              <ArrowLeft className="h-5 w-5" />
            </button>

            <div className="flex flex-1 items-center gap-3">
              {getChannelIcon(conversation.channel_type)}
              <div>
                <h1
                  className="cursor-pointer text-lg font-semibold text-gray-900 transition hover:text-blue-600"
                  onClick={handleOpenProfile}
                  title="Ver perfil do contato"
                >
                  {displayName}
                </h1>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span>{visibleMessages.length} mensagens</span>
                  {conversation.channel_type === 'whatsapp' && conversation.conversation_id && (
                    <a
                      href={`https://wa.me/${conversation.conversation_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 transition hover:bg-green-100"
                    >
                      <Phone className="h-3 w-3" />
                      +{conversation.conversation_id.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, '$1 $2 $3-$4')}
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isPolling && (
                <div className="flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3 py-1">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                  <span className="text-xs font-medium text-green-700">Atualizando</span>
                </div>
              )}

              <button onClick={handleShare} className="rounded-lg p-2 transition hover:bg-gray-100" title="Compartilhar acompanhamento">
                <Share2 className="h-4 w-4 text-gray-600" />
              </button>

              <button onClick={handleManualRefresh} className="rounded-lg p-2 transition hover:bg-gray-100" title="Atualizar">
                <RefreshCw className="h-4 w-4 text-gray-600" />
              </button>

              <div className="relative">
                <button
                  onClick={() => setMoreMenuOpen(!moreMenuOpen)}
                  className="rounded-lg p-2 transition hover:bg-gray-100"
                  title="Mais acoes"
                >
                  <MoreHorizontal className="h-4 w-4 text-gray-600" />
                </button>
                {moreMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setMoreMenuOpen(false)} />
                    <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border bg-white py-2 shadow-xl">
                      <button
                        onClick={() => {
                          setMoreMenuOpen(false);
                          handleOpenProfile();
                        }}
                        className="w-full px-3 py-2.5 text-left text-sm text-gray-700 transition hover:bg-gray-50"
                      >
                        Ver perfil do contato
                      </button>
                      <button
                        onClick={() => {
                          setMoreMenuOpen(false);
                          handleShare();
                        }}
                        className="w-full px-3 py-2.5 text-left text-sm text-gray-700 transition hover:bg-gray-50"
                      >
                        Compartilhar acompanhamento
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="relative">
                {isBotPaused ? (
                  <button
                    onClick={() => handleBotPause(null)}
                    disabled={statusLoading}
                    className="flex items-center gap-2 rounded-lg bg-green-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-green-600 disabled:opacity-50"
                  >
                    <PlayCircle className="h-4 w-4" />
                    Reativar bot
                  </button>
                ) : (
                  <button
                    onClick={() => setPauseMenuOpen(!pauseMenuOpen)}
                    disabled={statusLoading}
                    className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-orange-600 disabled:opacity-50"
                  >
                    <PauseCircle className="h-4 w-4" />
                    Pausar
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                )}

                {pauseMenuOpen && !isBotPaused && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setPauseMenuOpen(false)} />
                    <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border bg-white py-2 shadow-xl">
                      <p className="px-3 py-1 text-xs font-medium text-gray-400">PAUSAR BOT POR:</p>
                      <button
                        onClick={() => handleBotPause(3)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-amber-50"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100">
                          <Clock className="h-4 w-4 text-amber-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">3 horas</p>
                          <p className="text-xs text-gray-500">Pausa rapida</p>
                        </div>
                      </button>
                      <button
                        onClick={() => handleBotPause(24)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-orange-50"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100">
                          <Clock className="h-4 w-4 text-orange-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">1 dia</p>
                          <p className="text-xs text-gray-500">Atendimento humano hoje</p>
                        </div>
                      </button>
                      <button
                        onClick={() => handleBotPause(72)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-red-50"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100">
                          <Clock className="h-4 w-4 text-red-500" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">3 dias</p>
                          <p className="text-xs text-gray-500">Lead com atendente</p>
                        </div>
                      </button>
                      <div className="my-1 border-t" />
                      <button
                        onClick={() => handleBotPause(360)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-red-50"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-200">
                          <PauseCircle className="h-4 w-4 text-red-700" />
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
                title="Encaminhar para atendimento humano"
                className="flex items-center gap-2 rounded-lg bg-red-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-600 disabled:opacity-50"
              >
                <PhoneForwarded className="h-4 w-4" />
                Encaminhar
              </button>

              {!isHandoff ? (
                <button
                  onClick={handleTakeover}
                  disabled={statusLoading}
                  className="flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-amber-600 disabled:opacity-50"
                >
                  <HandMetal className="h-4 w-4" />
                  Assumir
                </button>
              ) : (
                <button
                  onClick={handleReturnToBot}
                  disabled={statusLoading}
                  className="flex items-center gap-2 rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  Devolver ao bot
                </button>
              )}

              <span className={`rounded-full px-3 py-1 text-xs font-medium ${getStatusBadge(conversation.status)}`}>
                {getStatusLabel(conversation.status)}
              </span>
            </div>
          </div>

          {isHandoff && takeoverUntil && (
            <div className="mt-3 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-100 p-3">
              <Clock className="h-5 w-5 shrink-0 text-amber-700" />
              <p className="text-sm text-amber-900">
                <span className="font-medium">Bot pausado</span> - atendimento humano por {takeoverAgent || 'atendente'} ate{' '}
                {new Date(takeoverUntil).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          )}

          {isBotPaused && (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-red-300 bg-red-100 p-3">
              <div className="flex items-center gap-3">
                <PauseCircle className="h-5 w-5 shrink-0 text-red-700" />
                <p className="text-sm text-red-900">
                  <span className="font-medium">Bot pausado</span>
                  {pausedBy && <> por {pausedBy}</>}
                  {pausedUntil && (
                    <> ate {new Date(pausedUntil).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</>
                  )}
                  {' - '}apenas atendimento humano.
                </p>
              </div>
              <button
                onClick={() => handleBotPause(null)}
                disabled={statusLoading}
                className="shrink-0 rounded-lg bg-green-500 px-3 py-1 text-xs font-medium text-white transition hover:bg-green-600 disabled:opacity-50"
              >
                Reativar
              </button>
            </div>
          )}

          {conversation.summary_short && !isHandoff && (
            <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="text-sm text-blue-900">
                <span className="font-medium">Resumo IA:</span> {conversation.summary_short}
              </p>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto flex-1 w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {isAdmin && (
          <section className="mb-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-6 text-white">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.28em] text-slate-300">Painel do admin</p>
                  <h2 className="mt-2 text-2xl font-semibold">
                    Resumo do dia{activeTenantName ? ` em ${activeTenantName}` : ''}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm text-slate-300">
                    Visao executiva da operacao sem sair da conversa: volume, fila, canais e ritmo do dia.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <Clock className="h-4 w-4" />
                  <span>
                    {activitySummary
                      ? `Atualizado as ${new Date(activitySummary.loadedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                      : activityLoading
                        ? 'Atualizando visao do dia'
                        : 'Aguardando dados'}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-6">
              {activityError && !activitySummary && (
                <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {activityError}
                </div>
              )}

              {activityLoading && !activitySummary ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="h-28 animate-pulse rounded-2xl bg-slate-100" />
                  ))}
                </div>
              ) : activitySummary ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-cyan-100 bg-cyan-50 p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-cyan-900">Conversas hoje</p>
                        <Activity className="h-5 w-5 text-cyan-500" />
                      </div>
                      <p className="mt-4 text-3xl font-semibold text-slate-900">
                        {activitySummary.overview.period_conversations.toLocaleString('pt-BR')}
                      </p>
                      <p className="mt-1 text-xs text-cyan-700">Contatos com movimento no dia</p>
                    </div>

                    <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-blue-900">Mensagens hoje</p>
                        <BarChart3 className="h-5 w-5 text-blue-500" />
                      </div>
                      <p className="mt-4 text-3xl font-semibold text-slate-900">
                        {activitySummary.overview.period_messages.toLocaleString('pt-BR')}
                      </p>
                      <p className="mt-1 text-xs text-blue-700">
                        Tempo medio de resposta: {activitySummary.overview.avg_response_time}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-emerald-900">Em andamento</p>
                        <Users className="h-5 w-5 text-emerald-500" />
                      </div>
                      <p className="mt-4 text-3xl font-semibold text-slate-900">
                        {activitySummary.overview.active_conversations.toLocaleString('pt-BR')}
                      </p>
                      <p className="mt-1 text-xs text-emerald-700">
                        {activitySummary.metrics?.pool_count ?? 0} no pool sem dono
                      </p>
                    </div>

                    <div className="rounded-2xl border border-violet-100 bg-violet-50 p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-violet-900">Resolucao do dia</p>
                        <TrendingUp className="h-5 w-5 text-violet-500" />
                      </div>
                      <p className="mt-4 text-3xl font-semibold text-slate-900">
                        {activitySummary.overview.resolution_rate.toFixed(1)}%
                      </p>
                      <p className="mt-1 text-xs text-violet-700">Fechamentos em relacao ao movimento de hoje</p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 xl:grid-cols-[1.1fr_1fr_1fr]">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Status do dia</p>
                          <p className="text-xs text-slate-500">Onde a operacao esta concentrada</p>
                        </div>
                        <Layers3 className="h-5 w-5 text-slate-400" />
                      </div>
                      <div className="mt-4 space-y-3">
                        {activitySummary.statuses.map((item) => {
                          const total = activitySummary.overview.period_conversations || 1;
                          const percentage = Math.round((item.count / total) * 100);
                          return (
                            <div key={item.name}>
                              <div className="mb-1 flex items-center justify-between text-sm">
                                <span className="font-medium text-slate-700">{getStatusLabel(item.name)}</span>
                                <span className="text-slate-500">{item.count}</span>
                              </div>
                              <div className="h-2 rounded-full bg-white">
                                <div className="h-2 rounded-full bg-slate-900" style={{ width: `${Math.max(8, percentage)}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Canais do dia</p>
                          <p className="text-xs text-slate-500">Distribuicao do atendimento por origem</p>
                        </div>
                        <MessageCircle className="h-5 w-5 text-slate-400" />
                      </div>
                      <div className="mt-4 space-y-3">
                        {activitySummary.channels.map((channel) => (
                          <div key={channel.name} className="flex items-center justify-between rounded-2xl bg-white px-3 py-2">
                            <div className="flex items-center gap-2">
                              {getChannelIcon(channel.name)}
                              <div>
                                <p className="text-sm font-medium text-slate-700">{getChannelLabel(channel.name)}</p>
                                <p className="text-[11px] text-slate-500">{channel.count} conversas</p>
                              </div>
                            </div>
                            <span className="text-sm font-semibold text-slate-900">{channel.percentage.toFixed(1)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Ritmo operacional</p>
                          <p className="text-xs text-slate-500">Pressao atual da operacao</p>
                        </div>
                        <Clock className="h-5 w-5 text-slate-400" />
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                        <div className="rounded-2xl bg-white px-4 py-3">
                          <p className="text-xs uppercase tracking-wide text-slate-400">Fila sem dono</p>
                          <p className="mt-2 text-2xl font-semibold text-slate-900">{activitySummary.metrics?.pool_count ?? 0}</p>
                        </div>
                        <div className="rounded-2xl bg-white px-4 py-3">
                          <p className="text-xs uppercase tracking-wide text-slate-400">Pico do dia</p>
                          <p className="mt-2 text-2xl font-semibold text-slate-900">
                            {peakHour ? formatHourLabel(peakHour.hour) : '--:--'}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">{peakHour?.count || 0} eventos na faixa</p>
                        </div>
                        <div className="rounded-2xl bg-white px-4 py-3">
                          <p className="text-xs uppercase tracking-wide text-slate-400">Agora</p>
                          <p className="mt-2 text-2xl font-semibold text-slate-900">{currentHourActivity}</p>
                          <p className="mt-1 text-xs text-slate-500">mensagens nesta hora</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </section>
        )}

        <div className={`grid gap-6 ${isAdmin ? 'xl:grid-cols-[minmax(0,1fr)_340px]' : ''}`}>
          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Linha do atendimento</p>
                  <p className="text-xs text-slate-500">Conversa completa com anexos e eventos importantes em ordem cronologica.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
                    Hoje: {conversationInsights.todayMessages} mensagens
                  </span>
                  <span className="rounded-full bg-blue-50 px-3 py-1 font-medium text-blue-700">
                    {conversationInsights.mediaToday} com midia
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-4 px-4 py-5">
              {visibleMessages.map((message) => {
                const isIncoming = message.direction === 'in';
                const isSystem = message.direction === 'system';
                const isToolCall = message.message_type === 'tool_call' || message.message_type === 'tool_result';
                const isHuman = message.message_type === 'human_reply';
                const text = getMessageText(message);

                if (isSystem) {
                  return (
                    <div key={message.id} className="flex justify-center">
                      <div className="rounded-full border border-gray-200 bg-gray-100 px-4 py-2 text-xs text-gray-600">
                        {text || '[evento do sistema]'}
                        <span className="ml-2 text-gray-400">
                          {new Date(message.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={message.id} className={`flex ${isIncoming ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-2xl ${isIncoming ? 'mr-auto' : 'ml-auto'}`}>
                      <div
                        className={`rounded-lg p-4 ${
                          isToolCall
                            ? 'border border-purple-200 bg-purple-50'
                            : isHuman
                              ? 'border border-amber-200 bg-amber-50'
                              : isIncoming
                                ? 'border border-gray-200 bg-white'
                                : 'bg-blue-600 text-white'
                        }`}
                      >
                        <div className="mb-2 flex items-center gap-2">
                          <div
                            className={`rounded-full p-1.5 ${
                              isToolCall
                                ? 'bg-purple-200'
                                : isHuman
                                  ? 'bg-amber-200'
                                  : isIncoming
                                    ? 'bg-gray-200'
                                    : 'bg-blue-500'
                            }`}
                          >
                            {getMessageIcon(message.direction, message.message_type)}
                          </div>
                          <span className={`text-xs font-medium ${isIncoming || isToolCall || isHuman ? 'text-gray-600' : 'text-blue-100'}`}>
                            {getMessageLabel(message)}
                          </span>
                          <span className={`ml-auto text-xs ${isIncoming || isToolCall || isHuman ? 'text-gray-500' : 'text-blue-100'}`}>
                            {new Date(message.created_at).toLocaleTimeString('pt-BR')}
                          </span>
                        </div>

                        {text ? (
                          <p className={`whitespace-pre-wrap text-sm ${isIncoming || isToolCall || isHuman ? 'text-gray-900' : 'text-white'}`}>
                            {text}
                          </p>
                        ) : (
                          <p className={`text-sm italic ${isIncoming || isToolCall || isHuman ? 'text-gray-400' : 'text-blue-200'}`}>
                            [Mensagem sem texto]
                          </p>
                        )}

                        {isToolCall && message.raw_payload && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs text-purple-700 hover:text-purple-900">
                              Ver payload completo
                            </summary>
                            <pre className="mt-2 overflow-x-auto rounded bg-purple-100 p-2 text-xs">
                              {JSON.stringify(message.raw_payload, null, 2)}
                            </pre>
                          </details>
                        )}

                        {(() => {
                          const mediaItems = normalizeMedia(message.media);
                          if (mediaItems.length === 0) return null;

                          return (
                            <div className="mt-3 space-y-2">
                              {mediaItems.map((item, index) => {
                                const url = getMediaUrl(item);
                                const type = (item.type || message.message_type || 'media').toLowerCase();

                                if (type === 'audio') {
                                  return (
                                    <div key={index} className="space-y-2">
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
                                            Abrir arquivo
                                          </a>
                                        )}
                                        {item.share_url && (
                                          <a
                                            href={item.share_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={`underline ${isIncoming || isToolCall || isHuman ? 'text-gray-600 hover:text-gray-800' : 'text-blue-100 hover:text-white'}`}
                                          >
                                            Abrir link
                                          </a>
                                        )}
                                      </div>
                                      {item.transcription && (
                                        <p className={`whitespace-pre-wrap text-xs ${isIncoming || isToolCall || isHuman ? 'text-gray-600' : 'text-blue-100'}`}>
                                          <span className="font-medium">Transcricao:</span> {item.transcription}
                                        </p>
                                      )}
                                    </div>
                                  );
                                }

                                if (type === 'image') {
                                  if (!url) return null;
                                  return (
                                    <div key={index} className="space-y-2">
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
                                          Abrir arquivo
                                        </a>
                                        {item.share_url && (
                                          <a
                                            href={item.share_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={`underline ${isIncoming || isToolCall || isHuman ? 'text-gray-600 hover:text-gray-800' : 'text-blue-100 hover:text-white'}`}
                                          >
                                            Abrir link
                                          </a>
                                        )}
                                      </div>
                                      {item.analysis && (
                                        <p className={`whitespace-pre-wrap text-xs ${isIncoming || isToolCall || isHuman ? 'text-gray-600' : 'text-blue-100'}`}>
                                          <span className="font-medium">Descricao:</span> {item.analysis}
                                        </p>
                                      )}
                                    </div>
                                  );
                                }

                                if (type === 'video') {
                                  if (!url) return null;
                                  return (
                                    <div key={index} className="space-y-2">
                                      <video controls preload="metadata" className="w-full rounded-lg border border-gray-200" src={url} />
                                      <div className="flex flex-wrap gap-2 text-xs">
                                        <a
                                          href={url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className={`underline ${isIncoming || isToolCall || isHuman ? 'text-gray-600 hover:text-gray-800' : 'text-blue-100 hover:text-white'}`}
                                        >
                                          Abrir arquivo
                                        </a>
                                        {item.share_url && (
                                          <a
                                            href={item.share_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={`underline ${isIncoming || isToolCall || isHuman ? 'text-gray-600 hover:text-gray-800' : 'text-blue-100 hover:text-white'}`}
                                          >
                                            Abrir link
                                          </a>
                                        )}
                                      </div>
                                    </div>
                                  );
                                }

                                if (!url) return null;

                                return (
                                  <div key={index} className="space-y-1">
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

                      <div className={`mt-1 text-xs text-gray-500 ${isIncoming ? 'text-left' : 'text-right'}`}>
                        {new Date(message.created_at).toLocaleDateString('pt-BR')}
                      </div>
                    </div>
                  </div>
                );
              })}

              <div ref={messagesEndRef} />
            </div>

            {visibleMessages.length === 0 && !loading && (
              <div className="py-12 text-center">
                <MessageCircle className="mx-auto mb-3 h-12 w-12 text-gray-400" />
                <p className="text-gray-600">Nenhuma mensagem nesta conversa</p>
              </div>
            )}
          </section>

          {isAdmin && (
            <aside className="self-start space-y-4 xl:sticky xl:top-24">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Leitura desta conversa</p>
                    <p className="text-xs text-slate-500">Sinais rapidos para decidir o proximo passo</p>
                  </div>
                  <UserCircle className="h-5 w-5 text-slate-400" />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Hoje</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">{conversationInsights.todayMessages}</p>
                    <p className="text-xs text-slate-500">mensagens</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Midia hoje</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">{conversationInsights.mediaToday}</p>
                    <p className="text-xs text-slate-500">anexos</p>
                  </div>
                  <div className="rounded-2xl bg-sky-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-sky-500">Recebidas</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">{conversationInsights.incomingToday}</p>
                    <p className="text-xs text-slate-500">entradas hoje</p>
                  </div>
                  <div className="rounded-2xl bg-emerald-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-emerald-500">Enviadas</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">{conversationInsights.outgoingToday}</p>
                    <p className="text-xs text-slate-500">saidas hoje</p>
                  </div>
                </div>

                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-slate-500">Status atual</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${getStatusBadge(conversation.status)}`}>
                      {getStatusLabel(conversation.status)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-slate-500">Ultimo toque</span>
                    <span className="font-medium text-slate-900">{conversationInsights.lastTouchRelative}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-slate-500">Horario</span>
                    <span className="font-medium text-slate-900">{conversationInsights.lastTouchExact}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Canal</span>
                    <span className="font-medium text-slate-900">{getChannelLabel(conversation.channel_type)}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Fila viva de hoje</p>
                    <p className="text-xs text-slate-500">Quem acabou de movimentar e precisa de contexto</p>
                  </div>
                  <Activity className="h-5 w-5 text-slate-400" />
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div className="rounded-2xl bg-slate-50 p-3 text-center">
                    <p className="text-xs text-slate-400">Open</p>
                    <p className="mt-1 text-xl font-semibold text-slate-900">{statusSummary.open || 0}</p>
                  </div>
                  <div className="rounded-2xl bg-amber-50 p-3 text-center">
                    <p className="text-xs text-amber-500">Aguardando</p>
                    <p className="mt-1 text-xl font-semibold text-slate-900">{statusSummary.waiting_customer || 0}</p>
                  </div>
                  <div className="rounded-2xl bg-orange-50 p-3 text-center">
                    <p className="text-xs text-orange-500">Handoff</p>
                    <p className="mt-1 text-xl font-semibold text-slate-900">{statusSummary.handoff || 0}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {(activitySummary?.recentContacts || []).map((contact) => {
                    const isCurrent = contact.conversation_id === conversationId && contact.channel_type === conversation.channel_type;
                    return (
                      <button
                        key={`${contact.channel_type}-${contact.conversation_id}`}
                        onClick={() => {
                          if (isCurrent) return;
                          router.push(`/dash/conversations/${contact.project_id}/${contact.conversation_id}?channel_type=${contact.channel_type}`);
                        }}
                        className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                          isCurrent
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              {getChannelIcon(contact.channel_type)}
                              <p className={`truncate text-sm font-medium ${isCurrent ? 'text-white' : 'text-slate-900'}`}>
                                {contact.contact_name}
                              </p>
                            </div>
                            <p className={`mt-1 line-clamp-2 text-xs ${isCurrent ? 'text-slate-200' : 'text-slate-500'}`}>
                              {contact.last_text || 'Sem ultima mensagem de texto'}
                            </p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-medium ${
                            isCurrent ? 'bg-white/15 text-white' : getStatusBadge(contact.status)
                          }`}>
                            {getStatusLabel(contact.status)}
                          </span>
                        </div>
                        <div className={`mt-3 flex items-center justify-between text-[11px] ${isCurrent ? 'text-slate-300' : 'text-slate-500'}`}>
                          <span>{getChannelLabel(contact.channel_type)}</span>
                          <span>{formatRelativeTime(contact.last_event_at)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </aside>
          )}
        </div>
      </main>

      <div className={`sticky bottom-0 border-t ${isHandoff ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}>
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
          {sendError && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {sendError}
              <button onClick={() => setSendError(null)} className="ml-auto">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="flex items-center gap-3">
            <input
              ref={inputRef}
              type="text"
              value={replyText}
              onChange={(event) => setReplyText(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && !event.shiftKey && handleSend()}
              placeholder="Responder ao contato..."
              disabled={sending}
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleSend}
              disabled={!replyText.trim() || sending}
              className="rounded-lg bg-blue-600 p-2.5 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {transferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setTransferModal(false)}>
          <div className="mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Encaminhar atendimento</h3>
              <button onClick={() => setTransferModal(false)} className="rounded p-1 transition hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-4 text-sm text-gray-600">
              A conversa sera encaminhada para atendimento humano por 8 horas e o responsavel sera avisado.
            </p>
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-gray-700">Motivo (opcional)</label>
              <input
                type="text"
                value={transferReason}
                onChange={(event) => setTransferReason(event.target.value)}
                placeholder="Ex: Cliente quer falar com gerente"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setTransferModal(false)}
                className="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleTransfer}
                disabled={transferLoading}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {transferLoading ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <PhoneForwarded className="h-4 w-4" />
                )}
                Transferir
              </button>
            </div>
          </div>
        </div>
      )}

      {profileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setProfileModal(false)}>
          <div
            className="mx-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">Perfil do contato</h2>
                <button onClick={() => setProfileModal(false)} className="rounded-lg p-1 transition hover:bg-gray-100">
                  <X className="h-5 w-5" />
                </button>
              </div>
              {profileLoading ? (
                <div className="py-8 text-center text-gray-500">Carregando perfil...</div>
              ) : profileData ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100">
                      <UserCircle className="h-8 w-8 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-lg font-semibold">{profileData.contact_name}</p>
                      {profileData.phone && (
                        <a
                          href={`https://wa.me/${profileData.phone}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-green-600 hover:underline"
                        >
                          +{profileData.phone}
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg bg-gray-50 p-3 text-center">
                      <p className="text-2xl font-bold text-gray-900">{profileData.stats?.total_messages || 0}</p>
                      <p className="text-xs text-gray-500">Mensagens</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3 text-center">
                      <p className="text-2xl font-bold text-blue-600">{profileData.stats?.messages_in || 0}</p>
                      <p className="text-xs text-gray-500">Recebidas</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3 text-center">
                      <p className="text-2xl font-bold text-green-600">{profileData.stats?.messages_out || 0}</p>
                      <p className="text-xs text-gray-500">Enviadas</p>
                    </div>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between border-b py-1">
                      <span className="text-gray-500">Status</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${getStatusBadge(profileData.status || '')}`}>
                        {getStatusLabel(profileData.status || '')}
                      </span>
                    </div>
                    {profileData.stats?.first_message_at && (
                      <div className="flex justify-between border-b py-1">
                        <span className="text-gray-500">Primeiro contato</span>
                        <span className="font-medium">
                          {new Date(profileData.stats.first_message_at).toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                    )}
                    {profileData.stats?.last_message_at && (
                      <div className="flex justify-between border-b py-1">
                        <span className="text-gray-500">Ultimo contato</span>
                        <span className="font-medium">
                          {new Date(profileData.stats.last_message_at).toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                    )}
                  </div>

                  {profileData.assignment && (
                    <div className="rounded-lg bg-blue-50 p-3">
                      <p className="mb-1 text-xs font-medium text-blue-500">ATRIBUICAO ATUAL</p>
                      <p className="text-sm font-medium">{profileData.assignment.assignee_name || 'Sem nome'}</p>
                      {profileData.assignment.stage_name && (
                        <div className="mt-1 flex items-center gap-2">
                          <div
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: profileData.assignment.stage_color || '#6366f1' }}
                          />
                          <span className="text-xs text-gray-600">{profileData.assignment.stage_name}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {profileData.summary && (
                    <div className="rounded-lg bg-gray-50 p-3">
                      <p className="mb-1 text-xs font-medium text-gray-500">RESUMO IA</p>
                      <p className="text-sm text-gray-700">{profileData.summary}</p>
                    </div>
                  )}

                  {profileData.user_data && Object.keys(profileData.user_data).length > 0 && (
                    <div className="rounded-lg bg-gray-50 p-3">
                      <p className="mb-1 text-xs font-medium text-gray-500">DADOS COLETADOS</p>
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

                  <div className="flex gap-2 pt-2">
                    {profileData.phone && (
                      <a
                        href={`https://wa.me/${profileData.phone}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 rounded-lg bg-green-500 py-2 text-center text-sm font-medium text-white transition hover:bg-green-600"
                      >
                        Abrir contato
                      </a>
                    )}
                    <button
                      onClick={() => setProfileModal(false)}
                      className="flex-1 rounded-lg bg-gray-100 py-2 text-center text-sm font-medium text-gray-700 transition hover:bg-gray-200"
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

      {shareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShareModal(false)}>
          <div className="mx-4 w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Link publico da conversa</h3>
              <button onClick={() => setShareModal(false)} className="rounded p-1 transition hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-4 text-sm text-gray-600">
              Qualquer pessoa com este link pode acompanhar a conversa em tempo real em modo leitura. O link expira em 72 horas.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={shareLink}
                readOnly
                className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm"
              />
              <button
                onClick={copyLink}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition hover:bg-blue-700"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
