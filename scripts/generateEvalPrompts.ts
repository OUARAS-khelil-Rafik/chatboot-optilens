import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

type PromptCase = {
  id: string;
  expectedLang: "fr" | "en" | "ar" | "dz";
  user: string;
};

function getArg(name: string): string | undefined {
  // Prefer the last occurrence so `npm run ... -- --flag X` overrides defaults baked into scripts.
  for (let i = process.argv.length - 2; i >= 0; i--) {
    if (process.argv[i] === `--${name}`) return process.argv[i + 1];
  }
  return undefined;
}

function getArgNumber(name: string, fallback: number): number {
  const v = getArg(name);
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

function formatSphCylAxis(i: number): { sph: string; cyl: string; axis: string } {
  // deterministic-ish values
  const sphVals = ["-0.50", "-1.00", "-1.50", "-2.00", "-2.50", "-3.00", "-4.00", "+1.00", "+2.00"];
  const cylVals = ["0.00", "-0.50", "-0.75", "-1.00", "-1.25", "-2.00"];
  const axisVals = ["5", "10", "25", "45", "70", "90", "110", "135", "160", "175"];

  const sph = pick(sphVals, i);
  const cyl = pick(cylVals, i + 3);
  const axis = pick(axisVals, i + 7);
  return { sph, cyl, axis };
}

function buildFrench(i: number): PromptCase {
  const { sph, cyl, axis } = formatSphCylAxis(i);
  const needs = [
    "je travaille sur écran toute la journée",
    "je conduis beaucoup la nuit",
    "je veux des verres photochromiques",
    "je veux un traitement hydrophobe",
    "je veux un bon antireflet",
    "j’ai un budget moyen",
    "je veux le meilleur confort",
  ];
  const questions = [
    `Bonjour, j’ai une ordonnance SPH ${sph} CYL ${cyl} AXE ${axis}. ${pick(needs, i)}. Tu me conseilles quoi ?`,
    `Salut, SPH ${sph} CYL ${cyl}. ${pick(needs, i + 1)}. Quels traitements tu recommandes ?`,
    `Je veux des verres progressifs. SPH ${sph} CYL ${cyl} AXE ${axis}. ${pick(needs, i + 2)}.`,
    `Est-ce que vous avez du BLUECUT et un antireflet ? SPH ${sph} CYL ${cyl}.`,
    `C’est combien le prix pour un verre avec antireflet + durci ? SPH ${sph} CYL ${cyl}.`,
    `C’est disponible en stock aujourd’hui ? Je cherche un verre photochromique.`,
  ];

  return {
    id: `fr-${pad2(i)}`,
    expectedLang: "fr",
    user: pick(questions, i),
  };
}

function buildEnglish(i: number): PromptCase {
  const { sph, cyl, axis } = formatSphCylAxis(i);
  const needs = [
    "I work on screens all day",
    "I drive at night",
    "I want photochromic lenses",
    "I want hydrophobic coating",
    "I want strong anti-reflective",
    "I have a medium budget",
  ];
  const questions = [
    `Hi, my prescription is SPH ${sph} CYL ${cyl} AXIS ${axis}. ${pick(needs, i)}. What do you recommend?`,
    `I need BLUECUT + anti-reflective. SPH ${sph} CYL ${cyl}.`,
    `Is it in stock right now? I'm looking for photochromic lenses.`,
    `What's the price for anti-reflective + hard coat lenses?`,
  ];

  return {
    id: `en-${pad2(i)}`,
    expectedLang: "en",
    user: pick(questions, i),
  };
}

function buildArabic(i: number): PromptCase {
  const { sph, cyl, axis } = formatSphCylAxis(i);
  const needs = [
    "نخدم بزاف قدام الشاشة",
    "نسوق بالليل بزاف",
    "نحب عدسات فوتوكروميك",
    "نحب مضاد للانعكاس قوي",
    "نحب طبقة هيدروفوب",
  ];
  const questions = [
    `سلام، عندي وصفة SPH ${sph} CYL ${cyl} محور ${axis}. ${pick(needs, i)}. واش تقترح؟`,
    `هل هذا متوفر في المحل الآن؟ أريد عدسات فوتوكروميك.`,
    `كم السعر لعدسة مع مضاد للانعكاس + طبقة قاسية؟`,
  ];

  return {
    id: `ar-${pad2(i)}`,
    expectedLang: "ar",
    user: pick(questions, i),
  };
}

function buildDarijaLatin(i: number): PromptCase {
  const { sph, cyl } = formatSphCylAxis(i);
  const needs = [
    "rani nkhdem bzzaf 3la pc",
    "nso9 bzzaf f lil",
    "n7eb photochromique",
    "n7eb anti-reflet mlih",
    "ch7al ydir price?",
    "wach kayen f stock?",
  ];
  const questions = [
    `wesh, SPH ${sph} CYL ${cyl}. ${pick(needs, i)}. chnou n9der ndiro?`,
    `sahbi n7eb verres bluecut + anti-reflet. SPH ${sph} CYL ${cyl}.`,
    `wach disponible fi lma7al?`,
  ];

  return {
    id: `dz-${pad2(i)}`,
    expectedLang: "dz",
    user: pick(questions, i),
  };
}

async function main() {
  const out = getArg("out") ?? "training_data/eval/prompts.jsonl";
  const total = getArgNumber("total", 0);
  const perLang = getArgNumber("perLang", 500);

  const outPath = path.resolve(process.cwd(), out);
  ensureDir(path.dirname(outPath));

  const stream = fs.createWriteStream(outPath, { encoding: "utf8" });

  const resolvedPerLang = total > 0 ? Math.floor(total / 4) : perLang;
  const remainder = total > 0 ? total - resolvedPerLang * 4 : 0;

  let written = 0;
  for (let i = 1; i <= resolvedPerLang; i++) {
    stream.write(JSON.stringify(buildFrench(i)) + "\n");
    stream.write(JSON.stringify(buildEnglish(i)) + "\n");
    stream.write(JSON.stringify(buildArabic(i)) + "\n");
    stream.write(JSON.stringify(buildDarijaLatin(i)) + "\n");
    written += 4;
  }

  if (remainder > 0) {
    const builders = [buildFrench, buildEnglish, buildArabic, buildDarijaLatin];
    for (let j = 0; j < remainder; j++) {
      const i = resolvedPerLang + 1 + j;
      const b = builders[j % builders.length];
      stream.write(JSON.stringify(b(i)) + "\n");
      written += 1;
    }
  }

  await new Promise<void>((resolve, reject) => {
    stream.end(() => resolve());
    stream.on("error", (e) => reject(e));
  });

  console.log(`Wrote ${written} prompts to ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
