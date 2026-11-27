"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import Agents from "./Agents";
import { api, emit, on, setCsrf, SSE_EVENTS } from "./api";
import Chat from "./Chat";
import { AppCtx, type AppState } from "./ctx";
import { Icon, type IconName } from "./Icon";
import Landing from "./site/pages/Landing";
import { Footer, Nav } from "./site/Chrome";
import { Dot, Logo, Mark } from "./site/ui";
import { Activity, Requests, Settings, Tasks } from "./Pages";
import { btnPrimary, field, Modal } from "./ui";

type LoginMode = "signin" | "signup" | "verify";

function Login({ needsSetup, onDone }: { needsSetup: boolean; onDone: (r: any) => void }) {
  const [mode, setMode] = useState<LoginMode>("signin");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [notice, setNotice] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const line = "mt-2 w-full border-b-2 border-ink bg-transparent py-2.5 text-[16px] outline-none transition-colors focus:border-signal";

  // Resend countdown: restarts at 60s whenever a code is (re)sent.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const signingUp = !needsSetup && mode !== "signin";

  const switchMode = (m: LoginMode) => {
    setMode(m);
    setErr("");
    setNotice("");
    setCode("");
    if (m === "signup") setPassword("");
  };

  const submitSignin = async () => {
    try {
      onDone(await api("POST", needsSetup ? "auth/setup" : "auth/login", { email, password, name: name || undefined }));
    } catch (er: any) {
      setBusy(false);
      if (er?.code === "needs_verification") {
        // Offer to finish the signup: jump to the code screen and resend.
        setSentTo(email.trim().toLowerCase());
        setMode("verify");
        setPassword("");
        setCode("");
        setErr("");
        setNotice("Your email is not verified yet. We can send you a new code.");
        try {
          const r = await api("POST", "auth/signup/resend-code", { email: email.trim().toLowerCase() });
          setNotice("A new verification code is on its way.");
          setCooldown(r?.resend_after ?? 60);
        } catch (e2: any) {
          setErr(e2?.message ?? "Could not send a new code.");
          if (e2?.retryAfter ?? e2?.status === 429) setCooldown(60);
        }
        return;
      }
      setErr(er.message);
    }
  };

  const submitSignup = async () => {
    try {
      const r = await api("POST", "auth/signup/request-code", { email, name: name || undefined, password });
      setSentTo(r.email ?? email.trim().toLowerCase());
      setMode("verify");
      setCode("");
      setErr("");
      setNotice("We sent a 6-digit code to your email. It expires in 10 minutes.");
      setCooldown(r.resend_after ?? 60);
      setPassword("");
    } catch (er: any) {
      setErr(er.message);
    } finally {
      setBusy(false);
    }
  };

  const submitVerify = async () => {
    try {
      onDone(await api("POST", "auth/signup/verify", { email: sentTo, code }));
    } catch (er: any) {
      setErr(er.message);
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await api("POST", "auth/signup/resend-code", { email: sentTo });
      setNotice("A new verification code is on its way.");
      setCode("");
      setCooldown(r?.resend_after ?? 60);
    } catch (er: any) {
      setErr(er.message);
    } finally {
      setBusy(false);
    }
  };

  const heading = needsSetup ? "Create your workspace" : mode === "signin" ? "Sign in to AgentRelay" : mode === "signup" ? "Create your account" : "Verify your email";
  const blurb = needsSetup
    ? "Set up the first administrator account to get your relay online."
    : mode === "signin"
      ? "Sign in to open your agent workspace and pick up where you left off."
      : mode === "signup"
        ? "Sign up with your email. We'll send a 6-digit code to confirm it before creating your account."
        : `Enter the 6-digit code we sent to ${sentTo || "your email"}.`;

  return (
    <main className="grid min-h-screen bg-paper text-ink lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-ink p-12 text-paper lg:flex">
        <Link href="/" className="inline-block" aria-label="Back to AgentRelay home"><Logo dark={false} /></Link>
        <div>
          <p className="label text-paper/50">One relay, every agent</p>
          <ul className="mt-6 border-t border-paper/20">
            {[
              ["Shared rooms", "Messages, handoffs and context stay in one place for every connected agent."],
              ["No polling loops", "wait_for_message holds one call open. Nothing burns tokens while idle."],
              ["Humans in the loop", "Loop guard, pause/resume and request_human_input keep you in control."],
            ].map(([t, d], i) => (
              <motion.li key={t} initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.12, duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }} className="flex items-start gap-4 border-b border-paper/20 py-5">
                <span className="mt-2"><Dot state="waiting" /></span>
                <span>
                  <span className="font-display block text-2xl font-bold leading-none">{t}</span>
                  <span className="mt-2 block text-[14px] leading-relaxed text-paper/55">{d}</span>
                </span>
              </motion.li>
            ))}
          </ul>
        </div>
        <p className="label text-paper/45">Remote MCP relay · self-hosted · human in the loop</p>
      </section>

      <section className="flex items-center px-6 py-14 sm:px-12">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="label mb-12 inline-flex items-center gap-2 text-mute hover:text-ink">
            <Icon name="arrow-right" size={14} className="rotate-180" /> Back to site
          </Link>
          <p className="label text-signal">{needsSetup ? "First-time setup" : mode === "signin" ? "Workspace" : "New account"}</p>
          <h1 className="font-display mt-3 text-5xl font-extrabold leading-[0.98]">{heading}</h1>
          <p className="mt-4 text-[15.5px] leading-relaxed text-ink-3">{blurb}</p>

          {mode === "verify" && !needsSetup ? (
            <form
              className="mt-10 space-y-5"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setErr("");
                await submitVerify();
              }}
            >
              <label className="block">
                <span className="label text-mute">Verification code</span>
                <input
                  className={`${line} font-mono tracking-[0.5em]`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  aria-label="Verification code"
                  placeholder="000000"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
              </label>
              {notice && !err && <p className="border border-ink/20 bg-ink/[0.04] px-3 py-2.5 text-[13px] text-ink-3" role="status">{notice}</p>}
              {err && <p role="alert" className="border border-signal-dark bg-signal/10 px-3 py-2.5 text-[13px] text-signal-dark">{err}</p>}
              <button disabled={busy} className="group relative mt-4 flex w-full items-center justify-between overflow-hidden bg-ink px-5 py-4 text-[15px] font-semibold text-paper transition-colors hover:bg-signal hover:text-ink disabled:opacity-70">
                <motion.span className="absolute inset-y-0 left-0 bg-signal" initial={{ width: 0 }} animate={{ width: busy ? "100%" : 0 }} transition={{ duration: 0.7, ease: "easeInOut" }} />
                <span className="relative">{busy ? "Please wait…" : "Verify and create account"}</span>
                <Icon name="arrow-right" size={18} className="relative transition-transform group-hover:translate-x-1" />
              </button>
              <div className="flex items-center justify-between gap-4 pt-1 text-[13px]">
                <button type="button" onClick={resend} disabled={busy || cooldown > 0} className="text-ink underline decoration-ink/30 underline-offset-4 transition-colors hover:text-signal disabled:text-mute disabled:no-underline disabled:opacity-70">
                  {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                </button>
                <button type="button" onClick={() => switchMode("signup")} className="text-mute transition-colors hover:text-ink">
                  Change email
                </button>
              </div>
            </form>
          ) : (
            <form
              className="mt-10 space-y-5"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setErr("");
                setNotice("");
                if (signingUp) await submitSignup();
                else await submitSignin();
              }}
            >
              <label className="block">
                <span className="label text-mute">Email</span>
                <input className={line} type="email" autoComplete="username" aria-label="Email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              {(needsSetup || signingUp) && (
                <label className="block">
                  <span className="label text-mute">Name</span>
                  <input className={line} autoComplete="name" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
                </label>
              )}
              <label className="block">
                <span className="label text-mute">Password {needsSetup || signingUp ? "(at least 8 characters)" : ""}</span>
                <input
                  className={line}
                  type="password"
                  autoComplete={needsSetup || signingUp ? "new-password" : "current-password"}
                  aria-label="Password"
                  minLength={needsSetup || signingUp ? 8 : 1}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {err && <p role="alert" className="border border-signal-dark bg-signal/10 px-3 py-2.5 text-[13px] text-signal-dark">{err}</p>}
              <button disabled={busy} className="group relative mt-4 flex w-full items-center justify-between overflow-hidden bg-ink px-5 py-4 text-[15px] font-semibold text-paper transition-colors hover:bg-signal hover:text-ink disabled:opacity-70">
                <motion.span className="absolute inset-y-0 left-0 bg-signal" initial={{ width: 0 }} animate={{ width: busy ? "100%" : 0 }} transition={{ duration: 0.7, ease: "easeInOut" }} />
                <span className="relative">{busy ? "Please wait…" : needsSetup ? "Create admin and sign in" : signingUp ? "Send verification code" : "Sign in"}</span>
                <Icon name="arrow-right" size={18} className="relative transition-transform group-hover:translate-x-1" />
              </button>
              {!needsSetup && (
                <p className="pt-1 text-[13px] text-mute">
                  {signingUp ? (
                    <>Already have an account?{" "}
                      <button type="button" onClick={() => switchMode("signin")} className="text-ink underline decoration-ink/30 underline-offset-4 transition-colors hover:text-signal">Sign in</button>
                    </>
                  ) : (
                    <>Don&apos;t have an account?{" "}
                      <button type="button" onClick={() => switchMode("signup")} className="text-ink underline decoration-ink/30 underline-offset-4 transition-colors hover:text-signal">Sign up</button>
                    </>
                  )}
                </p>
              )}
            </form>
          )}

          <p className="mt-8 flex items-start gap-3 border-t border-ink/20 pt-6 text-[13px] leading-relaxed text-mute">
            <Icon name="lock" size={16} className="mt-0.5 shrink-0" />
            {needsSetup
              ? "No default credentials are created. This first account will have administrator access."
              : mode === "verify"
                ? "Codes are single-use, expire after 10 minutes and are stored only as a hash. Never share your code with anyone."
                : "There are no default credentials. The first admin comes from ADMIN_EMAIL / ADMIN_PASSWORD or a one-time setup form. Sessions use secure, same-site cookies with CSRF protection."}
          </p>
        </div>
      </section>
    </main>
  );
}

const NAV: { id: string; icon: IconName; label: string }[] = [
  { id: "chat", icon: "messages", label: "Chat" },
  { id: "agents", icon: "agent", label: "Agents" },
  { id: "tasks", icon: "tasks", label: "Tasks" },
  { id: "requests", icon: "human", label: "Requests" },
  { id: "activity", icon: "activity", label: "Activity" },
  { id: "settings", icon: "settings", label: "Settings" },
];

export function LandingPage() {
  return (
    <>
      <Nav />
      <Landing />
      <Footer />
    </>
  );
}

/**
 * Mobile keyboards shrink only the *visual* viewport on iOS: the layout viewport
 * keeps its 100vh size, which would leave the composer stuck behind the keyboard.
 * Mirror the usable height into `--app-h` (falling back to 100dvh) so the shell
 * follows the keyboard. Android already resizes the layout viewport thanks to
 * `interactiveWidget: "resizes-content"`, so the override only applies when the
 * two viewports disagree by roughly a keyboard's worth of pixels.
 */
function useViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const sync = () => {
      if (vv.height < window.innerHeight - 80) root.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
      else root.style.removeProperty("--app-h");
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      root.style.removeProperty("--app-h");
    };
  }, []);
}

function debounced(fn: () => void, ms = 250) {
  let t: ReturnType<typeof setTimeout>;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

export default function App({ signInPage = false, workspaceRoute = false }: { signInPage?: boolean; workspaceRoute?: boolean }) {
  const router = useRouter();
  useViewportHeight();
  const [boot, setBoot] = useState<{ me: any; needs_setup: boolean; workspace?: { id: string; name: string } | null } | null>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [active, setActive] = useState<string | null>(null);
  const [nav, setNav] = useState("chat");
  const [sse, setSse] = useState<AppState["sse"]>("connecting");
  const [menu, setMenu] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ msg: string; kind: string } | null>(null);
  const [newRoom, setNewRoom] = useState(false);
  const [nr, setNr] = useState({ name: "", topic: "", members: [] as string[] });
  const [sound, setSound] = useState(false);
  const activeRef = useRef<string | null>(null);
  const soundRef = useRef(false);
  activeRef.current = active;
  soundRef.current = sound;

  const toast = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    setToastMsg({ msg, kind });
    setTimeout(() => setToastMsg(null), 3500);
  }, []);

  const loadMe = useCallback(async () => {
    const r = await api("GET", "auth/me");
    if (r.csrf) setCsrf(r.csrf);
    setBoot({ me: r.user, needs_setup: r.needs_setup, workspace: r.workspace ?? null });
    if (r.user && signInPage) router.replace("/workspace");
  }, [router, signInPage]);

  useEffect(() => {
    loadMe().catch(() => setBoot({ me: null, needs_setup: false }));
    setSound(localStorage.getItem("ar_sound") === "1");
  }, [loadMe]);

  useEffect(() => {
    if (workspaceRoute && boot && !boot.me) router.replace("/sign-in");
  }, [workspaceRoute, boot, router]);

  const refreshAgents = useCallback(() => void api("GET", "agents").then((r) => setAgents(r.agents)).catch(() => {}), []);
  const refreshRooms = useCallback(() => void api("GET", "rooms").then((r) => setRooms(r.rooms)).catch(() => {}), []);
  const refreshRequests = useCallback(() => void api("GET", "human-requests").then((r) => setRequests(r.requests)).catch(() => {}), []);

  const me = boot?.me;
  useEffect(() => {
    if (!me) return;
    refreshAgents();
    refreshRooms();
    refreshRequests();
    const dAgents = debounced(refreshAgents);
    const dRooms = debounced(refreshRooms);
    const dReq = debounced(refreshRequests, 100);
    const es = new EventSource("/api/v1/events"); // Browser reconnects and sends Last-Event-ID.
    es.onopen = () => {
      setSse("live");
      refreshAgents();
      refreshRooms();
    };
    es.onerror = () => setSse(es.readyState === EventSource.CLOSED ? "down" : "connecting");
    for (const t of SSE_EVENTS) {
      es.addEventListener(t, (ev) => {
        const d = JSON.parse((ev as MessageEvent).data);
        emit(t, d);
        if (t === "message.created") {
          if (d.message && d.room_id !== activeRef.current && d.message.from?.kind !== "system") setUnread((u) => ({ ...u, [d.room_id]: (u[d.room_id] ?? 0) + 1 }));
          dRooms();
          if (d.message?.from?.kind === "agent") dAgents();
        }
        if (["room.paused", "room.resumed", "room.updated"].includes(t)) dRooms();
        if (["presence.updated", "agent.updated", "inbox.dead"].includes(t)) dAgents();
        if (t === "task.updated") dAgents();
        if (t === "human_request.created") {
          dReq();
          if (soundRef.current) beep();
        }
        if (t === "human_request.answered") dReq();
      });
    }
    const poll = setInterval(refreshAgents, 20000); // Presence ages without events.
    return () => {
      es.close();
      clearInterval(poll);
    };
  }, [me, refreshAgents, refreshRooms, refreshRequests]);

  useEffect(() => on("room.paused", (d) => toast(`Room paused (${d.reason})`, "err")), [toast]);
  useEffect(() => {
    if (!active && rooms.length) setActive(rooms.find((r) => r.name === "general")?.id ?? rooms[0].id);
  }, [rooms, active]);

  const openRoom = useCallback((id: string | null) => {
    setActive(id);
    setNav("chat");
    setMenu(false);
    if (id) setUnread((u) => ({ ...u, [id]: 0 }));
  }, []);

  const roomLabel = useCallback(
    (r: any) => (r.kind === "dm" ? (r.members ?? []).filter((n: string) => n !== me?.handle).join(", ") || "dm" : r.name),
    [me],
  );
  const openReq = requests.filter((r) => r.status === "open").length;

  const ctx: AppState = useMemo(
    () => ({ me, agents, rooms, requests, unread, activeRoom: active, sse, refreshAgents, refreshRooms, refreshRequests, openRoom, setNav, toast, roomLabel }),
    [me, agents, rooms, requests, unread, active, sse, refreshAgents, refreshRooms, refreshRequests, openRoom, toast, roomLabel],
  );

  if (!boot) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-mute">
        <div className="label flex items-center gap-3"><Mark size={28} />Loading AgentRelay…</div>
      </div>
    );
  }

  if (!me && workspaceRoute) return <div className="label flex min-h-screen items-center justify-center bg-paper text-mute">Redirecting to sign in…</div>;
  if (!me) {
    return (
      <Login
        needsSetup={boot.needs_setup}
        onDone={async (r) => {
          setCsrf(r.csrf);
          const me = r.user.handle ? r.user : { ...r.user, handle: r.user.email.split("@")[0] };
          setBoot({ me, needs_setup: false, workspace: null });
          // Fetch the freshly created workspace name (login/setup responses do not include it).
          api("GET", "auth/me")
            .then((m) => setBoot({ me: m.user ?? me, needs_setup: false, workspace: m.workspace ?? null }))
            .catch(() => {});
          router.replace("/workspace");
        }}
      />
    );
  }

  const groups = rooms.filter((r) => r.kind === "group");
  const dms = rooms.filter((r) => r.kind === "dm");
  const pageTitle = NAV.find((item) => item.id === nav)?.label ?? "Workspace";

  return (
    <AppCtx.Provider value={ctx}>
      {/* The shell owns the viewport: 100dvh follows mobile URL bars, and
          --app-h (set while a keyboard is open on iOS) shrinks it further.
          Nothing outside it scrolls, so the app header can never drift away. */}
      <div className="flex h-[var(--app-h,100dvh)] overflow-hidden overscroll-none bg-paper text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        {menu && <button className="fixed inset-0 z-30 cursor-default bg-slate-950/50 md:hidden" onClick={() => setMenu(false)} aria-label="Close navigation" />}
        <aside className={`fixed inset-y-0 left-0 z-40 flex w-[264px] shrink-0 flex-col overflow-hidden border-r border-white/[0.07] bg-ink text-slate-300 shadow-2xl shadow-black/10 transition-transform md:static md:translate-x-0 md:shadow-none ${menu ? "translate-x-0" : "-translate-x-full"}`} aria-label="Sidebar">
          <div className="flex h-[76px] shrink-0 items-center justify-between border-b border-paper/15 px-5">
            <Link href="/" className="flex min-w-0 items-center" aria-label="AgentRelay site"><Logo dark={false} /></Link>
            <span title={`Realtime: ${sse}`} aria-label={`Realtime ${sse}`} className="shrink-0"><Dot state={sse === "live" ? "online" : sse === "connecting" ? "blocked" : "error"} /></span>
          </div>
          <div className="shrink-0 px-4 pb-2 pt-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-600">Workspace</div>
          <nav className="shrink-0 space-y-1 px-3" aria-label="Main">
            {NAV.map(({ id, icon, label }) => (
              <button key={id} onClick={() => (setNav(id), setMenu(false))} aria-current={nav === id} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] transition ${nav === id ? "bg-paper/10 font-semibold text-paper shadow-[inset_3px_0_0_#ff4a1c]" : "text-slate-400 hover:bg-white/[0.045] hover:text-slate-100"}`}>
                <Icon name={icon} size={17} className={nav === id ? "text-signal" : "text-slate-500 group-hover:text-slate-300"} />
                <span className="flex-1">{label}</span>
                {id === "requests" && openReq > 0 && <span className="bg-signal px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink">{openReq}</span>}
              </button>
            ))}
          </nav>
          <div className="mx-4 mt-5 shrink-0 border-t border-white/[0.06]" />
          <div className="mt-4 flex shrink-0 items-center justify-between px-5 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
            <span>Rooms</span>
            <button className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition hover:bg-white/[0.07] hover:text-white" onClick={() => setNewRoom(true)} title="New room" aria-label="New room">
              <Icon name="plus" size={15} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 text-[12px]">
            {groups.map((r) => <RoomButton key={r.id} r={r} label={`# ${r.name}`} active={nav === "chat" && active === r.id} unread={unread[r.id]} onClick={() => openRoom(r.id)} />)}
            {dms.length > 0 && <div className="px-3 pb-2 pt-5 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-600">Direct messages</div>}
            {dms.map((r) => <RoomButton key={r.id} r={r} label={`@ ${roomLabel(r)}`} active={nav === "chat" && active === r.id} unread={unread[r.id]} onClick={() => openRoom(r.id)} />)}
            {!groups.length && !dms.length && <p className="px-3 py-2 text-[11px] leading-5 text-slate-600">Create a room to give your agents a shared place to work.</p>}
          </div>
          <div className="shrink-0 border-t border-white/[0.07] p-3">
            <div className="flex items-center gap-2.5 rounded-xl p-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-700/70 text-xs font-semibold text-slate-200">{(me.name || me.email || "U").slice(0, 1).toUpperCase()}</div>
              <div className="min-w-0 flex-1 truncate">
                <b className="block truncate text-xs font-semibold text-slate-200">{me.name}</b>
                <span className="text-[10px] capitalize text-slate-500">{me.role}</span>
              </div>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/[0.07] hover:text-white"
                title="Sign out"
                aria-label="Sign out"
                onClick={async () => {
                  await api("POST", "auth/logout").catch(() => {});
                  setCsrf("");
                  setBoot({ me: null, needs_setup: false });
                  router.replace("/");
                }}
              ><Icon name="logout" size={16} /></button>
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="z-10 flex h-[62px] shrink-0 items-center justify-between border-b border-ink/20 bg-paper-2 px-4 dark:border-paper/15 dark:bg-slate-900 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <button className="flex h-10 w-10 items-center justify-center border border-ink text-ink transition hover:bg-ink hover:text-paper md:hidden dark:border-paper dark:text-paper" onClick={() => setMenu(true)} aria-label="Open menu">
                <Icon name="menu" size={19} />
              </button>
              <div>
                <p className="label text-mute">AgentRelay workspace</p>
                <h1 className="font-display mt-0.5 flex items-baseline gap-2 text-xl font-bold leading-none">
                  <span>{pageTitle}</span>
                  {boot?.workspace?.name && (
                    <span className="border border-ink/25 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-mute dark:border-paper/25" title="Your workspace">
                      {boot.workspace.name}
                    </span>
                  )}
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="label hidden text-mute sm:inline" aria-label="Agents online">{agents.filter((a) => a.presence === "online").length}/{agents.length} agents online</span>
              <span role="status" className="label flex items-center gap-2 border border-ink/30 px-3 py-1.5 text-ink dark:border-paper/30 dark:text-paper">
                <Dot state={sse === "live" ? "online" : sse === "connecting" ? "blocked" : "error"} />
                {sse === "live" ? "Connected" : sse === "connecting" ? "Connecting" : "Reconnecting"}
              </span>
            </div>
          </header>
          
          {/* Chat manages its own scrolling (message list only), so the outer
              wrapper must not scroll or the room header would scroll away.
              Other pages keep scrolling here. */}
          <div className={nav === "chat" ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-y-auto"}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={nav} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="h-full min-h-0">
                {nav === "chat" && (active ? <div className="h-full min-h-0"><Chat key={active} roomId={active} /></div> : <div className="p-8 text-sm text-slate-500">{rooms.length ? "Select a room." : "No rooms yet — create one with the + button in the sidebar."}</div>)}
                {nav === "agents" && <Agents />}
                {nav === "tasks" && <Tasks />}
                {nav === "requests" && <Requests />}
                {nav === "activity" && <Activity />}
                {nav === "settings" && <Settings sound={sound} setSound={setSound} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
      {toastMsg && (
        <div role="status" className={`fixed bottom-4 right-4 z-[60] rounded-xl border px-4 py-3 text-sm shadow-lg ${toastMsg.kind === "err" ? "border-rose-500/20 bg-rose-700 text-white" : "border-slate-700 bg-slate-900 text-white"}`}>
          {toastMsg.msg}
        </div>
      )}
      {newRoom && (
        <Modal title="New room" onClose={() => setNewRoom(false)}>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const r = await api("POST", "rooms", { name: nr.name, topic: nr.topic, members: nr.members });
                setNewRoom(false);
                setNr({ name: "", topic: "", members: [] });
                refreshRooms();
                openRoom(r.room.id);
              } catch (er: any) {
                toast(er.message, "err");
              }
            }}
          >
            <input className={field} required placeholder="room-name" pattern="[a-zA-Z0-9][a-zA-Z0-9_-]*" value={nr.name} onChange={(e) => setNr({ ...nr, name: e.target.value })} aria-label="Room name" />
            <input className={field} placeholder="Topic (optional)" value={nr.topic} onChange={(e) => setNr({ ...nr, topic: e.target.value })} aria-label="Topic" />
            <div className="text-xs font-semibold">Agents</div>
            <div className="flex flex-wrap gap-2">
              {agents.map((a) => (
                <label key={a.id} className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={nr.members.includes(a.name)} onChange={(e) => setNr({ ...nr, members: e.target.checked ? [...nr.members, a.name] : nr.members.filter((x) => x !== a.name) })} />@{a.name}
                </label>
              ))}
            </div>
            <button className={btnPrimary}>Create room</button>
          </form>
        </Modal>
      )}
    </AppCtx.Provider>
  );
}

function RoomButton({ r, label, active, unread, onClick }: any) {
  return (
    <button onClick={onClick} aria-current={active} className={`group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] transition ${active ? "bg-white/[0.09] font-medium text-white" : "text-slate-500 hover:bg-white/[0.045] hover:text-slate-300"}`}>
      <span className="flex-1 truncate">{label}</span>
      {r.state === "paused" && <Icon name="pause" size={13} className="text-amber-300" />}
      {unread > 0 && <span className="rounded-md bg-signal px-1.5 py-0.5 font-mono text-[9px] font-bold text-ink">{unread}</span>}
    </button>
  );
}

function beep() {
  try {
    const ac = new AudioContext();
    const o = ac.createOscillator();
    o.connect(ac.destination);
    o.frequency.value = 880;
    o.start();
    setTimeout(() => (o.stop(), ac.close()), 180);
  } catch {}
}
