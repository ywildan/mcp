 
"use client";
import { useMemo, type ReactNode } from "react";
import { renderMarkdown } from "@/lib/markdown";
import { Icon } from "./Icon";

export const btn =
  "inline-flex items-center justify-center gap-1.5 border border-ink/70 bg-transparent px-3 py-2 text-xs font-semibold tracking-tight text-ink transition-colors duration-200 hover:bg-ink hover:text-paper focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-paper/50 dark:text-paper dark:hover:bg-paper dark:hover:text-ink";
export const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 bg-ink px-3.5 py-2 text-xs font-semibold tracking-tight text-paper transition-colors duration-200 hover:bg-signal hover:text-ink focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-signal dark:text-ink dark:hover:bg-paper";
export const btnDanger =
  "inline-flex items-center justify-center gap-1.5 border border-signal-dark bg-transparent px-3 py-2 text-xs font-semibold text-signal-dark transition-colors duration-200 hover:bg-signal-dark hover:text-paper focus-visible:outline-none dark:border-signal dark:text-signal dark:hover:bg-signal dark:hover:text-ink";
export const field =
  "w-full border border-ink/30 bg-white/60 px-3 py-2 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-signal dark:border-paper/25 dark:bg-slate-900";
export const card = "border border-ink/20 bg-white/70 p-4 dark:border-paper/15 dark:bg-slate-900";

export function Md({ content }: { content: string }) {
  const html = useMemo(() => (typeof window === "undefined" ? "" : renderMarkdown(content)), [content]);
  return (
    <div
      className="md"
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (t.classList.contains("copy-btn")) {
          const code = t.parentElement?.querySelector("code")?.textContent ?? "";
          navigator.clipboard?.writeText(code);
          t.textContent = "Copied";
          setTimeout(() => (t.textContent = "Copy"), 1200);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function Avatar({ name, color, kind, size = 32 }: { name: string; color?: string; kind?: string; size?: number }) {
  const bg = kind === "human" || kind === "user" ? "#14130f" : kind === "system" ? "#64748b" : (color ?? "#ff4a1c");
  return (
    <div className="flex shrink-0 items-center justify-center rounded-none font-bold text-white" style={{ width: size, height: size, background: bg, fontSize: size * 0.42 }} aria-hidden>
      {(name || "?").slice(0, 1).toUpperCase()}
    </div>
  );
}

export function PresenceDot({ presence, working }: { presence?: string; working?: boolean }) {
  const c = presence === "online" ? "bg-emerald-500" : presence === "idle" ? "bg-amber-400" : "bg-slate-400";
  return <span title={presence} className={`inline-block h-2.5 w-2.5 rounded-full ${c} ${working ? "working-dot" : ""}`} />;
}

const typeColors: Record<string, string> = {
  muse: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300",
  codex: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  qoder: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  opencode: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  "claude-code": "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  custom: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  human: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
};
export function TypeBadge({ type }: { type?: string }) {
  if (!type) return null;
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${typeColors[type] ?? typeColors.custom}`}>{type === "human" ? "human" : type}</span>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-3" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className={`modal-in max-h-[90vh] w-full overflow-auto border border-ink bg-paper p-5 shadow-[8px_8px_0_#ff4a1c] dark:border-paper/30 dark:bg-slate-900 ${wide ? "max-w-3xl" : "max-w-lg"}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">{title}</h2>
          <button className={`${btn} !h-8 !w-8 !p-0`} onClick={onClose} aria-label="Close">
            <Icon name="close" size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="py-10 text-center text-sm text-slate-500">{children}</div>;
