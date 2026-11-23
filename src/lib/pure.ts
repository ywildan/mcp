// Pure domain helpers (unit-tested): fan-out rules, loop guard, rate limit, presence, mentions.

export type NotifyMode = "all" | "mentions_only" | "none";

export interface FanoutMember {
  kind: "agent" | "user";
  id: string;
  notifyMode: NotifyMode;
}

export interface FanoutInput {
  roomKind: "dm" | "group";
  members: FanoutMember[];
  sender: { kind: "agent" | "user" | "system"; id: string };
  type: string;
  mentionedAgentIds: string[];
  humansWakeAll: boolean;
  forceRecipients?: string[];
  notifySystem?: boolean;
}

/** PRD §11: decide which agents receive an inbox item for a new message. */
export function computeRecipients(i: FanoutInput): string[] {
  const out = new Set<string>();
  if (i.type === "system" && !i.notifySystem) {
    (i.forceRecipients ?? []).forEach((a) => out.add(a));
    return [...out];
  }
  for (const m of i.members) {
    if (m.kind !== "agent") continue;
    if (i.sender.kind === "agent" && m.id === i.sender.id) continue;
    if (i.roomKind === "dm") {
      out.add(m.id);
      continue;
    }
    if (m.notifyMode === "none") continue;
    if (m.notifyMode === "all") out.add(m.id);
    else if (i.mentionedAgentIds.includes(m.id)) out.add(m.id);
    else if (i.sender.kind === "user" && i.humansWakeAll) out.add(m.id);
  }
  for (const a of i.forceRecipients ?? []) if (!(i.sender.kind === "agent" && a === i.sender.id)) out.add(a);
  return [...out];
}

export interface HopState {
  hopCount: number;
  hopLimit: number;
}

/** Loop guard: returns the next hop state after a message from `senderKind`. */
export function nextHop(s: HopState, senderKind: "agent" | "user" | "system") {
  if (senderKind === "user") return { hopCount: 0, tripped: false, warn: false };
  if (senderKind === "system") return { hopCount: s.hopCount, tripped: false, warn: false };
  const hopCount = s.hopCount + 1;
  return { hopCount, tripped: hopCount >= s.hopLimit, warn: hopCount >= Math.ceil(s.hopLimit * 0.8) };
}

export type Presence = "online" | "idle" | "offline";
export function presenceOf(lastSeen: Date | string | null, waiting: boolean, now = Date.now()): Presence {
  if (waiting) return "online";
  if (!lastSeen) return "offline";
  const age = now - new Date(lastSeen).getTime();
  if (age < 60_000) return "online";
  if (age < 10 * 60_000) return "idle";
  return "offline";
}

export function parseMentions(content: string): string[] {
  const set = new Set<string>();
  for (const m of content.matchAll(/(?:^|[^\w@])@([a-z0-9][a-z0-9_-]{0,31})/gi)) set.add(m[1].toLowerCase());
  return [...set];
}

/** Sliding window rate limiter (in-process). */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private windowMs = 60_000) {}
  /** Returns 0 if allowed (and records the hit), otherwise seconds to wait. */
  hit(key: string, limit: number, now = Date.now()): number {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= limit) {
      this.hits.set(key, arr);
      return Math.max(1, Math.ceil((arr[0] + this.windowMs - now) / 1000));
    }
    arr.push(now);
    this.hits.set(key, arr);
    return 0;
  }
}

/** Lease helper: an inbox item is claimable if pending or its lease expired. */
export function isClaimable(item: { state: string; leaseExpiresAt: Date | null }, now = Date.now()) {
  if (item.state === "pending") return true;
  return item.state === "delivered" && !!item.leaseExpiresAt && item.leaseExpiresAt.getTime() < now;
}
