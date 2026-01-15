import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// Standalone seed script.
// We normalize SQLite `file:` URLs to absolute paths because the current working directory
// can differ depending on how the script is invoked (npm, editor, CI).

function findProjectRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const hasPackageJson = fs.existsSync(path.join(dir, "package.json"));
    const hasPrismaSchema = fs.existsSync(path.join(dir, "prisma", "schema.prisma"));
    if (hasPackageJson && hasPrismaSchema) return dir;

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

function normalizeSqliteUrl(databaseUrl: string): string {
  if (!databaseUrl.startsWith("file:")) return databaseUrl;

  const afterPrefix = databaseUrl.slice("file:".length);
  const [filePathPart, ...queryParts] = afterPrefix.split("?");

  if (filePathPart.startsWith("/")) return databaseUrl;

  const root = findProjectRoot(process.cwd());
  const absolutePath = path.resolve(root, filePathPart);
  const query = queryParts.length ? `?${queryParts.join("?")}` : "";
  return `file:${absolutePath}${query}`;
}

const projectRoot = findProjectRoot(process.cwd());
const fallbackDbUrl = `file:${path.resolve(projectRoot, "prisma", "dev.db")}`;
process.env.DATABASE_URL = normalizeSqliteUrl(process.env.DATABASE_URL ?? fallbackDbUrl);

const prisma = new PrismaClient();

type SeedLens = {
  sku: string;
  brand: string;
  family?: string;
  index: number;
  material?: string;
  isAspheric?: boolean;
  photochromic?: boolean;
  photochromicTech?: string;
  blueCut?: boolean;
  coatings: Array<"AR" | "HARD" | "HYDRO" | "BLUECUT" | "PHOTO">;
  description?: string;
  priceCents: number;
  currency?: string;
  quantity: number;
  supplier?: string;
};

const PHOTOCHROMIC_TECH = [
  {
    name: "Photochromic (générique)",
    descriptionFr:
      "Les verres photochromiques s’assombrissent automatiquement sous l’effet des UV (et partiellement de la lumière visible selon la technologie), puis redeviennent clairs en intérieur. La vitesse de transition dépend de la température, de l’intensité UV, de l’épaisseur et du matériau (organique/minéral).",
    descriptionEn:
      "Photochromic lenses darken automatically under UV (and partly visible light depending on technology), then return clear indoors. Transition speed depends on temperature, UV intensity, thickness and material.",
    descriptionAr:
      "العدسات الفوتوكرومية تَغمق تلقائياً تحت تأثير الأشعة فوق البنفسجية ثم تعود شفافة داخل الأماكن المغلقة. سرعة التغيير تتأثر بالحرارة وشدة الأشعة وسُمك العدسة والمادة.",
    descriptionDarija:
      "الڤلاص الفوتوكروميك يڤمّق كي يكون UV، وكي تدخل للداخل يرجع صافي. السرعة تتبدّل حسب السخانة وشدة UV والسماكة ونوع المادة.",
  },
  {
    name: "Photochromic (optimisé voiture)",
    descriptionFr:
      "Certaines générations sont conçues pour mieux s’activer derrière pare-brise (qui filtre une partie des UV). Elles restent généralement moins foncées qu’en plein soleil extérieur.",
    descriptionEn:
      "Some generations are designed to activate better behind car windshields (which filter part of UV). They usually get less dark than under direct outdoor sun.",
    descriptionAr:
      "بعض الأنواع مُحسَّنة للعمل خلف زجاج السيارة الذي يُقلل الأشعة فوق البنفسجية، لكنها عادةً لا تصبح داكنة مثل الخارج.",
    descriptionDarija:
      "كاين أنواع تخدم مليح حتى فالطوموبيل (الباربريز يقطع شوية UV)، بصح ما توصلش لغموق تاع برا.",
  },
] as const;

const COATINGS = [
  { code: "AR", labelFr: "Antireflet", labelEn: "Anti-reflective" },
  { code: "BLUECUT", labelFr: "Blue Cut", labelEn: "Blue light filter" },
  { code: "PHOTO", labelFr: "Photochromique", labelEn: "Photochromic" },
  { code: "HARD", labelFr: "Durci", labelEn: "Hard coat" },
  { code: "HYDRO", labelFr: "Hydrophobe", labelEn: "Hydrophobic" },
] as const;

const BRANDS = ["Zeiss", "Essilor", "Crizal", "Hoya", "Distributeur"] as const;

const LENSES: SeedLens[] = [
  {
    sku: "ZEISS-AR-150",
    brand: "Zeiss",
    family: "SmartLife",
    index: 1.5,
    material: "Organic",
    coatings: ["AR", "HARD", "HYDRO"],
    description: "Monofocal entrée de gamme avec antireflet + durci + hydrophobe.",
    priceCents: 450000,
    currency: "DZD",
    quantity: 10,
    supplier: "Zeiss",
  },
  {
    sku: "ESSILOR-CRIZAL-160-BLUE",
    brand: "Crizal",
    family: "Crizal",
    index: 1.6,
    material: "Organic",
    blueCut: true,
    coatings: ["AR", "BLUECUT", "HARD", "HYDRO"],
    description: "Traitement premium antireflet + protection lumière bleue + hydrophobe.",
    priceCents: 890000,
    currency: "DZD",
    quantity: 6,
    supplier: "Essilor/Crizal",
  },
  {
    sku: "HOYA-PHOTO-167",
    brand: "Hoya",
    family: "Sensity",
    index: 1.67,
    material: "Organic",
    photochromic: true,
    photochromicTech: "Photochromic (générique)",
    coatings: ["AR", "PHOTO", "HARD", "HYDRO"],
    description: "Photochromique polyvalent (extérieur/intérieur).",
    priceCents: 980000,
    currency: "DZD",
    quantity: 4,
    supplier: "Hoya",
  },
  {
    sku: "DIST-PHOTO-174-CAR",
    brand: "Distributeur",
    family: "Premium",
    index: 1.74,
    material: "Organic",
    isAspheric: true,
    photochromic: true,
    photochromicTech: "Photochromic (optimisé voiture)",
    coatings: ["AR", "PHOTO", "HARD", "HYDRO"],
    description: "Très fin (1.74) asphérique, photochromique optimisé voiture.",
    priceCents: 1350000,
    currency: "DZD",
    quantity: 2,
    supplier: "Distributeur",
  },
  {
    sku: "HOYA-AR-156",
    brand: "Hoya",
    family: "Nulux",
    index: 1.56,
    material: "Organic",
    coatings: ["AR", "HARD", "HYDRO"],
    description: "Monofocal confortable avec antireflet + durci + hydrophobe.",
    priceCents: 620000,
    currency: "DZD",
    quantity: 8,
    supplier: "OptiLens Store",
  },
  {
    sku: "ZEISS-BLUE-156",
    brand: "Zeiss",
    family: "BlueProtect",
    index: 1.56,
    material: "Organic",
    blueCut: true,
    coatings: ["AR", "BLUECUT", "HARD", "HYDRO"],
    description: "BlueCut pour usage écrans, avec traitements de base complets.",
    priceCents: 760000,
    currency: "DZD",
    quantity: 5,
    supplier: "OptiLens Store",
  },
  {
    sku: "ESSILOR-PHOTO-160",
    brand: "Essilor",
    family: "Transitions",
    index: 1.6,
    material: "Organic",
    photochromic: true,
    photochromicTech: "Photochromic (générique)",
    coatings: ["AR", "PHOTO", "HARD", "HYDRO"],
    description: "Photochromique pour extérieur/intérieur, bon confort au quotidien.",
    priceCents: 920000,
    currency: "DZD",
    quantity: 3,
    supplier: "OptiLens Store",
  },
  {
    sku: "HOYA-HI-174-BLUE",
    brand: "Hoya",
    family: "HiVision",
    index: 1.74,
    material: "Organic",
    isAspheric: true,
    blueCut: true,
    coatings: ["AR", "BLUECUT", "HARD", "HYDRO"],
    description: "Très fin (1.74) asphérique + BlueCut, pour fortes puissances et écrans.",
    priceCents: 1450000,
    currency: "DZD",
    quantity: 0,
    supplier: "OptiLens Store",
  },
];

async function main() {
  // Brands
  const brandMap = new Map<string, string>();
  for (const name of BRANDS) {
    const brand = await prisma.brand.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    brandMap.set(name, brand.id);
  }

  // Photochromic tech
  const techMap = new Map<string, string>();
  for (const tech of PHOTOCHROMIC_TECH) {
    const record = await prisma.photochromicTech.upsert({
      where: { name: tech.name },
      update: {
        descriptionFr: tech.descriptionFr,
        descriptionEn: tech.descriptionEn,
        descriptionAr: tech.descriptionAr,
        descriptionDarija: tech.descriptionDarija,
      },
      create: tech,
    });
    techMap.set(record.name, record.id);
  }

  // Coatings
  const coatingMap = new Map<string, string>();
  for (const coating of COATINGS) {
    const record = await prisma.coating.upsert({
      where: { code: coating.code },
      update: {
        labelFr: coating.labelFr,
        labelEn: coating.labelEn,
      },
      create: {
        code: coating.code,
        labelFr: coating.labelFr,
        labelEn: coating.labelEn,
      },
    });
    coatingMap.set(record.code, record.id);
  }

  // Lenses
  for (const lens of LENSES) {
    const brandId = brandMap.get(lens.brand);
    if (!brandId) throw new Error(`Unknown brand: ${lens.brand}`);

    const photochromicTechId = lens.photochromicTech
      ? techMap.get(lens.photochromicTech)
      : undefined;

    const product = await prisma.lensProduct.upsert({
      where: { sku: lens.sku },
      update: {
        brandId,
        family: lens.family,
        index: lens.index,
        material: lens.material,
        isAspheric: lens.isAspheric ?? false,
        photochromic: lens.photochromic ?? false,
        photochromicTechId: photochromicTechId ?? null,
        blueCut: lens.blueCut ?? false,
        description: lens.description,
      },
      create: {
        sku: lens.sku,
        brandId,
        family: lens.family,
        index: lens.index,
        material: lens.material,
        isAspheric: lens.isAspheric ?? false,
        photochromic: lens.photochromic ?? false,
        photochromicTechId: photochromicTechId ?? null,
        blueCut: lens.blueCut ?? false,
        description: lens.description,
      },
    });

    // Upsert inventory
    await prisma.inventoryItem.upsert({
      where: {
        // synthetic unique key not present; fallback: delete+create approach
        id: product.id,
      },
      update: {
        supplier: lens.supplier,
        priceCents: lens.priceCents,
        currency: lens.currency ?? "DZD",
        quantity: lens.quantity,
        isActive: true,
        lensId: product.id,
      },
      create: {
        id: product.id,
        lensId: product.id,
        supplier: lens.supplier,
        priceCents: lens.priceCents,
        currency: lens.currency ?? "DZD",
        quantity: lens.quantity,
        isActive: true,
      },
    });

    // Link coatings (reset for determinism)
    await prisma.lensCoating.deleteMany({ where: { lensId: product.id } });
    for (const code of lens.coatings) {
      const coatingId = coatingMap.get(code);
      if (!coatingId) throw new Error(`Unknown coating: ${code}`);
      await prisma.lensCoating.create({
        data: {
          lensId: product.id,
          coatingId,
        },
      });
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Seed completed");
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
