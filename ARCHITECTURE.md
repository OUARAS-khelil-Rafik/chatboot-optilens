# Architecture (OptiLens Chatboot)

## Vue d’ensemble

Application Next.js (App Router) avec une UI de chat persistante, une base SQLite via Prisma, et un LLM local (Ollama) par défaut.

- UI: `src/components/ChatUI.tsx`
- Page d’accueil: `src/app/page.tsx`
- API: `src/app/api/**/route.ts`
- DB: `prisma/schema.prisma` + `src/lib/db.ts`
- LLM: `src/lib/ollama.ts` (par défaut) ou `src/lib/openaiCompat.ts` (optionnel)

## Flux principal “chat”

1) L’utilisateur envoie un message depuis l’UI (`ChatUI`).
2) L’API `POST /api/chat`:
   - détecte la langue et construit un *system prompt* avec règle de langue stricte
   - parse une éventuelle prescription (SPH/CYL/AX)
   - calcule une recommandation simple (indice + traitements)
   - cherche un contexte de catalogue en DB (RAG léger)
   - appelle le provider LLM (Ollama / OpenAI-compatible)
   - persiste messages + met à jour un résumé et une mémoire légère
3) L’UI affiche la réponse et permet de reprendre/renommer/supprimer les chats.

## Base de données

- SQLite par défaut (`prisma/dev.db`).
- Schéma principal:
  - `ChatSession`, `ChatMessage` (historique)
  - `ChatMemory` (mémoire clé/valeur par scope)
  - `LensProduct`, `InventoryItem`, `Brand`, `Coating`… (catalogue)

Notes:
- `src/lib/db.ts` normalise `DATABASE_URL` pour éviter les chemins SQLite relatifs qui cassent en runtime.

## Providers LLM

- Ollama: `OLLAMA_BASE_URL`, `OLLAMA_MODEL`
- OpenAI-compatible: `LLM_PROVIDER=openai-compat`, `OPENAI_COMPAT_BASE_URL`, `OPENAI_COMPAT_MODEL`, `OPENAI_COMPAT_API_KEY` (optionnel)

## Dossiers “training”

`training/` et `training_data/` contiennent les scripts et artefacts pour fine-tuning/éval. Ils ne sont pas requis pour faire tourner l’app en dev.
