import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureWorkspace } from "@/lib/core";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    await ensureWorkspace();
    return Response.json({ ready: true });
  } catch {
    return Response.json({ ready: false }, { status: 503 });
  }
}
