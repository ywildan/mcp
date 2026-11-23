import type { SVGProps } from "react";

export type IconName =
  | "relay"
  | "messages"
  | "agent"
  | "tasks"
  | "human"
  | "activity"
  | "settings"
  | "arrow-right"
  | "arrow-up-right"
  | "arrow-down"
  | "plus"
  | "menu"
  | "close"
  | "pause"
  | "play"
  | "zap"
  | "plug"
  | "edit"
  | "rotate"
  | "alert"
  | "paperclip"
  | "info"
  | "logout"
  | "send"
  | "check"
  | "chevron-down"
  | "chevron-right"
  | "lock"
  | "mail"
  | "shield"
  | "server"
  | "clock"
  | "link"
  | "sparkles"
  | "globe"
  | "hash"
  | "user"
  | "copy"
  | "external"
  | "terminal"
  | "users"
  | "network";

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName;
  size?: number;
  strokeWidth?: number;
};

export function Icon({ name, size = 18, strokeWidth = 1.8, ...props }: IconProps) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  let shape;

  switch (name) {
    case "relay":
    case "network":
      shape = (
        <>
          <circle cx="12" cy="12" r="2.6" />
          <circle cx="5" cy="5" r="2" />
          <circle cx="19" cy="5" r="2" />
          <circle cx="5" cy="19" r="2" />
          <circle cx="19" cy="19" r="2" />
          <path d="m7 6.5 3.2 3.3M17 6.5l-3.2 3.3M7 17.5l3.2-3.3M17 17.5l-3.2-3.3" />
        </>
      );
      break;
    case "messages":
      shape = <><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-4 2v-5.2A7.5 7.5 0 1 1 20 11.5Z" /><path d="M8 10h8M8 14h5" /></>;
      break;
    case "agent":
      shape = <><rect x="4" y="7" width="16" height="13" rx="4" /><path d="M12 3v4M9 13h.01M15 13h.01M9 17h6M8 4l-2 2M16 4l2 2" /></>;
      break;
    case "tasks":
      shape = <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4.5h6M8.5 10h7M8.5 14h7M8.5 18h4" /><path d="m7.2 10 .7.7 1.1-1.2M7.2 14l.7.7 1.1-1.2" /></>;
      break;
    case "human":
      shape = <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0M17 5.5l1.2 1.2L21 4" /></>;
      break;
    case "activity":
      shape = <><path d="M3 12h4l2.2-6 4.3 12 2.2-6H21" /><path d="M4 4h16v16H4z" opacity=".25" /></>;
      break;
    case "settings":
      shape = <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.6v-.2a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H6v-2.6h.2a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V5h2.6v.2a1.7 1.7 0 0 0 1.1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2v2.6h-.2a1.7 1.7 0 0 0-1.5 1.3Z" /></>;
      break;
    case "arrow-right":
      shape = <><path d="M5 12h14M13 6l6 6-6 6" /></>;
      break;
    case "arrow-up-right":
    case "external":
      shape = <><path d="M7 17 17 7M8 7h9v9" /><path d="M19 13v6H5V5h6" /></>;
      break;
    case "arrow-down":
      shape = <><path d="M12 4v15M6 13l6 6 6-6" /></>;
      break;
    case "plus":
      shape = <><path d="M12 5v14M5 12h14" /></>;
      break;
    case "menu":
      shape = <><path d="M4 6h16M4 12h16M4 18h16" /></>;
      break;
    case "close":
      shape = <><path d="m6 6 12 12M18 6 6 18" /></>;
      break;
    case "pause":
      shape = <><path d="M8 5v14M16 5v14" /></>;
      break;
    case "play":
      shape = <><path d="m8 5 11 7-11 7z" /></>;
      break;
    case "zap":
      shape = <><path d="m13 2-3 8h7l-6 12 2-9H6l7-11Z" /></>;
      break;
    case "plug":
      shape = <><path d="M8 3v5M16 3v5M6 8h12v3a6 6 0 0 1-6 6v4M9 8v3M15 8v3" /></>;
      break;
    case "edit":
      shape = <><path d="m15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z" /></>;
      break;
    case "rotate":
      shape = <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 9a7 7 0 0 1 11.6-2L20 12M4 12l2.3 5a7 7 0 0 0 11.6-2" /></>;
      break;
    case "alert":
      shape = <><path d="m12 3 9 16H3l9-16Z" /><path d="M12 9v4M12 16h.01" /></>;
      break;
    case "paperclip":
      shape = <><path d="m8 12.5 6.8-6.8a3.2 3.2 0 0 1 4.5 4.5l-8.8 8.9a5 5 0 0 1-7.1-7.1l8.4-8.4" /><path d="m7.5 15 8.1-8.1" /></>;
      break;
    case "info":
      shape = <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>;
      break;
    case "logout":
      shape = <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>;
      break;
    case "send":
      shape = <><path d="m22 2-7 20-4-9-9-4 20-7Z" /><path d="M22 2 11 13" /></>;
      break;
    case "check":
      shape = <><path d="m5 12 4 4L19 6" /></>;
      break;
    case "chevron-down":
      shape = <><path d="m6 9 6 6 6-6" /></>;
      break;
    case "chevron-right":
      shape = <><path d="m9 18 6-6-6-6" /></>;
      break;
    case "lock":
      shape = <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3M12 14v3" /></>;
      break;
    case "mail":
      shape = <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>;
      break;
    case "shield":
      shape = <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>;
      break;
    case "server":
      shape = <><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01M11 8h6M11 17h6" /></>;
      break;
    case "clock":
      shape = <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>;
      break;
    case "link":
      shape = <><path d="m10 13 4-4" /><path d="M8 16H6a4 4 0 0 1 0-8h4M16 8h2a4 4 0 0 1 0 8h-4" /></>;
      break;
    case "sparkles":
      shape = <><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16ZM5 2l.6 1.4L7 4l-1.4.6L5 6l-.6-1.4L3 4l1.4-.6L5 2Z" /></>;
      break;
    case "globe":
      shape = <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></>;
      break;
    case "hash":
      shape = <><path d="M5 9h14M4 15h14M10 3 8 21M16 3l-2 18" /></>;
      break;
    case "user":
      shape = <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>;
      break;
    case "copy":
      shape = <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>;
      break;
    case "terminal":
      shape = <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>;
      break;
    case "users":
      shape = <><path d="M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-3A4.5 4.5 0 0 0 4 18.5V20" /><circle cx="10" cy="7" r="3.5" /><path d="M20 20v-1.5a4.5 4.5 0 0 0-3-4.25M16 4a3.5 3.5 0 0 1 0 6.8" /></>;
      break;
  }

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      {...common}
      {...props}
    >
      {shape}
    </svg>
  );
}
