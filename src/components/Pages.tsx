 
"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ago, fmtDateTime, on } from "./api";
import { useApp } from "./ctx";
import { Icon } from "./Icon";
import { btn, btnDanger, btnPrimary, card, Empty, field, Md, Modal } from "./ui";

// ───────────── Tasks board ─────────────
const COLS = ["queued", "in_progress", "blocked", "done", "failed", "cancelled"];
export function Tasks() {
  const { agents, rooms, toast } = useApp();
  const [tasks, setTasks] = useState<any[]>([]);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ title: "", description: "", assignee: "", room_id: "", priority: "normal", acceptance_criteria: "" });
  const load = useCallback(() => api("GET", "tasks").then((r) => setTasks(r.tasks)).catch((e) => toast(e.message, "err")), [toast]);
  useEffect(() => {
    load();
    return on("task.updated", load);
  }, [load]);
  const shown = tasks.filter((t) => !filter || t.assignee === filter);
  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-bold">Task board</h1>
        <select className={`${field} w-44`} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by assignee">
          <option value="">All assignees</option>
          {agents.map((a) => (
            <option key={a.id}>{a.name}</option>
          ))}
        </select>
        <button className={btnPrimary} onClick={() => setCreating(true)}>
          <Icon name="plus" size={15} /> New task
        </button>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-3">
        {COLS.map((c) => (
          <div key={c} className="w-64 shrink-0 rounded-lg bg-slate-100 p-2 dark:bg-slate-900">
            <h3 className="mb-2 flex justify-between px-1 text-xs font-bold uppercase text-slate-500">
              {c.replace("_", " ")} <span>{shown.filter((t) => t.status === c).length}</span>
            </h3>
            <div className="space-y-2">
              {shown
                .filter((t) => t.status === c)
                .map((t) => (
                  <button key={t.id} onClick={() => setOpen(t)} className="w-full rounded-md border border-slate-200 bg-white p-2 text-left text-sm shadow-sm hover:border-indigo-400 dark:border-slate-800 dark:bg-slate-950">
                    <div className="font-medium">{t.title}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      → @{t.assignee} · {t.priority} · {ago(t.updated_at)}
                    </div>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
      {open && (
        <Modal title={open.title} onClose={() => setOpen(null)} wide>
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-3 text-xs text-slate-500">
              <span>id: {open.id}</span>
              <span>assignee: @{open.assignee}</span>
              <span>creator: {open.creator.name}</span>
              <span>priority: {open.priority}</span>
              {open.due_at && <span>due: {fmtDateTime(open.due_at)}</span>}
            </div>
            {open.description && <Md content={open.description} />}
            {open.acceptance_criteria && (
              <div>
                <b>Acceptance criteria</b>
                <Md content={open.acceptance_criteria} />
              </div>
            )}
            {open.result_summary && (
              <div className="rounded border-l-4 border-emerald-500 bg-emerald-50 p-2 dark:bg-emerald-950/40">
                <b>Result</b>
                <Md content={open.result_summary} />
              </div>
            )}
            <div className="flex items-center gap-2">
              <label htmlFor="st" className="text-xs">
                Status
              </label>
              <select
                id="st"
                className={`${field} w-40`}
                value={open.status}
                onChange={async (e) => {
                  try {
                    const r = await api("PATCH", `tasks/${open.id}`, { status: e.target.value });
                    setOpen(r.task);
                    load();
                  } catch (er: any) {
                    toast(er.message, "err");
                  }
                }}
              >
                {COLS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <b className="text-xs">History</b>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                {open.history.map((h: any, i: number) => (
                  <li key={i}>
                    {fmtDateTime(h.at)} · {h.by} → <b>{h.status}</b> {h.note ? `(${h.note})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Modal>
      )}
      {creating && (
        <Modal title="New task" onClose={() => setCreating(false)}>
          <form
            className="space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("POST", "tasks", { ...f, room_id: f.room_id || undefined });
                setCreating(false);
                setF({ title: "", description: "", assignee: "", room_id: "", priority: "normal", acceptance_criteria: "" });
                load();
              } catch (er: any) {
                toast(er.message, "err");
              }
            }}
          >
            <input className={field} required placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="Title" />
            <textarea className={field} rows={3} placeholder="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} aria-label="Description" />
            <textarea className={field} rows={2} placeholder="Acceptance criteria" value={f.acceptance_criteria} onChange={(e) => setF({ ...f, acceptance_criteria: e.target.value })} aria-label="Acceptance criteria" />
            <div className="grid grid-cols-3 gap-2">
              <select className={field} required value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })} aria-label="Assignee">
                <option value="">Assignee…</option>
                {agents.map((a) => (
                  <option key={a.id}>{a.name}</option>
                ))}
              </select>
              <select className={field} value={f.room_id} onChange={(e) => setF({ ...f, room_id: e.target.value })} aria-label="Room">
                <option value="">DM (auto)</option>
                {rooms.filter((r) => r.kind === "group").map((r) => (
                  <option key={r.id} value={r.id}>
                    #{r.name}
                  </option>
                ))}
              </select>
              <select className={field} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} aria-label="Priority">
                {["low", "normal", "high", "urgent"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
            <button className={btnPrimary}>Create & notify assignee</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ───────────── Human requests ─────────────
export function Requests() {
  const { requests, refreshRequests, toast } = useApp();
  const [ans, setAns] = useState<Record<string, string>>({});
  const respond = async (id: string, answer: string) => {
    try {
      await api("POST", `human-requests/${id}/answer`, { answer });
      refreshRequests();
    } catch (e: any) {
      toast(e.message, "err");
    }
  };
  const open = requests.filter((r) => r.status === "open");
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <h1 className="text-lg font-bold">Human requests</h1>
      {!open.length && <Empty>No open requests. Agents escalate here with request_human_input.</Empty>}
      {open.map((r) => (
        <div key={r.id} className={`${card} border-l-4 border-rose-500`}>
          <div className="text-xs text-slate-500">
            @{r.agent} · {ago(r.created_at)} {r.urgency === "high" && <b className="text-rose-600">HIGH</b>}
          </div>
          <div className="my-2">
            <Md content={r.question} />
          </div>
          <div className="flex flex-wrap gap-2">
            {r.options.map((o: string) => (
              <button key={o} className={o.toLowerCase().startsWith("deny") ? btnDanger : btnPrimary} onClick={() => respond(r.id, o)}>
                {o}
              </button>
            ))}
          </div>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (ans[r.id]?.trim()) respond(r.id, ans[r.id].trim());
            }}
          >
            <input className={field} placeholder="Custom answer…" value={ans[r.id] ?? ""} onChange={(e) => setAns({ ...ans, [r.id]: e.target.value })} aria-label="Custom answer" />
            <button className={btn}>Answer</button>
          </form>
        </div>
      ))}
      {requests.some((r) => r.status !== "open") && <h2 className="pt-4 text-sm font-bold text-slate-500">Answered</h2>}
      {requests
        .filter((r) => r.status !== "open")
        .slice(0, 20)
        .map((r) => (
          <div key={r.id} className="rounded border border-slate-200 p-2 text-xs dark:border-slate-800">
            <b>@{r.agent}</b>: {r.question.slice(0, 120)} → <b>{r.answer}</b> <span className="text-slate-500">({ago(r.answered_at)})</span>
          </div>
        ))}
    </div>
  );
}

// ───────────── Activity & logs ─────────────
export function Activity() {
  const { agents, toast, me } = useApp();
  const [tab, setTab] = useState("tools");
  const [agent, setAgent] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const load = useCallback(async () => {
    try {
      if (tab === "tools") setRows((await api("GET", `activity?limit=150${agent ? `&agent_id=${agent}` : ""}`)).activity);
      else if (tab === "dead") setRows((await api("GET", "inbox/dead")).items);
      else setRows((await api("GET", "audit-logs")).logs);
    } catch (e: any) {
      setRows([]);
      toast(e.message, "err");
    }
  }, [tab, agent, toast]);
  useEffect(() => {
    load();
    const offs = [on("activity.created", () => tab === "tools" && load()), on("inbox.dead", () => tab === "dead" && load())];
    return () => offs.forEach((o) => o());
  }, [load, tab]);
  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-bold">Activity &amp; logs</h1>
        {[["tools", "Tool calls"], ["dead", "Dead letters"], ...(me.role === "admin" ? [["audit", "Audit log"]] : [])].map(([k, l]) => (
          <button key={k} className={`${btn} ${tab === k ? "!bg-indigo-600 !text-white" : ""}`} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
        {tab === "tools" && (
          <select className={`${field} w-40`} value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Agent filter">
            <option value="">All agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-100 dark:bg-slate-900">
            {tab === "tools" && (
              <tr>
                <th className="p-2">Time</th>
                <th>Agent</th>
                <th>Tool</th>
                <th>Status</th>
                <th>ms</th>
                <th>Detail</th>
              </tr>
            )}
            {tab === "dead" && (
              <tr>
                <th className="p-2">Agent</th>
                <th>Message</th>
                <th>Deliveries</th>
                <th />
              </tr>
            )}
            {tab === "audit" && (
              <tr>
                <th className="p-2">Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Detail</th>
              </tr>
            )}
          </thead>
          <tbody>
            {rows.map((r, i) =>
              tab === "tools" ? (
                <tr key={r.id} className="border-t border-slate-200 dark:border-slate-800">
                  <td className="p-2 whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                  <td>{r.agent}</td>
                  <td className="font-mono">{r.tool}</td>
                  <td className={r.status === "ok" ? "text-emerald-600" : "text-red-600"}>
                    {r.status} {r.error_code}
                  </td>
                  <td>{r.duration_ms}</td>
                  <td className="max-w-xs truncate text-slate-500">{r.summary ?? "(hidden)"}</td>
                </tr>
              ) : tab === "dead" ? (
                <tr key={r.id} className="border-t border-slate-200 dark:border-slate-800">
                  <td className="p-2">{r.agent}</td>
                  <td className="max-w-md truncate">{r.content}</td>
                  <td>{r.delivery_count}</td>
                  <td className="space-x-1 whitespace-nowrap p-2">
                    <button className={btn} onClick={async () => (await api("POST", `inbox/${r.id}/requeue`).catch((e) => toast(e.message, "err")), load())}>
                      Requeue
                    </button>
                    <button className={btnDanger} onClick={async () => (await api("POST", `inbox/${r.id}/discard`).catch((e) => toast(e.message, "err")), load())}>
                      Discard
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={r.id ?? i} className="border-t border-slate-200 dark:border-slate-800">
                  <td className="p-2 whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                  <td>{r.actorKind}:{String(r.actorId).slice(0, 12)}</td>
                  <td className="font-mono">{r.action}</td>
                  <td className="max-w-[10rem] truncate">{r.target}</td>
                  <td className="max-w-xs truncate text-slate-500">{JSON.stringify(r.detailJson)}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
        {!rows.length && <Empty>Nothing here yet.</Empty>}
      </div>
    </div>
  );
}

// ───────────── Settings ─────────────
export function Settings({ sound, setSound }: { sound: boolean; setSound: (b: boolean) => void }) {
  const { toast, me } = useApp();
  const [s, setS] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [nu, setNu] = useState({ email: "", name: "", password: "", role: "member" });
  const admin = me.role === "admin";
  const loadUsers = useCallback(() => admin && api("GET", "users").then((r) => setUsers(r.users)).catch(() => {}), [admin]);
  useEffect(() => {
    api("GET", "settings").then((r) => setS(r.settings));
    loadUsers();
  }, [loadUsers]);
  if (!s) return null;
  const num = (k: string, label: string, hint?: string) => (
    <label className="block text-xs">
      {label} {hint && <span className="text-slate-400">({hint})</span>}
      <input className={field} type="number" min={0} disabled={!admin} value={s[k]} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} />
    </label>
  );
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-lg font-bold">Settings</h1>
      <div className={card}>
        <h2 className="mb-2 text-sm font-bold">Appearance &amp; notifications</h2>
        <div className="flex flex-wrap gap-2">
          <button
            className={btn}
            onClick={() => {
              const d = document.documentElement.classList.toggle("dark");
              localStorage.setItem("ar_theme", d ? "dark" : "light");
            }}
          >
            Toggle light / dark
          </button>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={sound}
              onChange={(e) => {
                setSound(e.target.checked);
                localStorage.setItem("ar_sound", e.target.checked ? "1" : "0");
              }}
            />
            Sound on new human request
          </label>
        </div>
      </div>
      <div className={card}>
        <h2 className="mb-2 text-sm font-bold">Safety, limits &amp; retention (workspace)</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {num("hopLimit", "Loop guard hop limit", "applies to new rooms")}
          {num("rateMsgPerMin", "Messages / min / agent")}
          {num("rateCallsPerMin", "Tool calls / min / agent")}
          {num("waitDefaultSeconds", "Default wait seconds", "0 = infinite")}
          {num("leaseSeconds", "Inbox lease seconds")}
          {num("retentionDaysMessages", "Retention: messages (days)")}
          {num("retentionDaysInbox", "Retention: inbox items (days)")}
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs">
          <input type="checkbox" disabled={!admin} checked={s.redactActivity} onChange={(e) => setS({ ...s, redactActivity: e.target.checked })} />
          Hide tool payload summaries in Activity log
        </label>
        <label className="mt-1 flex items-center gap-2 text-xs">
          <input type="checkbox" disabled={!admin} checked={s.autoAddMentions} onChange={(e) => setS({ ...s, autoAddMentions: e.target.checked })} />
          Auto-add mentioned agents to the room
        </label>
        {admin && (
          <button className={`${btnPrimary} mt-3`} onClick={async () => api("PATCH", "settings", s).then((r) => (setS(r.settings), toast("Settings saved"))).catch((e) => toast(e.message, "err"))}>
            Save
          </button>
        )}
      </div>
      {admin && (
        <div className={card}>
          <h2 className="mb-2 text-sm font-bold">Users</h2>
          <ul className="mb-3 space-y-1 text-sm">
            {users.map((u) => (
              <li key={u.id}>
                {u.name} <span className="text-slate-500">&lt;{u.email}&gt; · {u.role}</span>
              </li>
            ))}
          </ul>
          <form
            className="grid gap-2 sm:grid-cols-4"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("POST", "users", nu);
                setNu({ email: "", name: "", password: "", role: "member" });
                loadUsers();
                toast("User created");
              } catch (er: any) {
                toast(er.message, "err");
              }
            }}
          >
            <input className={field} type="email" required placeholder="email" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} aria-label="Email" />
            <input className={field} placeholder="name" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} aria-label="Name" />
            <input className={field} type="password" minLength={8} required placeholder="password (8+)" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} aria-label="Password" />
            <div className="flex gap-2">
              <select className={field} value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })} aria-label="Role">
                <option>member</option>
                <option>admin</option>
              </select>
              <button className={btnPrimary}>Add</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
