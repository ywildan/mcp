 
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const ADMIN = { email: process.env.ADMIN_EMAIL ?? "admin@test.local", password: process.env.ADMIN_PASSWORD ?? "test-password-123" };
const BASE = process.env.RELAY_URL ?? "http://127.0.0.1:3100";
const sfx = Math.random().toString(36).slice(2, 6);
let csrf = "";

async function apiLogin(request: APIRequestContext) {
  const me = await (await request.get("/api/v1/auth/me")).json();
  const r = await request.post(me.needs_setup ? "/api/v1/auth/setup" : "/api/v1/auth/login", { data: { ...ADMIN, name: "Admin" } });
  csrf = (await r.json()).csrf;
}
const api = async (request: APIRequestContext, method: "post" | "get" | "patch", path: string, data?: unknown) =>
  (await request[method](`/api/v1/${path}`, { data, headers: { "x-csrf-token": csrf } })).json();

async function tool(token: string, name: string, args: any) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await res.text();
  const data = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)));
  return (data[0] ?? JSON.parse(text)).result.structuredContent;
}
const mkAgent = async (request: APIRequestContext, n: string) => {
  const r = await api(request, "post", "agents", { name: `e${sfx}${n}` });
  return { name: `e${sfx}${n}`, token: r.token as string };
};
async function uiLogin(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "Open your workspace" }).click();
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await apiLogin(request);
});

test("unauthenticated visitors see the landing page before sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /A switchboard for your AI agents/ })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveCount(0);
  await page.getByRole("link", { name: "Open your workspace" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to AgentRelay" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("signed-in visitors still see the landing page at /; workspace lives at /workspace", async ({ page }) => {
  await uiLogin(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /A switchboard for your AI agents/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await page.goto("/workspace");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
});

test("login; create agent in UI → token shown once + connect snippets", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Open your workspace" }).click();
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill("definitely-wrong");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.locator("form [role=alert]")).toContainText(/invalid/i);
  await uiLogin(page);
  await page.getByRole("button", { name: /Agents/ }).click();
  await page.getByRole("button", { name: "New agent" }).click();
  await page.getByPlaceholder("muse").fill(`ui${sfx}`);
  await page.getByRole("button", { name: "Create agent" }).click();
  const tokenInput = page.getByLabel("Agent token");
  await expect(tokenInput).toHaveValue(/^ar_live_/);
  const token = await tokenInput.inputValue();
  await expect(page.locator("pre").first()).toContainText(token);
  await page.getByRole("tab", { name: "Codex CLI" }).click();
  await expect(page.locator("pre").first()).toContainText("tool_timeout_sec");
  await page.getByRole("button", { name: "Close" }).click();
  await page.reload();
  await page.getByRole("button", { name: /Agents/ }).click();
  await expect(page.getByText(`@ui${sfx}`)).toBeVisible();
  await page.getByRole("button", { name: /Connect/ }).first().click();
  await expect(page.locator("body")).not.toContainText(token); // never shown again
});

test("S7/S8 human chat reaches waiting agent; @mention autocomplete; agent reply appears live; XSS inert", async ({ page, request }) => {
  const B = await mkAgent(request, "b");
  const C = await mkAgent(request, "c");
  await uiLogin(page);
  await page.getByRole("button", { name: "New room" }).click();
  await page.getByLabel("Room name").fill(`e2e-${sfx}`);
  await page.getByLabel(`@${B.name}`).check();
  await page.getByLabel(`@${C.name}`).check();
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`e2e-${sfx}`) })).toBeVisible();

  const rid = (await (await request.get("/api/v1/rooms", { headers: { "x-csrf-token": csrf } })).json()).rooms.find((r: any) => r.name === `e2e-${sfx}`).id;
  await api(request, "patch", `rooms/${rid}`, { humans_wake_all: false }); // small rooms default to true (DECISIONS #9)
  const waitB = tool(B.token, "wait_for_message", { timeout_seconds: 20 });
  const waitC = tool(C.token, "wait_for_message", { timeout_seconds: 4 });
  const composer = page.getByLabel("Message composer");
  await composer.fill(`hello @${B.name.slice(0, 4)}`);
  await expect(page.getByRole("option", { name: new RegExp(`@${B.name}`) })).toBeVisible(); // autocomplete
  await composer.press("Tab");
  await expect(composer).toHaveValue(new RegExp(`@${B.name} $`));
  await composer.type("please check");
  await composer.press("Enter");
  const got = await waitB;
  expect(got.status).toBe("message");
  expect(got.messages[0].content).toBe(`hello @${B.name} please check`);
  expect(got.messages[0].from.kind).toBe("human");
  expect((await waitC).status).toBe("timeout"); // S8: only the mentioned agent is triggered (room has 3 members + humans_wake_all default → check below)
  await expect(page.getByText("please check")).toBeVisible();

  await tool(B.token, "send_message", { room_id: rid, content: "reply from **B** with `code`\n\n```ts\nconst answer = 42\n```" });
  await expect(page.getByText("reply from")).toBeVisible(); // live, no reload
  await expect(page.locator(".md strong", { hasText: "B" }).first()).toBeVisible();
  await expect(page.locator(".copy-btn").first()).toBeVisible();

  await tool(B.token, "send_message", { room_id: rid, content: `<img src=x onerror="window.__xss=1"><script>window.__xss=2</script> [x](javascript:window.__xss=3)` });
  await expect(page.getByText("[x]").or(page.getByText("<script>")).first()).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  expect(await page.locator(".md img[src='x'], .md script").count()).toBe(0);
});

test("S9 loop guard: banner appears, Resume clears it, conversation continues", async ({ page, request }) => {
  const A = await mkAgent(request, "x");
  const B = await mkAgent(request, "y");
  const room = (await api(request, "post", "rooms", { name: `loop-${sfx}`, members: [A.name, B.name], hop_limit: 4 })).room;
  await uiLogin(page);
  await page.getByRole("button", { name: new RegExp(`# loop-${sfx}`) }).click();
  for (let i = 0; i < 4; i++) await tool(i % 2 ? B.token : A.token, "send_message", { room_id: room.id, content: `ping-pong ${i}` });
  const banner = page.locator("[role=alert]", { hasText: "Room paused" });
  await expect(banner).toContainText("Room paused (loop guard)");
  expect((await tool(A.token, "send_message", { room_id: room.id, content: "blocked?" })).error.code).toBe("room_paused");
  await banner.getByRole("button", { name: "Resume" }).click();
  await expect(banner).toBeHidden();
  expect((await tool(A.token, "send_message", { room_id: room.id, content: "continuing after resume" })).error).toBeUndefined();
  await expect(page.getByText("continuing after resume")).toBeVisible();
  // human message also resumes
  for (let i = 0; i < 3; i++) await tool(i % 2 ? B.token : A.token, "send_message", { room_id: room.id, content: `again ${i}` });
  await expect(banner).toContainText("Room paused");
  await page.getByLabel("Message composer").fill("human here");
  await page.getByLabel("Message composer").press("Enter");
  await expect(banner).toBeHidden();
});

test("Wake/Cancel wait button, pause/resume agent, human request card and task board", async ({ page, request }) => {
  const A = await mkAgent(request, "w");
  const B = await mkAgent(request, "v");
  await uiLogin(page);
  const waiting = tool(A.token, "wait_for_message", { timeout_seconds: 0 });
  await page.getByRole("button", { name: /Agents/ }).click();
  const cardA = page.locator("div.rounded-lg", { hasText: `@${A.name}` }).first();
  await expect(cardA.getByText("waiting for messages")).toBeVisible({ timeout: 10000 });
  await cardA.getByRole("button", { name: /Wake/ }).click();
  expect((await waiting).status).toBe("interrupted");
  await cardA.getByRole("button", { name: /Pause/ }).click();
  await expect(cardA.getByText("PAUSED")).toBeVisible();
  expect((await tool(A.token, "wait_for_message", {})).status).toBe("paused");
  await cardA.getByRole("button", { name: /Resume/ }).click();

  // human request → answer from UI
  const req = await tool(B.token, "request_human_input", { question: `Deploy ${sfx}?`, options: ["approve", "deny"] });
  await page.getByRole("button", { name: /Requests/ }).click();
  await expect(page.getByText(`Deploy ${sfx}?`)).toBeVisible();
  const answered = tool(B.token, "wait_for_message", { timeout_seconds: 15 });
  await page.getByRole("button", { name: "approve" }).first().click();
  expect((await answered).messages[0].content).toBe("approve");
  void req;

  // task board
  const t = (await tool(A.token, "create_task", { title: `Board ${sfx}`, assignee: B.name })).task;
  await page.getByRole("button", { name: /Tasks/ }).click();
  await expect(page.getByText(`Board ${sfx}`)).toBeVisible();
  await tool(B.token, "update_task", { task_id: t.id, status: "done", result_summary: "all good" });
  await expect(page.locator("h3", { hasText: /done/i }).locator("xpath=..").getByText(`Board ${sfx}`)).toBeVisible();
});
