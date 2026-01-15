# Scripts

Ces scripts servent surtout pour le fine-tuning / évaluation et des smoke tests.

## Dataset / training

- `exportFinetuneDataset.ts`
  - Exporte des conversations depuis la DB (sessions + messages) vers `training_data/optilens_chat.jsonl`.
  - Usage: `npm run data:finetune -- --out training_data/optilens_chat.jsonl`

- `prepareFinetuneDataset.ts`
  - Split + préparation (train/val) dans `training_data/prepared/`.
  - Usage: `npm run data:finetune:prepare`

- `generateAxolotlConfig.ts`
  - Génère une config Axolotl en fonction du dataset préparé.
  - Usage: `npm run axolotl:config`

## Évaluation

- `generateEvalPrompts.ts`
  - Génère des prompts d’éval dans `training_data/eval/`.
  - Usage: `npm run eval:prompts`

- `evalLanguageAdherence.ts`
  - Vérifie l’adhérence de langue (FR/EN/AR/DZ) sur un jeu de prompts.
  - Usage: `npm run eval:language`

## Smoke tests

- `smokeChat.ts`, `smokeChatStream.ts`
  - Tests rapides de l’endpoint chat.
  - Usage: `npm run smoke` / `npm run smoke:stream`

- `smokeCompareModels.ts`
  - Compare plusieurs modèles/providers sur un set de prompts.
  - Usage: `npm run smoke:compare`
