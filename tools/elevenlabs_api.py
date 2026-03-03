#!/usr/bin/env python3
"""
SuperBot - ElevenLabs Conversational AI Tool
Gerencia agentes de voz ElevenLabs via API.
Uso: python tools/elevenlabs_api.py <comando> [args]

Comandos:
  agents                     Lista todos agentes conversacionais
  agent <agent_id>           Detalhes de um agente
  prompt <agent_id>          Mostra system prompt do agente
  update-prompt <id> <file>  Atualiza prompt de arquivo
  tools <agent_id>           Lista tools/webhooks do agente
  knowledge <agent_id>       Lista knowledge base do agente
  conversations <agent_id>   Lista conversas recentes
  conversation <conv_id>     Detalhes de uma conversa
"""
import json
import os
import sys
import urllib.request
import ssl
from pathlib import Path

# Config
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
BASE_URL = "https://api.elevenlabs.io"

# Try loading from .env
if not ELEVENLABS_API_KEY:
    env_path = Path(__file__).parent.parent / "superbot_platform" / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("ELEVENLABS_API_KEY="):
                ELEVENLABS_API_KEY = line.split("=", 1)[1].strip()


def _request(method, path, data=None):
    """Request para ElevenLabs API."""
    url = f"{BASE_URL}{path}"
    headers = {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
    }
    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        print(f"[ERROR] HTTP {e.code}: {error_body[:500]}", file=sys.stderr)
        sys.exit(1)


def cmd_agents():
    """Lista agentes conversacionais."""
    result = _request("GET", "/v1/convai/agents")
    agents = result.get("agents", [])
    if not agents:
        print("Nenhum agente encontrado.")
        return
    print(f"{'ID':>30} | {'Nome':40s} | Status")
    print("-" * 85)
    for a in agents:
        name = a.get("name", "?")
        agent_id = a.get("agent_id", "?")
        print(f"{agent_id:>30} | {name:40s} |")
    print(f"\nTotal: {len(agents)} agentes")


def cmd_agent(agent_id):
    """Detalhes de um agente."""
    a = _request("GET", f"/v1/convai/agents/{agent_id}")
    print(f"Nome: {a.get('name', '?')}")
    print(f"ID: {a.get('agent_id', '?')}")

    # Conversation config
    conv = a.get("conversation_config", {})

    # Agent info
    agent_info = conv.get("agent", {})
    prompt_cfg = agent_info.get("prompt", {})
    print(f"Modelo: {prompt_cfg.get('model', '?')}")
    print(f"Temperatura: {prompt_cfg.get('temperature', '?')}")
    print(f"Max tokens: {prompt_cfg.get('max_tokens', '?')}")

    # First message
    first_msg = agent_info.get("first_message", "")
    if first_msg:
        print(f"First message: {first_msg[:200]}")

    # Language
    lang = agent_info.get("language", "?")
    print(f"Lingua: {lang}")

    # Tools
    tools = prompt_cfg.get("tools", [])
    if tools:
        print(f"\nTools ({len(tools)}):")
        for t in tools:
            ttype = t.get("type", "?")
            name = t.get("name", t.get("description", "?"))
            if ttype == "webhook":
                url = t.get("api_schema", {}).get("url", "?")
                print(f"  - [{ttype}] {name} -> {url}")
            else:
                print(f"  - [{ttype}] {name}")

    # Knowledge base
    kb = prompt_cfg.get("knowledge_base", [])
    if kb:
        print(f"\nKnowledge base ({len(kb)} items):")
        for item in kb:
            print(f"  - {item.get('name', '?')} ({item.get('type', '?')})")

    # TTS
    tts = conv.get("tts", {})
    voice_id = tts.get("voice_id", "?")
    print(f"\nVoice ID: {voice_id}")


def cmd_prompt(agent_id):
    """Mostra system prompt."""
    a = _request("GET", f"/v1/convai/agents/{agent_id}")
    conv = a.get("conversation_config", {})
    agent_info = conv.get("agent", {})
    prompt_cfg = agent_info.get("prompt", {})
    prompt = prompt_cfg.get("prompt", "")
    print(f"=== {a.get('name', '?')} - System Prompt ===")
    print(f"Tamanho: {len(prompt)} chars\n")
    sys.stdout.buffer.write(prompt.encode("utf-8", errors="replace"))
    sys.stdout.buffer.write(b"\n")


def cmd_update_prompt(agent_id, prompt_file):
    """Atualiza system prompt."""
    with open(prompt_file, "r", encoding="utf-8") as f:
        new_prompt = f.read().strip()

    print(f"Novo prompt: {len(new_prompt)} chars")

    # Get current agent config
    a = _request("GET", f"/v1/convai/agents/{agent_id}")

    # Update prompt
    conv = a.get("conversation_config", {})
    conv.setdefault("agent", {}).setdefault("prompt", {})["prompt"] = new_prompt

    # PATCH agent
    result = _request("PATCH", f"/v1/convai/agents/{agent_id}", {
        "conversation_config": conv
    })
    print(f"Atualizado! Agent: {result.get('name', '?')}")


def cmd_tools(agent_id):
    """Lista tools do agente."""
    a = _request("GET", f"/v1/convai/agents/{agent_id}")
    conv = a.get("conversation_config", {})
    tools = conv.get("agent", {}).get("prompt", {}).get("tools", [])

    if not tools:
        print("Nenhuma tool configurada.")
        return

    print(f"=== Tools de {a.get('name', '?')} ({len(tools)}) ===\n")
    for i, t in enumerate(tools, 1):
        ttype = t.get("type", "?")
        name = t.get("name", "?")
        desc = t.get("description", "")
        print(f"{i}. [{ttype}] {name}")
        if desc:
            print(f"   Descricao: {desc[:200]}")
        if ttype == "webhook":
            schema = t.get("api_schema", {})
            print(f"   URL: {schema.get('url', '?')}")
            print(f"   Method: {schema.get('method', '?')}")
            props = schema.get("request_body", {}).get("properties", {})
            if props:
                print(f"   Params: {', '.join(props.keys())}")
        print()


def cmd_knowledge(agent_id):
    """Lista knowledge base."""
    a = _request("GET", f"/v1/convai/agents/{agent_id}")
    conv = a.get("conversation_config", {})
    kb = conv.get("agent", {}).get("prompt", {}).get("knowledge_base", [])

    if not kb:
        print("Nenhum item na knowledge base.")
        return

    print(f"=== Knowledge Base ({len(kb)} items) ===\n")
    for item in kb:
        print(f"  - {item.get('name', '?')} (type: {item.get('type', '?')}, id: {item.get('id', '?')})")


def cmd_conversations(agent_id):
    """Lista conversas recentes."""
    result = _request("GET", f"/v1/convai/agents/{agent_id}/conversations?page_size=20")
    convs = result.get("conversations", [])
    if not convs:
        print("Nenhuma conversa encontrada.")
        return
    print(f"{'ID':>30} | {'Status':10s} | {'Duracao':8s} | Inicio")
    print("-" * 90)
    for c in convs:
        cid = c.get("conversation_id", "?")
        status = c.get("status", "?")
        duration = c.get("call_duration_secs", "?")
        started = c.get("start_time_unix_secs", "?")
        print(f"{cid:>30} | {status:10s} | {str(duration):8s} | {started}")


def cmd_conversation(conv_id):
    """Detalhes de uma conversa."""
    c = _request("GET", f"/v1/convai/conversations/{conv_id}")
    print(f"ID: {c.get('conversation_id', '?')}")
    print(f"Agent: {c.get('agent_id', '?')}")
    print(f"Status: {c.get('status', '?')}")
    print(f"Duracao: {c.get('call_duration_secs', '?')}s")

    # Transcript
    transcript = c.get("transcript", [])
    if transcript:
        print(f"\n=== Transcript ({len(transcript)} msgs) ===")
        for msg in transcript:
            role = msg.get("role", "?")
            text = msg.get("message", "")
            print(f"  [{role}] {text[:200]}")

    # Data collected
    data = c.get("collected_data", {})
    if data:
        print(f"\n=== Dados coletados ===")
        print(json.dumps(data, indent=2, ensure_ascii=False))


def main():
    if not ELEVENLABS_API_KEY:
        print("[ERROR] ELEVENLABS_API_KEY nao configurada.", file=sys.stderr)
        sys.exit(1)

    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1]
    args = sys.argv[2:]

    commands = {
        "agents": (cmd_agents, 0),
        "agent": (cmd_agent, 1),
        "prompt": (cmd_prompt, 1),
        "update-prompt": (cmd_update_prompt, 2),
        "tools": (cmd_tools, 1),
        "knowledge": (cmd_knowledge, 1),
        "conversations": (cmd_conversations, 1),
        "conversation": (cmd_conversation, 1),
    }

    if cmd not in commands:
        print(f"[ERROR] Comando desconhecido: {cmd}", file=sys.stderr)
        print(__doc__)
        sys.exit(1)

    func, nargs = commands[cmd]
    if len(args) < nargs:
        print(f"[ERROR] {cmd} requer {nargs} argumento(s)", file=sys.stderr)
        sys.exit(1)

    func(*args[:nargs])


if __name__ == "__main__":
    main()
