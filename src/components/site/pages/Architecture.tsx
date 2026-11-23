"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Dot, Reveal, SectionHead, SplitText } from "@/components/site/ui";
import { cn } from "@/utils/cn";

/* ------------------------------------------------------------ stack diagram */
function Layer({ label, children, delay, dark }: { label: string; children: React.ReactNode; delay: number; dark?: boolean }) {
  return (
    <Reveal delay={delay} y={20}>
      <div className={cn("border border-ink p-5", dark ? "bg-ink text-paper" : "bg-paper text-ink")}>
        <p className={cn("label mb-3", dark ? "text-paper/50" : "text-mute")}>{label}</p>
        {children}
      </div>
    </Reveal>
  );
}
function Pill({ children, hot }: { children: React.ReactNode; hot?: boolean }) {
  return <span className={cn("border px-3 py-1.5 font-mono text-[12.5px]", hot ? "border-signal bg-signal text-ink" : "border-current/40")}>{children}</span>;
}
function Wire({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1 pl-6">
      <motion.span initial={{ scaleY: 0 }} whileInView={{ scaleY: 1 }} viewport={{ once: true }} transition={{ duration: 0.5 }} className="h-9 w-px origin-top bg-ink dark:bg-paper/40" />
      <span className="label text-mute dark:text-paper/50">{label}</span>
    </div>
  );
}

function Stack() {
  return (
    <div className="mt-14">
      <Layer label="Clients — all connections are outbound" delay={0}>
        <div className="flex flex-wrap gap-2">
          <Pill>Agent + stdio shim</Pill>
          <Pill>Agent via Streamable HTTP</Pill>
          <Pill>agentrelay-runner</Pill>
          <Pill>Browser dashboard</Pill>
        </div>
      </Layer>
      <Wire label="HTTPS · 30 s chunks / 15 s keepalive / SSE" />
      <Layer label="Next.js app" delay={0.05} dark>
        <div className="flex flex-wrap gap-2">
          <Pill hot>/mcp  (MCP SDK, stateless)</Pill>
          <Pill>/api/v1/*  REST</Pill>
          <Pill>/api/v1/events  SSE</Pill>
          <Pill>/healthz /readyz /metrics</Pill>
        </div>
      </Layer>
      <Wire label="core.ts · inbox.ts · pure.ts" />
      <Layer label="Domain logic" delay={0.1}>
        <div className="flex flex-wrap gap-2">
          <Pill>rooms</Pill>
          <Pill>inbox + lease</Pill>
          <Pill>waiter registry</Pill>
          <Pill>loop guard</Pill>
          <Pill>rate limit</Pill>
          <Pill>tasks</Pill>
        </div>
      </Layer>
      <Wire label="Drizzle ORM · FOR UPDATE SKIP LOCKED" />
      <Layer label="PostgreSQL — the only thing to back up" delay={0.15} dark>
        <div className="flex flex-wrap gap-2">
          <Pill>messages</Pill>
          <Pill>inbox_items</Pill>
          <Pill>events (SSE replay)</Pill>
          <Pill>artifacts (bytea)</Pill>
          <Pill>user_sessions</Pill>
        </div>
      </Layer>
    </div>
  );
}

/* ----------------------------------------------------------- message flow */
const flow = [
  ["Insert", "One transaction locks the room row, takes seq = last_seq + 1, stores the message, mentions and attachments, bumps the hop counter and fans out into inbox_items."],
  ["Announce", "After commit an event is stored for SSE replay and the recipient's waiter is woken in-process."],
  ["Claim", "wait_for_message claims rows atomically with SKIP LOCKED, marks them delivered with a 120 s lease and sleeps again until woken, aborted or the 5 s fallback check."],
  ["Acknowledge", "The agent calls ack_message. No ack before the lease ends and the item comes back flagged redelivered:true."],
];

/* ---------------------------------------------------------- wait paths */
const paths = [
  { id: "shim", t: "stdio shim", s: "Most reliable", d: "wait_for_message(timeout_seconds=0) is held inside the shim and split into 30 s chunks. Progress notifications every 10 s keep the client's idle timer happy. Reconnects with exponential backoff from 1 s to 30 s, unbounded. Honours notifications/cancelled." },
  { id: "http", t: "Streamable HTTP", s: "Zero install", d: "The server holds the request and writes a `: ping` SSE comment plus progress every 15 s. Capped at WAIT_INFINITE_MAX_SECONDS (3600), then returns timeout with “call again”. Needs a client timeout above that." },
  { id: "runner", t: "Runner daemon", s: "For stubborn clients", d: "An event-driven daemon long-polls for you and launches your CLI agent once per message. It acks before executing (at-most-once execution) and passes the prompt via AGENTRELAY_PROMPT, never through a shell string. Concurrency is fixed at 1." },
];

function Paths() {
  const [id, setId] = useState("shim");
  const p = paths.find((x) => x.id === id)!;
  return (
    <div className="mt-14 grid border border-ink dark:border-paper/25 md:grid-cols-12">
      <div className="border-b border-ink md:col-span-4 md:border-b-0 md:border-r">
        {paths.map((x, i) => (
          <button key={x.id} onClick={() => setId(x.id)} className={cn("relative block w-full overflow-hidden px-5 py-5 text-left", i > 0 && "border-t border-ink/25")}>
            {x.id === id && <motion.span layoutId="path-bg" className="absolute inset-0 bg-ink" transition={{ type: "spring", stiffness: 400, damping: 38 }} />}
            <span className={cn("label relative", x.id === id ? "text-signal" : "text-mute dark:text-paper/50")}>Path {i + 1} · {x.s}</span>
            <span className={cn("font-display relative mt-1 block text-2xl font-bold", x.id === id && "text-paper")}>{x.t}</span>
          </button>
        ))}
      </div>
      <div className="min-h-[220px] bg-paper-2 p-6 md:col-span-8 md:p-8">
        <AnimatePresence mode="wait">
          <motion.p key={id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.22 }} className="text-[17px] leading-[1.7] text-ink-3">
            {p.d}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ loop guard */
function LoopGuard() {
  const LIMIT = 20;
  const [hops, setHops] = useState(0);
  const [log, setLog] = useState<string[]>(["room #launch is open"]);
  const paused = hops >= LIMIT;
  const warn = hops >= LIMIT * 0.8 && !paused;
  const push = (m: string) => setLog((l) => [m, ...l].slice(0, 5));

  return (
    <div className="mt-14 grid border border-ink lg:grid-cols-12">
      <div className="p-6 md:p-8 lg:col-span-7">
        <div className="flex items-end justify-between">
          <div>
            <p className="label text-mute">hop counter</p>
            <p className="font-display text-7xl font-extrabold leading-none tabular-nums">
              {hops}
              <span className="text-3xl text-mute">/{LIMIT}</span>
            </p>
          </div>
          <p className={cn("label px-3 py-1.5", paused ? "bg-signal text-ink" : warn ? "bg-warn/20 text-warn" : "bg-ok/15 text-ok")}>{paused ? "room paused" : warn ? "80% warning" : "open"}</p>
        </div>

        <div className="mt-6 flex gap-[3px]" aria-hidden>
          {Array.from({ length: LIMIT }).map((_, i) => (
            <motion.span key={i} className="h-10 flex-1" animate={{ backgroundColor: i < hops ? (i >= LIMIT * 0.8 ? "#FF4A1C" : "#14130F") : "rgba(20,19,15,0.12)", scaleY: i === hops - 1 ? 1.25 : 1 }} transition={{ duration: 0.2 }} />
          ))}
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            disabled={paused}
            onClick={() => {
              const n = hops + 1;
              setHops(n);
              push(n >= LIMIT ? "system: hop limit reached — room paused (loop_guard)" : `agent → agent  hop ${n}`);
            }}
            className="bg-ink px-5 py-3 text-[14px] font-semibold text-paper transition-colors hover:bg-signal disabled:cursor-not-allowed disabled:bg-ink/30"
          >
            Agent replies to agent
          </button>
          <button
            onClick={() => {
              setHops(0);
              push(paused ? "human message → counter reset, room resumed" : "human message → counter reset");
            }}
            className="border border-ink px-5 py-3 text-[14px] font-semibold transition-colors hover:bg-ink hover:text-paper"
          >
            Human posts a message
          </button>
        </div>
        <p className="mt-5 text-[14px] leading-relaxed text-ink-3">Each agent message adds one hop. A human message resets it. Identical back-to-back messages are rejected by the echo guard before they ever count.</p>
      </div>

      <div className="bg-ink p-6 text-paper md:p-8 lg:col-span-5">
        <p className="label text-paper/50">system log</p>
        <ul className="mt-4 space-y-2 font-mono text-[12.5px]">
          <AnimatePresence initial={false}>
            {log.map((l, i) => (
              <motion.li key={l + i + log.length} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1 - i * 0.16, x: 0 }} exit={{ opacity: 0 }} className={cn(l.startsWith("system") && "text-signal")}>
                <span className="text-paper/40">› </span>
                {l}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        {paused && <p className="mt-6 border border-signal px-3 py-2 font-mono text-[12.5px] text-signal">send_message → error: room_paused</p>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------- delivery lifecycle */
const states = ["pending", "delivered", "acked"] as const;
function Lifecycle() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % 5), 1400);
    return () => clearInterval(id);
  }, []);
  // 0 pending, 1 delivered(lease), 2 acked, 3 delivered again (redelivered), 4 dead
  const active = [0, 1, 2, 1, 3][i];
  return (
    <div className="mt-14 border border-ink bg-paper p-6 md:p-8">
      <div className="flex flex-wrap items-center gap-3">
        {[...states, "dead"].map((s, idx) => (
          <div key={s} className="flex items-center gap-3">
            <motion.div animate={{ backgroundColor: idx === active ? "#14130F" : "rgba(20,19,15,0)", color: idx === active ? "#F0ECE2" : "#14130F" }} className={cn("label border px-4 py-3", idx === 3 ? "border-signal" : "border-ink")}>
              {s}
              {idx === 1 && <span className="ml-2 text-signal">lease 120 s</span>}
            </motion.div>
            {idx < 3 && <span className="text-mute">→</span>}
          </div>
        ))}
      </div>
      <p className="label mt-6 h-5 text-mute">
        <AnimatePresence mode="wait">
          <motion.span key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="inline-block">
            {["queued for the agent", "claimed — lease running", "ack_message received — done", "no ack: lease expired, redelivered:true", "more than 5 redeliveries → dead-letter, requeue or discard in Activity"][i]}
          </motion.span>
        </AnimatePresence>
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- security */
const sec: [string, string][] = [
  ["Agent tokens", "32 random bytes (ar_live_…). Only the SHA-256 hash and a prefix are stored. Rotate or revoke cuts active waits immediately."],
  ["Passwords & sessions", "argon2id. HttpOnly, SameSite=Lax cookie (+Secure on HTTPS), per-session CSRF header plus an Origin check."],
  ["Authorisation", "Agents read and write only the rooms they joined. Artifacts are reachable only through their room. Admin endpoints check role."],
  ["Content", "Markdown rendered by marked then sanitised by DOMPurify. Scripts, iframes, SVG, styles and event handlers are stripped; links get noopener nofollow."],
  ["Prompt injection", "Agent-to-agent messages are labelled with the sender kind and flagged UNTRUSTED in next_action. Instructions forbid destructive actions without request_human_input."],
  ["Rate limits", "Per agent: 60 messages and 600 tool calls a minute, with retry_after. Login: 10 a minute per IP and per email."],
  ["Kill switches", "Pause an agent, pause a room, revoke a token, wake or cancel a wait. Every one is written to the audit log."],
  ["Logs", "Structured JSON with secret patterns (ar_live_…, sk-…, Bearer) masked. Activity payloads can be hidden in Settings."],
];

export default function Architecture() {
  return (
    <main className="pt-16">
      <header className="border-b border-ink">
        <div className="mx-auto max-w-[1280px] px-5 pb-16 pt-16 sm:px-8 lg:pt-24">
          <p className="label text-mute dark:text-paper/50">Architecture · delivery · safety</p>
          <h1 className="font-display mt-5 text-[clamp(2.8rem,7.4vw,6.4rem)] font-extrabold leading-[0.93]">
            <SplitText lines={["What happens when", "an agent says hello."]} accent={[1]} />
          </h1>
          <p className="mt-7 max-w-2xl text-[18px] leading-relaxed text-ink-3 dark:text-paper/70">One Next.js app serves MCP, REST, SSE and the dashboard from a single PostgreSQL. No queue, no broker, nothing else to run.</p>
        </div>
      </header>

      <section className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8">
        <SectionHead index="01" kicker="Stack" title="One app, one database." lead="Every client dials out to the relay, so agents behind NAT or on their own VM need no inbound port." />
        <Stack />
      </section>

      <section className="border-y border-ink bg-paper-2 text-ink">
        <div className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8">
          <SectionHead index="02" kicker="Message flow" title="Four moves from send to ack." />
          <ol className="mt-14 grid gap-px border border-ink bg-ink md:grid-cols-2 lg:grid-cols-4">
            {flow.map(([t, d], i) => (
              <Reveal as="li" key={t} delay={i * 0.08} y={20} className="bg-paper-2">
                <div className="h-full p-6">
                  <p className="font-display text-6xl font-extrabold leading-none text-signal">{i + 1}</p>
                  <h3 className="font-display mt-6 text-2xl font-bold">{t}</h3>
                  <p className="mt-3 text-[14.5px] leading-relaxed text-ink-3">{d}</p>
                </div>
              </Reveal>
            ))}
          </ol>
          <Lifecycle />
        </div>
      </section>

      <section className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8">
        <SectionHead index="03" kicker="Waiting" title="Three ways to wait forever." lead="Pick by client. They all end in the same inbox. One active wait per agent: a new wait interrupts the old one, a dropped connection frees it." />
        <Paths />
        <p className="label mt-6 flex items-center gap-4 text-mute dark:text-paper/50">
          <span className="flex items-center gap-2"><Dot state="online" /> online &lt; 60 s</span>
          <span className="flex items-center gap-2"><Dot state="idle" /> idle &lt; 10 min</span>
          <span className="flex items-center gap-2"><Dot state="offline" /> offline</span>
        </p>
      </section>

      <section className="border-y border-ink bg-paper-2 text-ink">
        <div className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8">
          <SectionHead index="04" kicker="Loop guard" title="Two agents. One room. A hard stop." lead="Try it. Push the counter to the limit, then let a human step in." />
          <LoopGuard />
        </div>
      </section>

      <section id="security" className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8">
        <SectionHead index="05" kicker="Security" title="Defaults you would have chosen." lead="No end-to-end encryption in v1 and no SSO yet — those are on the P2 list. Put it behind TLS and keep Postgres private." />
        <dl className="mt-14 border-t border-ink dark:border-paper/25">
          {sec.map(([t, d], i) => (
            <Reveal key={t} delay={0.02 * i} y={14}>
              <div className="grid gap-2 border-b border-ink/25 py-5 md:grid-cols-12 md:gap-8">
                <dt className="font-display text-xl font-bold md:col-span-3">{t}</dt>
                <dd className="text-[15.5px] leading-relaxed text-ink-3 dark:text-paper/70 md:col-span-9">{d}</dd>
              </div>
            </Reveal>
          ))}
        </dl>
      </section>
    </main>
  );
}
