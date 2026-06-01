# Novel Buds

**An AI-powered workspace for planning, writing, and illustrating novels.**

![Python](https://img.shields.io/badge/Python-3.12+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18%20+%20pgvector-4169E1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

Novel Buds is a full-stack writing platform that combines **structured story management** (characters, locations, timelines, outlines) with **flexible, multi-provider AI generation** for prose, translation, and illustration. Every entity is multi-language aware, so a story can be planned, written, and localized in one place.

---

## Features

- **Story organization**: Projects group everything; basic info (title, logline, genres, tags), a drag-and-drop outline manager, and a rich-text novel editor with auto-save and versioning.
- **Story entities (cards)**: Characters, organizations, locations, and lore books, each with rich content, images, and per-language translations.
- **Timeline tool**: Customizable calendar units, multiple tracks, and dated events that link to story entities and manuscript chapters.
- **Image generation**: Multi-provider (OpenAI, Gemini, xAI, NovelAI, OpenRouter), per-object positive/negative prompt engineering, a review/approval workflow, and AVIF output.
- **Translation system**: Per-object, per-language versioning with coverage tracking and batch translation.
- **Tokenizer & normalization**: Token counting and text normalization for prompt-size optimization across providers.
- **Semantic search & memory**: pgvector embeddings power retrieval over story content.

### AI agents

The heart of Novel Buds is an agentic system that lets an LLM read and edit the entire project through a permissioned tool engine.

- **Two ways to run the model:**
  - **Journeys**: structured, goal-oriented tasks (manuscript generation, object creation, translation, and more) that carry explicit context (selected objects, targets, language) and can be started, canceled, and resumed.
  - **Agents**: named, persistent assistants for free-form, multi-turn chat against the project.
- **Tool engine**: Permissioned, category-gated (`read` / `write` / `delete` / `translate` / `generate`) modules give the model concrete actions over project data:
  - **Manuscript**: read, replace, and surgically patch chapter text (and translations).
  - **Story entities**: create / read / patch / delete characters, locations, factions, items, lore, and their folder hierarchy.
  - **Timeline**: create and edit tracks and dated events, with links and tags.
  - **Outline**: build and edit the outline/act/chapter structure.
  - **Project data**: update basic info (title, logline, genres, tags) and author guidelines.
  - **Search**: regex and semantic (vector) search across the project knowledge base.
  - **Project tree**: read the hierarchical project structure.
  - **Image**: generate object and inline scene images.
- **Human-in-the-loop tool calls**: Each tool call streams to the UI and can require user approval (accept/reject) before it mutates the project; calls progress through explicit states (pending, validating, applying, applied/rejected/failed).
- **Sub-agents**: Define specialized, named agents with their own prompts, model config, and granular tool grants, then let a parent agent or journey invoke them as tools (`call_<name>`) for nested orchestration.
- **MCP (Model Context Protocol)**: Register external MCP servers per preset; their tools are exposed dynamically to the agent alongside the built-in modules.
- **Streaming & reasoning**: Server-Sent-Events streaming with thinking/reasoning support (off / model-native / custom), effort levels from `minimal` through `xhigh` / `max`, and full LLM request logging.
- **Native tool-call fallback**: Models without native tool calling are supported via on-the-fly `<tool_call>` tag parsing, so the same agent flow works across providers.

- **Multi-provider LLM support**: Anthropic Claude, OpenAI, Google Gemini, xAI, OpenRouter, and Ollama Cloud, configurable per project, with thinking/reasoning modes and request logging.

---

## Tech stack

| Layer | Technologies |
|-------|--------------|
| **Backend** | Python 3.12+, FastAPI, SQLAlchemy + Alembic, PostgreSQL 18 + pgvector, JWT auth, Jinja2 prompt templating, Anthropic / OpenAI / Google GenAI SDKs |
| **Frontend** | React 19, TypeScript 5.8, Vite 7, React Router 7, Zustand, TipTap, CodeMirror, i18next, dnd-kit |
| **Infrastructure** | Docker Compose, Caddy 2 reverse proxy (TLS), S3 or local filesystem asset storage |

---

## Architecture

The application runs as five Docker Compose services behind a Caddy reverse proxy.

```
                         ┌──────────────────────────────┐
        Browser  ──────► │   caddy  (:80 / :443, TLS)   │
                         └───────────────┬──────────────┘
                          /api/* │        │ /* (app, /storage/assets/*)
                                 ▼        ▼
              ┌────────────────────┐   ┌────────────────────┐
              │ backend            │   │ frontend           │
              │ FastAPI  (:8000)   │   │ Vite preview(:5173)│
              └─────────┬──────────┘   └────────────────────┘
                        │
                        ▼
              ┌────────────────────┐        ┌────────────────────┐
              │ db                 │        │ usage-reconciler   │
              │ pgvector  (:5432)  │◄───────│ background worker   │
              └────────────────────┘        └────────────────────┘

   Assets: local filesystem (dev) or S3 (prod), served via /storage/assets/*
```

Key source locations:

- `App/backend/`: `routes/` (API endpoints), `services/` (business logic + tool engine), `providers/` (per-LLM integrations), `prompts/` (Jinja2 templates), `models/`, `alembic/`
- `App/frontend/src/`: `pages/`, `components/`, `store/` (Zustand), `api/`
- `docker/`: Dockerfiles and Caddy configs

---

## Getting started (Docker Compose)

**Prerequisites:** Docker and Docker Compose.

1. **Create the dev env file:**

   ```bash
   cp .env.dev.example .env.dev
   ```

2. **Fill in the required secrets** in `.env.dev`:

   - `POSTGRES_PASSWORD`: any strong value
   - `JWT_SECRET_KEY`, generate with:
     ```bash
     python -c "import secrets; print(secrets.token_urlsafe(32))"
     ```
   - `CREDENTIAL_ENCRYPTION_KEY`, generate with:
     ```bash
     python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
     ```
   - `DEMO_MODE_OPENROUTER_API_KEY`: an OpenRouter key (required for first-run guided/demo mode)

   Dev uses local asset storage by default, so S3 is **not** required.

3. **Start the stack:**

   ```bash
   docker compose --env-file .env.dev -f docker-compose.yml -f docker-compose.dev.yml up -d --build
   ```

4. **Open the app:**

   - Same machine: `https://novelbuds.localhost`
   - LAN / mobile: `https://<desktop-ip>.sslip.io`

   > `.localhost` resolves to the *client device*, so it won't work from other devices. Use the `sslip.io` form for LAN/mobile access.

The backend runs `alembic upgrade head` automatically on startup, so the database schema is created on first run.

For production deployment (VPS, Cloudflare Origin CA certificates, and TLS-cert trust details), see **[DOCKER.md](DOCKER.md)**.

---

## Running natively (optional)

Docker Compose is the recommended path. For a native dev setup on Windows you can use the helper scripts, which require a local PostgreSQL instance with the pgvector extension:

- `StartBackend.bat`: runs `uvicorn App.backend.main:app --reload --host 0.0.0.0 --port 8000`
- `StartFrontend.bat`: runs the Vite dev server

---

## Project layout

```
NovelGenerator/
├── App/
│   ├── backend/              # FastAPI backend (routes, services, providers, prompts, models)
│   └── frontend/             # React + TypeScript frontend (Vite)
├── docker/                   # Dockerfiles + Caddy configs (dev & prod)
├── docker-compose.yml        # Base compose (db, backend, usage-reconciler, frontend, caddy)
├── docker-compose.dev.yml    # Dev overrides (autoreload + bind mounts)
├── docker-compose.prod.yml   # Prod overrides
└── DOCKER.md                 # Deployment guide
```

---

## Status & license

Personal project, not currently licensed for reuse. All rights reserved.
