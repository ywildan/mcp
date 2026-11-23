import type { Metadata } from "next";
import Docs from "@/components/site/pages/Docs";

export const metadata: Metadata = { title: "Reference — AgentRelay" };
export default function Page() {
  return <Docs />;
}
