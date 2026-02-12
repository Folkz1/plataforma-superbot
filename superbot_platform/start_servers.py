"""
Script para iniciar Backend + Frontend do SuperBot Platform
Execute: python start_servers.py
"""
import subprocess
import sys
import time
import os
import urllib.request

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VENV_PYTHON = os.path.join(BASE_DIR, "venv", "Scripts", "python.exe")
VENV_UVICORN = os.path.join(BASE_DIR, "venv", "Scripts", "uvicorn.exe")
DASHBOARD_DIR = os.path.join(BASE_DIR, "dashboard")

def check_api():
    """Check if API is responding"""
    try:
        with urllib.request.urlopen('http://localhost:8000/', timeout=3) as r:
            return r.status == 200
    except:
        return False

def check_frontend():
    """Check if frontend is responding"""
    try:
        with urllib.request.urlopen('http://localhost:3000/', timeout=3) as r:
            return r.status == 200
    except:
        return False

def main():
    print("=" * 60)
    print("SuperBot Platform - Iniciando servidores")
    print("=" * 60)

    # Start backend
    print("\n[1/2] Iniciando Backend API (porta 8000)...")
    backend = subprocess.Popen(
        [VENV_UVICORN, "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"],
        cwd=BASE_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT
    )

    # Wait for backend
    for i in range(10):
        time.sleep(1)
        if check_api():
            print("   Backend OK!")
            break
        print(f"   Aguardando backend... ({i+1}s)")
    else:
        print("   ERRO: Backend nao iniciou!")
        backend.terminate()
        return 1

    # Start frontend
    print("\n[2/2] Iniciando Frontend Dashboard (porta 3000)...")
    frontend = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=DASHBOARD_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        shell=True
    )

    # Wait for frontend
    for i in range(15):
        time.sleep(1)
        if check_frontend():
            print("   Frontend OK!")
            break
        print(f"   Aguardando frontend... ({i+1}s)")
    else:
        print("   Aviso: Frontend pode demorar mais para iniciar")

    print("\n" + "=" * 60)
    print("PRONTO! Acesse:")
    print("  - API:       http://localhost:8000")
    print("  - Dashboard: http://localhost:3000")
    print("  - Login:     admin / admin123")
    print("=" * 60)
    print("\nPressione Ctrl+C para parar os servidores\n")

    try:
        # Keep running and show logs
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nEncerrando servidores...")
        backend.terminate()
        frontend.terminate()
        print("Finalizado!")

if __name__ == "__main__":
    sys.exit(main() or 0)
