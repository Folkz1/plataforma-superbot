import { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '@/lib/api';

interface Message {
  id: string;
  direction: string;
  message_type: string;
  text: string | null;
  media: any;
  raw_payload: any;
  created_at: string;
}

interface ConversationData {
  project_id: string;
  conversation_id: string;
  contact_name: string | null;
  channel_type: string;
  status: string;
  last_event_at: string;
  ai_state: string | null;
  summary_short: string | null;
  metadata: Record<string, any> | null;
  messages: Message[];
}

interface UseConversationOptions {
  enabled?: boolean;
  pollInterval?: number;
}

export function useConversation(
  projectId: string,
  conversationId: string,
  options: UseConversationOptions = {}
) {
  const { enabled = true, pollInterval = 5000 } = options;

  const [conversation, setConversation] = useState<ConversationData | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [sending, setSending] = useState(false);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastMessageCountRef = useRef(0);

  const fetchConversation = async () => {
    try {
      const response = await api.get(`/api/conversations/${projectId}/${conversationId}`);
      const data = response.data;

      setConversation(data);
      setMessages(data.messages || []);

      if (data.messages.length > lastMessageCountRef.current) {
        lastMessageCountRef.current = data.messages.length;
      }

      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Erro ao carregar conversa');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (enabled && projectId && conversationId) {
      fetchConversation();
    }
  }, [projectId, conversationId, enabled]);

  useEffect(() => {
    if (!enabled || !projectId || !conversationId) return;

    setIsPolling(true);

    intervalRef.current = setInterval(() => {
      fetchConversation();
    }, pollInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        setIsPolling(false);
      }
    };
  }, [projectId, conversationId, enabled, pollInterval]);

  const refresh = () => {
    fetchConversation();
  };

  const sendMessage = useCallback(async (text: string) => {
    setSending(true);
    try {
      const resp = await api.post(
        `/api/conversations/${projectId}/${conversationId}/send`,
        { text }
      );
      await fetchConversation();
      return resp.data;
    } catch (err: any) {
      throw new Error(err.response?.data?.detail || 'Erro ao enviar mensagem');
    } finally {
      setSending(false);
    }
  }, [projectId, conversationId]);

  const updateStatus = useCallback(async (status: string, reason?: string) => {
    try {
      const resp = await api.patch(
        `/api/conversations/${projectId}/${conversationId}/status`,
        { status, reason }
      );
      await fetchConversation();
      return resp.data;
    } catch (err: any) {
      throw new Error(err.response?.data?.detail || 'Erro ao atualizar status');
    }
  }, [projectId, conversationId]);

  return {
    conversation,
    messages,
    loading,
    error,
    isPolling,
    sending,
    refresh,
    sendMessage,
    updateStatus
  };
}
