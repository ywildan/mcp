 
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

let csrf = "";
export const setCsrf = (c: string) => {
  csrf = c;
};

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/v1/${path}`, {
    method,
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j?.error?.message ?? r.statusText, r.status, j?.error?.code);
  return j as T;
}

/** Tiny in-page event bus fed by the SSE connection. */
export const bus = new EventTarget();
export const emit = (type: string, detail: unknown) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export function on(type: string, fn: (d: any) => void) {
  const h = (e: Event) => fn((e as CustomEvent).detail);
  bus.addEventListener(type, h);
  return () => bus.removeEventListener(type, h);
}

export const SSE_EVENTS = [
  "message.created",
  "message.updated",
  "presence.updated",
  "agent.updated",
  "task.updated",
  "room.paused",
  "room.resumed",
  "room.updated",
  "human_request.created",
  "human_request.answered",
  "activity.created",
  "inbox.dead",
];

export const fmtTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
export const fmtDateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
export function ago(iso?: string | null) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
