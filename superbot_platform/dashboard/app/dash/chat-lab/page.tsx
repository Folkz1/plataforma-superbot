'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Send, Loader2, Wifi, WifiOff, RefreshCw, Trash2, FlaskConical, ChevronDown
} from 'lucide-react';

// Hard-coded experimental agents (add more as needed)
const AGENTS = [
  {
    id: 'agent_7501kjx5qhp1fvcagh87n4h36dsx',
    name: '[GIANNI] Giulia TEXT',
    description: 'Agente texto - Famiglia Gianni com gpt-4.1-mini + 5 tools + 6 KB docs',
  },
  {
    id: 'agent_8201kg0y1kdtfpeabda5311vmp81',
    name: '[GIANNI] Giulia WEB (voz)',
    description: 'Agente WEB com voz - Famiglia Gianni (gpt-4.1-mini)',
  },
];

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: Date;
  streaming?: boolean;
}

export default function ChatLabPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [selectedAgent, setSelectedAgent] = useState(AGENTS[0]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [conversationId, setConversationId] = useState('');
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const streamBufferRef = useRef('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) { router.push('/login'); return; }
    const u = JSON.parse(userData);
    if (u.role !== 'admin') { router.push('/dash'); return; }
    setUser(u);
  }, [router]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
    setConnecting(false);
  }, []);

  const connect = useCallback(async () => {
    disconnect();
    setConnecting(true);
    setMessages([]);
    setConversationId('');
    streamBufferRef.current = '';

    try {
      const res = await fetch('/api/elevenlabs-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: selectedAgent.id }),
      });
      const data = await res.json();
      if (!data.signed_url) throw new Error(data.error || 'No signed URL');

      const ws = new WebSocket(data.signed_url);
      wsRef.current = ws;

      ws.onopen = () => {
        // Send initiation data (required by ElevenLabs protocol)
        ws.send(JSON.stringify({
          type: 'conversation_initiation_client_data',
          custom_llm_extra_body: {},
          conversation_config_override: {},
          dynamic_variables: {},
        }));
        setConnected(true);
        setConnecting(false);
        setMessages([{ role: 'system', text: 'Conectado ao agente. Aguardando...', timestamp: new Date() }]);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'conversation_initiation_metadata': {
            const cid = msg.conversation_initiation_metadata_event?.conversation_id || '';
            setConversationId(cid);
            break;
          }

          case 'agent_chat_response_part': {
            const part = msg.text_response_part || {};
            if (part.type === 'start') {
              streamBufferRef.current = '';
              setMessages(prev => [...prev, { role: 'assistant', text: '', timestamp: new Date(), streaming: true }]);
            } else if (part.type === 'delta' && part.text) {
              streamBufferRef.current += part.text;
              const currentText = streamBufferRef.current;
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.streaming) {
                  updated[updated.length - 1] = { ...last, text: currentText };
                }
                return updated;
              });
            } else if (part.type === 'stop') {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.streaming) {
                  updated[updated.length - 1] = { ...last, streaming: false };
                }
                return updated;
              });
            }
            break;
          }

          case 'agent_response': {
            // Final consolidated response - only use if streaming didn't capture it
            const text = msg.agent_response_event?.agent_response?.trim() || '';
            setMessages(prev => {
              const last = prev[prev.length - 1];
              // If streaming is still active, finalize it with the full text
              if (last?.role === 'assistant' && last.streaming) {
                const updated = [...prev];
                updated[updated.length - 1] = { ...last, text, streaming: false };
                return updated;
              }
              // If last assistant message already has content, skip (streaming already handled it)
              if (last?.role === 'assistant' && last.text) return prev;
              // No streaming happened - add as new message
              return [...prev, { role: 'assistant', text, timestamp: new Date() }];
            });
            break;
          }

          case 'ping': {
            const eventId = msg.ping_event?.event_id;
            ws.send(JSON.stringify({ type: 'pong', event_id: eventId }));
            break;
          }

          case 'client_tool_call': {
            const tc = msg.client_tool_call || {};
            setMessages(prev => [
              ...prev,
              { role: 'system', text: `Tool call: ${tc.tool_name} (${JSON.stringify(tc.parameters || {}).slice(0, 100)})`, timestamp: new Date() },
            ]);
            break;
          }

          case 'error': {
            setMessages(prev => [
              ...prev,
              { role: 'system', text: `Erro: ${JSON.stringify(msg).slice(0, 200)}`, timestamp: new Date() },
            ]);
            break;
          }
        }
      };

      ws.onclose = () => {
        setConnected(false);
        setConnecting(false);
        setMessages(prev => [...prev, { role: 'system', text: 'Desconectado.', timestamp: new Date() }]);
      };

      ws.onerror = () => {
        setConnected(false);
        setConnecting(false);
        setMessages(prev => [...prev, { role: 'system', text: 'Erro de conexao WebSocket.', timestamp: new Date() }]);
      };
    } catch (err: any) {
      setConnecting(false);
      setMessages([{ role: 'system', text: `Erro: ${err.message}`, timestamp: new Date() }]);
    }
  }, [selectedAgent, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { disconnect(); };
  }, [disconnect]);

  const sendMessage = () => {
    const text = input.trim();
    if (!text || !wsRef.current || !connected) return;

    setMessages(prev => [...prev, { role: 'user', text, timestamp: new Date() }]);
    wsRef.current.send(JSON.stringify({ type: 'user_message', text }));
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!user) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FlaskConical className="w-5 h-5 text-purple-500" />
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Chat Lab</h1>
            <span className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 px-2 py-0.5 rounded-full font-medium">
              Experimental
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Agent selector */}
            <div className="relative">
              <button
                onClick={() => setAgentDropdownOpen(!agentDropdownOpen)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                <span className="max-w-[200px] truncate">{selectedAgent.name}</span>
                <ChevronDown className="w-4 h-4" />
              </button>
              {agentDropdownOpen && (
                <div className="absolute right-0 mt-1 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10">
                  {AGENTS.map(agent => (
                    <button
                      key={agent.id}
                      onClick={() => { setSelectedAgent(agent); setAgentDropdownOpen(false); disconnect(); }}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 ${
                        selectedAgent.id === agent.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                      }`}
                    >
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{agent.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{agent.description}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Connection status */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
              connected
                ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
            }`}>
              {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {connected ? 'Conectado' : 'Desconectado'}
            </div>

            {/* Connect/Disconnect */}
            <button
              onClick={connected ? disconnect : connect}
              disabled={connecting}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition ${
                connected
                  ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              } disabled:opacity-50`}
            >
              {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : connected ? 'Desconectar' : 'Conectar'}
            </button>

            {/* Clear */}
            <button
              onClick={() => { disconnect(); setMessages([]); }}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              title="Limpar"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
        {conversationId && (
          <p className="text-xs text-gray-400 mt-1 font-mono">{conversationId}</p>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50 dark:bg-gray-900">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <FlaskConical className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">Clique em &quot;Conectar&quot; para iniciar uma conversa</p>
            <p className="text-xs mt-1 opacity-60">ElevenLabs Chat Mode via WebSocket</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : msg.role === 'system' ? 'justify-center' : 'justify-start'}`}>
            {msg.role === 'system' ? (
              <div className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 rounded-full text-xs text-gray-500 dark:text-gray-400">
                {msg.text}
              </div>
            ) : (
              <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-md'
                  : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-bl-md shadow-sm'
              }`}>
                {msg.text || (msg.streaming ? <Loader2 className="w-4 h-4 animate-spin text-gray-400" /> : '')}
                {msg.streaming && msg.text && (
                  <span className="inline-block w-1.5 h-4 bg-blue-500 ml-0.5 animate-pulse rounded" />
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <div className="flex items-end gap-2 max-w-4xl mx-auto">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={connected ? 'Digite sua mensagem...' : 'Conecte-se primeiro...'}
            disabled={!connected}
            rows={1}
            className="flex-1 resize-none px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 text-sm"
            style={{ maxHeight: '120px' }}
            onInput={(e) => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = 'auto';
              t.style.height = Math.min(t.scrollHeight, 120) + 'px';
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!connected || !input.trim()}
            className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
