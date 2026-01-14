import { PrismaClient } from "@/generated/prisma/client";
import fs from "node:fs";
import path from "node:path";

declare global {
  var prisma: PrismaClient | undefined;
}

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

  // Already absolute (macOS/Linux). Keep as-is.
  if (filePathPart.startsWith("/")) return databaseUrl;

  const root = findProjectRoot(process.cwd());
  const absolutePath = path.resolve(root, filePathPart);
  const query = queryParts.length ? `?${queryParts.join("?")}` : "";
  return `file:${absolutePath}${query}`;
}

// Ensure DATABASE_URL is always set and that SQLite file paths are absolute.
// This avoids "Unable to open the database file" when the runtime cwd differs (e.g., Next/Turbopack output dirs).
const projectRoot = findProjectRoot(process.cwd());
const fallbackDbUrl = `file:${path.resolve(projectRoot, "prisma", "dev.db")}`;
process.env.DATABASE_URL = normalizeSqliteUrl(process.env.DATABASE_URL ?? fallbackDbUrl);

export const prisma = globalThis.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}
