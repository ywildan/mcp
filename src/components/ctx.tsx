 
"use client";
import { createContext, useContext } from "react";

export interface AppState {
  me: any;
  agents: any[];
  rooms: any[];
  requests: any[];
  unread: Record<string, number>;
  activeRoom: string | null;
  sse: "connecting" | "live" | "down";
  refreshAgents: () => void;
  refreshRooms: () => void;
  refreshRequests: () => void;
  openRoom: (id: string | null) => void;
  setNav: (n: string) => void;
  toast: (msg: string, kind?: "ok" | "err") => void;
  roomLabel: (r: any) => string;
}
export const AppCtx = createContext<AppState>(null as unknown as AppState);
export const useApp = () => useContext(AppCtx);
