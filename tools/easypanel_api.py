#!/usr/bin/env python3
"""
SuperBot - EasyPanel API Tool
Gerencia containers e deploy no EasyPanel.
Uso: python tools/easypanel_api.py <comando> [args]

Comandos:
  status                  Status de todos os servicos
  services                Lista servicos do projeto
  redeploy <service>      Faz redeploy de um servico
  logs <service>          Ultimas linhas de log
  env <service>           Lista env vars de um servico
  domains <service>       Lista dominios configurados

Requer: EASYPANEL_URL e EASYPANEL_API_KEY no .env ou ambiente.
EasyPanel URL padrao: https://72.60.13.22:3000 (ou via painel web)
"""
import json
import os
import sys
import urllib.request
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


def _request(method, path, data=None):
    """Request para EasyPanel API."""
    url = f"{EASYPANEL_URL}{path}"
    headers = {
        "Authorization": f"Bearer {EASYPANEL_API_KEY}",
        "Content-Type": "application/json",
    }
    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    # EasyPanel often uses self-signed certs
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        print(f"[ERROR] HTTP {e.code}: {error_body[:500]}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        sys.exit(1)


def cmd_status():
    """Status de todos servicos."""
    if not EASYPANEL_URL:
        print("[INFO] EASYPANEL_URL nao configurada no .env")
        print("[INFO] Para configurar, adicione ao .env:")
        print("  EASYPANEL_URL=https://72.60.13.22:3000")
        print("  EASYPANEL_API_KEY=<seu_token>")
        print("")
        print("Alternativa: acessar via web https://72.60.13.22:3000")
        print(f"Projeto: {EASYPANEL_PROJECT}")
        return

    result = _request("GET", f"/api/projects/{EASYPANEL_PROJECT}/services")
    services = result.get("services", result if isinstance(result, list) else [])
    print(f"{'Servico':30s} | {'Status':10s} | {'Tipo':10s} | Dominio")
    print("-" * 90)
    for s in services:
        name = s.get("name", "?")
        status = s.get("status", "?")
        stype = s.get("type", "?")
        domains = ", ".join(d.get("host", "") for d in s.get("domains", []))
        print(f"{name:30s} | {status:10s} | {stype:10s} | {domains}")


def cmd_services():
    """Lista servicos com detalhes."""
    cmd_status()  # Same output for now


def cmd_redeploy(service):
    """Redeploy de um servico."""
    if not EASYPANEL_URL:
        print(f"[INFO] Para redeploy manual do '{service}':")
        print(f"  1. Acesse https://72.60.13.22:3000")
        print(f"  2. Projeto: {EASYPANEL_PROJECT}")
        print(f"  3. Servico: {service}")
        print(f"  4. Clique em 'Rebuild' ou 'Deploy'")
        return

    result = _request("POST", f"/api/projects/{EASYPANEL_PROJECT}/services/{service}/deploy")
    print(f"Redeploy iniciado para '{service}'!")
    print(json.dumps(result, indent=2))


def cmd_logs(service):
    """Logs de um servico."""
    if not EASYPANEL_URL:
        print(f"[INFO] EASYPANEL_URL nao configurada.")
        print(f"Para ver logs via docker (se tiver acesso SSH):")
        print(f"  ssh root@72.60.13.22 docker logs --tail 50 {EASYPANEL_PROJECT}-{service}")
        return

    result = _request("GET", f"/api/projects/{EASYPANEL_PROJECT}/services/{service}/logs?lines=50")
    logs = result.get("logs", result if isinstance(result, str) else str(result))
    print(logs)


def cmd_env(service):
    """Env vars de um servico."""
    if not EASYPANEL_URL:
        print(f"[INFO] EASYPANEL_URL nao configurada.")
        print(f"Acesse https://72.60.13.22:3000 > {EASYPANEL_PROJECT} > {service} > Environment")
        return

    result = _request("GET", f"/api/projects/{EASYPANEL_PROJECT}/services/{service}/env")
    envs = result.get("env", result if isinstance(result, dict) else {})
    for k, v in envs.items():
        # Mask sensitive values
        if any(s in k.lower() for s in ["key", "secret", "token", "password"]):
            print(f"{k}=****{v[-4:]}" if len(str(v)) > 4 else f"{k}=****")
        else:
            print(f"{k}={v}")


def cmd_domains(service):
    """Dominios de um servico."""
    if not EASYPANEL_URL:
        print(f"[INFO] Dominios conhecidos:")
        print(f"  ai.superbot.digital -> N8N (porta 5678)")
        print(f"  app.superbot.digital -> Next.js Dashboard")
        print(f"  API FastAPI -> precisa configurar dominio/porta")
        print(f"\nPara configurar: https://72.60.13.22:3000 > {EASYPANEL_PROJECT} > {service} > Domains")
        return

    result = _request("GET", f"/api/projects/{EASYPANEL_PROJECT}/services/{service}")
    domains = result.get("domains", [])
    for d in domains:
        print(f"  {d.get('host', '?')} -> porta {d.get('port', '?')}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1]
    args = sys.argv[2:]

    commands = {
        "status": (cmd_status, 0),
        "services": (cmd_services, 0),
        "redeploy": (cmd_redeploy, 1),
        "logs": (cmd_logs, 1),
        "env": (cmd_env, 1),
        "domains": (cmd_domains, 1),
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
