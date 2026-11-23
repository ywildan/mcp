"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Dot } from "./ui";

type Id = "human" | "planner" | "builder" | "reviewer";

const HUB = { x: 260, y: 200 };
const nodes: Record<Id, { x: number; y: number; label: string; client: string }> = {
  human: { x: 76, y: 62, label: "you", client: "dashboard" },
  planner: { x: 444, y: 62, label: "planner", client: "Claude Code" },
  builder: { x: 444, y: 338, label: "builder", client: "Codex CLI" },
  reviewer: { x: 76, y: 338, label: "reviewer", client: "OpenCode" },
};

const script: { from: Id; to: Id; tool: string; text: string }[] = [
  { from: "human", to: "planner", tool: "message", text: "Ship the pricing page by Friday." },
  { from: "planner", to: "builder", tool: "create_task", text: "Build /pricing from the Figma spec." },
  { from: "builder", to: "reviewer", tool: "send_message", text: "Preview is up — please review." },
  { from: "reviewer", to: "human", tool: "request_human_input", text: "Approve the copy for the Pro tier?" },
];

export function RelayBoard() {
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<"fly" | "work">("fly");
  const [count, setCount] = useState(0);
  const cur = script[step % script.length];

  useEffect(() => {
    setPhase("fly");
    const a = setTimeout(() => {
      setPhase("work");
      setCount((c) => c + 1);
    }, 1500);
    const b = setTimeout(() => setStep((s) => s + 1), 3600);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [step]);

  const stateOf = (id: Id): "working" | "waiting" => (phase === "work" && cur.to === id && id !== "human" ? "working" : "waiting");

  return (
    <div className="relative bg-ink text-paper">
      <div className="flex items-center justify-between border-b border-paper/15 px-4 py-3">
        <span className="label flex items-center gap-2 text-paper/70">
          <Dot state="working" /> illustration · example flow
        </span>
        <span className="label text-paper/50">not live data</span>
      </div>

      <svg viewBox="0 0 520 400" className="block w-full" role="img" aria-label="Animated diagram: messages travelling between agents through the relay">
        <defs>
          <pattern id="rb-dots" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#F0ECE2" opacity="0.1" />
          </pattern>
        </defs>
        <rect width="520" height="400" fill="url(#rb-dots)" />

        {(Object.keys(nodes) as Id[]).map((id) => {
          const n = nodes[id];
          const active = (cur.from === id && phase === "fly") || (cur.to === id && phase === "work");
          return <line key={id} x1={n.x} y1={n.y} x2={HUB.x} y2={HUB.y} stroke={active ? "#FF4A1C" : "#F0ECE2"} strokeOpacity={active ? 1 : 0.28} strokeWidth="1.5" className="dash-flow" style={{ transition: "stroke .3s" }} />;
        })}

        {/* hub */}
        <g>
          <rect x={HUB.x - 54} y={HUB.y - 54} width="108" height="108" fill="none" stroke="#FF4A1C" strokeWidth="1.5" transform={`rotate(45 ${HUB.x} ${HUB.y})`} />
          <rect x={HUB.x - 54} y={HUB.y - 54} width="108" height="108" fill="none" stroke="#F0ECE2" strokeOpacity="0.25" strokeWidth="1" />
          <rect x={HUB.x - 40} y={HUB.y - 40} width="80" height="80" fill="#FF4A1C" />
          <path d={`M${HUB.x - 22} ${HUB.y + 10}h13l9-22 9 22h13`} fill="none" stroke="#14130F" strokeWidth="4" strokeLinecap="square" />
          <text x={HUB.x} y={HUB.y + 76} textAnchor="middle" fontFamily="IBM Plex Mono" fontSize="10" letterSpacing="1.5" fill="#F0ECE2" opacity="0.7">RELAY</text>
        </g>

        {/* packet */}
        <AnimatePresence>
          <motion.g key={step} initial={{ x: nodes[cur.from].x, y: nodes[cur.from].y, opacity: 1 }} animate={{ x: [nodes[cur.from].x, HUB.x, nodes[cur.to].x], y: [nodes[cur.from].y, HUB.y, nodes[cur.to].y], opacity: [1, 1, 0] }} transition={{ duration: 1.5, times: [0, 0.5, 1], ease: "easeInOut" }}>
            <rect x="-9" y="-9" width="18" height="18" fill="#F0ECE2" />
            <rect x="-4" y="-4" width="8" height="8" fill="#FF4A1C" />
          </motion.g>
        </AnimatePresence>

        {/* agents */}
        {(Object.keys(nodes) as Id[]).map((id) => {
          const n = nodes[id];
          const st = stateOf(id);
          return (
            <g key={id} transform={`translate(${n.x - 66} ${n.y - 30})`}>
              <rect width="132" height="60" fill="#14130F" stroke="#F0ECE2" strokeOpacity="0.55" />
              <motion.rect width="132" height="60" fill="none" stroke="#FF4A1C" strokeWidth="2" animate={{ opacity: st === "working" ? 1 : 0 }} transition={{ duration: 0.25 }} />
              <text x="12" y="25" fontFamily="Bricolage Grotesque" fontWeight="700" fontSize="16" fill="#F0ECE2">{n.label}</text>
              <text x="12" y="41" fontFamily="IBM Plex Mono" fontSize="9.5" fill="#F0ECE2" opacity="0.55">{n.client}</text>
              <circle cx="14" cy="51" r="3" fill={st === "working" ? "#FF4A1C" : "#5fbf85"} />
              <text x="24" y="54" fontFamily="IBM Plex Mono" fontSize="9" letterSpacing="1" fill="#F0ECE2" opacity="0.8">{id === "human" ? "ONLINE" : st === "working" ? "WORKING" : "WAITING"}</text>
            </g>
          );
        })}
      </svg>

      <div className="border-t border-paper/15 px-4 py-3">
        <AnimatePresence mode="wait">
          <motion.p key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }} className="truncate font-mono text-[12.5px]">
            <span className="text-signal">{cur.from}</span>
            <span className="text-paper/40"> → </span>
            <span className="text-signal">{cur.to}</span>
            <span className="text-paper/40">  {cur.tool}  </span>
            <span className="text-paper/90">“{cur.text}”</span>
          </motion.p>
        </AnimatePresence>
        <p className="label mt-2 flex justify-between text-paper/45">
          <span>example hops: {count}</span>
          <span>tokens spent while waiting: 0</span>
        </p>
      </div>
    </div>
  );
}
