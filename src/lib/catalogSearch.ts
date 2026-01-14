import { prisma } from "@/lib/db";
import type { Recommendation } from "@/lib/recommendation";

export type CatalogHit = {
  sku: string;
  brand: string;
  family?: string | null;
  index: number;
  isAspheric: boolean;
  photochromic: boolean;
  photochromicTech?: {
    name: string;
    descriptionFr: string;
    descriptionEn: string;
    descriptionAr?: string | null;
    descriptionDarija?: string | null;
  } | null;
  blueCut: boolean;
  coatings: Array<{ code: string; labelFr: string; labelEn: string }>;
  description?: string | null;
  inventory: {
    priceCents: number;
    currency: string;
    quantity: number;
    supplier?: string | null;
  } | null;
};

function normalize(text: string) {
  return text.toLowerCase().trim();
}

function extractDesiredIndex(text: string): number | undefined {
  const m = /(1\.(?:50|56|60|67|74))/i.exec(text.replace(/\s/g, ""));
  if (!m) return undefined;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : undefined;
}

function extractBrand(text: string): string | undefined {
  const t = normalize(text);
  if (t.includes("zeiss")) return "Zeiss";
  if (t.includes("essilor")) return "Essilor";
  if (t.includes("crizal")) return "Crizal";
  if (t.includes("hoya") || t.includes("هويا")) return "Hoya";
  if (t.includes("distributeur")) return "Distributeur";
  return undefined;
}

function wants(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

export async function searchCatalog(params: {
  userText: string;
  recommendation?: Recommendation;
  limit?: number;
}): Promise<CatalogHit[]> {
  const { userText } = params;
  const limit = params.limit ?? 6;

  const brand = extractBrand(userText);
  const desiredIndex = extractDesiredIndex(userText);

  const wantPhoto = wants(userText, [/photo/i, /transition/i]) || (params.recommendation?.wantPhotochromic ?? false);
  const wantBlue = wants(userText, [/blue\s*cut/i, /lumi[eè]re\s*bleue/i, /screen/i, /ordinateur/i]) || (params.recommendation?.wantBlueCut ?? false);

  const indexTarget = desiredIndex ?? params.recommendation?.recommendedIndex;

  const results = await prisma.lensProduct.findMany({
    where: {
      ...(brand ? { brand: { name: brand } } : {}),
      ...(wantPhoto ? { photochromic: true } : {}),
      ...(wantBlue ? { blueCut: true } : {}),
      inventory: {
        some: {
          isActive: true,
        },
      },
    },
    include: {
      brand: true,
      photochromicTech: true,
      coatings: {
        include: {
          coating: true,
        },
      },
      inventory: {
        where: { isActive: true },
        orderBy: [{ quantity: "desc" }, { updatedAt: "desc" }],
        take: 1,
      },
    },
    take: 50,
  });

  const scored = results
    .map((lens) => {
      let score = 0;

      // Prefer in-stock
      const inv = lens.inventory[0];
      if (inv && inv.quantity > 0) score += 5;

      // Index closeness
      if (indexTarget) {
        const diff = Math.abs(lens.index - indexTarget);
        score += Math.max(0, 4 - diff * 10);
      }

      // Feature match
      if (wantPhoto && lens.photochromic) score += 2;
      if (wantBlue && lens.blueCut) score += 2;

      // More coatings slightly better
      score += Math.min(2, lens.coatings.length * 0.25);

      return { lens, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ lens }) => {
    const inv = lens.inventory[0];
    return {
      sku: lens.sku,
      brand: lens.brand.name,
      family: lens.family,
      index: lens.index,
      isAspheric: lens.isAspheric,
      photochromic: lens.photochromic,
      photochromicTech: lens.photochromicTech
        ? {
            name: lens.photochromicTech.name,
            descriptionFr: lens.photochromicTech.descriptionFr,
            descriptionEn: lens.photochromicTech.descriptionEn,
            descriptionAr: lens.photochromicTech.descriptionAr,
            descriptionDarija: lens.photochromicTech.descriptionDarija,
          }
        : null,
      blueCut: lens.blueCut,
      coatings: lens.coatings.map((c) => ({
        code: c.coating.code,
        labelFr: c.coating.labelFr,
        labelEn: c.coating.labelEn,
      })),
      description: lens.description,
      inventory: inv
        ? {
            priceCents: inv.priceCents,
            currency: inv.currency,
            quantity: inv.quantity,
            supplier: inv.supplier,
          }
        : null,
    };
  });
}

export function formatCatalogContextForPrompt(
  hits: CatalogHit[],
  opts?: { includePrice?: boolean; includeAvailability?: boolean },
): string {
  if (hits.length === 0) return "(Aucun produit trouvé dans la base de données.)";

  const includePrice = opts?.includePrice ?? false;
  const includeAvailability = opts?.includeAvailability ?? false;

  return hits
    .map((h, i) => {
      const coatings = h.coatings.map((c) => c.code).join(", ");
      const tech = h.photochromicTech ? ` | Tech: ${h.photochromicTech.name}` : "";

      const base = `${i + 1}. SKU=${h.sku} | ${h.brand}${h.family ? " " + h.family : ""} | index=${h.index} | asph=${h.isAspheric ? "yes" : "no"} | photo=${h.photochromic ? "yes" : "no"}${tech} | blueCut=${h.blueCut ? "yes" : "no"} | coatings=[${coatings}]`;

      const parts: string[] = [base];
      if (includePrice) {
        const price = h.inventory ? `${(h.inventory.priceCents / 100).toFixed(0)} ${h.inventory.currency}` : "N/A";
        parts.push(`price=${price}`);
      }
      if (includeAvailability) {
        const stock = h.inventory ? `${h.inventory.quantity}` : "N/A";
        parts.push(`stock=${stock}`);
      }
      return parts.join(" | ");
    })
    .join("\n");
}
