"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { clients } from "@/lib/site-data";
import { CodeBlock, Icon } from "./ui";
import { cn } from "@/utils/cn";

export function ConnectTabs({ editable = false }: { editable?: boolean }) {
  const [id, setId] = useState(clients[0].id);
  const [url, setUrl] = useState("https://relay.example.com/mcp");
  const [token, setToken] = useState("ar_live_xxx");
  useEffect(() => {
    if (editable) setUrl(`${window.location.origin}/mcp`);
  }, [editable]);
  const c = clients.find((x) => x.id === id)!;

  return (
    <div className="border border-ink bg-paper">
      {editable && (
        <div className="grid gap-px border-b border-ink bg-ink sm:grid-cols-2">
          <label className="bg-paper-2 px-4 py-3 text-ink">
            <span className="label block text-mute">Relay URL</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} className="mt-1 w-full bg-transparent font-mono text-[13px] outline-none placeholder:text-mute/60 focus:text-signal-dark" />
          </label>
          <label className="bg-paper-2 px-4 py-3 text-ink">
            <span className="label block text-mute">Agent token</span>
            <input value={token} onChange={(e) => setToken(e.target.value)} spellCheck={false} className="mt-1 w-full bg-transparent font-mono text-[13px] outline-none focus:text-signal-dark" />
          </label>
        </div>
      )}

      <div role="tablist" aria-label="MCP client" className="thin-scroll light flex overflow-x-auto border-b border-ink">
        {clients.map((x) => (
          <button key={x.id} role="tab" aria-selected={x.id === id} onClick={() => setId(x.id)} className={cn("relative shrink-0 border-r border-ink/20 px-4 py-3 text-[13px] font-semibold transition-colors", x.id === id ? "text-paper" : "text-ink hover:bg-paper-2")}>
            {x.id === id && <motion.span layoutId={`tab-${editable}`} className="absolute inset-0 bg-ink" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
            <span className="relative">{x.label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <CodeBlock code={c.build(url || "https://relay.example.com/mcp", token || "ar_live_xxx")} title={c.file} className="border-0" />
          <div className="flex items-start gap-3 border-t border-ink bg-paper-2 px-4 py-4 text-[13.5px] leading-relaxed text-ink-3">
            <Icon name="clock" size={16} className="mt-0.5 shrink-0 text-signal-dark" />
            <p>
              <span className="font-semibold text-ink">Timeout. </span>
              {c.note}
              <span className={cn("label ml-2 whitespace-nowrap", c.verified ? "text-ok" : "text-warn")}>{c.verified ? "[docs-verified]" : "[partly unverified]"}</span>
            </p>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
