// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { computeRecipients, isClaimable, nextHop, parseMentions, presenceOf, RateLimiter } from "@/lib/pure";
import { renderMarkdown } from "@/lib/markdown";

const members = [
  { kind: "agent" as const, id: "a", notifyMode: "mentions_only" as const },
  { kind: "agent" as const, id: "b", notifyMode: "mentions_only" as const },
  { kind: "agent" as const, id: "c", notifyMode: "all" as const },
  { kind: "agent" as const, id: "d", notifyMode: "none" as const },
  { kind: "user" as const, id: "u", notifyMode: "all" as const },
];
const base = { roomKind: "group" as const, members, type: "chat", mentionedAgentIds: [] as string[], humansWakeAll: false };

describe("fan-out (PRD §11)", () => {
  it("sender never receives own message; all-mode receives everything; none never", () => {
    expect(computeRecipients({ ...base, sender: { kind: "agent", id: "c" } }).sort()).toEqual([]);
    expect(computeRecipients({ ...base, sender: { kind: "agent", id: "a" } }).sort()).toEqual(["c"]);
  });
  it("mentions_only needs a mention", () => {
    expect(computeRecipients({ ...base, sender: { kind: "agent", id: "a" }, mentionedAgentIds: ["b", "d"] }).sort()).toEqual(["b", "c"]);
  });
  it("humans_wake_all wakes mentions_only agents on human messages", () => {
    expect(computeRecipients({ ...base, sender: { kind: "user", id: "u" }, humansWakeAll: true }).sort()).toEqual(["a", "b", "c"]);
    expect(computeRecipients({ ...base, sender: { kind: "user", id: "u" } }).sort()).toEqual(["c"]);
  });
  it("DM always notifies the other agent; task always reaches assignee; system skipped", () => {
    expect(computeRecipients({ ...base, roomKind: "dm", members: members.slice(0, 2), sender: { kind: "agent", id: "a" } })).toEqual(["b"]);
    expect(computeRecipients({ ...base, sender: { kind: "agent", id: "a" }, type: "task", forceRecipients: ["d"] }).sort()).toEqual(["c", "d"]);
    expect(computeRecipients({ ...base, sender: { kind: "system", id: "system" }, type: "system" })).toEqual([]);
    expect(computeRecipients({ ...base, sender: { kind: "system", id: "system" }, type: "system", notifySystem: true }).sort()).toEqual(["c"]);
  });
});

describe("loop guard", () => {
  it("increments for agents, resets for humans, trips at limit, warns at 80%", () => {
    expect(nextHop({ hopCount: 3, hopLimit: 20 }, "agent")).toMatchObject({ hopCount: 4, tripped: false, warn: false });
    expect(nextHop({ hopCount: 15, hopLimit: 20 }, "agent")).toMatchObject({ hopCount: 16, warn: true, tripped: false });
    expect(nextHop({ hopCount: 19, hopLimit: 20 }, "agent")).toMatchObject({ tripped: true });
    expect(nextHop({ hopCount: 19, hopLimit: 20 }, "user")).toMatchObject({ hopCount: 0, tripped: false });
    expect(nextHop({ hopCount: 7, hopLimit: 20 }, "system").hopCount).toBe(7);
  });
});

describe("presence / mentions / rate limit / lease", () => {
  const now = Date.now();
  it("presence thresholds", () => {
    expect(presenceOf(null, true)).toBe("online");
    expect(presenceOf(new Date(now - 30_000), false, now)).toBe("online");
    expect(presenceOf(new Date(now - 5 * 60_000), false, now)).toBe("idle");
    expect(presenceOf(new Date(now - 11 * 60_000), false, now)).toBe("offline");
    expect(presenceOf(null, false)).toBe("offline");
  });
  it("parses @mentions, ignoring emails", () => {
    expect(parseMentions("hi @Codex and @muse-1, mail a@b.com").sort()).toEqual(["codex", "muse-1"]);
  });
  it("rate limiter blocks after limit and reports retry_after", () => {
    const r = new RateLimiter(60_000);
    for (let i = 0; i < 3; i++) expect(r.hit("k", 3, 1000)).toBe(0);
    expect(r.hit("k", 3, 2000)).toBeGreaterThan(0);
    expect(r.hit("other", 3, 2000)).toBe(0);
    expect(r.hit("k", 3, 62_000)).toBe(0);
  });
  it("lease claimability", () => {
    expect(isClaimable({ state: "pending", leaseExpiresAt: null })).toBe(true);
    expect(isClaimable({ state: "delivered", leaseExpiresAt: new Date(Date.now() + 10_000) })).toBe(false);
    expect(isClaimable({ state: "delivered", leaseExpiresAt: new Date(Date.now() - 10_000) })).toBe(true);
    expect(isClaimable({ state: "acked", leaseExpiresAt: null })).toBe(false);
  });
});

describe("markdown sanitization (XSS, scenario 14)", () => {
  it("strips scripts, handlers and javascript: urls", () => {
    const payloads = ['<script>alert(1)</script>', '<img src=x onerror="alert(1)">', '[x](javascript:alert(1))', '<a href="javascript:alert(1)">y</a>', '<iframe src="//evil"></iframe>', '<svg onload=alert(1)>'];
    for (const p of payloads) {
      const el = document.createElement("div");
      el.innerHTML = renderMarkdown(p);
      expect(el.querySelector("script, iframe, svg, object, embed")).toBeNull();
      for (const n of Array.from(el.querySelectorAll("*"))) {
        for (const a of Array.from(n.attributes)) {
          expect(a.name.startsWith("on")).toBe(false);
          if (a.name === "href" || a.name === "src") expect(a.value).not.toMatch(/^\s*javascript:/i);
        }
      }
    }
  });
  it("renders code blocks with copy button and keeps normal links safe", () => {
    const html = renderMarkdown("```ts\nconst a = 1\n```\n[ok](https://example.com)");
    expect(html).toContain("copy-btn");
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });
});
