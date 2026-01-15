export type Prescription = {
  sph?: number;
  cyl?: number;
  axis?: number;
};

export type VisualNeed =
  | "screen"
  | "outdoor"
  | "driving"
  | "easy-clean"
  | "premium-clarity";

export type Budget = "basic" | "mid" | "premium";

export type Recommendation = {
  recommendedIndex?: 1.5 | 1.56 | 1.6 | 1.67 | 1.74;
  wantPhotochromic?: boolean;
  wantBlueCut?: boolean;
  coatings: Array<"AR" | "HARD" | "HYDRO" | "PHOTO" | "BLUECUT">;
  rationale: string[];
};

// Recommendation logic is intentionally simple and explainable:
// - parse a rough prescription (SPH/CYL/AX)
// - pick an index based on max optical power (sph and sph+cyl)
// - add coatings based on needs (screen/outdoor/driving)
// This is not a medical device; it's a sales-assistant heuristic.

function clampIndex(idx: number): Recommendation["recommendedIndex"] {
  if (idx <= 1.5) return 1.5;
  if (idx <= 1.56) return 1.56;
  if (idx <= 1.6) return 1.6;
  if (idx <= 1.67) return 1.67;
  return 1.74;
}

export function parsePrescription(text: string): Prescription | undefined {
  // Accept formats like: SPH -2.50 CYL -1.25 AX 180
  // Or: sph:-2.5 cyl:-1.25 axis:180
  const normalized = text
    .replace(/,/g, ".")
    .replace(/\s+/g, " ")
    .trim();

  const sphMatch = /(?:\bSPH\b|\bsph\b)\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)/i.exec(normalized);
  const cylMatch = /(?:\bCYL\b|\bcyl\b)\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)/i.exec(normalized);
  const axisMatch = /(?:\bAX(?:IS)?\b|\baxe\b)\s*[:=]?\s*(\d{1,3})/i.exec(normalized);

  const sph = sphMatch ? Number(sphMatch[1]) : undefined;
  const cyl = cylMatch ? Number(cylMatch[1]) : undefined;
  const axis = axisMatch ? Number(axisMatch[1]) : undefined;

  if (sph === undefined && cyl === undefined && axis === undefined) return undefined;

  return {
    sph: Number.isFinite(sph as number) ? sph : undefined,
    cyl: Number.isFinite(cyl as number) ? cyl : undefined,
    axis: Number.isFinite(axis as number) ? axis : undefined,
  };
}

export function recommendFromInputs(params: {
  prescription?: Prescription;
  needs?: VisualNeed[];
  budget?: Budget;
}): Recommendation {
  const coatings: Recommendation["coatings"] = ["AR", "HARD", "HYDRO"];
  const rationale: string[] = [
    "Antireflet (AR) pour réduire les reflets et améliorer le contraste.",
    "Durci pour limiter les micro-rayures.",
    "Hydrophobe pour faciliter le nettoyage et limiter les traces.",
  ];

  const needs = params.needs ?? [];
  let wantBlueCut = false;
  let wantPhotochromic = false;

  if (needs.includes("screen")) {
    wantBlueCut = true;
    coatings.push("BLUECUT");
    rationale.push("Blue Cut si usage écrans important (confort subjectif). ");
  }

  if (needs.includes("outdoor") || needs.includes("driving")) {
    wantPhotochromic = true;
    coatings.push("PHOTO");
    rationale.push(
      "Photochromique si alternance intérieur/extérieur; utile aussi dehors. En voiture, choisir une techno optimisée pare-brise."
    );
  }

  // Index recommendation based on power magnitude.
  let recommendedIndex: Recommendation["recommendedIndex"] | undefined;
  const { prescription } = params;
  if (prescription?.sph !== undefined || prescription?.cyl !== undefined) {
    const sph = prescription.sph ?? 0;
    const cyl = prescription.cyl ?? 0;
    // Two principal meridians: sph and sph+cyl
    const p1 = Math.abs(sph);
    const p2 = Math.abs(sph + cyl);
    const maxPower = Math.max(p1, p2);

    if (maxPower <= 2) recommendedIndex = 1.5;
    else if (maxPower <= 3.5) recommendedIndex = 1.56;
    else if (maxPower <= 6) recommendedIndex = 1.6;
    else if (maxPower <= 8) recommendedIndex = 1.67;
    else recommendedIndex = 1.74;

    rationale.push(`Indice recommandé basé sur la puissance max (~${maxPower.toFixed(2)}D).`);

    // If cylinder high, bias to higher index / aspheric.
    if (Math.abs(cyl) >= 2) {
      const bumped = clampIndex((recommendedIndex ?? 1.6) + 0.07);
      if (bumped !== recommendedIndex) {
        recommendedIndex = bumped;
        rationale.push("Cylindre élevé: on privilégie souvent une meilleure finesse (indice supérieur) et/ou asphérique.");
      }
    }
  }

  // Budget constraints (light bias)
  if (params.budget === "basic") {
    rationale.push("Budget basique: on privilégie l’essentiel (AR + durci), et on propose des options si besoin.");
  } else if (params.budget === "premium") {
    rationale.push("Budget premium: on privilégie des gammes premium et traitements complets.");
  }

  return {
    recommendedIndex,
    wantBlueCut,
    wantPhotochromic,
    coatings,
    rationale,
  };
}
