#!/usr/bin/env python3
"""
SuperBot - EasyPanel API Tool (tRPC)
Gerencia containers e deploy no EasyPanel via tRPC API.
Uso: python tools/easypanel_api.py <comando> [args]

Comandos:
  status                  Status de todos os servicos
  inspect <service>       Detalhes completos de um servico
  deploy <service>        Faz deploy/redeploy de um servico
  logs <service>          Ultimas linhas de log
  env <service>           Lista env vars de um servico
  projects                Lista todos projetos

Servicos conhecidos: plataforma-superbot, frontend-superbot
Requer: EASYPANEL_URL e EASYPANEL_API_KEY no .env ou ambiente.
"""
import json
import os
import sys
import urllib.request
import urllib.parse
import ssl
from pathlib import Path

# Config
EASYPANEL_URL = os.environ.get("EASYPANEL_URL", "")
EASYPANEL_API_KEY = os.environ.get("EASYPANEL_API_KEY", "")
EASYPANEL_PROJECT = os.environ.get("EASYPANEL_PROJECT", "aplicativos")

# Try loading from .env
env_path = Path(__file__).parent.parent / "superbot_platform" / ".env"
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if line.startswith("EASYPANEL_URL=") and not EASYPANEL_URL:
            EASYPANEL_URL = line.split("=", 1)[1].strip()
        elif line.startswith("EASYPANEL_API_KEY=") and not EASYPANEL_API_KEY:
            EASYPANEL_API_KEY = line.split("=", 1)[1].strip()
        elif line.startswith("EASYPANEL_PROJECT="):
            EASYPANEL_PROJECT = line.split("=", 1)[1].strip()


def _trpc_get(procedure, input_data=None):
    """GET request para EasyPanel tRPC API."""
    url = f"{EASYPANEL_URL}/api/trpc/{procedure}"
    if input_data:
        url += "?input=" + urllib.parse.quote(json.dumps({"json": input_data}))
    headers = {
        "Authorization": f"Bearer {EASYPANEL_API_KEY}",
        "Content-Type": "application/json",
    }
    req = urllib.request.Request(url, method="GET", headers=headers)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("result", {}).get("data", {}).get("json", data)
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        print(f"[ERROR] HTTP {e.code}: {error_body[:500]}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        sys.exit(1)


def _trpc_post(procedure, input_data):
    """POST request para EasyPanel tRPC API."""
    url = f"{EASYPANEL_URL}/api/trpc/{procedure}"
    headers = {
        "Authorization": f"Bearer {EASYPANEL_API_KEY}",
        "Content-Type": "application/json",
    }
    body = json.dumps({"json": input_data}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("result", {}).get("data", {}).get("json", data)
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        print(f"[ERROR] HTTP {e.code}: {error_body[:500]}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        sys.exit(1)


def cmd_status():
    """Status de todos servicos do projeto."""
    result = _trpc_get("projects.listProjectsAndServices")
    projects = result.get("projects", [])
    services = result.get("services", [])

    print(f"=== Projetos ({len(projects)}) ===")
    for p in projects:
        print(f"  {p['name']} (criado: {p.get('createdAt', '?')[:10]})")

    # Filter services for our project
    proj_services = [s for s in services if s.get("projectName") == EASYPANEL_PROJECT]
    print(f"\n=== Servicos de '{EASYPANEL_PROJECT}' ({len(proj_services)}) ===")
    print(f"{'Nome':30s} | {'Tipo':10s} | {'Enabled':8s} | Imagem/Source")
    print("-" * 95)
    for s in proj_services:
        name = s.get("name", "?")
        stype = s.get("type", "?")
        enabled = "SIM" if s.get("enabled") else "NAO"
        source = s.get("source", {})
        if source.get("type") == "image":
            src_info = source.get("image", "?")
        elif source.get("type") == "github":
            src_info = f"{source.get('owner', '?')}/{source.get('repo', '?')}:{source.get('ref', '?')}"
        else:
            src_info = source.get("type", "?")
        print(f"{name:30s} | {stype:10s} | {enabled:8s} | {src_info}")


def cmd_inspect(service):
    """Detalhes completos de um servico."""
    result = _trpc_get("services.app.inspectService", {
        "projectName": EASYPANEL_PROJECT,
        "serviceName": service,
    })

    print(f"=== {service} ===")
    print(f"Tipo: {result.get('type', '?')}")
    print(f"Enabled: {result.get('enabled', '?')}")

    # Source
    source = result.get("source", {})
    print(f"\nSource: {source.get('type', '?')}")
    if source.get("type") == "image":
        print(f"  Image: {source.get('image', '?')}")
    elif source.get("type") == "github":
        print(f"  Repo: {source.get('owner', '?')}/{source.get('repo', '?')}")
        print(f"  Branch: {source.get('ref', '?')}")

    # Deploy info
    deploy = result.get("deploy", {})
    if deploy:
        print(f"\nDeploy:")
        print(f"  Replicas: {deploy.get('replicas', '?')}")
        print(f"  Zero downtime: {deploy.get('zeroDowntime', '?')}")

    # Commit
    commit = result.get("commit", {})
    if commit:
        sha = commit.get("sha", "?")[:12]
        msg = commit.get("commit", {}).get("message", "?")[:80]
        print(f"\nUltimo commit: {sha}")
        print(f"  Msg: {msg}")

    # Deploy URL
    deploy_url = result.get("deploymentUrl", "")
    if deploy_url:
        print(f"\nDeploy URL: {deploy_url}")

    # Token
    token = result.get("token", "")
    if token:
        print(f"Token: {token[:8]}...{token[-4:]}")

    # Env
    env_str = result.get("env", "")
    if env_str:
        env_lines = env_str.strip().split("\n")
        print(f"\nEnv vars ({len(env_lines)}):")
        for line in env_lines:
            if "=" in line:
                k, v = line.split("=", 1)
                if any(s in k.lower() for s in ["key", "secret", "token", "password"]):
                    print(f"  {k}=****{v[-4:]}" if len(v) > 4 else f"  {k}=****")
                else:
                    print(f"  {k}={v[:80]}")


def cmd_deploy(service):
    """Deploy/redeploy de um servico."""
    print(f"Disparando deploy de '{service}'...")
    result = _trpc_post("services.app.deployService", {
        "projectName": EASYPANEL_PROJECT,
        "serviceName": service,
    })
    print(f"Deploy disparado com sucesso!")
    if result:
        print(json.dumps(result, indent=2)[:500])


def cmd_logs(service):
    """Logs de um servico."""
    result = _trpc_get("logs.getServiceLogs", {
        "projectName": EASYPANEL_PROJECT,
        "serviceName": service,
    })
    if isinstance(result, str):
        print(result)
    elif isinstance(result, dict):
        logs = result.get("logs", result)
        if isinstance(logs, list):
            for line in logs:
                print(line)
        else:
            print(logs)
    else:
        print(json.dumps(result, indent=2)[:3000])


def cmd_env(service):
    """Env vars de um servico."""
    result = _trpc_get("services.app.inspectService", {
        "projectName": EASYPANEL_PROJECT,
        "serviceName": service,
    })
    env_str = result.get("env", "")
    if not env_str:
        print("Nenhuma env var configurada.")
        return

    print(f"=== Env vars de {service} ===\n")
    for line in env_str.strip().split("\n"):
        if "=" in line:
            k, v = line.split("=", 1)
            if any(s in k.lower() for s in ["key", "secret", "token", "password"]):
                print(f"{k}=****{v[-4:]}" if len(v) > 4 else f"{k}=****")
            else:
                print(f"{k}={v}")


def cmd_projects():
    """Lista todos projetos."""
    result = _trpc_get("projects.listProjectsAndServices")
    projects = result.get("projects", [])
    services = result.get("services", [])

    for p in projects:
        pname = p["name"]
        proj_svcs = [s for s in services if s.get("projectName") == pname]
        print(f"\n=== {pname} ({len(proj_svcs)} servicos) ===")
        for s in proj_svcs:
            enabled = "ON" if s.get("enabled") else "OFF"
            print(f"  [{enabled}] {s.get('name', '?')} ({s.get('type', '?')})")


def main():
    if not EASYPANEL_URL or not EASYPANEL_API_KEY:
        print("[ERROR] EASYPANEL_URL e EASYPANEL_API_KEY necessarios.", file=sys.stderr)
        print("Configure no .env ou como variavel de ambiente.")
        sys.exit(1)

    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1]
    args = sys.argv[2:]

    commands = {
        "status": (cmd_status, 0),
        "inspect": (cmd_inspect, 1),
        "deploy": (cmd_deploy, 1),
        "logs": (cmd_logs, 1),
        "env": (cmd_env, 1),
        "projects": (cmd_projects, 0),
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
