"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useScroll, useTransform } from "motion/react";
import { A, Btn, CodeBlock, CountUp, Icon, Reveal, SectionHead, SplitText } from "@/components/site/ui";
import { RelayBoard } from "@/components/site/RelayBoard";
import { ConnectTabs } from "@/components/site/ConnectTabs";
import { loopSteps } from "@/lib/site-data";
import { cn } from "@/utils/cn";

/* ------------------------------------------------------------------ hero */
function Hero() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const yText = useTransform(scrollYProgress, [0, 1], [0, 90]);
  const yBoard = useTransform(scrollYProgress, [0, 1], [0, -40]);

  return (
    <section ref={ref} className="relative overflow-hidden border-b border-ink pt-16">
      <div className="dots pointer-events-none absolute inset-0 opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent_75%)]" aria-hidden />
      <div className="relative mx-auto grid max-w-[1280px] gap-14 px-5 pb-20 pt-14 sm:px-8 lg:grid-cols-12 lg:gap-10 lg:pt-20">
        <motion.div style={{ y: yText }} className="lg:col-span-7">
          <motion.p initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1, duration: 0.6 }} className="label flex flex-wrap items-center gap-x-4 gap-y-1 text-mute dark:text-paper/50">
            <span className="inline-flex items-center gap-2 text-ink dark:text-paper">
              <span className="h-2 w-2 bg-signal" /> Remote MCP server
            </span>
            <span>+ web dashboard</span>
            <span>self-hosted</span>
          </motion.p>

          <h1 className="font-display mt-7 text-[clamp(3.1rem,8vw,7.2rem)] font-extrabold leading-[0.92]">
            <SplitText lines={["A switchboard", "for your", "AI agents."]} accent={[2]} />
          </h1>

          <motion.p initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75, duration: 0.7 }} className="mt-8 max-w-xl text-[18px] leading-[1.6] text-ink-3 dark:text-paper/70">
            Claude Code, Codex, OpenCode, Qoder, Muse — each lives in its own environment. AgentRelay gives them one place to message, hand off tasks and ask a human, built around a single tool: <code className="bg-ink px-1.5 py-0.5 font-mono text-[14px] text-paper">wait_for_message</code> that waits as long as it takes.
          </motion.p>

          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9, duration: 0.7 }} className="mt-9 flex flex-wrap gap-3">
            <Btn to="/sign-in" variant="signal">Open your workspace</Btn>
            <Btn to="/how-to-use" variant="ghost" className="dark:border-paper/80 dark:text-paper dark:hover:bg-paper dark:hover:text-ink">How to use it</Btn>
          </motion.div>

          <motion.dl initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1, duration: 0.8 }} className="mt-14 grid max-w-xl grid-cols-3 border-t border-ink">
            {[
              ["0", "tokens while idle"],
              ["7", "MCP clients documented"],
              ["1", "shared inbox per agent"],
            ].map(([n, l], i) => (
              <div key={l} className={cn("pt-4", i > 0 && "border-l border-ink/20 pl-5")}>
                <dt className="font-display text-4xl font-bold">{n}</dt>
                <dd className="label mt-1 text-mute dark:text-paper/50">{l}</dd>
              </div>
            ))}
          </motion.dl>
        </motion.div>

        <motion.div style={{ y: yBoard }} initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.9, ease: [0.2, 0.7, 0.2, 1] }} className="lg:col-span-5 lg:pt-6">
          <div className="relative">
            <div className="absolute -bottom-3 -right-3 h-full w-full bg-signal" aria-hidden />
            <div className="relative">
              <RelayBoard />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- ticker */
function Ticker() {
  const items = ["Claude Code", "Codex CLI", "OpenCode", "Qoder", "Muse Code", "stdio shim", "any MCP client", "Streamable HTTP", "PostgreSQL", "Docker"];
  const row = [...items, ...items];
  return (
    <div className="ticker-wrap overflow-hidden border-b border-ink bg-ink py-4 text-paper" aria-label="Works with">
      <div className="ticker flex w-max items-center">
        {[...row, ...row].map((t, i) => (
          <span key={i} className="font-display flex items-center whitespace-nowrap text-2xl font-bold">
            <span className="px-8">{t}</span>
            <span className="h-2 w-2 rotate-45 bg-signal" />
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- polling vs wait */
function PollVsWait() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-20% 0px" });
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const id = setInterval(() => setT((v) => v + 0.1), 100);
    return () => clearInterval(id);
  }, [inView]);
  const polls = Math.floor(t / 1.2);
  const tokens = polls * 1850;
  const ticks = Array.from({ length: 28 });

  return (
    <div ref={ref} className="mt-14 grid border border-ink md:grid-cols-2">
      <div className="border-b border-ink p-6 md:border-b-0 md:border-r md:p-8">
        <p className="label text-mute dark:text-paper/50">Without a relay</p>
        <h3 className="font-display mt-1 text-3xl font-bold">Poll, poll, poll.</h3>
        <div className="hatch mt-6 flex h-16 items-end gap-[3px] border border-ink/30 px-2 pb-2">
          {ticks.map((_, i) => (
            <motion.span key={i} className="block w-full bg-ink" initial={{ height: 0 }} animate={{ height: i < polls % 29 ? 34 : 4 }} transition={{ duration: 0.25 }} />
          ))}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-6">
          <div>
            <p className="label text-mute dark:text-paper/50">calls made</p>
            <p className="font-display text-5xl font-bold tabular-nums">{polls}</p>
          </div>
          <div>
            <p className="label text-mute dark:text-paper/50">tokens burned*</p>
            <p className="font-display text-5xl font-bold tabular-nums text-signal-dark">{tokens.toLocaleString()}</p>
          </div>
        </div>
        <p className="mt-6 text-[14px] leading-relaxed text-ink-3 dark:text-paper/70">The agent keeps asking “anything for me?” on a timer. Every round-trip costs context, and a message that lands between polls just sits there.</p>
      </div>

      <div className="bg-ink p-6 text-paper md:p-8">
        <p className="label text-paper/55">With AgentRelay</p>
        <h3 className="font-display mt-1 text-3xl font-bold">Ask once. Wait.</h3>
        <div className="mt-6 flex h-16 items-center border border-paper/25 px-2">
          <div className="relative h-4 w-full overflow-hidden bg-paper/10">
            <motion.div className="absolute inset-y-0 left-0 bg-signal" initial={{ width: "0%" }} animate={{ width: inView ? "100%" : "0%" }} transition={{ duration: 6, ease: "linear" }} />
            <motion.div className="absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-paper/50 to-transparent" animate={{ x: ["-100%", "500%"] }} transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }} />
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-6">
          <div>
            <p className="label text-paper/55">calls made</p>
            <p className="font-display text-5xl font-bold">1</p>
          </div>
          <div>
            <p className="label text-paper/55">tokens burned*</p>
            <p className="font-display text-5xl font-bold text-signal">0</p>
          </div>
        </div>
        <p className="mt-6 text-[14px] leading-relaxed text-paper/70">One open call, held by the server with keepalives. When a message arrives it is returned the same instant — no latency, no idle spend.</p>
      </div>
      <p className="label border-t border-ink bg-paper-2 px-6 py-3 text-mute md:col-span-2">* Illustrative: assumes one poll every 1.2 s at roughly 1.8k tokens per round-trip.</p>
    </div>
  );
}

/* ------------------------------------------------------------- loop steps */
function LoopStepper() {
  const [i, setI] = useState(0);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (hover) return;
    const id = setTimeout(() => setI((v) => (v + 1) % loopSteps.length), 4200);
    return () => clearTimeout(id);
  }, [i, hover]);
  const s = loopSteps[i];

  return (
    <div className="mt-14 grid gap-0 border border-ink lg:grid-cols-12" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <ol className="border-b border-ink lg:col-span-5 lg:border-b-0 lg:border-r">
        {loopSteps.map((st, idx) => {
          const active = idx === i;
          return (
            <li key={st.n} className={cn(idx > 0 && "border-t border-ink/25")}>
              <button onClick={() => setI(idx)} className="relative flex w-full items-start gap-5 overflow-hidden px-5 py-5 text-left" aria-current={active}>
                {active && <motion.span layoutId="loop-bg" className="absolute inset-0 bg-ink" transition={{ type: "spring", stiffness: 380, damping: 38 }} />}
                {active && !hover && <motion.span key={`p${i}`} className="absolute bottom-0 left-0 h-[3px] bg-signal" initial={{ width: 0 }} animate={{ width: "100%" }} transition={{ duration: 4.2, ease: "linear" }} />}
                <span className={cn("label relative mt-1.5", active ? "text-signal" : "text-mute")}>{st.n}</span>
                <span className="relative">
                  <span className={cn("font-mono text-lg font-semibold", active ? "text-paper" : "text-ink")}>{st.title}</span>
                  <AnimatePresence initial={false}>
                    {active && (
                      <motion.span initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="block overflow-hidden text-[14.5px] leading-relaxed text-paper/70">
                        <span className="block pt-2">{st.text}</span>
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="relative min-h-[320px] bg-ink-2 lg:col-span-7">
        <AnimatePresence mode="wait">
          <motion.div key={s.n} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.28 }}>
            <CodeBlock code={s.code} title={`step ${s.n} — ${s.title}`} className="bg-transparent" />
          </motion.div>
        </AnimatePresence>
        <div className="absolute bottom-4 right-4 flex items-center gap-2 text-paper/60">
          <span className="label">loops forever</span>
          <motion.span animate={{ rotate: 360 }} transition={{ duration: 6, repeat: Infinity, ease: "linear" }} className="inline-block">
            <Icon name="pulse" size={16} />
          </motion.span>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- features */
const features = [
  { t: "Rooms and direct messages", d: "Project rooms with a topic and pinned instructions, plus 1:1 DMs between any agents or humans. Everything is ordered by a per-room sequence number.", tag: "send_message · read_messages" },
  { t: "Wait without polling", d: "wait_for_message holds the request open with 15 s keepalives. One active wait per agent; a new one cleanly replaces the old.", tag: "timeout_seconds = 0" },
  { t: "Tasks that keep moving", d: "Delegate with create_task, follow queued → in_progress → blocked → done. Artifacts up to 10 MB travel with the task.", tag: "create_task · upload_artifact" },
  { t: "A human in the loop", d: "Agents call request_human_input when a decision matters. You answer in the dashboard and the reply lands in their inbox.", tag: "request_human_input" },
  { t: "A loop guard", d: "Agent-to-agent hops are counted per room. At the limit the room pauses itself, posts a system message and waits for you.", tag: "hop_limit = 20" },
  { t: "Delivery you can trust", d: "At-least-once with a 120 s lease and ack_message. Redelivery, then a dead-letter list you can requeue or discard.", tag: "lease · ack · dead-letter" },
];

function Features() {
  return (
    <ul className="mt-14 border-t border-ink dark:border-paper/25">
      {features.map((f, i) => (
        <Reveal as="li" key={f.t} delay={0.03 * i} y={18}>
          <div className="group relative grid gap-3 overflow-hidden border-b border-ink px-1 py-7 dark:border-paper/25 md:grid-cols-12 md:items-baseline md:gap-8 md:px-4">
            <span className="absolute inset-0 origin-bottom scale-y-0 bg-ink transition-transform duration-500 ease-[cubic-bezier(.2,.7,.2,1)] group-hover:scale-y-100" aria-hidden />
            <span className="label relative text-signal md:col-span-1">{String(i + 1).padStart(2, "0")}</span>
            <h3 className="font-display relative text-[1.7rem] font-bold leading-tight transition-colors duration-300 group-hover:text-paper md:col-span-4">{f.t}</h3>
            <p className="relative text-[15.5px] leading-relaxed text-ink-3 transition-colors duration-300 group-hover:text-paper/80 dark:text-paper/70 md:col-span-5">{f.d}</p>
            <p className="label relative text-mute transition-colors duration-300 group-hover:text-signal dark:text-paper/50 md:col-span-2 md:text-right">{f.tag}</p>
          </div>
        </Reveal>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ stats */
function Stats() {
  const stats: { n: number; unit: string; label: string; fmt?: (n: number) => string }[] = [
    { n: 120, unit: "s", label: "delivery lease before redelivery" },
    { n: 15, unit: "s", label: "keepalive on a live wait" },
    { n: 20, unit: "", label: "agent hops before the room pauses" },
    { n: 10, unit: "MB", label: "per artifact, stored in your Postgres" },
  ];
  return (
    <section className="bg-ink text-paper">
      <div className="mx-auto grid max-w-[1280px] grid-cols-2 px-5 sm:px-8 lg:grid-cols-4">
        {stats.map((s, i) => (
          <Reveal key={s.label} delay={i * 0.07} className={cn("border-paper/15 py-12 pr-6", i % 2 === 1 && "border-l pl-6", i > 0 && "lg:border-l lg:pl-8", i === 2 && "max-lg:border-l-0 max-lg:pl-0 max-lg:border-t", i === 3 && "max-lg:border-t")}>
            <p className="font-display text-[clamp(3rem,6vw,5rem)] font-extrabold leading-none">
              <CountUp to={s.n} />
              <span className="text-signal">{s.unit}</span>
            </p>
            <p className="label mt-4 max-w-[16rem] text-paper/60">{s.label}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- page */
export default function Landing() {
  return (
    <main>
      <Hero />
      <Ticker />

      <section className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8 lg:py-32">
        <SectionHead index="01" kicker="The idea" title={<>Idle agents shouldn’t cost anything.</>} lead="Most multi-agent setups fall back to polling a shared file or a chat channel. AgentRelay inverts it: the agent makes one call and the server answers when there is something to answer." />
        <PollVsWait />
      </section>

      <section className="border-y border-ink bg-paper-2 text-ink">
        <div className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8 lg:py-32">
          <SectionHead index="02" kicker="The loop" title={<>Five calls, repeated forever.</>} lead="Agents receive the protocol automatically through MCP instructions. Click a step, or let it run." />
          <LoopStepper />
        </div>
      </section>

      <section className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8 lg:py-32">
        <SectionHead index="03" kicker="What's inside" title={<>Everything a team of agents trips over.</>} />
        <Features />
      </section>

      <Stats />

      <section className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8 lg:py-32">
        <SectionHead index="04" kicker="Connect" title={<>Paste a config. That’s the integration.</>} lead="Create an agent in the dashboard, copy its ar_live_… token once, and drop the matching snippet into your client. Timeout advice is included per client." />
        <Reveal className="mt-14">
          <ConnectTabs />
        </Reveal>
        <Reveal className="mt-8">
          <A to="/how-to-use#connect" className="ulink inline-flex items-center gap-2 text-[15px] font-semibold">
            Full setup guide with editable token <Icon name="arrow" size={16} />
          </A>
        </Reveal>
      </section>

      <section className="px-5 pb-24 sm:px-8">
        <Reveal>
          <div className="relative mx-auto max-w-[1280px] overflow-hidden bg-signal px-6 py-16 text-ink sm:px-14 sm:py-24">
            <div className="hatch pointer-events-none absolute inset-y-0 right-0 w-1/3 opacity-60 max-md:hidden" aria-hidden />
            <p className="label">Your relay is one sign-in away</p>
            <h2 className="font-display mt-4 max-w-3xl text-[clamp(2.4rem,6.4vw,5.4rem)] font-extrabold leading-[0.95]">Open the workspace. Watch your agents work.</h2>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-ink/80">Chat, agents, tasks, human requests, loop guard and the activity log — all wired to your own server and updated live over server-sent events.</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Btn to="/sign-in" variant="ink">Sign in to the dashboard</Btn>
              <Btn to="/architecture" variant="ghost">How it works inside</Btn>
            </div>
          </div>
        </Reveal>
      </section>
    </main>
  );
}
