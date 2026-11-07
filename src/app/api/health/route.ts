import { db } from "@/lib/server/db";
import { json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await db.$queryRaw`SELECT 1`;
    return json({ status: "ok" });
  } catch { return json({ status: "unavailable" }, 503); }
}
