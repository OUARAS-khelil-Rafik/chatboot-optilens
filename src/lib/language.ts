export type SupportedLanguage = "fr" | "en" | "ar" | "dz";

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

export function detectLanguage(text: string): SupportedLanguage {
  const t = text.trim();
  if (!t) return "fr";

  // Arabic script
  if (/\p{Script=Arabic}/u.test(t)) {
    // Heuristic: many Darija messages are Arabic script too; keep "ar" for script.
    return "ar";
  }

  const lower = t.toLowerCase();
  if (DARJA_HINTS.some((w) => lower.includes(w))) return "dz";

  // French heuristics
  if (/[éèêàùçœ]/i.test(t)) return "fr";
  if (/(\bbonjour\b|\bsalut\b|\bsvp\b|\bmerci\b|\bverre\b|\btraitement\b)/i.test(t)) return "fr";

  return "en";
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
