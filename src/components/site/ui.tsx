"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useInView, type Variants } from "motion/react";
import { cn } from "@/utils/cn";

/* ---------- links ---------- */
export function A({ to, className, children, ...rest }: { to: string; className?: string; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <Link href={to} className={className} {...rest}>
      {children}
    </Link>
  );
}

export function Ext({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  );
}

/* ---------- logo ---------- */
export function Mark({ size = 28, dark = true }: { size?: number; dark?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" fill={dark ? "#14130F" : "#F0ECE2"} />
      <path d="M5 22h6l5-12 5 12h6" fill="none" stroke="#FF4A1C" strokeWidth="3" strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}

export function Logo({ dark = true }: { dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Mark dark={dark} />
      <span className={cn("font-display text-[19px] font-bold leading-none", dark ? "text-ink" : "text-paper")}>
        AgentRelay
      </span>
    </span>
  );
}

/* ---------- icons (minimal, hand-drawn strokes) ---------- */
const paths: Record<string, string> = {
  arrow: "M4 12h15M13 6l6 6-6 6",
  arrowUpRight: "M7 17L17 7M8 7h9v9",
  copy: "M9 9h10v10H9zM5 15V5h10",
  check: "M4 12.5l5 5L20 6.5",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6L6 18",
  hash: "M9 4L7 20M17 4l-2 16M4 9h16M3 15h16",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 3.5-6 8-6s8 2 8 6",
  chat: "M4 5h16v11H9l-5 4z",
  task: "M5 5h14v14H5zM8.5 12l2.5 2.5 4.5-5",
  bell: "M6 17V11a6 6 0 0112 0v6l2 2H4zM10 21h4",
  pulse: "M3 12h4l3-8 4 16 3-8h4",
  gear: "M12 15a3 3 0 100-6 3 3 0 000 6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2",
  pause: "M8 5v14M16 5v14",
  play: "M7 4l13 8-13 8z",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 017 0v3",
  server: "M4 5h16v5H4zM4 14h16v5H4zM8 7.5h.01M8 16.5h.01",
  plug: "M9 3v5M15 3v5M6 8h12v3a6 6 0 01-12 0zM12 17v4",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5",
  send: "M3 11l18-8-8 18-2-8z",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  alert: "M12 4l9 16H3zM12 10v4M12 17h.01",
};
export function Icon({ name, size = 18, className }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

/* ---------- buttons ---------- */
export function Btn({
  to,
  href,
  onClick,
  variant = "ink",
  children,
  className,
  type,
}: {
  to?: string;
  href?: string;
  onClick?: () => void;
  variant?: "ink" | "signal" | "ghost" | "paper";
  children: ReactNode;
  className?: string;
  type?: "button" | "submit";
}) {
  const cls = cn(
    "group relative inline-flex items-center justify-center gap-2.5 overflow-hidden px-5 py-3 text-[14px] font-semibold tracking-tight transition-colors duration-300",
    variant === "ink" && "bg-ink text-paper hover:bg-signal",
    variant === "signal" && "bg-signal text-ink hover:bg-ink hover:text-paper",
    variant === "paper" && "bg-paper text-ink hover:bg-signal",
    variant === "ghost" && "border border-ink/80 text-ink hover:bg-ink hover:text-paper",
    className,
  );
  const inner = (
    <>
      <span>{children}</span>
      <Icon name="arrow" size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
    </>
  );
  if (to) return <A to={to} className={cls}>{inner}</A>;
  if (href) return <Ext href={href} className={cls}>{inner}</Ext>;
  return <button type={type ?? "button"} onClick={onClick} className={cls}>{inner}</button>;
}

/* ---------- motion helpers ---------- */
const ease = [0.2, 0.7, 0.2, 1] as const;

export function Reveal({ children, delay = 0, y = 28, className, as = "div" }: { children: ReactNode; delay?: number; y?: number; className?: string; as?: "div" | "li" | "section" | "p" }) {
  const M = motion[as] as typeof motion.div;
  return (
    <M initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "0px 0px -12% 0px" }} transition={{ duration: 0.7, ease, delay }} className={className}>
      {children}
    </M>
  );
}

const wordV: Variants = {
  hidden: { y: "108%" },
  show: (i: number) => ({ y: "0%", transition: { duration: 0.8, ease, delay: 0.05 * i } }),
};

/** word-by-word masked rise. `lines` are rendered as separate blocks. */
export function SplitText({ lines, className, delay = 0, accent }: { lines: string[]; className?: string; delay?: number; accent?: number[] }) {
  let k = 0;
  return (
    <span className={cn("block", className)}>
      <span className="sr-only">{lines.join(" ")}</span>
      {lines.map((line, li) => (
        <span key={li} className="block" aria-hidden="true">
          {line.split(" ").map((w, wi) => {
            const i = k++;
            return (
              <span key={wi} className="mr-[0.22em] inline-block overflow-hidden align-bottom pb-[0.12em] -mb-[0.12em]">
                <motion.span custom={i + delay * 20} variants={wordV} initial="hidden" animate="show" className={cn("inline-block", accent?.includes(li) && "text-signal")}>
                  {w}
                </motion.span>
              </span>
            );
          })}
        </span>
      ))}
    </span>
  );
}

export function CountUp({ to, duration = 1.6, className, format }: { to: number; duration?: number; className?: string; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    if (!inView || !ref.current) return;
    const c = animate(0, to, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = format ? format(v) : Math.round(v).toLocaleString();
      },
    });
    return () => c.stop();
  }, [inView, to, duration, format]);
  return <span ref={ref} className={className}>0</span>;
}

/* ---------- section heading ---------- */
export function SectionHead({ index, kicker, title, lead, className }: { index: string; kicker: string; title: ReactNode; lead?: ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-6 md:grid-cols-12", className)}>
      <Reveal className="md:col-span-3">
        <p className="label flex items-center gap-3">
          <span className="text-signal">{index}</span>
          <span className="h-px w-8 bg-current opacity-30" />
          <span className="opacity-60">{kicker}</span>
        </p>
      </Reveal>
      <div className="md:col-span-9">
        <Reveal delay={0.05}>
          <h2 className="font-display max-w-3xl text-[clamp(2rem,4.6vw,3.6rem)] font-bold leading-[1.02]">{title}</h2>
        </Reveal>
        {lead && (
          <Reveal delay={0.12}>
            <p className="mt-5 max-w-2xl text-[17px] leading-relaxed opacity-80">{lead}</p>
          </Reveal>
        )}
      </div>
    </div>
  );
}

/* ---------- code ---------- */
function hl(line: string): ReactNode {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#") || trimmed.startsWith("//")) return <span className="tok-c">{line}</span>;
  const out: ReactNode[] = [];
  const re = /("(?:[^"\\]|\\.)*")|(#.*$|\/\/.*$)|\b(claude|npx|export|opencode|npm|docker|cp|cd|git|curl|node)\b|\b(\d+)\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    if (m[1]) out.push(<span key={i++} className="tok-s">{m[1]}</span>);
    else if (m[2]) out.push(<span key={i++} className="tok-c">{m[2]}</span>);
    else if (m[3]) out.push(<span key={i++} className="tok-k">{m[3]}</span>);
    else if (m[4]) out.push(<span key={i++} className="tok-n">{m[4]}</span>);
    last = m.index + m[0].length;
  }
  out.push(line.slice(last));
  return out;
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
      className={cn("label inline-flex items-center gap-1.5 border border-paper/25 px-2.5 py-1.5 text-paper/80 transition hover:border-signal hover:text-signal", className)}
      aria-label="Copy to clipboard"
    >
      <Icon name={done ? "check" : "copy"} size={13} />
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export function CodeBlock({ code, title, className, maxH }: { code: string; title?: string; className?: string; maxH?: string }) {
  return (
    <div className={cn("overflow-hidden bg-ink text-paper", className)}>
      <div className="flex items-center justify-between border-b border-paper/10 px-4 py-2.5">
        <span className="label truncate text-paper/55">{title ?? "shell"}</span>
        <CopyButton text={code} />
      </div>
      <pre className={cn("code-scroll overflow-auto p-4 font-mono text-[12.5px] leading-[1.75]", maxH)}>
        <code>
          {code.split("\n").map((l, i) => (
            <div key={i} className="whitespace-pre">{hl(l) || " "}</div>
          ))}
        </code>
      </pre>
    </div>
  );
}

/* ---------- status dot ---------- */
export function Dot({ state }: { state: "online" | "working" | "waiting" | "blocked" | "offline" | "idle" | "error" }) {
  const color = {
    online: "bg-ok",
    waiting: "bg-ok",
    working: "bg-signal",
    blocked: "bg-warn",
    error: "bg-signal-dark",
    idle: "bg-mute",
    offline: "bg-ink/25",
  }[state];
  const live = state === "waiting" || state === "working" || state === "online";
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {live && <span className={cn("pulse-ring absolute inset-0 rounded-full", color)} />}
      <span className={cn("relative h-2 w-2 rounded-full", color)} />
    </span>
  );
}
