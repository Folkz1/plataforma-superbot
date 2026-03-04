'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  Send, Loader2, Wifi, WifiOff, Trash2, FlaskConical, ChevronDown,
  ChevronRight, Variable, Wrench, Plus, X
} from 'lucide-react';

interface ElevenLabsAgent {
  agent_id: string;
  name?: string;
  _configured_label?: string;
  _configured_active?: boolean;
  platform_settings?: { widget_settings?: { name?: string } };
  conversation_config?: {
    agent?: { prompt?: { prompt?: string }; tools?: any[] };
  };
}

interface ToolCallInfo {
  tool_name: string;
  parameters: Record<string, any>;
  result?: string;
  expanded: boolean;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: Date;
  streaming?: boolean;
  toolCall?: ToolCallInfo;
}

export default function ChatLabPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [tenantId, setTenantId] = useState('');

  // Agents from API
  const [agents, setAgents] = useState<ElevenLabsAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<ElevenLabsAgent | null>(null);
  const [agentsLoading, setAgentsLoading] = useState(true);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [conversationId, setConversationId] = useState('');
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);

  // Dynamic variables
  const [showVarsPanel, setShowVarsPanel] = useState(false);
  const [dynamicVars, setDynamicVars] = useState<Record<string, string>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const streamBufferRef = useRef('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ─── Init ──────────────────────────────────────────────

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) { router.push('/login'); return; }
    const u = JSON.parse(userData);
    if (u.role !== 'admin') { router.push('/dash'); return; }
    setUser(u);
    const tId = localStorage.getItem('active_tenant_id') || u.client_id;
    if (tId) setTenantId(tId);
  }, [router]);

  // Load agents from API
  useEffect(() => {
    if (!tenantId) return;
    setAgentsLoading(true);
    api.get(`/api/elevenlabs/agents/${tenantId}`)
      .then(res => {
        const list: ElevenLabsAgent[] = res.data?.agents || [];
        setAgents(list);
        if (list.length > 0 && !selectedAgent) setSelectedAgent(list[0]);
      })
      .catch(() => setAgents([]))
      .finally(() => setAgentsLoading(false));
  }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Extract variables from selected agent prompt
  useEffect(() => {
    if (!selectedAgent) return;
    const prompt = selectedAgent.conversation_config?.agent?.prompt?.prompt || '';
    const varMatches = prompt.match(/\{\{(\w+)\}\}/g) || [];
    const vars: Record<string, string> = {};
    varMatches.forEach(m => {
      const key = m.replace(/\{\{|\}\}/g, '');
      if (!key.startsWith('system__')) vars[key] = dynamicVars[key] || '';
    });
    setDynamicVars(vars);
  }, [selectedAgent]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ─── WebSocket ─────────────────────────────────────────

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
    setConnecting(false);
  }, []);

  const connect = useCallback(async () => {
    if (!selectedAgent) return;
    disconnect();
    setConnecting(true);
    setMessages([]);
    setConversationId('');
    streamBufferRef.current = '';

    try {
      const res = await fetch('/api/elevenlabs-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: selectedAgent.agent_id }),
      });
      const data = await res.json();
      if (!data.signed_url) throw new Error(data.error || 'No signed URL');

      const ws = new WebSocket(data.signed_url);
      wsRef.current = ws;

      ws.onopen = () => {
        // Build dynamic variables payload (only non-empty)
        const varsPayload: Record<string, string> = {};
        Object.entries(dynamicVars).forEach(([k, v]) => {
          if (v.trim()) varsPayload[k] = v.trim();
        });

        ws.send(JSON.stringify({
          type: 'conversation_initiation_client_data',
          custom_llm_extra_body: {},
          conversation_config_override: {},
          dynamic_variables: varsPayload,
        }));
        setConnected(true);
        setConnecting(false);

        const varsInfo = Object.keys(varsPayload).length > 0
          ? ` | Vars: ${Object.entries(varsPayload).map(([k, v]) => `${k}="${v}"`).join(', ')}`
          : '';
        setMessages([{ role: 'system', text: `Conectado ao agente.${varsInfo}`, timestamp: new Date() }]);
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
            const text = msg.agent_response_event?.agent_response?.trim() || '';
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant' && last.streaming) {
                const updated = [...prev];
                updated[updated.length - 1] = { ...last, text, streaming: false };
                return updated;
              }
              if (last?.role === 'assistant' && last.text) return prev;
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
              {
                role: 'system',
                text: `Tool: ${tc.tool_name}`,
                timestamp: new Date(),
                toolCall: {
                  tool_name: tc.tool_name || 'unknown',
                  parameters: tc.parameters || {},
                  expanded: false,
                },
              },
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
  }, [selectedAgent, disconnect, dynamicVars]);

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

  const toggleToolCall = (index: number) => {
    setMessages(prev => {
      const updated = [...prev];
      const msg = updated[index];
      if (msg?.toolCall) {
        updated[index] = { ...msg, toolCall: { ...msg.toolCall, expanded: !msg.toolCall.expanded } };
      }
      return updated;
    });
  };

  if (!user) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  const agentName = selectedAgent
    ? (selectedAgent._configured_label || selectedAgent.name || selectedAgent.platform_settings?.widget_settings?.name || selectedAgent.agent_id)
    : 'Nenhum';

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
                <span className="max-w-[200px] truncate">{agentsLoading ? 'Carregando...' : agentName}</span>
                <ChevronDown className="w-4 h-4" />
              </button>
              {agentDropdownOpen && (
                <div className="absolute right-0 mt-1 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10 max-h-80 overflow-y-auto">
                  {agents.map(agent => {
                    const name = agent._configured_label || agent.name || agent.platform_settings?.widget_settings?.name || agent.agent_id;
                    const toolCount = agent.conversation_config?.agent?.tools?.length || 0;
                    return (
                      <button
                        key={agent.agent_id}
                        onClick={() => { setSelectedAgent(agent); setAgentDropdownOpen(false); disconnect(); }}
                        className={`w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 ${
                          selectedAgent?.agent_id === agent.agent_id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                        }`}
                      >
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {agent.agent_id}
                          {toolCount > 0 && <span className="ml-2 text-amber-600 dark:text-amber-400">{toolCount} tools</span>}
                        </p>
                      </button>
                    );
                  })}
                  {agents.length === 0 && !agentsLoading && (
                    <p className="px-4 py-3 text-sm text-gray-500">Nenhum agente encontrado</p>
                  )}
                </div>
              )}
            </div>

            {/* Dynamic vars toggle */}
            <button
              onClick={() => setShowVarsPanel(!showVarsPanel)}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg transition ${
                showVarsPanel || Object.keys(dynamicVars).length > 0
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
              }`}
              title="Variaveis dinamicas"
            >
              <Variable className="w-3.5 h-3.5" />
              {Object.values(dynamicVars).filter(v => v.trim()).length > 0 && (
                <span className="font-medium">{Object.values(dynamicVars).filter(v => v.trim()).length}</span>
              )}
            </button>

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
              disabled={connecting || !selectedAgent}
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

      {/* Dynamic Variables Panel */}
      {showVarsPanel && (
        <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase flex items-center gap-1.5">
              <Variable className="w-3.5 h-3.5" /> Variaveis Dinamicas
            </h3>
            <div className="flex items-center gap-2">
              <button onClick={() => setDynamicVars(prev => ({ ...prev, [`var_${Date.now()}`]: '' }))}
                className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition">
                <Plus className="w-3 h-3" /> Adicionar
              </button>
              <button onClick={() => setShowVarsPanel(false)} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded">
                <X className="w-3.5 h-3.5 text-gray-400" />
              </button>
            </div>
          </div>
          {Object.keys(dynamicVars).length === 0 ? (
            <p className="text-xs text-gray-400">Nenhuma variavel. Use {'{{nome}}'} no prompt do agente.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {Object.entries(dynamicVars).map(([key, val]) => (
                <div key={key} className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1">
                  <code className="text-xs text-purple-600 dark:text-purple-400 font-mono">{key}:</code>
                  <input type="text" value={val}
                    onChange={e => setDynamicVars(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder="valor"
                    className="w-24 px-1.5 py-0.5 text-xs border-0 bg-transparent text-gray-900 dark:text-white focus:ring-0 focus:outline-none"
                  />
                  <button onClick={() => {
                    const copy = { ...dynamicVars };
                    delete copy[key];
                    setDynamicVars(copy);
                  }} className="text-gray-400 hover:text-red-500">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-400 mt-1.5">Variaveis sao enviadas ao conectar. Reconecte para aplicar mudancas.</p>
        </div>
      )}

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
              msg.toolCall ? (
                // Expandable tool call
                <div className="max-w-[80%] bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleToolCall(i)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition"
                  >
                    {msg.toolCall.expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    <Wrench className="w-3.5 h-3.5" />
                    <span className="font-mono font-medium">{msg.toolCall.tool_name}</span>
                  </button>
                  {msg.toolCall.expanded && (
                    <div className="px-3 pb-2">
                      <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mb-1">Parametros:</p>
                      <pre className="text-xs font-mono text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/40 rounded p-2 overflow-x-auto">
                        {JSON.stringify(msg.toolCall.parameters, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <div className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 rounded-full text-xs text-gray-500 dark:text-gray-400">
                  {msg.text}
                </div>
              )
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
