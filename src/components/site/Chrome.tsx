"use client";
import { useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring } from "motion/react";
import { A, Btn, Ext, Icon, Logo, Mark } from "./ui";
import { REPO } from "@/lib/site-data";
import { usePathname } from "next/navigation";

type Route = string;

const links: { to: string; label: string; route: Route }[] = [
  { to: "/", label: "Product", route: "/" },
  { to: "/how-to-use", label: "How to use", route: "/how-to-use" },
  { to: "/architecture", label: "Architecture", route: "/architecture" },
  { to: "/docs", label: "Reference", route: "/docs" },
];

export function Nav() {
  const route: Route = usePathname() ?? "/";
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const { scrollY, scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.4 });

  useMotionValueEvent(scrollY, "change", (y) => {
    const prev = scrollY.getPrevious() ?? 0;
    setHidden(y > prev && y > 160 && !open);
  });

  return (
    <>
      <motion.header animate={{ y: hidden ? "-100%" : "0%" }} transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }} className="fixed inset-x-0 top-0 z-50 border-b border-ink/15 bg-paper/95 text-ink backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-5 sm:px-8">
          <A to="/" aria-label="AgentRelay home" onClick={() => setOpen(false)}>
            <Logo />
          </A>

          <nav className="hidden items-center gap-9 md:flex" aria-label="Primary">
            {links.map((l) => (
              <A key={l.to} to={l.to} aria-current={route === l.route ? "page" : undefined} className="ulink py-1 text-[14px] font-medium">
                {l.label}
              </A>
            ))}
            <Ext href={REPO} className="ulink flex items-center gap-1 py-1 text-[14px] font-medium">
              GitHub <Icon name="arrowUpRight" size={13} />
            </Ext>
          </nav>

          <div className="flex items-center gap-3">
            <A to="/sign-in" className="hidden border border-ink px-4 py-2 text-[13px] font-semibold text-ink transition-colors duration-300 hover:bg-ink hover:text-paper sm:inline-block">
              Sign in
            </A>
            <button className="grid h-10 w-10 place-items-center border border-ink text-ink md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
              <Icon name={open ? "close" : "menu"} />
            </button>
          </div>
        </div>
        <motion.div style={{ scaleX: progress }} className="absolute inset-x-0 bottom-[-1px] h-[2px] origin-left bg-signal" />
      </motion.header>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ clipPath: "inset(0 0 100% 0)" }} animate={{ clipPath: "inset(0 0 0% 0)" }} exit={{ clipPath: "inset(0 0 100% 0)" }} transition={{ duration: 0.45, ease: [0.7, 0, 0.2, 1] }} className="fixed inset-0 z-40 bg-ink px-6 pt-24 text-paper md:hidden">
            <nav className="flex flex-col">
              {[...links, { to: "/sign-in", label: "Sign in", route: "/sign-in" }].map((l, i) => (
                <motion.div key={l.to} initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.06 }}>
                  <A to={l.to} onClick={() => setOpen(false)} className="font-display flex items-center justify-between border-b border-paper/15 py-5 text-4xl font-bold">
                    {l.label}
                    <Icon name="arrow" size={26} className="text-signal" />
                  </A>
                </motion.div>
              ))}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function Footer() {
  return (
    <footer className="mt-10 bg-ink text-paper">
      <div className="mx-auto max-w-[1280px] px-5 pb-8 pt-16 sm:px-8">
        <div className="grid gap-12 md:grid-cols-12">
          <div className="md:col-span-5">
            <Logo dark={false} />
            <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-paper/65">
              A remote MCP server and web dashboard for AI agents that live in different places. Self-hosted, open source, human in the loop.
            </p>
          </div>
          <FooterCol title="Learn" items={[["How to use", "/how-to-use"], ["Architecture", "/architecture"], ["Tool reference", "/docs"], ["FAQ", "/how-to-use#faq"]]} />
          <FooterCol title="Workspace" items={[["Workspace sign-in", "/sign-in"], ["Connect a client", "/how-to-use#connect"], ["Security", "/architecture#security"]]} />
          <div className="md:col-span-3">
            <p className="label mb-4 text-paper/45">Source</p>
            <Ext href={REPO} className="ulink inline-flex items-center gap-1.5 text-[15px]">
              github.com/ywildan/agentrelay <Icon name="arrowUpRight" size={14} />
            </Ext>
            <p className="mt-6 font-mono text-[12px] leading-relaxed text-paper/45">
              npx -y agentrelay-mcp
              <br />
              --url https://relay.example.com/mcp
            </p>
          </div>
        </div>

        <div className="relative mt-16 select-none overflow-hidden">
          <p className="font-display whitespace-nowrap text-[clamp(3.4rem,15.6vw,15rem)] font-extrabold leading-[0.82] text-paper/[0.07]" aria-hidden="true">
            AgentRelay
          </p>
        </div>

        <div className="mt-8 flex flex-col justify-between gap-3 border-t border-paper/15 pt-6 text-[12px] text-paper/50 sm:flex-row">
          <span className="flex items-center gap-2">
            <Mark size={16} dark={false} /> Self-hosted MCP relay and live workspace for AI agents.
          </span>
          <span className="font-mono">wait_for_message(timeout_seconds=0)</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, items }: { title: string; items: [string, string][] }) {
  return (
    <div className="md:col-span-2">
      <p className="label mb-4 text-paper/45">{title}</p>
      <ul className="space-y-3">
        {items.map(([l, to]) => (
          <li key={l}>
            <A to={to} className="ulink text-[15px]">{l}</A>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { Btn };
