 
"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, fmtTime, on } from "./api";
import { useApp } from "./ctx";
import { Icon } from "./Icon";
import { Avatar, btn, btnDanger, btnPrimary, field, Md, Modal, PresenceDot, TypeBadge } from "./ui";

export default function Chat({ roomId }: { roomId: string }) {
  const { me, agents, rooms, requests, toast, refreshRooms, refreshRequests, roomLabel } = useApp();
  const room = rooms.find((r) => r.id === roomId);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [panel, setPanel] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [replyTo, setReplyTo] = useState<any>(null);
  const [thread, setThread] = useState<{ root: any; items: any[] } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const scrollBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const loadLatest = useCallback(async () => {
    const r = await api("GET", `rooms/${roomId}/messages?limit=50`);
    setMsgs(r.messages);
    setHasMore(r.has_more);
    stick.current = true;
    setNewCount(0);
  }, [roomId]);

  const loadMembers = useCallback(async () => {
    try {
      setMembers((await api("GET", `rooms/${roomId}`)).members);
    } catch {}
  }, [roomId]);

  useEffect(() => {
    setMsgs([]);
    setReplyTo(null);
    loadLatest().catch((e) => toast(e.message, "err"));
    loadMembers();
  }, [roomId, loadLatest, loadMembers, toast]);

  useEffect(() => {
    const offs = [
      on("message.created", (d) => {
        if (d.room_id !== roomId) return;
        if (!d.message) return void loadLatest();
        setMsgs((prev) => (prev.some((m) => m.id === d.message.id) ? prev : [...prev, d.message]));
        if (!stick.current) setNewCount((c) => c + 1);
      }),
      on("message.updated", (d) => d.room_id === roomId && setMsgs((prev) => prev.map((m) => (m.id === d.message.id ? d.message : m)))),
      on("room.updated", (d) => d.room_id === roomId && loadMembers()),
      on("presence.updated", () => loadMembers()),
    ];
    return () => offs.forEach((o) => o());
  }, [roomId, loadLatest, loadMembers]);

  useLayoutEffect(() => {
    if (stick.current) scrollBottom();
  }, [msgs, scrollBottom]);

  const onScroll = async () => {
    const el = listRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (stick.current && newCount) setNewCount(0);
    if (el.scrollTop < 60 && hasMore && !loadingOlder && msgs.length) {
      setLoadingOlder(true);
      const prevH = el.scrollHeight;
      try {
        const r = await api("GET", `rooms/${roomId}/messages?limit=50&before_seq=${msgs[0].seq}`);
        stick.current = false;
        setMsgs((p) => [...r.messages, ...p]);
        setHasMore(r.has_more);
        requestAnimationFrame(() => {
          if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight - prevH;
        });
      } finally {
        setLoadingOlder(false);
      }
    }
  };

  const toggleRoom = async () => {
    try {
      await api("POST", `rooms/${roomId}/${room?.state === "paused" ? "resume" : "pause"}`);
      refreshRooms();
    } catch (e: any) {
      toast(e.message, "err");
    }
  };

  const working = agents.filter((a) => members.some((m) => m.kind === "agent" && m.id === a.id) && a.status?.state === "working");
  const byId = useMemo(() => new Map(msgs.map((m) => [m.id, m])), [msgs]);
  const openThread = async (m: any) => {
    const rootId = m.thread_id ?? m.id;
    const r = await api("GET", `rooms/${roomId}/messages?thread_id=${rootId}&limit=200`);
    setThread({ root: byId.get(rootId) ?? m, items: r.messages });
  };

  if (!room) return <div className="p-6 text-sm text-slate-500">Room not found.</div>;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        {/* No `sticky` here: the shell never scrolls, and the nearest scrollport
            (the overflow-hidden wrapper) would make it a no-op anyway. */}
        <header className="relative z-10 flex shrink-0 items-center gap-2 border-b border-slate-200 bg-paper px-4 py-2.5 dark:border-slate-800 dark:bg-slate-950">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-bold">
              {room.kind === "dm" ? "" : "# "}
              {roomLabel(room)} {room.state === "paused" && <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-950 dark:text-red-300">PAUSED</span>}
            </h1>
            <p className="truncate text-xs text-slate-500">{room.topic || `${room.member_count} members · hop ${room.hop_count}/${room.hop_limit}`}</p>
          </div>
          <button className={btn} onClick={toggleRoom} aria-label={room.state === "paused" ? "Resume room" : "Pause room"}>
            {room.state === "paused" ? <Icon name="play" size={14} /> : <Icon name="pause" size={14} />}
            <span className="hidden sm:inline">{room.state === "paused" ? "Resume" : "Pause room"}</span>
          </button>
          <button className={btn} onClick={() => setPanel((p) => !p)} aria-pressed={panel} aria-label="Room info">
            <Icon name="info" size={14} /> <span className="hidden sm:inline">Info</span>
          </button>
        </header>

        {room.state === "paused" && (
          <div role="alert" className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            <span className="flex-1">
              {room.pause_reason === "loop_guard" ? "Room paused (loop guard): agents exchanged too many messages without human input." : "Room paused by operator."} Agent messages are rejected. Sending a message also resumes the room.
            </span>
            <button className={btnPrimary} onClick={toggleRoom}>
              Resume
            </button>
          </div>
        )}

        <div ref={listRef} onScroll={onScroll} className="relative min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-4 py-3">
          {hasMore && <div className="py-2 text-center text-xs text-slate-500">{loadingOlder ? "Loading…" : "Scroll up for older messages"}</div>}
          {!msgs.length && <div className="py-16 text-center text-sm text-slate-500">No messages yet. Start the conversation.</div>}
          {msgs.map((m, i) => (
            <MessageItem key={m.id} m={m} prev={msgs[i - 1]} byId={byId} meHandle={me.handle} requests={requests} onReply={() => setReplyTo(m)} onThread={() => openThread(m)} isAdmin={me.role === "admin"} onAnswered={refreshRequests} />
          ))}
        </div>
        {newCount > 0 && (
          <button
            className="mx-auto -mt-10 mb-2 rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white shadow"
            onClick={() => {
              stick.current = true;
              scrollBottom();
              setNewCount(0);
            }}
          >
            <Icon name="arrow-down" size={14} /> {newCount} new message{newCount > 1 ? "s" : ""}
          </button>
        )}
        {working.length > 0 && (
          <div className="px-4 pb-1 text-xs text-slate-500" aria-live="polite">
            {working.map((a) => (
              <span key={a.id} className="mr-3">
                <PresenceDot presence="online" working /> <b>{a.name}</b> working{a.status.activity ? `: ${a.status.activity}` : "…"}
              </span>
            ))}
          </div>
        )}
        <Composer roomId={roomId} members={members} agents={agents} replyTo={replyTo} clearReply={() => setReplyTo(null)} />
      </div>
      {panel && <button className="fixed inset-0 z-30 bg-slate-950/50 md:hidden" onClick={() => setPanel(false)} aria-label="Close room info" />}
      {panel && <RoomPanel roomId={roomId} room={room} members={members} reload={loadMembers} onClose={() => setPanel(false)} />}
      {thread && (
        <Modal title="Thread" onClose={() => setThread(null)}>
          <div className="space-y-2">
            {thread.items.map((m) => (
              <div key={m.id} className="rounded border border-slate-200 p-2 dark:border-slate-800">
                <div className="mb-1 text-xs text-slate-500">
                  <b>{m.from.name}</b> · {fmtTime(m.created_at)}
                </div>
                <Md content={m.content} />
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function MessageItem({ m, prev, byId, meHandle, requests, onReply, onThread, isAdmin, onAnswered }: any) {
  const { toast } = useApp();
  const [answer, setAnswer] = useState("");
  const grouped = prev && prev.from.name === m.from.name && prev.type === "chat" && m.type === "chat" && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 120000;
  if (m.type === "system" || m.from.kind === "system")
    return (
      <div className="my-2 rounded-md bg-amber-50 px-3 py-1.5 text-center text-xs text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
        <Md content={m.content} />
      </div>
    );
  if (m.type === "status")
    return (
      <div className="px-11 text-xs text-slate-500">
        · <b>{m.from.name}</b>: <span className="[&_.md]:inline">{m.content.replace(/[*_`]/g, "")}</span>
      </div>
    );
  const reply = m.reply_to ? byId.get(m.reply_to) : null;
  const req = m.type === "human_request" ? requests.find((r: any) => r.id === m.metadata?.request_id) : null;
  const mine = m.from.kind === "human" && m.from.name === meHandle;
  const frame =
    m.type === "task"
      ? "border-l-4 border-amber-400 bg-amber-50 dark:bg-amber-950/40"
      : m.type === "result"
        ? "border-l-4 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
        : m.type === "human_request"
          ? "border-l-4 border-rose-500 bg-rose-50 dark:bg-rose-950/40"
          : "";
  const respond = async (text: string) => {
    try {
      await api("POST", `human-requests/${m.metadata.request_id}/answer`, { answer: text });
      onAnswered();
    } catch (e: any) {
      toast(e.message, "err");
    }
  };
  return (
    <div className={`group flex gap-2.5 rounded-md px-1 py-0.5 hover:bg-slate-100/70 dark:hover:bg-slate-900/70 ${grouped ? "" : "mt-3"}`}>
      <div className="w-8 shrink-0">{!grouped && <Avatar name={m.from.name} color={m.from.color} kind={m.from.kind} />}</div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-sm font-semibold" style={{ color: m.from.kind === "agent" ? m.from.color : undefined }}>
              {m.from.display_name || m.from.name}
            </span>
            <TypeBadge type={m.from.kind === "human" ? "human" : m.from.type} />
            {m.type !== "chat" && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase dark:bg-slate-800">{m.type.replace("_", " ")}</span>}
            {m.priority === "urgent" && <span className="text-[10px] font-bold text-rose-600">URGENT</span>}
            <span className="text-slate-500">{fmtTime(m.created_at)}</span>
            {m.edited_at && <span className="text-slate-400">(edited)</span>}
            {m.redelivered && <span className="text-slate-400">(redelivered)</span>}
          </div>
        )}
        {reply && (
          <div className="mb-1 flex min-w-0 items-center gap-1 truncate border-l-2 border-slate-400 pl-2 text-xs text-slate-500">
            <Icon name="arrow-right" size={12} className="shrink-0" />
            <span className="truncate">{reply.from.name}: {reply.content.slice(0, 120)}</span>
          </div>
        )}
        <div className={`rounded-md ${frame ? `${frame} px-3 py-2` : ""} ${m.deleted_at ? "italic text-slate-400" : ""}`}>
          <Md content={m.content} />
          {m.type === "human_request" && req && (
            <div className="mt-2">
              {req.status === "open" ? (
                <div className="space-y-2">
                  {req.options?.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {req.options.map((o: string) => (
                        <button key={o} className={o.toLowerCase().startsWith("deny") ? btnDanger : btnPrimary} onClick={() => respond(o)}>
                          {o}
                        </button>
                      ))}
                    </div>
                  )}
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (answer.trim()) respond(answer.trim());
                    }}
                  >
                    <input className={field} placeholder="Type an answer…" value={answer} onChange={(e) => setAnswer(e.target.value)} aria-label="Answer" />
                    <button className={btn}>Answer</button>
                  </form>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300"><Icon name="check" size={14} /> Answered: {req.answer}</div>
              )}
            </div>
          )}
        </div>
        {m.attachments?.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-2">
            {m.attachments.map((a: any) => (
              <a key={a.id} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" href={`/api/v1/artifacts/${a.id}/download`} target="_blank" rel="noreferrer">
                <Icon name="paperclip" size={13} /> {a.name} ({Math.ceil(a.size / 1024)} KB)
              </a>
            ))}
          </div>
        )}
        {/* Touch devices have no hover: keep the actions reachable there, and only
            reveal them on hover for mouse users. */}
        <div className="hidden gap-2 pt-0.5 text-[11px] text-slate-500 group-hover:flex [@media(hover:none)]:flex">
          <button className="hover:underline" onClick={onReply}>
            Reply
          </button>
          {(m.thread_id || m.reply_to) && (
            <button className="hover:underline" onClick={onThread}>
              Thread
            </button>
          )}
          {isAdmin && !m.deleted_at && (
            <button
              className="text-red-600 hover:underline"
              onClick={async () => {
                if (confirm("Delete this message?")) await api("DELETE", `messages/${m.id}`).catch((e) => toast(e.message, "err"));
              }}
            >
              Delete
            </button>
          )}
          {mine && <span className="text-slate-400">you</span>}
        </div>
      </div>
    </div>
  );
}

function Composer({ roomId, members, agents, replyTo, clearReply }: any) {
  const { toast } = useApp();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);
  const ta = useRef<HTMLTextAreaElement>(null);
  // Grow with the draft (one line at rest, capped at max-h-40) so the textarea,
  // the attach button and the send button always share the same 44px row.
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    // Chromium counts the (long, wrapping) placeholder in scrollHeight, so only
    // measure once there is real text; otherwise the 44px min-height governs.
    if (!el.value) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);
  const m = /(?:^|\s)@([a-z0-9_-]*)$/i.exec(text.slice(0, ta.current?.selectionStart ?? text.length));
  const cands = useMemo(() => {
    if (!m) return [];
    const names = new Map<string, string>();
    members.forEach((x: any) => names.set(x.name, x.kind));
    agents.forEach((a: any) => names.set(a.name, "agent"));
    return [...names.entries()].filter(([n]) => n.startsWith(m[1].toLowerCase())).slice(0, 6);
  }, [m, members, agents]);

  const pick = (name: string) => {
    const pos = ta.current?.selectionStart ?? text.length;
    const before = text.slice(0, pos).replace(/@([a-z0-9_-]*)$/i, `@${name} `);
    setText(before + text.slice(pos));
    setSel(0);
    setTimeout(() => ta.current?.focus(), 0);
  };

  const send = async () => {
    if ((!text.trim() && !files.length) || busy) return;
    setBusy(true);
    try {
      await api("POST", `rooms/${roomId}/messages`, { content: text.trim() || "(attachment)", reply_to: replyTo?.id, attachments: files.map((f) => f.id) });
      setText("");
      setFiles([]);
      clearReply();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const attach = async (f: File) => {
    if (f.size > 10 * 1024 * 1024) return toast("File exceeds 10 MB", "err");
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    try {
      const r = await api("POST", "artifacts", { name: f.name, mime: f.type || "application/octet-stream", content_base64: btoa(bin), room_id: roomId });
      setFiles((p) => [...p, r.artifact]);
    } catch (e: any) {
      toast(e.message, "err");
    }
  };

  return (
    <div className="relative border-t border-slate-200 p-3 dark:border-slate-800">
      {replyTo && (
        <div className="mb-2 flex items-center gap-2 rounded bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">
          <span className="flex-1 truncate">
            Replying to <b>{replyTo.from.name}</b>: {replyTo.content.slice(0, 100)}
          </span>
          <button onClick={clearReply} aria-label="Cancel reply" className="rounded p-1 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 dark:hover:bg-slate-700 dark:hover:text-white">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {files.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">
              <Icon name="paperclip" size={13} /> {f.name}{" "}
              <button onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))} aria-label="Remove attachment" className="rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:hover:bg-slate-700 dark:hover:text-white">
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {cands.length > 0 && (
        <ul role="listbox" className="absolute bottom-full left-3 z-10 mb-1 w-56 overflow-hidden rounded-md border border-slate-300 bg-white shadow dark:border-slate-700 dark:bg-slate-900">
          {cands.map(([n, k], i) => (
            <li key={n} role="option" aria-selected={i === sel} className={`cursor-pointer px-3 py-1.5 text-sm ${i === sel ? "bg-indigo-100 dark:bg-indigo-950" : ""}`} onMouseDown={(e) => (e.preventDefault(), pick(n))}>
              @{n} <span className="text-xs text-slate-500">{k === "agent" ? "agent" : "human"}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <label className={`${btn} h-11 w-11 shrink-0 cursor-pointer !p-0`} title="Attach file" aria-label="Attach file">
          <Icon name="paperclip" size={16} />
          <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} />
        </label>
        <textarea
          ref={ta}
          rows={1}
          className={`${field} max-h-40 min-h-11 resize-none`}
          placeholder="Message… (@mention agents, Enter to send, Shift+Enter for newline)"
          aria-label="Message composer"
          enterKeyHint="send"
          value={text}
          onChange={(e) => (setText(e.target.value), setSel(0))}
          onKeyDown={(e) => {
            if (cands.length) {
              if (e.key === "ArrowDown") return e.preventDefault(), setSel((s) => (s + 1) % cands.length);
              if (e.key === "ArrowUp") return e.preventDefault(), setSel((s) => (s - 1 + cands.length) % cands.length);
              if (e.key === "Enter" || e.key === "Tab") return e.preventDefault(), pick(cands[sel][0]);
              if (e.key === "Escape") return setText((t) => t + " ");
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className={`${btnPrimary} h-11 w-11 shrink-0 sm:w-auto`} onClick={send} disabled={busy} aria-label="Send message">
          <Icon name="send" size={16} /> <span className="hidden sm:inline">Send</span>
        </button>
      </div>
    </div>
  );
}

function RoomPanel({ roomId, room, members, reload, onClose }: any) {
  const { agents, toast, refreshRooms } = useApp();
  const [tasks, setTasks] = useState<any[]>([]);
  const [arts, setArts] = useState<any[]>([]);
  const [pinned, setPinned] = useState(room.pinned_instructions ?? "");
  const [hop, setHop] = useState(String(room.hop_limit));
  const [preview, setPreview] = useState<any>(null);
  const [add, setAdd] = useState("");

  useEffect(() => {
    const load = () => {
      api("GET", `tasks?room_id=${roomId}`).then((r) => setTasks(r.tasks)).catch(() => {});
      api("GET", `rooms/${roomId}/artifacts`).then((r) => setArts(r.artifacts)).catch(() => {});
    };
    load();
    const off = [on("task.updated", load), on("message.created", (d) => d.room_id === roomId && d.message?.attachments?.length && load())];
    return () => off.forEach((o) => o());
  }, [roomId]);
  useEffect(() => setPinned(room.pinned_instructions ?? ""), [room.pinned_instructions]);

  const act = async (fn: () => Promise<any>) => {
    try {
      await fn();
      reload();
      refreshRooms();
    } catch (e: any) {
      toast(e.message, "err");
    }
  };
  const open = async (a: any) => {
    const r = await api("GET", `artifacts/${a.id}`).catch((e) => (toast(e.message, "err"), null));
    if (r) setPreview(r.artifact);
  };
  const candidates = agents.filter((a: any) => !members.some((m: any) => m.kind === "agent" && m.id === a.id));
  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex h-full w-[85vw] max-w-80 shrink-0 flex-col space-y-4 overflow-y-auto overscroll-contain border-l border-slate-200 bg-paper p-3 text-sm shadow-2xl md:static md:z-auto md:w-72 md:max-w-none md:bg-transparent md:shadow-none dark:border-slate-800 dark:bg-slate-950 md:dark:bg-transparent" aria-label="Room info">
      <div className="flex items-center justify-between md:hidden">
        <h2 className="text-xs font-bold uppercase text-slate-500">Room info</h2>
        <button className={`${btn} !h-8 !w-8 !p-0`} onClick={onClose} aria-label="Close room info">
          <Icon name="close" size={14} />
        </button>
      </div>
      <section>
        <h3 className="mb-1.5 text-xs font-bold uppercase text-slate-500">Members ({members.length})</h3>
        <ul className="space-y-1.5">
          {members.map((m: any) => (
            <li key={m.kind + m.id} className="flex items-center gap-2">
              <PresenceDot presence={m.kind === "user" ? "online" : m.presence} working={m.status?.state === "working"} />
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  {m.display_name} {m.kind === "user" ? <TypeBadge type="human" /> : <TypeBadge type={m.type} />}
                </div>
                {m.status?.activity && <div className="truncate text-xs text-slate-500">{m.status.state}: {m.status.activity}</div>}
              </div>
              {m.kind === "agent" && room.kind !== "dm" && (
                <select
                  className="rounded border border-slate-300 bg-transparent text-[11px] dark:border-slate-700"
                  value={m.notify_mode}
                  aria-label={`Notify mode for ${m.name}`}
                  onChange={(e) => act(() => api("PATCH", `rooms/${roomId}/members/${encodeURIComponent(`${m.kind}:${m.id}`)}`, { notify_mode: e.target.value }))}
                >
                  <option value="all">all</option>
                  <option value="mentions_only">mentions</option>
                  <option value="none">none</option>
                </select>
              )}
              {room.kind !== "dm" && (
                <button className="rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-red-600 dark:hover:bg-rose-950/50" title="Remove" aria-label={`Remove ${m.display_name}`} onClick={() => act(() => api("DELETE", `rooms/${roomId}/members/${encodeURIComponent(`${m.kind}:${m.id}`)}`))}>
                  <Icon name="close" size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
        {room.kind !== "dm" && (
          <div className="mt-2 flex gap-1">
            <select className={field} value={add} onChange={(e) => setAdd(e.target.value)} aria-label="Add agent">
              <option value="">Add agent…</option>
              {candidates.map((a: any) => (
                <option key={a.id} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
            <button className={btn} disabled={!add} onClick={() => act(async () => (await api("POST", `rooms/${roomId}/members`, { name: add }), setAdd(""))) }>
              Add
            </button>
          </div>
        )}
      </section>
      {room.kind !== "dm" && (
        <section>
          <h3 className="mb-1.5 text-xs font-bold uppercase text-slate-500">Pinned instructions</h3>
          <textarea className={field} rows={4} value={pinned} onChange={(e) => setPinned(e.target.value)} placeholder="Project context returned to agents via get_room_context" />
          <button className={`${btn} mt-1`} onClick={() => act(() => api("PATCH", `rooms/${roomId}`, { pinned_instructions: pinned }))}>
            Save
          </button>
          <div className="mt-3 flex items-center gap-2 text-xs">
            <label htmlFor="hop">Hop limit</label>
            <input id="hop" className={`${field} w-20`} value={hop} onChange={(e) => setHop(e.target.value)} />
            <button className={btn} onClick={() => act(() => api("PATCH", `rooms/${roomId}`, { hop_limit: Number(hop) }))}>
              Set
            </button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={!!room.humans_wake_all} onChange={(e) => act(() => api("PATCH", `rooms/${roomId}`, { humans_wake_all: e.target.checked }))} />
            Human messages wake all agents
          </label>
        </section>
      )}
      <section>
        <h3 className="mb-1.5 text-xs font-bold uppercase text-slate-500">Tasks ({tasks.length})</h3>
        <ul className="space-y-1">
          {tasks.slice(0, 8).map((t) => (
            <li key={t.id} className="rounded border border-slate-200 p-1.5 text-xs dark:border-slate-800">
              <b>{t.title}</b> → {t.assignee} <span className="rounded bg-slate-200 px-1 dark:bg-slate-800">{t.status}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-1.5 text-xs font-bold uppercase text-slate-500">Artifacts ({arts.length})</h3>
        <ul className="space-y-1">
          {arts.map((a) => (
            <li key={a.id} className="flex items-center gap-1 text-xs">
              <button className="flex-1 truncate text-left hover:underline" onClick={() => open(a)}>
                {a.name}
              </button>
              <span className="text-slate-500">{Math.ceil(a.size / 1024)}KB</span>
              <a className="rounded p-1 text-slate-500 transition hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800" href={`/api/v1/artifacts/${a.id}/download`} title="Download" aria-label={`Download ${a.name}`}>
                <Icon name="arrow-down" size={14} />
              </a>
            </li>
          ))}
        </ul>
      </section>
      {preview && (
        <Modal title={preview.name} onClose={() => setPreview(null)} wide>
          <div className="mb-2 text-xs text-slate-500">
            {preview.mime} · {preview.size} bytes · sha256 {preview.sha256.slice(0, 16)}…
          </div>
          {preview.content_text !== undefined ? (
            <pre className="max-h-[60vh] overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">{preview.content_text}</pre>
          ) : preview.mime?.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/v1/artifacts/${preview.id}/download`} alt={preview.name} className="max-h-[60vh]" />
          ) : (
            <a className={btnPrimary} href={`/api/v1/artifacts/${preview.id}/download`}>
              Download
            </a>
          )}
        </Modal>
      )}
    </aside>
  );
}

