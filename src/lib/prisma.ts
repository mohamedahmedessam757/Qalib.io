import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrisma() {
  const url = process.env.DATABASE_URL;
  if (!url || url.includes("[YOUR-PASSWORD]")) {
    return null;
  }
  return new PrismaClient();
}

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production" && prisma) {
  globalForPrisma.prisma = prisma;
}

export function requirePrisma() {
  if (!prisma) {
    throw new Error(
      "DATABASE_URL is not configured. Add your Supabase DB password to .env.local",
    );
  }
  return prisma;
}
