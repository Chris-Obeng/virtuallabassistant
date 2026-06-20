// lib/db.ts
import { PrismaClient } from "./generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  const adapter = new PrismaNeon({
    connectionString: process.env.DATABASE_URL!, // pooled connection string
  });

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
  });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
