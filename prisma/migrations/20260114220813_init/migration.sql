-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "PhotochromicTech" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "descriptionFr" TEXT NOT NULL,
    "descriptionEn" TEXT NOT NULL,
    "descriptionAr" TEXT,
    "descriptionDarija" TEXT
);

-- CreateTable
CREATE TABLE "Coating" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "labelFr" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT,
    "labelDarija" TEXT
);

-- CreateTable
CREATE TABLE "LensProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "family" TEXT,
    "index" REAL NOT NULL,
    "material" TEXT,
    "isAspheric" BOOLEAN NOT NULL DEFAULT false,
    "minSph" REAL,
    "maxSph" REAL,
    "minCyl" REAL,
    "maxCyl" REAL,
    "photochromic" BOOLEAN NOT NULL DEFAULT false,
    "photochromicTechId" TEXT,
    "blueCut" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LensProduct_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LensProduct_photochromicTechId_fkey" FOREIGN KEY ("photochromicTechId") REFERENCES "PhotochromicTech" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LensCoating" (
    "lensId" TEXT NOT NULL,
    "coatingId" TEXT NOT NULL,

    PRIMARY KEY ("lensId", "coatingId"),
    CONSTRAINT "LensCoating_lensId_fkey" FOREIGN KEY ("lensId") REFERENCES "LensProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LensCoating_coatingId_fkey" FOREIGN KEY ("coatingId") REFERENCES "Coating" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lensId" TEXT NOT NULL,
    "supplier" TEXT,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InventoryItem_lensId_fkey" FOREIGN KEY ("lensId") REFERENCES "LensProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PhotochromicTech_name_key" ON "PhotochromicTech"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Coating_code_key" ON "Coating"("code");

-- CreateIndex
CREATE UNIQUE INDEX "LensProduct_sku_key" ON "LensProduct"("sku");

-- CreateIndex
CREATE INDEX "LensProduct_brandId_idx" ON "LensProduct"("brandId");

-- CreateIndex
CREATE INDEX "LensProduct_index_idx" ON "LensProduct"("index");

-- CreateIndex
CREATE INDEX "LensProduct_photochromic_idx" ON "LensProduct"("photochromic");

-- CreateIndex
CREATE INDEX "LensProduct_blueCut_idx" ON "LensProduct"("blueCut");

-- CreateIndex
CREATE INDEX "InventoryItem_lensId_idx" ON "InventoryItem"("lensId");

-- CreateIndex
CREATE INDEX "InventoryItem_isActive_idx" ON "InventoryItem"("isActive");
