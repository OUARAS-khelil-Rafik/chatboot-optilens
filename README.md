# OptiLens Chatboot

Chatbot “opticien” spécialisé dans les verres optiques (indices 1.50 / 1.56 / 1.60 / 1.67 / 1.74, traitements AR/BlueCut/Photo/Durci/Hydrophobe), avec recommandations à partir d’une prescription (SPH/CYL/AXE), recherche catalogue (RAG léger) et historique de chats persistant.

Objectif principal : fonctionner **on‑prem / local-first**. Par défaut, le LLM tourne en local via **Ollama** (aucune API cloud requise).

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Stack](#stack)
- [Démarrage rapide](#démarrage-rapide)
- [Configuration (env vars)](#configuration-env-vars)
- [Base de données (Prisma)](#base-de-données-prisma)
- [Providers LLM](#providers-llm)
- [API](#api)
- [Scripts utiles](#scripts-utiles)
- [Intégration (iframe)](#intégration-iframe)
- [Où modifier quoi](#où-modifier-quoi)
- [Training & évaluation](#training--évaluation)
- [Troubleshooting](#troubleshooting)

## Fonctionnalités

- Multilingue : FR / EN / AR / Darija (règle stricte “répondre dans la langue de l’utilisateur”).
- Chat persistant : sessions + messages sauvegardés en base (reprendre/renommer/supprimer).
- Recommandation verres : parsing prescription (SPH/CYL/AXE) + suggestion indice/traitements.
- Catalogue en base : RAG léger (prix/stock seulement si explicitement demandé).
- LLM local via Ollama (par défaut), ou endpoint OpenAI-compatible (vLLM, etc.).

## Stack

- Next.js (App Router)
- Prisma + SQLite (par défaut)
- Ollama (par défaut) / OpenAI-compatible (optionnel)
- React + Tailwind

## Démarrage rapide

### Prérequis

- Node.js 18+
- Ollama installé et lancé

### Installer

```bash
npm install
```

### Configurer (optionnel)

Ce projet supporte `.env.local` et `.env`.

```bash
cp .env.example .env.local
```

### Initialiser la base

Par défaut : SQLite locale dans `prisma/dev.db`.

```bash
npm run db:migrate
npm run db:seed
```

### Lancer un modèle local (Ollama)

Exemple (modèle multilingue) :

```bash
ollama pull qwen2.5:7b-instruct
```

### Démarrer l’app

```bash
npm run dev
```

Ouvrir : <http://localhost:3000>

## Configuration (env vars)

Les valeurs ci-dessous sont documentées dans `.env.example`.

| Variable | Par défaut | Description |
| --- | --- | --- |
| `DATABASE_URL` | auto (SQLite) | URL Prisma (SQLite/Postgres/MySQL…). Les `file:` SQLite sont normalisées en chemin absolu en runtime. |
| `LLM_PROVIDER` | `ollama` | Provider : `ollama` ou `openai-compat`. |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Base URL Ollama. |
| `OLLAMA_MODEL` | `qwen2.5:7b-instruct` | Nom du modèle Ollama. |
| `OPENAI_COMPAT_BASE_URL` | `http://127.0.0.1:8000` | Base URL d’un serveur OpenAI-compatible (ex: vLLM). Accepte `http://host:8000` ou `http://host:8000/v1`. |
| `OPENAI_COMPAT_MODEL` | (requis si `openai-compat`) | Nom du modèle côté serveur (ex: `Qwen/Qwen2.5-7B-Instruct`). |
| `OPENAI_COMPAT_API_KEY` | (optionnel) | Token si ton endpoint OpenAI-compatible le requiert. |

## Base de données (Prisma)

- Schéma Prisma : `prisma/schema.prisma`
- Seed d’exemple : `prisma/seed.ts`

Commandes :

```bash
npm run db:migrate
npm run db:seed
npm run db:studio
```

Pour brancher ta vraie base :

1) Adapter `prisma/schema.prisma` (si nécessaire)
2) Mettre `DATABASE_URL` dans `.env.local`
3) Remplacer `prisma/seed.ts` par un import/ETL depuis ta source

## Providers LLM

### 1) Ollama (par défaut)

- Aucune clé API nécessaire.
- Variables : `OLLAMA_BASE_URL`, `OLLAMA_MODEL`

### 2) OpenAI-compatible (vLLM, etc.)

Utile si tu veux servir le modèle sur une machine Linux GPU et garder l’app web portable.

- `LLM_PROVIDER=openai-compat`
- `OPENAI_COMPAT_BASE_URL=http://YOUR_HOST:8000`
- `OPENAI_COMPAT_MODEL=...`

## API

Routes (App Router) :

- `POST /api/chat` : endpoint principal du chat (stream optionnel).
- `GET /api/chats` : liste des sessions.
- `POST /api/chats` : créer une session.
- `GET /api/chats/:chatId` : récupérer une session + messages.
- `PATCH /api/chats/:chatId` : renommer une session.
- `DELETE /api/chats/:chatId` : supprimer une session.
- `PATCH /api/chats/:chatId/messages/:messageId` : éditer un message.
- `DELETE /api/chats/:chatId/messages/:messageId` : supprimer un message.

## Scripts utiles

Dév/qualité :

```bash
npm run dev
npm run build
npm run start
npm run typecheck
npm run lint
```

Smoke tests :

```bash
npm run smoke
npm run smoke:stream
npm run smoke:compare
```

Dataset / training / éval :

```bash
npm run data:finetune
npm run data:finetune:prepare
npm run axolotl:config
npm run eval:prompts
npm run eval:language
```

Détails : `scripts/README.md`

## Intégration (iframe)

Option simple et robuste : iframe.

```html
<iframe
  src="https://TON-DOMAINE/?embed=1"
  style="width: 100%; height: 650px; border: 0;"
  loading="lazy"
></iframe>
```

Le mode `?embed=1` rend l’UI plus compacte.

## Où modifier quoi

- UI chat : `src/components/ChatUI.tsx`
- Endpoint chat : `src/app/api/chat/route.ts`
- Reco SPH/CYL : `src/lib/recommendation.ts`
- Recherche catalogue (RAG) : `src/lib/catalogSearch.ts`
- Providers LLM : `src/lib/ollama.ts` et `src/lib/openaiCompat.ts`
- DB : `src/lib/db.ts`

## Training & évaluation

Les dossiers `training/` et `training_data/` sont optionnels pour le dev.

- Guide général : `training/README.md`
- Runbook Qwen 7B local : `training/runbook-qwen7b-local.md`
- Éval langue : `training/eval/README.md`

## Troubleshooting

- Erreur DB (SQLite) : lance `npm run db:migrate` puis `npm run db:seed`.
- “Unable to open the database file” : vérifie `DATABASE_URL`. Le runtime normalise les chemins SQLite relatifs, mais un `file:` incorrect peut casser.
- Erreur Ollama : vérifie `OLLAMA_BASE_URL` et que le modèle est bien installé (`ollama list`).
- OpenAI-compatible : `OPENAI_COMPAT_MODEL` est requis si `LLM_PROVIDER=openai-compat`.
