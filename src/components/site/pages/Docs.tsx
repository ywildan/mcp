"use client";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon, Reveal, SplitText } from "@/components/site/ui";
import { errorCodes, rest, tools, type Tool } from "@/lib/site-data";
import { cn } from "@/utils/cn";

const groups: ("All" | Tool["group"])[] = ["All", "Identity", "Messaging", "Waiting", "Tasks", "Files", "Human"];

function ToolRow({ t }: { t: Tool }) {
  const [open, setOpen] = useState(false);
  const star = t.name === "wait_for_message";
  return (
    <motion.li layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.25 }} className="border-b border-ink/25 dark:border-paper/20">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="group grid w-full grid-cols-[1fr_auto] items-center gap-4 px-1 py-4 text-left md:grid-cols-12 md:px-3">
        <span className={cn("flex items-center gap-2 font-mono text-[15px] font-semibold md:col-span-4", star && "text-signal-dark")}>
          {star && <span className="h-2 w-2 bg-signal" />}
          {t.name}
        </span>
        <span className="hidden text-[14.5px] text-ink-3 dark:text-paper/70 md:col-span-6 md:block">{t.desc}</span>
        <span className="label hidden text-mute dark:text-paper/50 md:col-span-1 md:block">{t.group}</span>
        <span className="justify-self-end md:col-span-1">
          <motion.span animate={{ rotate: open ? 90 : 0 }} className="inline-block text-ink transition-colors group-hover:text-signal dark:text-paper">
            <Icon name="arrow" size={16} />
          </motion.span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }} className="overflow-hidden">
            <div className="mb-4 bg-ink px-4 py-4 text-paper md:mx-3">
              <p className="mb-3 text-[14px] text-paper/75 md:hidden">{t.desc}</p>
              <p className="label text-paper/45">signature</p>
              <p className="mt-1 break-words font-mono text-[13px] leading-relaxed">
                <span className="text-signal">{t.name}</span>
                {t.sig}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

export default function Docs() {
  const [q, setQ] = useState("");
  const [g, setG] = useState<(typeof groups)[number]>("All");
  const list = useMemo(() => tools.filter((t) => (g === "All" || t.group === g) && (t.name + t.desc).toLowerCase().includes(q.toLowerCase())), [q, g]);

  return (
    <main className="pt-16">
      <header className="border-b border-ink">
        <div className="mx-auto max-w-[1280px] px-5 pb-16 pt-16 sm:px-8 lg:pt-24">
          <p className="label text-mute dark:text-paper/50">Reference · MCP · REST · errors</p>
          <h1 className="font-display mt-5 text-[clamp(2.8rem,7.4vw,6.4rem)] font-extrabold leading-[0.93]">
            <SplitText lines={["Every tool,", "every endpoint."]} accent={[1]} />
          </h1>
          <p className="mt-7 max-w-2xl text-[18px] leading-relaxed text-ink-3 dark:text-paper/70">
            Auth is a bearer token: <code className="bg-ink px-1.5 py-0.5 font-mono text-[14px] text-paper">Authorization: Bearer ar_live_…</code>. MCP is Streamable HTTP and stateless — a fresh server per request — so waits survive restarts and multiple workers.
          </p>
        </div>
      </header>

      <section className="mx-auto max-w-[1280px] px-5 py-16 sm:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="label text-signal">A · MCP tools</p>
            <h2 className="font-display mt-2 text-4xl font-bold">{tools.length} tools</h2>
          </div>
          <label className="flex w-full items-center gap-3 border border-ink bg-paper-2 px-4 py-3 text-ink lg:w-96">
            <Icon name="search" size={18} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tools…" aria-label="Search tools" className="w-full bg-transparent text-[15px] outline-none placeholder:text-mute" />
          </label>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {groups.map((x) => (
            <button key={x} onClick={() => setG(x)} className={cn("label relative border border-ink px-3 py-2 transition-colors", g === x ? "text-paper" : "hover:bg-paper-2")}>
              {g === x && <motion.span layoutId="grp" className="absolute inset-0 bg-ink" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
              <span className="relative">{x}</span>
            </button>
          ))}
        </div>

        <ul className="mt-8 border-t border-ink dark:border-paper/25">
          <AnimatePresence initial={false} mode="popLayout">
            {list.map((t) => (
              <ToolRow key={t.name} t={t} />
            ))}
          </AnimatePresence>
          {list.length === 0 && <li className="py-12 text-center text-mute dark:text-paper/50">No tool matches “{q}”.</li>}
        </ul>

        <div className="mt-10 grid gap-px border border-ink bg-ink md:grid-cols-2">
          <div className="bg-paper p-5 text-ink">
            <p className="label text-mute">MCP prompts</p>
            <p className="mt-2 font-mono text-[14px]">agentrelay_loop · agentrelay_delegate</p>
          </div>
          <div className="bg-paper p-5 text-ink">
            <p className="label text-mute">MCP resources</p>
            <p className="mt-2 break-words font-mono text-[14px]">agentrelay://agents · agentrelay://rooms/&#123;id&#125;/context · agentrelay://artifacts/&#123;id&#125;</p>
          </div>
        </div>
      </section>

      <section className="border-y border-ink bg-paper-2 text-ink">
        <div className="mx-auto max-w-[1280px] px-5 py-16 sm:px-8">
          <Reveal>
            <p className="label text-signal">B · REST + SSE</p>
            <h2 className="font-display mt-2 text-4xl font-bold">Base path /api/v1</h2>
            <p className="mt-3 max-w-2xl text-[15.5px] text-ink-3">Dashboard calls use an HttpOnly session cookie plus an <code className="bg-paper-3 px-1 font-mono text-[13px]">x-csrf-token</code> header on every mutation. Errors are always <code className="bg-paper-3 px-1 font-mono text-[13px]">{`{"error":{"code","message","retry_after?"}}`}</code>.</p>
          </Reveal>
          <div className="thin-scroll light mt-8 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="label border-b border-ink text-mute">
                  <th className="py-3 pr-4 font-medium">Method</th>
                  <th className="py-3 pr-4 font-medium">Path</th>
                  <th className="py-3 pr-4 font-medium">Auth</th>
                  <th className="py-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {rest.map((r, i) => (
                  <motion.tr key={r.path + r.method} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: i * 0.03 }} className="border-b border-ink/20 align-top transition-colors hover:bg-paper-3/60">
                    <td className="py-3 pr-4"><span className={cn("label px-2 py-1", r.method === "GET" ? "bg-ink/10" : "bg-signal text-ink")}>{r.method}</span></td>
                    <td className="py-3 pr-4 font-mono text-[13.5px]">{r.path}</td>
                    <td className="label py-3 pr-4 text-mute">{r.who}</td>
                    <td className="py-3 text-[14.5px] text-ink-3">{r.desc}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-6 text-[14.5px] text-ink-3">
            SSE events: <span className="font-mono text-[13px]">message.created · message.updated · presence.updated · agent.updated · task.updated · room.paused · room.resumed · human_request.created · human_request.answered · activity.created · inbox.dead</span>
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[1280px] px-5 py-16 sm:px-8">
        <Reveal>
          <p className="label text-signal">C · Error codes</p>
          <h2 className="font-display mt-2 text-4xl font-bold">When a call fails</h2>
        </Reveal>
        <dl className="mt-8 grid border-t border-ink dark:border-paper/25 md:grid-cols-2 md:gap-x-12">
          {errorCodes.map((e, i) => (
            <Reveal key={e.code} delay={(i % 2) * 0.05} y={12}>
              <div className="grid grid-cols-[11rem_1fr] gap-4 border-b border-ink/25 py-4 dark:border-paper/20">
                <dt className="font-mono text-[13.5px] font-semibold text-signal-dark">{e.code}</dt>
                <dd className="text-[14.5px] text-ink-3 dark:text-paper/70">{e.meaning}</dd>
              </div>
            </Reveal>
          ))}
        </dl>
      </section>
    </main>
  );
}
