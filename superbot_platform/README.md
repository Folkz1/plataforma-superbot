# SuperBot Platform 🤖

Plataforma de Agentes IA Multi-Canal com Google Gemini + ElevenLabs.

## 🚀 Features

- **Multi-Canal**: WhatsApp, Instagram, Messenger, Ligações
- **LLM Flexível**: Google Gemini (com suporte a OpenRouter)
- **RAG Nativo**: Gemini File Search para memória de documentos
- **TTS Premium**: ElevenLabs para respostas em áudio
- **Tools/Webhooks**: Integração com n8n para ações externas
- **API REST**: Gerenciamento completo via API

## 📦 Instalação

```bash
# Criar ambiente virtual
python -m venv venv
venv\Scripts\activate  # Windows
# source venv/bin/activate  # Linux/Mac

# Instalar dependências
pip install -r requirements.txt
```

## ⚙️ Configuração

1. Copie o `.env` e configure suas credenciais:

```bash
# As credenciais já estão configuradas no .env
# Verifique se estão corretas
```

2. Configure o banco de dados (opcional para MVP):

```bash
# Por enquanto, os dados ficam em memória
# Para produção, configure PostgreSQL
```

## 🏃 Executando

```bash
# Desenvolvimento
cd superbot_platform
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Ou diretamente
python -m app.main
```

Acesse: http://localhost:8000/docs para a documentação interativa.

## 📡 API Endpoints

### Agentes

| Método | Endpoint           | Descrição         |
| ------ | ------------------ | ----------------- |
| POST   | `/api/agents`      | Criar agente      |
| GET    | `/api/agents`      | Listar agentes    |
| GET    | `/api/agents/{id}` | Detalhe do agente |
| PUT    | `/api/agents/{id}` | Atualizar agente  |
| DELETE | `/api/agents/{id}` | Deletar agente    |

### Tools

| Método | Endpoint                           | Descrição      |
| ------ | ---------------------------------- | -------------- |
| POST   | `/api/agents/{id}/tools`           | Adicionar tool |
| GET    | `/api/agents/{id}/tools`           | Listar tools   |
| DELETE | `/api/agents/{id}/tools/{tool_id}` | Remover tool   |

### Canais

| Método | Endpoint                            | Descrição      |
| ------ | ----------------------------------- | -------------- |
| POST   | `/api/agents/{id}/channels`         | Conectar canal |
| GET    | `/api/agents/{id}/channels`         | Listar canais  |
| DELETE | `/api/agents/{id}/channels/{ch_id}` | Desconectar    |

### RAG (Memória)

| Método | Endpoint                           | Descrição        |
| ------ | ---------------------------------- | ---------------- |
| POST   | `/api/agents/{id}/rag/setup`       | Configurar RAG   |
| POST   | `/api/agents/{id}/rag/upload`      | Upload documento |
| POST   | `/api/agents/{id}/rag/upload-text` | Upload texto     |
| POST   | `/api/agents/{id}/rag/query`       | Testar query     |

### Chat

| Método | Endpoint                | Descrição           |
| ------ | ----------------------- | ------------------- |
| POST   | `/api/agents/{id}/chat` | Chat direto (teste) |

### Vozes

| Método | Endpoint            | Descrição               |
| ------ | ------------------- | ----------------------- |
| GET    | `/api/voices`       | Listar vozes ElevenLabs |
| POST   | `/api/voices/clone` | Clonar voz              |

### Webhooks

| Método   | Endpoint        | Descrição                            |
| -------- | --------------- | ------------------------------------ |
| GET/POST | `/webhook/meta` | Webhook Meta (WhatsApp/IG/Messenger) |

### Importação

| Método | Endpoint                   | Descrição             |
| ------ | -------------------------- | --------------------- |
| POST   | `/api/import/pacific-surf` | Importar Pacific Surf |

## 📝 Exemplo de Uso

### Criar um Agente

```bash
curl -X POST http://localhost:8000/api/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Meu Assistente",
    "system_prompt": "Você é um assistente prestativo...",
    "llm_model": "gemini-2.0-flash"
  }'
```

### Adicionar uma Tool

```bash
curl -X POST http://localhost:8000/api/agents/{agent_id}/tools \
  -H "Content-Type: application/json" \
  -d '{
    "name": "buscar_produto",
    "description": "Busca informações de um produto pelo código",
    "webhook_url": "https://seu-n8n.com/webhook/buscar-produto",
    "parameters": [
      {"name": "codigo", "type": "string", "required": true}
    ]
  }'
```

### Fazer Upload de Documento RAG

```bash
curl -X POST http://localhost:8000/api/agents/{agent_id}/rag/upload \
  -F "file=@documento.pdf" \
  -F "display_name=Manual do Produto"
```

### Testar Chat

```bash
curl -X POST http://localhost:8000/api/agents/{agent_id}/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Quais são os horários disponíveis?"}'
```

## 🔗 Integração com n8n

As tools são executadas via webhooks. Configure seus workflows no n8n:

1. Crie um webhook trigger no n8n
2. Adicione a URL do webhook como tool no agente
3. O agente chamará automaticamente quando necessário

Exemplo de resposta esperada da tool:

```json
{
  "status": 200,
  "data": {
    "horarios_disponiveis": ["09:00", "10:45", "13:00"]
  }
}
```

## 🎯 Importar Pacific Surf

Para importar a configuração existente do Pacific Surf:

```bash
curl -X POST http://localhost:8000/api/import/pacific-surf
```

Isso irá:

1. Criar agente com o system prompt do `system.md`
2. Configurar RAG com o conteúdo do `memoria_rag.md`
3. Adicionar todas as tools (search_booking, reschedule, cancel, etc.)

## 🔐 Credenciais Configuradas

| Serviço       | Status         |
| ------------- | -------------- |
| Google Gemini | ✅ Configurado |
| ElevenLabs    | ✅ Configurado |
| OpenRouter    | ✅ Configurado |
| Meta Token    | ✅ Configurado |

## 📁 Estrutura do Projeto

```
superbot_platform/
├── app/
│   ├── main.py              # API FastAPI
│   ├── config.py            # Configurações
│   ├── core/
│   │   ├── agent_manager.py # Gerenciador de agentes
│   │   └── channel_router.py # Router multi-canal
│   ├── integrations/
│   │   ├── gemini.py        # Cliente Gemini + RAG
│   │   └── elevenlabs.py    # Cliente ElevenLabs
│   ├── api/
│   │   ├── routes/
│   │   └── schemas/
│   └── db/
├── requirements.txt
├── .env
└── README.md
```

## 🚧 TODO

- [ ] Persistência em banco de dados (PostgreSQL)
- [ ] Dashboard web
- [ ] Autenticação/Autorização
- [ ] Logs e métricas
- [ ] Transcrição de áudio (Whisper)
- [ ] Ligações telefônicas (Twilio)

## 📄 Licença

Projeto interno - SuperBot Digital
