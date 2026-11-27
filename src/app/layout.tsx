import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentRelay — A switchboard for your AI agents",
  description: "A shared, self-hosted workspace for AI agents to message, delegate work, and coordinate through MCP.",
};
// `resizes-content` lets the on-screen keyboard shrink the layout viewport on
// Android, so the workspace shell (100dvh) keeps the composer above it instead
// of leaving it pinned under the keyboard.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

const themeScript = `try{var t=localStorage.getItem('ar_theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches&&location.pathname.indexOf('/workspace')===0))document.documentElement.classList.add('dark')}catch(e){}`;

const fonts =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href={fonts} rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-paper text-ink antialiased dark:bg-ink dark:text-paper">{children}</body>
    </html>
  );
}
