export type SupportedLanguage = "fr" | "en" | "ar" | "dz";

export type LanguageDetectionConfidence = "high" | "medium" | "low";

export type LanguageDetection = {
  lang: SupportedLanguage;
  confidence: LanguageDetectionConfidence;
};

const DARJA_HINTS = [
  "wesh",
  "wach",
  "sahbi",
  "sahbiya",
  "chhal",
  "ch7al",
  "bezzaf",
  "mlih",
  "mliha",
  "kifach",
  "win",
  "rani",
  "rak",
  "rana",
  "khoya",
  "khouya",
  "brk",
  "bzzf",
];

const FRENCH_HINT_WORDS = [
  // greetings / courtesy
  "bonjour",
  "salut",
  "bonsoir",
  "merci",
  "svp",
  "s'il",
  "sil",
  "vous",
  "stp",
  // common connectors
  "je",
  "tu",
  "il",
  "elle",
  "on",
  "nous",
  "vous",
  "ils",
  "elles",
  "mon",
  "ma",
  "mes",
  "ton",
  "ta",
  "tes",
  "notre",
  "votre",
  "pour",
  "avec",
  "sans",
  "dans",
  "sur",
  "chez",
  "de",
  "des",
  "du",
  "la",
  "le",
  "les",
  "un",
  "une",
  "et",
  "ou",
  "mais",
  "donc",
  "car",
  // optics-specific
  "verre",
  "verres",
  "lentille",
  "lentilles",
  "antireflet",
  "anti-reflet",
  "photochromique",
  "progressif",
  "progressifs",
  "traitement",
  "traitements",
  "monture",
  "ordonnance",
  "cyl",
  "sph",
  "axe",
];

const ENGLISH_HINT_WORDS = [
  "hello",
  "hi",
  "thanks",
  "please",
  "what",
  "how",
  "which",
  "price",
  "cost",
  "available",
  "availability",
  "in stock",
  "lens",
  "lenses",
  "coating",
  "coatings",
  "prescription",
  "progressive",
];

function countWordHits(lower: string, words: string[]): number {
  let hits = 0;
  for (const w of words) {
    if (!w) continue;
    // Prefer whole-word matching for short tokens; allow substring for longer domain terms.
    if (w.length <= 3) {
      const re = new RegExp(`(^|\\W)${w.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(\\W|$)`, "i");
      if (re.test(lower)) hits += 1;
    } else {
      if (lower.includes(w)) hits += 1;
    }
  }
  return hits;
}

export function detectLanguageInfo(text: string): LanguageDetection {
  const t = text.trim();
  if (!t) return { lang: "fr", confidence: "low" };

  // Arabic script
  if (/\p{Script=Arabic}/u.test(t)) {
    // Heuristic: many Darija messages are Arabic script too; keep "ar" for script.
    return { lang: "ar", confidence: "high" };
  }

  const lower = t.toLowerCase();
  if (DARJA_HINTS.some((w) => lower.includes(w))) return { lang: "dz", confidence: "medium" };

  // Strong French signal: accents / ligatures.
  if (/[éèêàùçœ]/i.test(t)) return { lang: "fr", confidence: "high" };

  // Score-based FR vs EN. Default to FR when ambiguous.
  const frScore = countWordHits(lower, FRENCH_HINT_WORDS);
  const enScore = countWordHits(lower, ENGLISH_HINT_WORDS);

  if (frScore === 0 && enScore === 0) {
    // If user wrote plain ASCII French without keywords, we still prefer FR for this app.
    return { lang: "fr", confidence: "low" };
  }

  const diff = Math.abs(frScore - enScore);
  const confidence: LanguageDetectionConfidence = diff >= 3 ? "high" : diff >= 1 ? "medium" : "low";

  return frScore >= enScore
    ? { lang: "fr", confidence }
    : { lang: "en", confidence };
}

export function detectLanguage(text: string): SupportedLanguage {
  return detectLanguageInfo(text).lang;
}

export function languageLabel(lang: SupportedLanguage): string {
  switch (lang) {
    case "fr":
      return "français";
    case "en":
      return "English";
    case "ar":
      return "العربية";
    case "dz":
      return "darija (dz)";
  }
}
