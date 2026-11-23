"use client";
import type { ReactNode } from "react";
import { MotionConfig, motion } from "motion/react";
import { usePathname } from "next/navigation";

/** Fade/rise on every route change (ref: App.tsx AnimatePresence page transition). */
export function PageTransition({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <MotionConfig reducedMotion="user">
      <motion.div key={path} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}>
        {children}
      </motion.div>
    </MotionConfig>
  );
}
