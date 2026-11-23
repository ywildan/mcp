import { handleRest } from "@/lib/rest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type P = { params: Promise<{ path: string[] }> };
const h = (req: Request, c: P) => handleRest(req, c.params);
export { h as GET, h as POST, h as PATCH, h as DELETE };
