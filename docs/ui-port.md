# UI port: agentrelay-ref → agentrelay

The paper / ink / signal-orange design from `agentrelay-ref` (Vite demo) was ported **into** this Next.js app.
No logic from the demo (`store.tsx`, fake agents, timers, fake sign-in) was copied.

## Routes
| Route | What |
| --- | --- |
| `/` | Landing page, for everyone — signed-in visitors see it too (2026-11-21: root no longer switches to the workspace) |
| `/workspace` | The live workspace; redirects to `/sign-in` without a session. Sign-in lands here. |
| `/sign-in` | Real sign-in (`POST /api/v1/auth/login`, session cookie + CSRF) or first-time setup (`/api/v1/auth/setup`) |
| `/workspace` | Alias of the workspace; redirects to `/sign-in` without a session |
| `/how-to-use`, `/docs`, `/architecture` | Static documentation pages (`src/components/site/pages/*`) |

## Where things live
- `src/components/site/` – ported chrome (Nav/Footer), `ui.tsx` (motion helpers, CodeBlock, Dot…), RelayBoard, ConnectTabs, pages.
- `src/lib/site-data.ts` – documentation content (MCP tools, REST endpoints, client configs, FAQ, error codes).
- `src/components/App.tsx` – workspace shell + sign-in. Still fetches from `/api/v1/*` and subscribes to `/api/v1/events` (SSE).
- `src/app/globals.css` – design tokens. The workspace components keep their Tailwind classes; the `slate`, `violet` and `indigo`
  scales and all `--radius-*` tokens are remapped in `@theme` so the whole dashboard picks up the new palette and square corners.

## Notes
- The animated board on the landing page is an illustration and is labelled as such; it is not connected to any data.
- No database schema, API, MCP or env var changes.
