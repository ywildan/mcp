import type { ReactNode } from "react";
import { Footer, Nav } from "@/components/site/Chrome";
import { PageTransition } from "@/components/site/PageTransition";

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Nav />
      <PageTransition>{children}</PageTransition>
      <Footer />
    </>
  );
}
