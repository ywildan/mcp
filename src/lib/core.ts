import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { config, newId, randomToken, RelayError, sha256, log } from "./config";
import { computeRecipients, nextHop, parseMentions, presenceOf, type NotifyMode } from "./pure";
import { hasWaiter, interruptWaiter, notifyAgent, publish } from "./events";

export type Actor = { kind: "agent" | "user"; id: string; name: string };
export type Sender = { kind: "agent" | "user" | "system"; id: string; name: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbLike = typeof db | Tx;

export const SYSTEM: Sender = { kind: "system", id: "system", name: "system" };
export const WS_ID = "ws_default";
export const GENERAL_ID = "room_general";
const NAME_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;
const AGENT_TYPES = ["muse", "codex", "qoder", "opencode", "claude-code", "custom"];

// ───────────────────────── settings ─────────────────────────
export interface Settings {
  hopLimit: number;
  rateMsgPerMin: number;
  rateCallsPerMin: number;
  waitDefaultSeconds: number;
  leaseSeconds: number;
  retentionDaysMessages: number;
  retentionDaysInbox: number;
  redactActivity: boolean;
  autoAddMentions: boolean;
}
const defaults = (): Settings => ({
  hopLimit: config.hopLimitDefault,
  rateMsgPerMin: config.rateMsgPerMin,
  rateCallsPerMin: config.rateCallsPerMin,
  waitDefaultSeconds: config.waitDefaultSeconds,
  leaseSeconds: config.inboxLeaseSeconds,
  retentionDaysMessages: config.retentionDaysMessages,
  retentionDaysInbox: config.retentionDaysInbox,
  redactActivity: false,
  autoAddMentions: false,
});
let settingsCache: { at: number; v: Settings } | null = null;
export async function getSettings(): Promise<Settings> {
  if (settingsCache && Date.now() - settingsCache.at < 3000) return settingsCache.v;
  await ensureWorkspace();
  const [w] = await db.select().from(s.workspaces).where(eq(s.workspaces.id, WS_ID));
  const v = { ...defaults(), ...((w?.settingsJson ?? {}) as Partial<Settings>) };
  settingsCache = { at: Date.now(), v };
  return v;
}
export async function updateSettings(actor: Actor, patch: Partial<Settings>) {
  const cur = await getSettings();
  const next: Settings = { ...cur };
  const numKeys = ["hopLimit", "rateMsgPerMin", "rateCallsPerMin", "waitDefaultSeconds", "leaseSeconds", "retentionDaysMessages", "retentionDaysInbox"] as const;
  for (const k of numKeys) {
    const v = patch[k];
    if (v !== undefined) {
      if (!Number.isFinite(v) || v < 0) throw new RelayError("invalid_input", `${k} must be a non-negative number`);
      next[k] = Math.floor(v);
    }
  }
  if (next.hopLimit < 1) throw new RelayError("invalid_input", "hopLimit must be >= 1");
  if (next.leaseSeconds < 1) throw new RelayError("invalid_input", "leaseSeconds must be >= 1");
  if (patch.redactActivity !== undefined) next.redactActivity = !!patch.redactActivity;
  if (patch.autoAddMentions !== undefined) next.autoAddMentions = !!patch.autoAddMentions;
  await db.update(s.workspaces).set({ settingsJson: next as unknown as Record<string, unknown> }).where(eq(s.workspaces.id, WS_ID));
  settingsCache = null;
  await audit(actor, "settings.update", "workspace", patch as Record<string, unknown>);
  return next;
}

// ───────────────────────── workspace bootstrap ─────────────────────────
const gw = globalThis as typeof globalThis & { __arWs?: Promise<void> };
export function ensureWorkspace(): Promise<void> {
  return (gw.__arWs ??= (async () => {
    await db.insert(s.workspaces).values({ id: WS_ID, name: "default" }).onConflictDoNothing();
    await db
      .insert(s.rooms)
      .values({ id: GENERAL_ID, workspaceId: WS_ID, name: "general", topic: "Default room for everyone", hopLimit: config.hopLimitDefault })
      .onConflictDoNothing();
    const email = process.env.ADMIN_EMAIL;
    const pw = process.env.ADMIN_PASSWORD;
    if (email && pw) {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.users);
      if (n === 0) {
        await createUser({ kind: "user", id: "system", name: "bootstrap" }, { email, name: email.split("@")[0], password: pw, role: "admin" }).catch((e) =>
          log("warn", "bootstrap_admin_failed", { err: String(e) }),
        );
      }
    }
  })().catch((e) => {
    gw.__arWs = undefined;
    throw e;
  }));
}

export async function audit(actor: { kind: string; id: string }, action: string, target = "", detail: Record<string, unknown> = {}) {
  await db.insert(s.auditLogs).values({ actorKind: actor.kind, actorId: actor.id, action, target, detailJson: detail });
}

// ───────────────────────── users ─────────────────────────
export const userHandle = (u: { email: string }) => u.email.split("@")[0].toLowerCase().replace(/[^a-z0-9_-]/g, "-");

export async function createUser(actor: Actor, i: { email: string; name: string; password: string; role: "admin" | "member" }) {
  const { hashPassword } = await import("./auth");
  if (i.password.length < 8) throw new RelayError("invalid_input", "Password must be at least 8 characters");
  const email = i.email.trim().toLowerCase();
  const [dupe] = await db.select().from(s.users).where(eq(s.users.email, email));
  if (dupe) throw new RelayError("conflict", "Email already registered", { status: 409 });
  const id = newId("usr");
  await db.insert(s.users).values({ id, workspaceId: WS_ID, email, name: i.name || email.split("@")[0], passwordHash: await hashPassword(i.password), role: i.role });
  await db.insert(s.roomMembers).values({ roomId: GENERAL_ID, participantKind: "user", participantId: id, notifyMode: "all" }).onConflictDoNothing();
  await audit(actor, "user.create", id, { email, role: i.role });
  return { id, email, name: i.name, role: i.role };
}

// ───────────────────────── agents & tokens ─────────────────────────
export type AgentRow = typeof s.agents.$inferSelect;

export async function issueToken(agentId: string) {
  const token = `ar_live_${randomToken(32)}`;
  const id = newId("tok");
  await db.insert(s.agentTokens).values({ id, agentId, tokenHash: sha256(token), prefix: token.slice(0, 16) });
  return { id, token, prefix: token.slice(0, 16) };
}

export async function createAgent(
  actor: Actor,
  i: { name: string; displayName?: string; type?: string; description?: string; capabilities?: string[]; color?: string; waitMode?: string },
) {
  await ensureWorkspace();
  const name = i.name.trim().toLowerCase();
  if (!NAME_RE.test(name) || name === "system") throw new RelayError("invalid_input", "name must be a slug: 2-32 chars of a-z, 0-9, _ or -");
  const type = i.type && AGENT_TYPES.includes(i.type) ? i.type : "custom";
  const [dupe] = await db.select().from(s.agents).where(eq(s.agents.name, name));
  if (dupe) throw new RelayError("conflict", `Agent name '${name}' already exists`, { status: 409 });
  const id = newId("agt");
  const palette = ["#6366f1", "#ec4899", "#10b981", "#f59e0b", "#06b6d4", "#8b5cf6", "#ef4444", "#84cc16"];
  await db.insert(s.agents).values({
    id,
    workspaceId: WS_ID,
    name,
    displayName: i.displayName?.trim() || name,
    type,
    description: i.description ?? "",
    capabilitiesJson: (i.capabilities ?? []).map((c) => c.trim()).filter(Boolean).slice(0, 20),
    color: i.color || palette[Math.floor(Math.random() * palette.length)],
    waitMode: i.waitMode === "bounded" ? "bounded" : "infinite",
  });
  await db.insert(s.roomMembers).values({ roomId: GENERAL_ID, participantKind: "agent", participantId: id, notifyMode: "mentions_only" }).onConflictDoNothing();
  const tok = await issueToken(id);
  await audit(actor, "agent.create", id, { name });
  const agent = await getAgentView(id);
  await publish("agent.updated", { agent_id: id });
  return { agent, token: tok.token, token_id: tok.id };
}

export async function updateAgent(actor: Actor, id: string, p: Partial<{ displayName: string; type: string; description: string; capabilities: string[]; color: string; waitMode: string }>) {
  const set: Partial<typeof s.agents.$inferInsert> = {};
  if (p.displayName !== undefined) set.displayName = p.displayName;
  if (p.type !== undefined && AGENT_TYPES.includes(p.type)) set.type = p.type;
  if (p.description !== undefined) set.description = p.description;
  if (p.capabilities !== undefined) set.capabilitiesJson = p.capabilities;
  if (p.color !== undefined) set.color = p.color;
  if (p.waitMode === "infinite" || p.waitMode === "bounded") set.waitMode = p.waitMode;
  if (Object.keys(set).length) await db.update(s.agents).set(set).where(eq(s.agents.id, id));
  await audit(actor, "agent.update", id, set as Record<string, unknown>);
  await publish("agent.updated", { agent_id: id });
  return getAgentView(id);
}

export async function deleteAgent(actor: Actor, id: string) {
  await db.update(s.agentTokens).set({ revokedAt: new Date() }).where(and(eq(s.agentTokens.agentId, id), isNull(s.agentTokens.revokedAt)));
  await db.update(s.agents).set({ state: "disabled" }).where(eq(s.agents.id, id));
  interruptWaiter(id, "revoked");
  await audit(actor, "agent.disable", id);
  await publish("agent.updated", { agent_id: id });
}

export async function setAgentState(actor: Actor, id: string, state: "active" | "paused") {
  const [a] = await db.select().from(s.agents).where(eq(s.agents.id, id));
  if (!a) throw new RelayError("not_found", "Agent not found");
  if (a.state === "disabled") throw new RelayError("conflict", "Agent is disabled", { status: 409 });
  await db.update(s.agents).set({ state }).where(eq(s.agents.id, id));
  await audit(actor, state === "paused" ? "agent.pause" : "agent.resume", id);
  notifyAgent(id);
  await publish("presence.updated", { agent_id: id });
  return getAgentView(id);
}

export async function rotateToken(actor: Actor, agentId: string, tokenId?: string) {
  await db
    .update(s.agentTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(s.agentTokens.agentId, agentId), isNull(s.agentTokens.revokedAt), tokenId ? eq(s.agentTokens.id, tokenId) : undefined));
  interruptWaiter(agentId, "revoked");
  const tok = await issueToken(agentId);
  await audit(actor, tokenId ? "token.rotate" : "token.create", agentId, { token_id: tok.id });
  await publish("agent.updated", { agent_id: agentId });
  return tok;
}

export async function addToken(actor: Actor, agentId: string) {
  const tok = await issueToken(agentId);
  await audit(actor, "token.create", agentId, { token_id: tok.id });
  await publish("agent.updated", { agent_id: agentId });
  return tok;
}

export async function revokeToken(actor: Actor, agentId: string, tokenId: string) {
  const r = await db
    .update(s.agentTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(s.agentTokens.id, tokenId), eq(s.agentTokens.agentId, agentId), isNull(s.agentTokens.revokedAt)))
    .returning();
  if (!r.length) throw new RelayError("not_found", "Active token not found");
  interruptWaiter(agentId, "revoked");
  await audit(actor, "token.revoke", agentId, { token_id: tokenId });
  await publish("agent.updated", { agent_id: agentId });
}

export async function authenticateToken(token: string): Promise<AgentRow | null> {
  if (!token.startsWith("ar_live_") || token.length > 200) return null;
  const rows = await db
    .select({ agent: s.agents, tokenId: s.agentTokens.id, lastUsed: s.agentTokens.lastUsedAt })
    .from(s.agentTokens)
    .innerJoin(s.agents, eq(s.agents.id, s.agentTokens.agentId))
    .where(and(eq(s.agentTokens.tokenHash, sha256(token)), isNull(s.agentTokens.revokedAt)));
  const r = rows[0];
  if (!r || r.agent.state === "disabled") return null;
  if (!r.lastUsed || Date.now() - r.lastUsed.getTime() > 30_000) {
    await db.update(s.agentTokens).set({ lastUsedAt: new Date() }).where(eq(s.agentTokens.id, r.tokenId));
  }
  return r.agent;
}

const lastTouch = new Map<string, number>();
export async function touchAgent(agentId: string, force = false) {
  const now = Date.now();
  if (!force && now - (lastTouch.get(agentId) ?? 0) < 5000) return;
  lastTouch.set(agentId, now);
  await db.update(s.agents).set({ lastSeenAt: new Date() }).where(eq(s.agents.id, agentId));
}

export async function setStatus(agentId: string, state: string, activity: string) {
  if (!["waiting", "working", "blocked", "error"].includes(state)) throw new RelayError("invalid_input", "state must be waiting|working|blocked|error");
  await db.update(s.agents).set({ statusState: state, statusActivity: activity.slice(0, 200), lastSeenAt: new Date() }).where(eq(s.agents.id, agentId));
  await publish("presence.updated", { agent_id: agentId, status: { state, activity } });
}

export async function pendingCounts(): Promise<Map<string, number>> {
  const rows = await db
    .select({ agentId: s.inboxItems.agentId, n: sql<number>`count(*)::int` })
    .from(s.inboxItems)
    .where(or(eq(s.inboxItems.state, "pending"), and(eq(s.inboxItems.state, "delivered"), lt(s.inboxItems.leaseExpiresAt, sql`now()`))))
    .groupBy(s.inboxItems.agentId);
  return new Map(rows.map((r) => [r.agentId, r.n]));
}

export function toAgentView(a: AgentRow, pending = 0) {
  const waiting = hasWaiter(a.id);
  return {
    id: a.id,
    name: a.name,
    display_name: a.displayName,
    type: a.type,
    description: a.description,
    capabilities: a.capabilitiesJson,
    color: a.color,
    state: a.state,
    wait_mode: a.waitMode,
    last_seen_at: a.lastSeenAt,
    presence: a.state === "disabled" ? "offline" : presenceOf(a.lastSeenAt, waiting),
    waiting,
    status: { state: a.statusState, activity: a.statusActivity },
    inbox_pending: pending,
    created_at: a.createdAt,
  };
}

export async function getAgentView(id: string) {
  const [a] = await db.select().from(s.agents).where(eq(s.agents.id, id));
  if (!a) throw new RelayError("not_found", "Agent not found");
  return toAgentView(a, (await pendingCounts()).get(id) ?? 0);
}

export async function listAgentViews(includeDisabled = false) {
  const rows = await db.select().from(s.agents).orderBy(asc(s.agents.name));
  const pc = await pendingCounts();
  const tokens = await db
    .select({ id: s.agentTokens.id, agentId: s.agentTokens.agentId, prefix: s.agentTokens.prefix, lastUsedAt: s.agentTokens.lastUsedAt, createdAt: s.agentTokens.createdAt })
    .from(s.agentTokens)
    .where(isNull(s.agentTokens.revokedAt));
  return rows
    .filter((a) => includeDisabled || a.state !== "disabled")
    .map((a) => ({
      ...toAgentView(a, pc.get(a.id) ?? 0),
      tokens: tokens.filter((t) => t.agentId === a.id).map((t) => ({ id: t.id, prefix: t.prefix, last_used_at: t.lastUsedAt, created_at: t.createdAt })),
    }));
}

export async function listParticipants(includeOffline = true) {
  const agents = (await listAgentViews()).filter((a) => includeOffline || a.presence !== "offline");
  const users = await db.select().from(s.users);
  return {
    agents: agents.map((a) => ({ name: a.name, kind: "agent", type: a.type, capabilities: a.capabilities, presence: a.presence, status: a.status, state: a.state, description: a.description })),
    humans: users.map((u) => ({ name: userHandle(u), kind: "user", display_name: u.name })),
  };
}

// ───────────────────────── rooms & membership ─────────────────────────
export type RoomRow = typeof s.rooms.$inferSelect;

export function toRoomView(r: RoomRow, memberCount?: number) {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    topic: r.topic,
    pinned_instructions: r.pinnedInstructions,
    visibility: r.visibility,
    state: r.state,
    pause_reason: r.pauseReason,
    hop_count: r.hopCount,
    hop_limit: r.hopLimit,
    humans_wake_all: r.humansWakeAll,
    last_seq: r.lastSeq,
    created_by: r.createdBy,
    created_at: r.createdAt,
    member_count: memberCount,
  };
}

export async function getRoom(id: string, d: DbLike = db) {
  const [r] = await d.select().from(s.rooms).where(eq(s.rooms.id, id));
  if (!r) throw new RelayError("not_found", "Room not found");
  return r;
}

export async function getMembers(roomId: string) {
  const rows = await db.select().from(s.roomMembers).where(eq(s.roomMembers.roomId, roomId));
  const agentIds = rows.filter((m) => m.participantKind === "agent").map((m) => m.participantId);
  const userIds = rows.filter((m) => m.participantKind === "user").map((m) => m.participantId);
  const agents = agentIds.length ? await db.select().from(s.agents).where(inArray(s.agents.id, agentIds)) : [];
  const users = userIds.length ? await db.select().from(s.users).where(inArray(s.users.id, userIds)) : [];
  return rows.map((m) => {
    if (m.participantKind === "agent") {
      const a = agents.find((x) => x.id === m.participantId);
      return { kind: "agent", id: m.participantId, name: a?.name ?? "?", display_name: a?.displayName ?? "?", type: a?.type, color: a?.color, notify_mode: m.notifyMode, presence: a ? toAgentView(a).presence : "offline", status: a ? { state: a.statusState, activity: a.statusActivity } : null, agent_state: a?.state };
    }
    const u = users.find((x) => x.id === m.participantId);
    return { kind: "user", id: m.participantId, name: u ? userHandle(u) : "?", display_name: u?.name ?? "?", notify_mode: m.notifyMode };
  });
}

export async function isMember(roomId: string, kind: "agent" | "user", id: string, d: DbLike = db) {
  const [m] = await d
    .select()
    .from(s.roomMembers)
    .where(and(eq(s.roomMembers.roomId, roomId), eq(s.roomMembers.participantKind, kind), eq(s.roomMembers.participantId, id)));
  return !!m;
}

export async function assertMember(roomId: string, actor: Actor) {
  if (actor.kind === "user") return;
  if (!(await isMember(roomId, "agent", actor.id))) throw new RelayError("forbidden", "You are not a member of this room", { status: 403 });
}

export async function resolveParticipant(name: string): Promise<{ kind: "agent" | "user"; id: string; name: string }> {
  const n = name.trim().replace(/^@/, "").toLowerCase();
  const [a] = await db.select().from(s.agents).where(eq(s.agents.name, n));
  if (a && a.state !== "disabled") return { kind: "agent", id: a.id, name: a.name };
  const users = await db.select().from(s.users);
  const u = users.find((x) => userHandle(x) === n || x.email === n || x.name.toLowerCase() === n);
  if (u) return { kind: "user", id: u.id, name: userHandle(u) };
  throw new RelayError("recipient_not_found", `No agent or human named '${name}'. Call list_agents to see valid names.`);
}

export async function addMember(actor: Actor, roomId: string, kind: "agent" | "user", id: string, notify?: NotifyMode) {
  const room = await getRoom(roomId);
  if (room.kind === "dm") throw new RelayError("invalid_input", "Cannot change members of a DM");
  await db
    .insert(s.roomMembers)
    .values({ roomId, participantKind: kind, participantId: id, notifyMode: notify ?? (kind === "user" ? "all" : "mentions_only") })
    .onConflictDoNothing();
  await audit(actor, "room.member_add", roomId, { kind, id });
  await publish("room.updated", { room_id: roomId });
}

export async function removeMember(actor: Actor, roomId: string, kind: "agent" | "user", id: string) {
  await db.delete(s.roomMembers).where(and(eq(s.roomMembers.roomId, roomId), eq(s.roomMembers.participantKind, kind), eq(s.roomMembers.participantId, id)));
  await audit(actor, "room.member_remove", roomId, { kind, id });
  await publish("room.updated", { room_id: roomId });
}

export async function setNotifyMode(roomId: string, kind: "agent" | "user", id: string, mode: NotifyMode) {
  if (!["all", "mentions_only", "none"].includes(mode)) throw new RelayError("invalid_input", "invalid notify mode");
  await db
    .update(s.roomMembers)
    .set({ notifyMode: mode })
    .where(and(eq(s.roomMembers.roomId, roomId), eq(s.roomMembers.participantKind, kind), eq(s.roomMembers.participantId, id)));
  await publish("room.updated", { room_id: roomId });
}

export async function createRoom(
  actor: Actor,
  i: { name: string; topic?: string; pinnedInstructions?: string; members?: string[]; visibility?: string; hopLimit?: number },
) {
  await ensureWorkspace();
  const name = i.name.trim().replace(/^#/, "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(name)) throw new RelayError("invalid_input", "room name must be a slug (a-z, 0-9, _ -)");
  const [dupe] = await db.select().from(s.rooms).where(and(eq(s.rooms.name, name), eq(s.rooms.kind, "group")));
  if (dupe) throw new RelayError("conflict", `Room '${name}' already exists`, { status: 409 });
  const st = await getSettings();
  const id = newId("room");
  await db.insert(s.rooms).values({
    id,
    workspaceId: WS_ID,
    name,
    topic: i.topic ?? "",
    pinnedInstructions: i.pinnedInstructions ?? "",
    visibility: i.visibility === "private" ? "private" : "open",
    hopLimit: i.hopLimit && i.hopLimit > 0 ? Math.floor(i.hopLimit) : st.hopLimit,
    createdBy: `${actor.kind}:${actor.id}`,
  });
  await db.insert(s.roomMembers).values({ roomId: id, participantKind: actor.kind, participantId: actor.id, notifyMode: actor.kind === "user" ? "all" : "mentions_only" }).onConflictDoNothing();
  for (const m of i.members ?? []) {
    const p = await resolveParticipant(m);
    await db.insert(s.roomMembers).values({ roomId: id, participantKind: p.kind, participantId: p.id, notifyMode: p.kind === "user" ? "all" : "mentions_only" }).onConflictDoNothing();
  }
  await audit(actor, "room.create", id, { name });
  await publish("room.updated", { room_id: id });
  return toRoomView(await getRoom(id));
}

export async function updateRoom(
  actor: Actor,
  id: string,
  p: Partial<{ topic: string; pinnedInstructions: string; hopLimit: number; humansWakeAll: boolean | null; state: string; visibility: string; name: string }>,
) {
  const set: Partial<typeof s.rooms.$inferInsert> = {};
  if (p.topic !== undefined) set.topic = p.topic;
  if (p.pinnedInstructions !== undefined) set.pinnedInstructions = p.pinnedInstructions;
  if (p.hopLimit !== undefined && p.hopLimit >= 1) set.hopLimit = Math.floor(p.hopLimit);
  if (p.humansWakeAll !== undefined) set.humansWakeAll = p.humansWakeAll;
  if (p.visibility === "open" || p.visibility === "private") set.visibility = p.visibility;
  if (p.name) set.name = p.name.replace(/^#/, "").toLowerCase();
  if (p.state === "archived" || (p.state === "active" && (await getRoom(id)).state === "archived")) set.state = p.state;
  if (Object.keys(set).length) await db.update(s.rooms).set(set).where(eq(s.rooms.id, id));
  await audit(actor, "room.update", id, set as Record<string, unknown>);
  await publish("room.updated", { room_id: id });
  return toRoomView(await getRoom(id));
}

export async function setRoomState(actor: Actor, id: string, state: "paused" | "active", reason = "operator") {
  const room = await getRoom(id);
  if (room.state === "archived") throw new RelayError("conflict", "Room is archived", { status: 409 });
  await db
    .update(s.rooms)
    .set({ state, pauseReason: state === "paused" ? reason : "", hopCount: state === "active" ? 0 : room.hopCount })
    .where(eq(s.rooms.id, id));
  await audit(actor, state === "paused" ? "room.pause" : "room.resume", id, { reason });
  await sendMessage(SYSTEM, { roomId: id, content: state === "paused" ? `Room paused by ${actor.name}.` : `Room resumed by ${actor.name}.`, type: "system", skipGuards: true });
  await publish(state === "paused" ? "room.paused" : "room.resumed", { room_id: id, reason });
  return toRoomView(await getRoom(id));
}

export async function listRoomsFor(actor: Actor, scope: "mine" | "open" | "all" = "mine") {
  const rooms = await db.select().from(s.rooms).where(sql`${s.rooms.state} <> 'archived'`).orderBy(asc(s.rooms.name));
  const members = await db.select().from(s.roomMembers);
  const agents = await db.select().from(s.agents);
  const users = await db.select().from(s.users);
  const out = [];
  for (const r of rooms) {
    const ms = members.filter((m) => m.roomId === r.id);
    const mine = ms.some((m) => m.participantKind === actor.kind && m.participantId === actor.id);
    if (actor.kind === "agent" && scope === "mine" && !mine) continue;
    if (actor.kind === "agent" && scope === "open" && (mine || r.visibility !== "open" || r.kind === "dm")) continue;
    const names = ms.map((m) =>
      m.participantKind === "agent" ? agents.find((a) => a.id === m.participantId)?.name ?? "?" : users.find((u) => u.id === m.participantId) ? userHandle(users.find((u) => u.id === m.participantId)!) : "?",
    );
    out.push({ ...toRoomView(r, ms.length), is_member: mine, members: r.kind === "dm" ? names : undefined });
  }
  return out;
}

export async function joinRoom(agent: AgentRow, roomId: string) {
  const room = await getRoom(roomId);
  if (room.kind !== "group" || room.visibility !== "open" || room.state === "archived") throw new RelayError("forbidden", "Room is not open for joining", { status: 403 });
  await db.insert(s.roomMembers).values({ roomId, participantKind: "agent", participantId: agent.id, notifyMode: "mentions_only" }).onConflictDoNothing();
  await publish("room.updated", { room_id: roomId });
  return toRoomView(room);
}
export async function leaveRoom(agent: AgentRow, roomId: string) {
  const room = await getRoom(roomId);
  if (room.kind === "dm") throw new RelayError("invalid_input", "Cannot leave a DM");
  await db.delete(s.roomMembers).where(and(eq(s.roomMembers.roomId, roomId), eq(s.roomMembers.participantKind, "agent"), eq(s.roomMembers.participantId, agent.id)));
  await publish("room.updated", { room_id: roomId });
  return toRoomView(room);
}

export async function getRoomContext(roomId: string) {
  const room = await getRoom(roomId);
  return { room: toRoomView(room), topic: room.topic, pinned_instructions: room.pinnedInstructions, members: await getMembers(roomId) };
}

async function getOrCreateDm(a: { kind: "agent" | "user"; id: string }, b: { kind: "agent" | "user"; id: string }) {
  const key = [`${a.kind}:${a.id}`, `${b.kind}:${b.id}`].sort().join("|");
  const [ex] = await db.select().from(s.rooms).where(eq(s.rooms.dmKey, key));
  if (ex) return ex;
  const id = newId("room");
  const st = await getSettings();
  await db.insert(s.rooms).values({ id, workspaceId: WS_ID, name: "dm", kind: "dm", dmKey: key, visibility: "private", hopLimit: st.hopLimit, createdBy: `${a.kind}:${a.id}` }).onConflictDoNothing();
  const room = await db.select().from(s.rooms).where(eq(s.rooms.dmKey, key));
  for (const p of [a, b]) await db.insert(s.roomMembers).values({ roomId: room[0].id, participantKind: p.kind, participantId: p.id, notifyMode: "all" }).onConflictDoNothing();
  await publish("room.updated", { room_id: room[0].id });
  return room[0];
}

// ───────────────────────── messages ─────────────────────────
export type MessageRow = typeof s.messages.$inferSelect;

export async function hydrate(rows: MessageRow[], extra: { redelivered?: Set<string> } = {}) {
  if (!rows.length) return [];
  const agentIds = [...new Set(rows.filter((r) => r.senderKind === "agent").map((r) => r.senderId))];
  const userIds = [...new Set(rows.filter((r) => r.senderKind === "user").map((r) => r.senderId))];
  const roomIds = [...new Set(rows.map((r) => r.roomId))];
  const [agents, users, rooms, atts] = await Promise.all([
    agentIds.length ? db.select().from(s.agents).where(inArray(s.agents.id, agentIds)) : [],
    userIds.length ? db.select().from(s.users).where(inArray(s.users.id, userIds)) : [],
    db.select().from(s.rooms).where(inArray(s.rooms.id, roomIds)),
    db
      .select({ messageId: s.messageAttachments.messageId, id: s.artifacts.id, name: s.artifacts.name, mime: s.artifacts.mime, size: s.artifacts.size })
      .from(s.messageAttachments)
      .innerJoin(s.artifacts, eq(s.artifacts.id, s.messageAttachments.artifactId))
      .where(inArray(s.messageAttachments.messageId, rows.map((r) => r.id))),
  ]);
  return rows.map((m) => {
    const a = agents.find((x) => x.id === m.senderId);
    const u = users.find((x) => x.id === m.senderId);
    const from =
      m.senderKind === "agent"
        ? { name: a?.name ?? "unknown", kind: "agent", type: a?.type, display_name: a?.displayName, color: a?.color }
        : m.senderKind === "user"
          ? { name: u ? userHandle(u) : "unknown", kind: "human", display_name: u?.name }
          : { name: "system", kind: "system" };
    const room = rooms.find((r) => r.id === m.roomId);
    return {
      id: m.id,
      room_id: m.roomId,
      room_name: room?.kind === "dm" ? "dm" : room?.name,
      seq: m.seq,
      from,
      type: m.type,
      content: m.deletedAt ? "[message deleted]" : m.content,
      reply_to: m.replyTo,
      thread_id: m.threadId,
      task_id: m.taskId,
      attachments: atts.filter((x) => x.messageId === m.id).map(({ messageId: _m, ...rest }) => rest),
      priority: m.priority,
      metadata: m.deletedAt ? {} : m.metadataJson,
      redelivered: extra.redelivered?.has(m.id) ?? false,
      edited_at: m.editedAt,
      deleted_at: m.deletedAt,
      created_at: m.createdAt,
    };
  });
}

export interface SendParams {
  roomId?: string;
  to?: string;
  content: string;
  type?: string;
  replyTo?: string;
  threadId?: string;
  attachments?: string[];
  metadata?: Record<string, unknown>;
  clientMessageId?: string;
  priority?: "normal" | "urgent";
  taskId?: string;
  forceRecipients?: string[];
  notify?: boolean;
  skipGuards?: boolean;
}
const MSG_TYPES = ["chat", "task", "result", "status", "system", "human_request"];

export async function sendMessage(sender: Sender, p: SendParams) {
  await ensureWorkspace();
  const type = p.type ?? "chat";
  if (!MSG_TYPES.includes(type)) throw new RelayError("invalid_input", `type must be one of ${MSG_TYPES.join(", ")}`);
  if (sender.kind === "user" && (type === "task" || type === "human_request" || type === "result")) {
    /* humans may only post chat/status/system via the API; others come from services */
  }
  if (!p.content || !p.content.trim()) throw new RelayError("invalid_input", "content must not be empty");
  if (Buffer.byteLength(p.content) > config.maxContentBytes)
    throw new RelayError("payload_too_large", `content exceeds ${config.maxContentBytes} bytes. Use upload_artifact and attach/link it instead.`);
  if (p.metadata && Buffer.byteLength(JSON.stringify(p.metadata)) > config.maxMetadataBytes) throw new RelayError("payload_too_large", "metadata exceeds 16 KB");

  let roomId = p.roomId;
  if (!roomId) {
    if (!p.to) throw new RelayError("invalid_input", "Provide room_id or to");
    const target = await resolveParticipant(p.to);
    if (target.kind === sender.kind && target.id === sender.id) throw new RelayError("invalid_input", "Cannot message yourself");
    if (sender.kind === "system") throw new RelayError("invalid_input", "system needs room_id");
    roomId = (await getOrCreateDm(sender as { kind: "agent" | "user"; id: string }, target)).id;
  }
  const rid = roomId;
  if (sender.kind === "agent" && !(await isMember(rid, "agent", sender.id))) throw new RelayError("forbidden", "You are not a member of this room", { status: 403 });
  if (sender.kind === "user" && !(await isMember(rid, "user", sender.id))) {
    await db.insert(s.roomMembers).values({ roomId: rid, participantKind: "user", participantId: sender.id, notifyMode: "all" }).onConflictDoNothing();
  }
  const st = await getSettings();

  const result = await db.transaction(async (tx) => {
    const [room] = await tx.select().from(s.rooms).where(eq(s.rooms.id, rid)).for("update");
    if (!room) throw new RelayError("not_found", "Room not found");
    if (room.state === "archived") throw new RelayError("conflict", "Room is archived", { status: 409 });
    if (sender.kind === "agent" && room.state === "paused" && !p.skipGuards)
      throw new RelayError("room_paused", `Room is paused (${room.pauseReason || "operator"}). Wait for a human to resume it.`);

    if (p.clientMessageId && sender.kind !== "system") {
      const [ex] = await tx
        .select()
        .from(s.messages)
        .where(and(eq(s.messages.senderId, sender.id), eq(s.messages.clientMessageId, p.clientMessageId), sql`${s.messages.createdAt} > now() - interval '24 hours'`));
      if (ex) return { row: ex, deduplicated: true, recipients: [] as string[], tripped: false, warn: false, warnings: [] as string[], hop: room.hopCount, hopLimit: room.hopLimit, resumed: false };
    }
    if (sender.kind === "agent" && !p.skipGuards) {
      const [last] = await tx.select().from(s.messages).where(eq(s.messages.roomId, rid)).orderBy(desc(s.messages.seq)).limit(1);
      if (last && last.senderId === sender.id && last.senderKind === "agent" && last.content.trim() === p.content.trim() && last.type === type)
        throw new RelayError("duplicate_message", "Identical consecutive message blocked (echo guard). Do not repeat yourself.");
    }

    const members = await tx.select().from(s.roomMembers).where(eq(s.roomMembers.roomId, rid));
    const names = parseMentions(p.content);
    const warnings: string[] = [];
    const mentioned: { kind: "agent" | "user"; id: string }[] = [];
    if (names.length) {
      const ags = await tx.select().from(s.agents).where(inArray(s.agents.name, names));
      const usrs = (await tx.select().from(s.users)).filter((u) => names.includes(userHandle(u)));
      for (const a of ags) {
        mentioned.push({ kind: "agent", id: a.id });
        if (!members.some((m) => m.participantKind === "agent" && m.participantId === a.id)) {
          if (st.autoAddMentions && room.kind === "group") {
            await tx.insert(s.roomMembers).values({ roomId: rid, participantKind: "agent", participantId: a.id, notifyMode: "mentions_only" }).onConflictDoNothing();
            members.push({ roomId: rid, participantKind: "agent", participantId: a.id, notifyMode: "mentions_only", joinedAt: new Date() });
            warnings.push(`@${a.name} was not a member and was auto-added.`);
          } else warnings.push(`@${a.name} is not a member of this room and will not be notified.`);
        }
      }
      for (const u of usrs) mentioned.push({ kind: "user", id: u.id });
    }

    const seq = room.lastSeq + 1;
    const id = newId("msg");
    const priority = sender.kind === "user" ? "urgent" : (p.priority ?? "normal");
    const [row] = await tx
      .insert(s.messages)
      .values({
        id,
        roomId: rid,
        seq,
        senderKind: sender.kind,
        senderId: sender.id,
        type,
        content: p.content,
        replyTo: p.replyTo ?? null,
        threadId: p.threadId ?? p.replyTo ?? null,
        taskId: p.taskId ?? null,
        metadataJson: p.metadata ?? {},
        priority,
        clientMessageId: p.clientMessageId ?? null,
      })
      .returning();
    if (mentioned.length) await tx.insert(s.messageMentions).values(mentioned.map((m) => ({ messageId: id, participantKind: m.kind, participantId: m.id }))).onConflictDoNothing();
    if (p.attachments?.length) {
      const found = await tx.select({ id: s.artifacts.id }).from(s.artifacts).where(inArray(s.artifacts.id, p.attachments));
      if (found.length !== new Set(p.attachments).size) throw new RelayError("not_found", "One or more attachments do not exist");
      await tx.insert(s.messageAttachments).values(found.map((f) => ({ messageId: id, artifactId: f.id }))).onConflictDoNothing();
    }

    // loop guard
    let hopCount = room.hopCount;
    let tripped = false;
    let warn = false;
    let resumed = false;
    let lastSeq = seq;
    let state = room.state;
    let pauseReason = room.pauseReason;
    if (!p.skipGuards) {
      const h = nextHop({ hopCount: room.hopCount, hopLimit: room.hopLimit }, sender.kind);
      hopCount = h.hopCount;
      tripped = h.tripped;
      warn = h.warn;
    }
    if (sender.kind === "user" && room.state === "paused" && room.pauseReason === "loop_guard") {
      state = "active";
      pauseReason = "";
      resumed = true;
    }
    if (tripped) {
      state = "paused";
      pauseReason = "loop_guard";
      lastSeq = seq + 1;
      await tx.insert(s.messages).values({
        id: newId("msg"),
        roomId: rid,
        seq: lastSeq,
        senderKind: "system",
        senderId: "system",
        type: "system",
        content: `Room paused by loop guard: ${hopCount} consecutive agent messages without human input (limit ${room.hopLimit}). A human can press Resume or send a message to continue.`,
        priority: "normal",
      });
    }
    await tx.update(s.rooms).set({ lastSeq, hopCount, state, pauseReason }).where(eq(s.rooms.id, rid));

    const wakeAll = room.humansWakeAll ?? members.length <= 3;
    const recipients = computeRecipients({
      roomKind: room.kind as "dm" | "group",
      members: members.map((m) => ({ kind: m.participantKind as "agent" | "user", id: m.participantId, notifyMode: m.notifyMode as NotifyMode })),
      sender,
      type,
      mentionedAgentIds: mentioned.filter((m) => m.kind === "agent").map((m) => m.id),
      humansWakeAll: wakeAll,
      forceRecipients: p.forceRecipients,
      notifySystem: p.notify,
    });
    if (recipients.length)
      await tx
        .insert(s.inboxItems)
        .values(recipients.map((agentId) => ({ id: newId("inb"), agentId, messageId: id, priority })))
        .onConflictDoNothing();
    return { row, deduplicated: false, recipients, tripped, warn, warnings, hop: hopCount, hopLimit: room.hopLimit, resumed };
  });

  if (!result.deduplicated) {
    const [view] = await hydrate([result.row]);
    await publish("message.created", { room_id: rid, message: view });
    for (const a of result.recipients) notifyAgent(a);
    if (result.tripped) await publish("room.paused", { room_id: rid, reason: "loop_guard" });
    if (result.resumed) await publish("room.resumed", { room_id: rid });
    if (result.tripped || result.resumed) await publish("message.created", { room_id: rid, refresh: true });
    if (result.tripped) await audit({ kind: "system", id: "system" }, "room.pause", rid, { reason: "loop_guard" });
    if (sender.kind === "agent") await touchAgent(sender.id);
  }
  return {
    message: { id: result.row.id, seq: result.row.seq, room_id: rid, created_at: result.row.createdAt },
    deduplicated: result.deduplicated,
    warnings: result.warnings,
    hop: { count: result.hop, limit: result.hopLimit, warn: result.warn },
    room_paused: result.tripped,
  };
}

export async function readMessages(roomId: string, o: { beforeSeq?: number; afterSeq?: number; limit?: number; threadId?: string } = {}) {
  const limit = Math.min(Math.max(o.limit ?? 50, 1), 200);
  const conds = [eq(s.messages.roomId, roomId)];
  if (o.beforeSeq) conds.push(sql`${s.messages.seq} < ${o.beforeSeq}`);
  if (o.afterSeq) conds.push(sql`${s.messages.seq} > ${o.afterSeq}`);
  if (o.threadId) conds.push(or(eq(s.messages.threadId, o.threadId), eq(s.messages.id, o.threadId))!);
  const asc_ = !!o.afterSeq && !o.beforeSeq;
  const rows = await db
    .select()
    .from(s.messages)
    .where(and(...conds))
    .orderBy(asc_ ? asc(s.messages.seq) : desc(s.messages.seq))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  if (!asc_) page.reverse();
  return { messages: await hydrate(page), next_cursor: hasMore ? (asc_ ? page[page.length - 1].seq : page[0].seq) : null, has_more: hasMore };
}

export async function searchMessages(actor: Actor, q: string, o: { roomId?: string; from?: string; limit?: number } = {}) {
  const conds = [isNull(s.messages.deletedAt)];
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  conds.push(sql`(to_tsvector('simple', ${s.messages.content}) @@ plainto_tsquery('simple', ${q}) OR ${s.messages.content} ILIKE ${like})`);
  if (o.roomId) conds.push(eq(s.messages.roomId, o.roomId));
  if (actor.kind === "agent") {
    const mine = await db.select({ r: s.roomMembers.roomId }).from(s.roomMembers).where(and(eq(s.roomMembers.participantKind, "agent"), eq(s.roomMembers.participantId, actor.id)));
    if (!mine.length) return [];
    conds.push(inArray(s.messages.roomId, mine.map((m) => m.r)));
  }
  if (o.from) {
    const p = await resolveParticipant(o.from).catch(() => null);
    if (!p) return [];
    conds.push(eq(s.messages.senderId, p.id));
  }
  const rows = await db.select().from(s.messages).where(and(...conds)).orderBy(desc(s.messages.createdAt)).limit(Math.min(o.limit ?? 20, 100));
  return hydrate(rows);
}

export async function editMessage(actor: Actor, id: string, content: string) {
  if (Buffer.byteLength(content) > config.maxContentBytes) throw new RelayError("payload_too_large", "content too large");
  const [r] = await db.update(s.messages).set({ content, editedAt: new Date() }).where(and(eq(s.messages.id, id), isNull(s.messages.deletedAt))).returning();
  if (!r) throw new RelayError("not_found", "Message not found");
  await audit(actor, "message.edit", id);
  const [v] = await hydrate([r]);
  await publish("message.updated", { room_id: r.roomId, message: v });
  return v;
}
export async function deleteMessage(actor: Actor, id: string) {
  const [r] = await db.update(s.messages).set({ deletedAt: new Date() }).where(eq(s.messages.id, id)).returning();
  if (!r) throw new RelayError("not_found", "Message not found");
  await audit(actor, "message.delete", id, { room_id: r.roomId });
  const [v] = await hydrate([r]);
  await publish("message.updated", { room_id: r.roomId, message: v });
}

// ───────────────────────── tasks ─────────────────────────
const TASK_STATUSES = ["queued", "in_progress", "blocked", "done", "failed", "cancelled"];
type TaskRow = typeof s.tasks.$inferSelect;

async function taskView(t: TaskRow) {
  const [assignee] = await db.select().from(s.agents).where(eq(s.agents.id, t.assigneeAgentId));
  let creator = t.creatorId;
  if (t.creatorKind === "agent") creator = (await db.select().from(s.agents).where(eq(s.agents.id, t.creatorId)))[0]?.name ?? t.creatorId;
  else if (t.creatorKind === "user") {
    const u = (await db.select().from(s.users).where(eq(s.users.id, t.creatorId)))[0];
    creator = u ? userHandle(u) : t.creatorId;
  }
  return {
    id: t.id,
    room_id: t.roomId,
    title: t.title,
    description: t.description,
    acceptance_criteria: t.acceptanceCriteria,
    creator: { kind: t.creatorKind, name: creator },
    assignee: assignee?.name,
    status: t.status,
    priority: t.priority,
    due_at: t.dueAt,
    parent_task_id: t.parentTaskId,
    result_summary: t.resultSummary,
    result_artifacts: t.resultArtifacts,
    history: t.history,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

export async function createTask(
  actor: Actor,
  i: { title: string; description?: string; assignee: string; roomId?: string; priority?: string; acceptanceCriteria?: string; due?: string; parentTaskId?: string },
) {
  if (!i.title?.trim()) throw new RelayError("invalid_input", "title required");
  const target = await resolveParticipant(i.assignee);
  if (target.kind !== "agent") throw new RelayError("invalid_input", "Tasks can only be assigned to agents");
  let roomId = i.roomId;
  if (roomId) {
    await assertMember(roomId, actor);
    if (!(await isMember(roomId, "agent", target.id))) await addMember(actor, roomId, "agent", target.id);
  } else roomId = (await getOrCreateDm(actor, target)).id;
  const priority = i.priority === "urgent" || i.priority === "low" || i.priority === "high" ? i.priority : "normal";
  const id = newId("task");
  const due = i.due ? new Date(i.due) : null;
  if (due && isNaN(due.getTime())) throw new RelayError("invalid_input", "due is not a valid date");
  const [t] = await db
    .insert(s.tasks)
    .values({
      id,
      roomId,
      title: i.title.trim(),
      description: i.description ?? "",
      acceptanceCriteria: i.acceptanceCriteria ?? "",
      creatorKind: actor.kind,
      creatorId: actor.id,
      assigneeAgentId: target.id,
      priority,
      dueAt: due,
      parentTaskId: i.parentTaskId ?? null,
      history: [{ at: new Date().toISOString(), by: actor.name, status: "queued" }],
    })
    .returning();
  const content = [`**Task: ${t.title}** (\`${id}\`, priority ${priority})`, "", t.description, t.acceptanceCriteria ? `\n**Acceptance criteria:**\n${t.acceptanceCriteria}` : "", due ? `\n**Due:** ${due.toISOString()}` : ""].join("\n").trim();
  await sendMessage(actor, { roomId, content, type: "task", taskId: id, metadata: { task_id: id, assignee: target.name }, forceRecipients: [target.id], priority: priority === "urgent" ? "urgent" : "normal", skipGuards: actor.kind === "user" ? false : false });
  await audit(actor, "task.create", id, { assignee: target.name });
  const v = await taskView(t);
  await publish("task.updated", { task: v });
  return v;
}

export async function updateTask(actor: Actor, id: string, p: { status?: string; resultSummary?: string; artifacts?: string[]; note?: string }) {
  const [t] = await db.select().from(s.tasks).where(eq(s.tasks.id, id));
  if (!t) throw new RelayError("not_found", "Task not found");
  if (actor.kind === "agent" && actor.id !== t.assigneeAgentId && !(t.creatorKind === "agent" && t.creatorId === actor.id))
    throw new RelayError("forbidden", "Only the assignee or creator can update this task", { status: 403 });
  if (p.status && !TASK_STATUSES.includes(p.status)) throw new RelayError("invalid_input", `status must be one of ${TASK_STATUSES.join(", ")}`);
  const status = p.status ?? t.status;
  const history = [...t.history, { at: new Date().toISOString(), by: actor.name, status, note: p.note }];
  const [u] = await db
    .update(s.tasks)
    .set({ status, resultSummary: p.resultSummary ?? t.resultSummary, resultArtifacts: p.artifacts ?? t.resultArtifacts, history, updatedAt: new Date() })
    .where(eq(s.tasks.id, id))
    .returning();
  const final = ["done", "failed", "cancelled"].includes(status);
  const lines = [`Task \`${id}\` **${t.title}** → **${status}**`];
  if (p.resultSummary) lines.push("", p.resultSummary);
  if (p.note) lines.push("", `_Note:_ ${p.note}`);
  const force: string[] = [];
  if (t.creatorKind === "agent" && t.creatorId !== actor.id) force.push(t.creatorId);
  if (actor.kind === "user") force.push(t.assigneeAgentId);
  try {
    await sendMessage(actor, { roomId: t.roomId, content: lines.join("\n"), type: final ? "result" : "status", taskId: id, metadata: { task_id: id, status }, forceRecipients: force, attachments: p.artifacts, priority: final ? "urgent" : "normal", skipGuards: false });
  } catch (e) {
    if (!(e instanceof RelayError && (e.code === "room_paused" || e.code === "duplicate_message"))) throw e;
  }
  await audit(actor, "task.update", id, { status });
  const v = await taskView(u);
  await publish("task.updated", { task: v });
  return v;
}

export async function listTasks(f: { assignee?: string; status?: string; roomId?: string; actor?: Actor } = {}) {
  const conds = [];
  if (f.assignee) {
    const p = await resolveParticipant(f.assignee).catch(() => null);
    conds.push(eq(s.tasks.assigneeAgentId, p?.id ?? "none"));
  }
  if (f.status) conds.push(eq(s.tasks.status, f.status));
  if (f.roomId) conds.push(eq(s.tasks.roomId, f.roomId));
  if (f.actor?.kind === "agent") {
    const mine = await db.select({ r: s.roomMembers.roomId }).from(s.roomMembers).where(and(eq(s.roomMembers.participantKind, "agent"), eq(s.roomMembers.participantId, f.actor.id)));
    conds.push(inArray(s.tasks.roomId, mine.map((m) => m.r).concat("none")));
  }
  const rows = await db.select().from(s.tasks).where(conds.length ? and(...conds) : undefined).orderBy(desc(s.tasks.updatedAt)).limit(300);
  return Promise.all(rows.map(taskView));
}

// ───────────────────────── artifacts ─────────────────────────
export async function uploadArtifact(actor: Actor, i: { name: string; mime?: string; contentText?: string; contentBase64?: string; roomId?: string }) {
  let buf: Buffer;
  if (i.contentText !== undefined) buf = Buffer.from(i.contentText, "utf8");
  else if (i.contentBase64 !== undefined) buf = Buffer.from(i.contentBase64, "base64");
  else throw new RelayError("invalid_input", "Provide content_text or content_base64");
  if (buf.length > config.maxArtifactBytes) throw new RelayError("payload_too_large", `Artifact exceeds ${config.maxArtifactBytes} bytes`);
  const roomId = i.roomId ?? GENERAL_ID;
  await assertMember(roomId, actor);
  const id = newId("art");
  const name = i.name.replace(/[\\/\0]/g, "_").slice(0, 200) || "file";
  const mime = i.mime || (i.contentText !== undefined ? "text/plain" : "application/octet-stream");
  await db.insert(s.artifacts).values({ id, roomId, uploaderKind: actor.kind, uploaderId: actor.id, name, mime, size: buf.length, storageKey: `db:${id}`, sha256: sha256(buf), content: buf });
  await audit(actor, "artifact.upload", id, { name, size: buf.length });
  return { id, name, mime, size: buf.length, sha256: sha256(buf), room_id: roomId, url: artifactUrl(id, true) };
}

export function artifactSig(id: string, exp: number) {
  return createHmac("sha256", config.sessionSecret).update(`${id}.${exp}`).digest("hex");
}
export function verifyArtifactSig(id: string, exp: number, sig: string) {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const a = Buffer.from(artifactSig(id, exp));
  const b = Buffer.from(sig || "");
  return a.length === b.length && timingSafeEqual(a, b);
}
export function artifactUrl(id: string, signed = false) {
  const base = `${config.publicUrl}/api/v1/artifacts/${id}/download`;
  if (!signed) return base;
  const exp = Math.floor(Date.now() / 1000) + 600;
  return `${base}?exp=${exp}&sig=${artifactSig(id, exp)}`;
}
const isTextual = (m: string) => m.startsWith("text/") || /json|xml|javascript|yaml|x-sh|diff|patch|markdown/.test(m);

export async function getArtifactBlob(actor: Actor, id: string) {
  const [a] = await db.select().from(s.artifacts).where(eq(s.artifacts.id, id));
  if (!a) throw new RelayError("not_found", "Artifact not found");
  await assertMember(a.roomId, actor);
  return { meta: { name: a.name, mime: a.mime }, content: a.content };
}

export async function getArtifact(actor: Actor, id: string) {
  const [a] = await db.select().from(s.artifacts).where(eq(s.artifacts.id, id));
  if (!a) throw new RelayError("not_found", "Artifact not found");
  await assertMember(a.roomId, actor);
  const meta = { id: a.id, name: a.name, mime: a.mime, size: a.size, sha256: a.sha256, room_id: a.roomId, created_at: a.createdAt };
  if (a.size <= 100 * 1024 && isTextual(a.mime)) return { ...meta, content_text: a.content.toString("utf8") };
  return { ...meta, url: artifactUrl(a.id, true), note: "Too large or binary for inline; fetch url (valid 10 min)." };
}
export async function getArtifactSigned(id: string) {
  const [a] = await db.select().from(s.artifacts).where(eq(s.artifacts.id, id));
  return a ?? null;
}
export async function listArtifacts(roomId: string) {
  const rows = await db
    .select({ id: s.artifacts.id, name: s.artifacts.name, mime: s.artifacts.mime, size: s.artifacts.size, sha256: s.artifacts.sha256, uploaderId: s.artifacts.uploaderId, createdAt: s.artifacts.createdAt })
    .from(s.artifacts)
    .where(eq(s.artifacts.roomId, roomId))
    .orderBy(desc(s.artifacts.createdAt))
    .limit(100);
  return rows;
}

// ───────────────────────── human-in-the-loop ─────────────────────────
export async function requestHumanInput(agent: AgentRow, i: { question: string; options?: string[]; roomId?: string; urgency?: string }) {
  const roomId = i.roomId ?? GENERAL_ID;
  const id = newId("hreq");
  const options = (i.options ?? []).slice(0, 10);
  const sent = await sendMessage(
    { kind: "agent", id: agent.id, name: agent.name },
    { roomId, content: i.question, type: "human_request", metadata: { request_id: id, options, urgency: i.urgency ?? "normal" }, skipGuards: true },
  );
  await db.insert(s.humanRequests).values({ id, roomId, agentId: agent.id, messageId: sent.message.id, question: i.question, optionsJson: options, urgency: i.urgency === "high" ? "high" : "normal" });
  await publish("human_request.created", { request_id: id, room_id: roomId, agent: agent.name, question: i.question });
  return { request_id: id, message_id: sent.message.id, note: "The answer will arrive in your inbox as a reply message (wait_for_message)." };
}

export async function listHumanRequests(status?: string) {
  const rows = await db.select().from(s.humanRequests).where(status ? eq(s.humanRequests.status, status) : undefined).orderBy(desc(s.humanRequests.createdAt)).limit(200);
  const agents = await db.select().from(s.agents);
  return rows.map((r) => ({
    id: r.id,
    room_id: r.roomId,
    agent: agents.find((a) => a.id === r.agentId)?.name ?? r.agentId,
    message_id: r.messageId,
    question: r.question,
    options: r.optionsJson,
    urgency: r.urgency,
    status: r.status,
    answer: r.answer,
    created_at: r.createdAt,
    answered_at: r.answeredAt,
  }));
}

export async function answerHumanRequest(actor: Actor, id: string, answer: string) {
  const [r] = await db.select().from(s.humanRequests).where(eq(s.humanRequests.id, id));
  if (!r) throw new RelayError("not_found", "Request not found");
  if (r.status !== "open") throw new RelayError("conflict", "Request already answered", { status: 409 });
  await db.update(s.humanRequests).set({ status: "answered", answer, answeredBy: actor.id, answeredAt: new Date() }).where(eq(s.humanRequests.id, id));
  await sendMessage(actor, { roomId: r.roomId, content: answer, type: "chat", replyTo: r.messageId, forceRecipients: [r.agentId], metadata: { request_id: id, answer, in_reply_to_request: r.question.slice(0, 200) }, priority: "urgent" });
  await audit(actor, "human_request.answer", id);
  await publish("human_request.answered", { request_id: id, room_id: r.roomId });
}

// ───────────────────────── logs / observability ─────────────────────────
export async function logActivity(agentId: string, tool: string, status: string, durationMs: number, errorCode?: string, summary?: string) {
  await db.insert(s.toolActivity).values({ agentId, tool, status, durationMs, errorCode: errorCode ?? null, summary: summary ?? null }).catch(() => {});
  if (tool !== "wait_for_message" || status !== "ok" || Math.random() < 0.1) await publish("activity.created", { agent_id: agentId, tool, status });
}

export async function listActivity(agentId?: string, limit = 100) {
  const rows = await db.select().from(s.toolActivity).where(agentId ? eq(s.toolActivity.agentId, agentId) : undefined).orderBy(desc(s.toolActivity.id)).limit(Math.min(limit, 500));
  const agents = await db.select().from(s.agents);
  const st = await getSettings();
  return rows.map((r) => ({ id: r.id, agent: agents.find((a) => a.id === r.agentId)?.name ?? r.agentId, tool: r.tool, status: r.status, duration_ms: r.durationMs, error_code: r.errorCode, summary: st.redactActivity ? null : r.summary, created_at: r.createdAt }));
}

export async function listAudit(limit = 200) {
  return db.select().from(s.auditLogs).orderBy(desc(s.auditLogs.id)).limit(Math.min(limit, 500));
}

export async function listDeadLetters() {
  const rows = await db
    .select({ item: s.inboxItems, msg: s.messages })
    .from(s.inboxItems)
    .innerJoin(s.messages, eq(s.messages.id, s.inboxItems.messageId))
    .where(eq(s.inboxItems.state, "dead"))
    .orderBy(desc(s.inboxItems.createdAt))
    .limit(200);
  const agents = await db.select().from(s.agents);
  return rows.map((r) => ({ id: r.item.id, agent: agents.find((a) => a.id === r.item.agentId)?.name, message_id: r.msg.id, room_id: r.msg.roomId, content: r.msg.content.slice(0, 300), delivery_count: r.item.deliveryCount, created_at: r.item.createdAt }));
}
export async function requeueDead(actor: Actor, id: string) {
  const r = await db.update(s.inboxItems).set({ state: "pending", deliveryCount: 0, leaseExpiresAt: null }).where(and(eq(s.inboxItems.id, id), eq(s.inboxItems.state, "dead"))).returning();
  if (!r.length) throw new RelayError("not_found", "Dead-letter item not found");
  notifyAgent(r[0].agentId);
  await audit(actor, "inbox.requeue", id);
}
export async function discardDead(actor: Actor, id: string) {
  await db.update(s.inboxItems).set({ state: "acked", ackedAt: new Date() }).where(and(eq(s.inboxItems.id, id), eq(s.inboxItems.state, "dead")));
  await audit(actor, "inbox.discard", id);
}

export async function metricsText() {
  const [m] = await db.select({ n: sql<number>`count(*)::int` }).from(s.messages);
  const q = await db.select({ state: s.inboxItems.state, n: sql<number>`count(*)::int` }).from(s.inboxItems).groupBy(s.inboxItems.state);
  const err = await db.select({ n: sql<number>`count(*)::int` }).from(s.toolActivity).where(and(eq(s.toolActivity.status, "error"), sql`${s.toolActivity.createdAt} > now() - interval '1 hour'`));
  const lat = await db
    .select({ p: sql<number>`coalesce(avg(extract(epoch from (${s.inboxItems.deliveredAt} - ${s.inboxItems.createdAt})) * 1000),0)::float` })
    .from(s.inboxItems)
    .where(sql`${s.inboxItems.deliveredAt} is not null and ${s.inboxItems.deliveredAt} > now() - interval '1 hour' and ${s.inboxItems.deliveryCount} = 1`);
  const { activeWaits } = await import("./events");
  const lines = [
    "# TYPE agentrelay_messages_total counter",
    `agentrelay_messages_total ${m.n}`,
    "# TYPE agentrelay_inbox_items gauge",
    ...q.map((r) => `agentrelay_inbox_items{state="${r.state}"} ${r.n}`),
    "# TYPE agentrelay_active_waits gauge",
    `agentrelay_active_waits ${activeWaits()}`,
    "# TYPE agentrelay_tool_errors_1h gauge",
    `agentrelay_tool_errors_1h ${err[0].n}`,
    "# TYPE agentrelay_delivery_latency_ms_avg_1h gauge",
    `agentrelay_delivery_latency_ms_avg_1h ${lat[0].p.toFixed(1)}`,
  ];
  return lines.join("\n") + "\n";
}

let lastRetention = 0;
export async function maybeRetention() {
  if (Date.now() - lastRetention < 30 * 60_000) return;
  lastRetention = Date.now();
  const st = await getSettings();
  await db.delete(s.inboxItems).where(sql`${s.inboxItems.createdAt} < now() - (${st.retentionDaysInbox} * interval '1 day') and ${s.inboxItems.state} in ('acked','dead')`);
  await db.delete(s.toolActivity).where(sql`${s.toolActivity.createdAt} < now() - (${config.retentionDaysActivity} * interval '1 day')`);
  const old = await db.select({ id: s.messages.id }).from(s.messages).where(sql`${s.messages.createdAt} < now() - (${st.retentionDaysMessages} * interval '1 day')`).limit(1000);
  if (old.length) {
    const ids = old.map((o) => o.id);
    await db.delete(s.messageMentions).where(inArray(s.messageMentions.messageId, ids));
    await db.delete(s.messageAttachments).where(inArray(s.messageAttachments.messageId, ids));
    await db.delete(s.inboxItems).where(inArray(s.inboxItems.messageId, ids));
    await db.delete(s.messages).where(inArray(s.messages.id, ids));
  }
}
