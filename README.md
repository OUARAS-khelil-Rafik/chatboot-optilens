# OptiLens Chatboot (multilangue, on‑prem)

Chatboot “opticien” spécialisé verres optiques (indices 1.5 / 1.56 / 1.6 / 1.67 / 1.74, traitements AR/BlueCut/Photo/Durci/Hydrophobe), avec recommandations par prescription (SPH/CYL) et réponses multilingues (FR/EN/AR/Darija).

Important: pas d’API cloud. Le LLM tourne **en local** via Ollama.

## Prérequis

- Node.js 18+
- Ollama installé et lancé

## Installation

```bash
npm install
```

## Base de données (catalogue + prix + disponibilité)

Par défaut: SQLite locale (fichier `prisma/dev.db`).

```bash
npm run db:migrate
npm run db:seed
```

Le schéma Prisma est dans prisma/schema.prisma.

## LLM local (Ollama)

1) Démarrer Ollama

2) Installer un modèle multilingue (exemple)

```bash
ollama pull qwen2.5:7b-instruct
```

1) (Optionnel) Variables d’environnement

- `OLLAMA_BASE_URL` (défaut `http://localhost:11434`)
- `OLLAMA_MODEL` (défaut `qwen2.5:7b-instruct`)

## Démarrer l’app

```bash
npm run dev
```

Puis ouvrir <http://localhost:3000>

## Intégration dans ton site web

Option simple et robuste: **iframe**.

```html
<iframe
  src="https://TON-DOMAINE/?embed=1"
  style="width: 100%; height: 650px; border: 0;"
  loading="lazy"
></iframe>
```

Le mode `?embed=1` rend l’UI plus compacte.

## Où modifier quoi

- UI chat: src/components/ChatUI.tsx
- Endpoint chat: src/app/api/chat/route.ts
- Reco SPH/CYL: src/lib/recommendation.ts
- Recherche catalogue (RAG): src/lib/catalogSearch.ts
- Appel LLM local: src/lib/ollama.ts

## Brancher ta vraie base de données

Aujourd’hui on seed une DB d’exemple. Pour utiliser **tes** prix/disponibilités:

1) Adapter prisma/schema.prisma (si nécessaire)
2) Changer `DATABASE_URL` dans .env (SQLite/PostgreSQL/MySQL…)
3) Remplacer prisma/seed.ts par un import depuis ta DB existante (ou écrire un script ETL)
