import { PrismaClient } from "@prisma/client";

const globalDatabase = globalThis as unknown as { versoPrisma?: PrismaClient };
export const db = globalDatabase.versoPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalDatabase.versoPrisma = db;
