#!/usr/bin/env python3
"""
SuperBot - N8N API Tool
Gerencia workflows N8N via API REST.
Uso: python tools/n8n_api.py <comando> [args]

Comandos:
  list                      Lista todos workflows
  get <workflow_id>          Detalhes de um workflow
  prompt <workflow_id>       Mostra system prompt do agente
  update-prompt <wf_id> <file>  Atualiza system prompt de arquivo
  nodes <workflow_id>        Lista nodes de um workflow
  activate <workflow_id>     Ativa workflow
  deactivate <workflow_id>   Desativa workflow
  backup <workflow_id>       Salva backup JSON do workflow
  executions <workflow_id>   Lista execucoes recentes
"""
import json
import os
import sys
import urllib.request
import ssl
from pathlib import Path

# Config
N8N_BASE_URL = os.environ.get("N8N_BASE_URL", "https://ai.superbot.digital")
N8N_API_KEY = os.environ.get("N8N_API_KEY", "")

# Try loading from .env if not in environment
if not N8N_API_KEY:
    env_path = Path(__file__).parent.parent / "superbot_platform" / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("N8N_API_KEY="):
                N8N_API_KEY = line.split("=", 1)[1].strip()
            elif line.startswith("N8N_BASE_URL=") and not os.environ.get("N8N_BASE_URL"):
                N8N_BASE_URL = line.split("=", 1)[1].strip()


def _request(method, path, data=None):
    """Faz request para N8N API."""
    url = f"{N8N_BASE_URL}/api/v1{path}"
    headers = {
        "X-N8N-API-KEY": N8N_API_KEY,
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


def _clean_nodes(nodes):
    """Remove campos extras dos nodes para PUT."""
    allowed = {
        "id", "name", "type", "typeVersion", "position", "parameters",
        "credentials", "disabled", "notes", "notesInFlow", "webhookId",
        "onError", "continueOnFail", "retryOnFail", "maxTries",
        "waitBetweenTries", "alwaysOutputData", "executeOnce",
    }
    return [{k: v for k, v in n.items() if k in allowed} for n in nodes]


def cmd_list():
    """Lista todos workflows."""
    result = _request("GET", "/workflows?limit=100")
    workflows = result.get("data", [])
    print(f"{'ID':>20} | {'Nome':50s} | {'Ativo':6s} | Tags")
    print("-" * 100)
    for w in workflows:
        tags = ", ".join(t.get("name", "") for t in w.get("tags", []))
        status = "SIM" if w.get("active") else "nao"
        print(f"{w['id']:>20} | {w['name']:50s} | {status:6s} | {tags}")
    print(f"\nTotal: {len(workflows)} workflows")


def cmd_get(workflow_id):
    """Detalhes de um workflow."""
    wf = _request("GET", f"/workflows/{workflow_id}")
    print(f"Nome: {wf['name']}")
    print(f"ID: {wf['id']}")
    print(f"Ativo: {wf.get('active', False)}")
    print(f"Criado: {wf.get('createdAt', '?')}")
    print(f"Atualizado: {wf.get('updatedAt', '?')}")
    print(f"Nodes ({len(wf.get('nodes', []))}):")
    for n in wf.get("nodes", []):
        ntype = n["type"].split(".")[-1]
        print(f"  - {n['name']} ({ntype})")


def cmd_prompt(workflow_id):
    """Mostra system prompt do agente."""
    wf = _request("GET", f"/workflows/{workflow_id}")
    for n in wf.get("nodes", []):
        sys_msg = n.get("parameters", {}).get("options", {}).get("systemMessage", "")
        if sys_msg and len(sys_msg) > 50:
            print(f"=== {n['name']} ===")
            print(f"Tamanho: {len(sys_msg)} chars")
            print()
            # Remove N8N expressions for readability
            clean = sys_msg
            for expr in ["={{ ", " }}="]:
                clean = clean.replace(expr, expr.replace("=", ""))
            print(clean)
            print()


def cmd_update_prompt(workflow_id, prompt_file):
    """Atualiza system prompt de um workflow a partir de arquivo."""
    # Read new prompt
    with open(prompt_file, "r", encoding="utf-8") as f:
        new_prompt = f.read().strip()

    print(f"Novo prompt: {len(new_prompt)} chars")

    # Get current workflow
    wf = _request("GET", f"/workflows/{workflow_id}")

    # Find and update agent node
    updated = False
    for node in wf["nodes"]:
        sys_msg = node.get("parameters", {}).get("options", {}).get("systemMessage", "")
        if sys_msg and len(sys_msg) > 50:
            node["parameters"]["options"]["systemMessage"] = new_prompt
            print(f"Atualizando node: {node['name']}")
            updated = True
            break

    if not updated:
        print("[ERROR] Nenhum node com systemMessage encontrado", file=sys.stderr)
        sys.exit(1)

    # Push update
    payload = {
        "name": wf["name"],
        "nodes": _clean_nodes(wf["nodes"]),
        "connections": wf["connections"],
        "settings": wf.get("settings", {}),
        "staticData": wf.get("staticData"),
    }
    result = _request("PUT", f"/workflows/{workflow_id}", payload)
    print(f"Atualizado! updatedAt: {result.get('updatedAt', '?')}")


def cmd_nodes(workflow_id):
    """Lista nodes com detalhes."""
    wf = _request("GET", f"/workflows/{workflow_id}")
    for n in wf.get("nodes", []):
        ntype = n["type"].split(".")[-1]
        params = n.get("parameters", {})
        print(f"\n--- {n['name']} ({ntype}) ---")
        # Show key parameters
        if "url" in params:
            print(f"  URL: {params['url']}")
        if "text" in params and isinstance(params["text"], str) and len(params["text"]) > 10:
            print(f"  Text: {params['text'][:200]}")
        if "systemMessage" in str(params):
            sys_msg = params.get("options", {}).get("systemMessage", "")
            print(f"  SystemMessage: {len(sys_msg)} chars")
        if "workflowId" in str(params):
            wid = params.get("workflowId", {})
            if isinstance(wid, dict):
                print(f"  Calls workflow: {wid.get('value', wid)}")
            else:
                print(f"  Calls workflow: {wid}")


def cmd_activate(workflow_id):
    """Ativa um workflow."""
    result = _request("POST", f"/workflows/{workflow_id}/activate")
    print(f"Workflow {result.get('name', '?')} ativado!")
    print(f"Active: {result.get('active', '?')}")


def cmd_deactivate(workflow_id):
    """Desativa um workflow."""
    result = _request("POST", f"/workflows/{workflow_id}/deactivate")
    print(f"Workflow {result.get('name', '?')} desativado!")
    print(f"Active: {result.get('active', '?')}")


def cmd_backup(workflow_id):
    """Salva backup do workflow."""
    wf = _request("GET", f"/workflows/{workflow_id}")
    name = wf.get("name", workflow_id).replace(" ", "_").lower()
    backup_dir = Path(__file__).parent.parent / "superbot_configuracoes" / "n8n_backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    filepath = backup_dir / f"{name}_{workflow_id}.json"
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(wf, f, ensure_ascii=False, indent=2)
    print(f"Backup salvo: {filepath}")


def cmd_executions(workflow_id):
    """Lista execucoes recentes."""
    result = _request("GET", f"/executions?workflowId={workflow_id}&limit=10")
    execs = result.get("data", [])
    print(f"{'ID':>12} | {'Status':10s} | {'Inicio':25s} | {'Duracao':10s}")
    print("-" * 70)
    for ex in execs:
        status = "OK" if ex.get("finished") else "FAIL"
        if ex.get("stoppedAt") is None:
            status = "RUNNING"
        started = ex.get("startedAt", "?")[:25]
        print(f"{ex['id']:>12} | {status:10s} | {started:25s} |")


def main():
    if not N8N_API_KEY:
        print("[ERROR] N8N_API_KEY nao configurada. Set env ou .env", file=sys.stderr)
        sys.exit(1)

    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1]
    args = sys.argv[2:]

    commands = {
        "list": (cmd_list, 0),
        "get": (cmd_get, 1),
        "prompt": (cmd_prompt, 1),
        "update-prompt": (cmd_update_prompt, 2),
        "nodes": (cmd_nodes, 1),
        "activate": (cmd_activate, 1),
        "deactivate": (cmd_deactivate, 1),
        "backup": (cmd_backup, 1),
        "executions": (cmd_executions, 1),
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
