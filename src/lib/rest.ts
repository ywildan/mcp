 
import { count, eq } from "drizzle-orm";
import { z, ZodError } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import * as core from "@/lib/core";
import { RelayError, log } from "@/lib/config";
import { checkLoginRate, createSession, destroySession, getSessionUser, requireUser, sessionCookie, verifyPassword, type SessionUser } from "@/lib/auth";
import { interruptWaiter } from "@/lib/events";

interface Ctx {
  req: Request;
  url: URL;
  p: Record<string, string>;
  body: any;
  su: SessionUser;
}
type Handler = (c: Ctx) => Promise<unknown>;
interface Route {
  method: string;
  parts: string[];
  h: Handler;
  auth: "public" | "user" | "admin";
}
const routes: Route[] = [];
const add = (method: string, path: string, auth: Route["auth"], h: Handler) => routes.push({ method, parts: path.split("/"), h, auth });
const parse = <T extends z.ZodTypeAny>(schema: T, v: unknown): z.infer<T> => schema.parse(v ?? {});
const pid = (v: string) => {
  const [kind, ...rest] = v.split(":");
  if ((kind !== "agent" && kind !== "user") || !rest.length) throw new RelayError("invalid_input", "participant id must be agent:<id> or user:<id>");
  return { kind: kind as "agent" | "user", id: rest.join(":") };
};
const userView = (u: typeof users.$inferSelect) => ({ id: u.id, email: u.email, name: u.name, role: u.role, handle: core.userHandle(u), created_at: u.createdAt });
const ok = { ok: true };

// ── auth ──
add("GET", "auth/me", "public", async ({ req }) => {
  await core.ensureWorkspace();
  const su = await getSessionUser(req);
  const [{ n }] = await db.select({ n: count() }).from(users);
  return su ? { user: userView(su.user), csrf: su.csrf, needs_setup: false } : { user: null, needs_setup: n === 0 };
});
const credSchema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });
add("POST", "auth/setup", "public", async ({ req, body }) => {
  await core.ensureWorkspace();
  const [{ n }] = await db.select({ n: count() }).from(users);
  if (n > 0) throw new RelayError("forbidden", "Setup already completed", { status: 403 });
  const b = parse(credSchema.extend({ name: z.string().max(100).optional(), password: z.string().min(8).max(200) }), body);
  const u = await core.createUser({ kind: "user", id: "system", name: "setup" }, { email: b.email, name: b.name ?? b.email.split("@")[0], password: b.password, role: "admin" });
  const sess = await createSession(u.id);
  return { __cookie: sessionCookie(req, sess.raw), user: u, csrf: sess.csrf };
});
add("POST", "auth/login", "public", async ({ req, body }) => {
  await core.ensureWorkspace();
  const b = parse(credSchema, body);
  checkLoginRate(req, b.email);
  const [u] = await db.select().from(users).where(eq(users.email, b.email.trim().toLowerCase()));
  if (!u || !(await verifyPassword(u.passwordHash, b.password))) {
    await core.audit({ kind: "system", id: "login" }, "login.failed", b.email.slice(0, 100));
    throw new RelayError("unauthorized", "Invalid email or password");
  }
  const sess = await createSession(u.id);
  await core.audit({ kind: "user", id: u.id }, "login.success", u.email);
  return { __cookie: sessionCookie(req, sess.raw), user: userView(u), csrf: sess.csrf };
});
add("POST", "auth/logout", "user", async ({ req, su }) => {
  await destroySession(su.sessionId);
  return { __cookie: sessionCookie(req, "", 0), ...ok };
});

// ── agents ──
add("GET", "agents", "user", async () => ({ agents: await core.listAgentViews() }));
add("POST", "agents", "admin", async ({ body, su }) => {
  const b = parse(
    z.object({ name: z.string().max(40), display_name: z.string().max(80).optional(), type: z.string().optional(), description: z.string().max(500).optional(), capabilities: z.array(z.string()).optional(), color: z.string().max(20).optional(), wait_mode: z.string().optional() }),
    body,
  );
  return core.createAgent(su.actor, { name: b.name, displayName: b.display_name, type: b.type, description: b.description, capabilities: b.capabilities, color: b.color, waitMode: b.wait_mode });
});
add("GET", "agents/:id", "user", async ({ p }) => ({ agent: await core.getAgentView(p.id) }));
add("PATCH", "agents/:id", "admin", async ({ p, body, su }) => {
  const b = parse(z.object({ display_name: z.string().max(80).optional(), type: z.string().optional(), description: z.string().max(500).optional(), capabilities: z.array(z.string()).optional(), color: z.string().max(20).optional(), wait_mode: z.string().optional() }), body);
  return { agent: await core.updateAgent(su.actor, p.id, { displayName: b.display_name, type: b.type, description: b.description, capabilities: b.capabilities, color: b.color, waitMode: b.wait_mode }) };
});
add("DELETE", "agents/:id", "admin", async ({ p, su }) => {
  await core.deleteAgent(su.actor, p.id);
  return ok;
});
add("POST", "agents/:id/tokens", "admin", async ({ p, body, su }) => {
  // rotate=true revokes all active tokens first; otherwise just adds a new token.
  const b = parse(z.object({ rotate: z.boolean().optional() }), body);
  const t = b.rotate ? await core.rotateToken(su.actor, p.id) : await core.addToken(su.actor, p.id);
  return { token: t.token, token_id: t.id, prefix: t.prefix };
});
add("DELETE", "agents/:id/tokens/:tid", "admin", async ({ p, su }) => {
  await core.revokeToken(su.actor, p.id, p.tid);
  return ok;
});
add("POST", "agents/:id/pause", "admin", async ({ p, su }) => ({ agent: await core.setAgentState(su.actor, p.id, "paused") }));
add("POST", "agents/:id/resume", "admin", async ({ p, su }) => ({ agent: await core.setAgentState(su.actor, p.id, "active") }));
add("POST", "agents/:id/wake", "user", async ({ p, su }) => {
  const woke = interruptWaiter(p.id, "wake");
  await core.audit(su.actor, "agent.wake", p.id, { had_wait: woke });
  return { interrupted: woke };
});

// ── rooms ──
add("GET", "rooms", "user", async ({ su }) => ({ rooms: await core.listRoomsFor(su.actor, "all") }));
add("POST", "rooms", "user", async ({ body, su }) => {
  const b = parse(z.object({ name: z.string(), topic: z.string().max(500).optional(), pinned_instructions: z.string().max(8000).optional(), members: z.array(z.string()).optional(), visibility: z.string().optional(), hop_limit: z.number().int().optional() }), body);
  return { room: await core.createRoom(su.actor, { name: b.name, topic: b.topic, pinnedInstructions: b.pinned_instructions, members: b.members, visibility: b.visibility, hopLimit: b.hop_limit }) };
});
add("GET", "rooms/:id", "user", async ({ p }) => ({ room: core.toRoomView(await core.getRoom(p.id)), members: await core.getMembers(p.id) }));
add("PATCH", "rooms/:id", "user", async ({ p, body, su }) => {
  const b = parse(z.object({ topic: z.string().max(500).optional(), pinned_instructions: z.string().max(8000).optional(), hop_limit: z.number().int().optional(), humans_wake_all: z.boolean().nullable().optional(), state: z.string().optional(), visibility: z.string().optional(), name: z.string().optional() }), body);
  return { room: await core.updateRoom(su.actor, p.id, { topic: b.topic, pinnedInstructions: b.pinned_instructions, hopLimit: b.hop_limit, humansWakeAll: b.humans_wake_all, state: b.state, visibility: b.visibility, name: b.name }) };
});
add("POST", "rooms/:id/members", "user", async ({ p, body, su }) => {
  const b = parse(z.object({ name: z.string().optional(), participant_id: z.string().optional(), notify_mode: z.enum(["all", "mentions_only", "none"]).optional() }), body);
  const t = b.participant_id ? pid(b.participant_id) : b.name ? await core.resolveParticipant(b.name) : null;
  if (!t) throw new RelayError("invalid_input", "name or participant_id required");
  await core.addMember(su.actor, p.id, t.kind, t.id, b.notify_mode);
  return { members: await core.getMembers(p.id) };
});
add("PATCH", "rooms/:id/members/:pid", "user", async ({ p, body }) => {
  const t = pid(p.pid);
  const b = parse(z.object({ notify_mode: z.enum(["all", "mentions_only", "none"]) }), body);
  await core.setNotifyMode(p.id, t.kind, t.id, b.notify_mode);
  return { members: await core.getMembers(p.id) };
});
add("DELETE", "rooms/:id/members/:pid", "user", async ({ p, su }) => {
  const t = pid(p.pid);
  await core.removeMember(su.actor, p.id, t.kind, t.id);
  return { members: await core.getMembers(p.id) };
});
add("POST", "rooms/:id/pause", "user", async ({ p, su }) => ({ room: await core.setRoomState(su.actor, p.id, "paused") }));
add("POST", "rooms/:id/resume", "user", async ({ p, su }) => ({ room: await core.setRoomState(su.actor, p.id, "active") }));
add("GET", "rooms/:id/messages", "user", async ({ p, url }) => {
  const q = url.searchParams;
  return core.readMessages(p.id, { beforeSeq: Number(q.get("before_seq")) || undefined, afterSeq: Number(q.get("after_seq")) || undefined, limit: Number(q.get("limit")) || 50, threadId: q.get("thread_id") ?? undefined });
});
add("POST", "rooms/:id/messages", "user", async ({ p, body, su }) => {
  const b = parse(z.object({ content: z.string(), reply_to: z.string().optional(), thread_id: z.string().optional(), attachments: z.array(z.string()).optional(), client_message_id: z.string().max(128).optional(), metadata: z.record(z.string(), z.unknown()).optional() }), body);
  return core.sendMessage(su.actor, { roomId: p.id, content: b.content, replyTo: b.reply_to, threadId: b.thread_id, attachments: b.attachments, clientMessageId: b.client_message_id, metadata: b.metadata });
});
add("GET", "rooms/:id/artifacts", "user", async ({ p }) => ({ artifacts: await core.listArtifacts(p.id) }));

// ── messages ──
add("PATCH", "messages/:id", "admin", async ({ p, body, su }) => ({ message: await core.editMessage(su.actor, p.id, parse(z.object({ content: z.string() }), body).content) }));
add("DELETE", "messages/:id", "admin", async ({ p, su }) => {
  await core.deleteMessage(su.actor, p.id);
  return ok;
});
add("GET", "search", "user", async ({ url, su }) => ({ messages: await core.searchMessages(su.actor, url.searchParams.get("q") ?? "", { roomId: url.searchParams.get("room_id") ?? undefined }) }));

// ── tasks ──
add("GET", "tasks", "user", async ({ url }) => ({ tasks: await core.listTasks({ assignee: url.searchParams.get("assignee") ?? undefined, status: url.searchParams.get("status") ?? undefined, roomId: url.searchParams.get("room_id") ?? undefined }) }));
add("POST", "tasks", "user", async ({ body, su }) => {
  const b = parse(z.object({ title: z.string(), description: z.string().optional(), assignee: z.string(), room_id: z.string().optional(), priority: z.string().optional(), acceptance_criteria: z.string().optional(), due: z.string().optional() }), body);
  return { task: await core.createTask(su.actor, { title: b.title, description: b.description, assignee: b.assignee, roomId: b.room_id, priority: b.priority, acceptanceCriteria: b.acceptance_criteria, due: b.due }) };
});
add("PATCH", "tasks/:id", "user", async ({ p, body, su }) => {
  const b = parse(z.object({ status: z.string().optional(), result_summary: z.string().optional(), artifacts: z.array(z.string()).optional(), note: z.string().optional() }), body);
  return { task: await core.updateTask(su.actor, p.id, { status: b.status, resultSummary: b.result_summary, artifacts: b.artifacts, note: b.note }) };
});

// ── artifacts ──
add("POST", "artifacts", "user", async ({ body, su }) => {
  const b = parse(z.object({ name: z.string(), mime: z.string().optional(), content_text: z.string().optional(), content_base64: z.string().optional(), room_id: z.string().optional() }), body);
  return { artifact: await core.uploadArtifact(su.actor, { name: b.name, mime: b.mime, contentText: b.content_text, contentBase64: b.content_base64, roomId: b.room_id }) };
});
add("GET", "artifacts/:id", "user", async ({ p, su }) => ({ artifact: await core.getArtifact(su.actor, p.id) }));
add("GET", "artifacts/:id/download", "public", async ({ req, p, url }) => {
  const sigOk = core.verifyArtifactSig(p.id, Number(url.searchParams.get("exp")), url.searchParams.get("sig") ?? "");
  let art: { meta: { name: string; mime: string }; content: Buffer };
  if (sigOk) {
    const a = await core.getArtifactSigned(p.id);
    if (!a) throw new RelayError("not_found", "Artifact not found");
    art = { meta: { name: a.name, mime: a.mime }, content: a.content };
  } else {
    const su = await requireUser(req);
    art = await core.getArtifactBlob(su.actor, p.id);
  }
  const inline = /^(image\/(png|jpeg|gif|webp)|text\/plain)$/.test(art.meta.mime);
  return new Response(new Uint8Array(art.content), {
    headers: {
      "content-type": inline ? art.meta.mime : "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(art.meta.name)}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
});

// ── human requests ──
add("GET", "human-requests", "user", async ({ url }) => ({ requests: await core.listHumanRequests(url.searchParams.get("status") ?? undefined) }));
add("POST", "human-requests/:id/answer", "user", async ({ p, body, su }) => {
  await core.answerHumanRequest(su.actor, p.id, parse(z.object({ answer: z.string().min(1).max(8000) }), body).answer);
  return ok;
});

// ── observability / admin ──
add("GET", "audit-logs", "admin", async ({ url }) => ({ logs: await core.listAudit(Number(url.searchParams.get("limit")) || 200) }));
add("GET", "activity", "user", async ({ url }) => ({ activity: await core.listActivity(url.searchParams.get("agent_id") ?? undefined, Number(url.searchParams.get("limit")) || 100) }));
add("GET", "inbox/dead", "user", async () => ({ items: await core.listDeadLetters() }));
add("POST", "inbox/:id/requeue", "admin", async ({ p, su }) => {
  await core.requeueDead(su.actor, p.id);
  return ok;
});
add("POST", "inbox/:id/discard", "admin", async ({ p, su }) => {
  await core.discardDead(su.actor, p.id);
  return ok;
});
add("GET", "settings", "user", async () => ({ settings: await core.getSettings() }));
add("PATCH", "settings", "admin", async ({ body, su }) => ({ settings: await core.updateSettings(su.actor, (body ?? {}) as Partial<core.Settings>) }));
add("GET", "users", "admin", async () => ({ users: (await db.select().from(users)).map(userView) }));
add("POST", "users", "admin", async ({ body, su }) => {
  const b = parse(z.object({ email: z.string().email(), name: z.string().max(100).optional(), password: z.string().min(8).max(200), role: z.enum(["admin", "member"]).optional() }), body);
  return { user: await core.createUser(su.actor, { email: b.email, name: b.name ?? b.email.split("@")[0], password: b.password, role: b.role ?? "member" }) };
});

function match(method: string, segs: string[]) {
  for (const r of routes) {
    if (r.method !== method || r.parts.length !== segs.length) continue;
    const p: Record<string, string> = {};
    let okm = true;
    for (let i = 0; i < segs.length; i++) {
      if (r.parts[i].startsWith(":")) p[r.parts[i].slice(1)] = segs[i];
      else if (r.parts[i] !== segs[i]) {
        okm = false;
        break;
      }
    }
    if (okm) return { r, p };
  }
  return null;
}

export async function handleRest(req: Request, params: Promise<{ path: string[] }>): Promise<Response> {
  const { path } = await params;
  const segs = path.map((s) => decodeURIComponent(s));
  try {
    const m = match(req.method, segs);
    if (!m) throw new RelayError("not_found", `No route ${req.method} /api/v1/${segs.join("/")}`);
    const su = m.r.auth === "public" ? (null as unknown as SessionUser) : await requireUser(req, { admin: m.r.auth === "admin" });
    let body: unknown = undefined;
    if (!["GET", "HEAD"].includes(req.method)) {
      const raw = await req.text();
      if (raw.length > 15 * 1024 * 1024) throw new RelayError("payload_too_large", "Body too large");
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          throw new RelayError("invalid_input", "Body must be valid JSON");
        }
      }
    }
    if (m.r.auth === "public" && req.method !== "GET" && req.headers.get("origin")) {
      const o = new URL(req.headers.get("origin")!).host;
      if (o !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) throw new RelayError("forbidden", "Cross-origin request blocked", { status: 403 });
    }
    const out = await m.r.h({ req, url: new URL(req.url), p: m.p, body, su });
    if (out instanceof Response) return out;
    const { __cookie, ...rest } = (out ?? {}) as { __cookie?: string };
    const res = Response.json(rest, { headers: { "cache-control": "no-store" } });
    if (__cookie) res.headers.append("set-cookie", __cookie);
    return res;
  } catch (e) {
    if (e instanceof ZodError) return Response.json({ error: { code: "invalid_input", message: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } }, { status: 400 });
    if (e instanceof RelayError) {
      const headers: Record<string, string> = e.extra.retry_after ? { "retry-after": String(e.extra.retry_after) } : {};
      return Response.json({ error: { code: e.code, message: e.message, ...(e.extra.retry_after ? { retry_after: e.extra.retry_after } : {}) } }, { status: e.status, headers });
    }
    log("error", "api_error", { path: segs.join("/"), err: String(e) });
    return Response.json({ error: { code: "internal_error", message: "Internal error" } }, { status: 500 });
  }
}
