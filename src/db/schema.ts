import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  settingsJson: jsonb("settings_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("member"), // admin | member
  createdAt: ts("created_at").notNull().defaultNow(),
  emailVerifiedAt: ts("email_verified_at"), // null = email not verified yet (cannot log in)
});

// Pending email signups. Only the sha256 of the 6-digit code is stored; the plain code lives solely in the email.
export const emailVerifications = pgTable(
  "email_verifications",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(), // sha256 of the 6-digit code; the plain code is never stored
    name: text("name").notNull().default(""),
    passwordHash: text("password_hash").notNull().default(""),
    expiresAt: ts("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    usedAt: ts("used_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("email_verifications_email_idx").on(t.email)],
);

export const userSessions = pgTable("user_sessions", {
  id: text("id").primaryKey(), // sha256 of cookie value
  userId: text("user_id").notNull(),
  csrfToken: text("csrf_token").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(), // unique per workspace, not globally
    displayName: text("display_name").notNull(),
    type: text("type").notNull().default("custom"),
    description: text("description").notNull().default(""),
    capabilitiesJson: jsonb("capabilities_json").$type<string[]>().notNull().default([]),
    color: text("color").notNull().default("#6366f1"),
    state: text("state").notNull().default("active"), // active | paused | disabled
    waitMode: text("wait_mode").notNull().default("infinite"), // infinite | bounded
    lastSeenAt: ts("last_seen_at"),
    statusState: text("status_state").notNull().default("waiting"),
    statusActivity: text("status_activity").notNull().default(""),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agents_workspace_name_uq").on(t.workspaceId, t.name)],
);

export const agentTokens = pgTable("agent_tokens", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const rooms = pgTable(
  "rooms",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("group"), // group | dm
    dmKey: text("dm_key"),
    topic: text("topic").notNull().default(""),
    pinnedInstructions: text("pinned_instructions").notNull().default(""),
    visibility: text("visibility").notNull().default("open"), // open | private
    state: text("state").notNull().default("active"), // active | paused | archived
    pauseReason: text("pause_reason").notNull().default(""),
    hopCount: integer("hop_count").notNull().default(0),
    hopLimit: integer("hop_limit").notNull().default(20),
    humansWakeAll: boolean("humans_wake_all"),
    lastSeq: integer("last_seq").notNull().default(0),
    createdBy: text("created_by").notNull().default("system"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("rooms_dm_key_uq").on(t.dmKey)],
);

export const roomMembers = pgTable(
  "room_members",
  {
    roomId: text("room_id").notNull(),
    participantKind: text("participant_kind").notNull(), // agent | user
    participantId: text("participant_id").notNull(),
    notifyMode: text("notify_mode").notNull().default("mentions_only"),
    joinedAt: ts("joined_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.roomId, t.participantKind, t.participantId] }),
    index("room_members_participant_idx").on(t.participantKind, t.participantId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull(),
    seq: integer("seq").notNull(),
    senderKind: text("sender_kind").notNull(), // agent | user | system
    senderId: text("sender_id").notNull(),
    type: text("type").notNull().default("chat"),
    content: text("content").notNull(),
    replyTo: text("reply_to"),
    threadId: text("thread_id"),
    taskId: text("task_id"),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
    priority: text("priority").notNull().default("normal"),
    clientMessageId: text("client_message_id"),
    editedAt: ts("edited_at"),
    deletedAt: ts("deleted_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("messages_room_seq_uq").on(t.roomId, t.seq),
    uniqueIndex("messages_client_id_uq").on(t.senderId, t.clientMessageId),
    index("messages_thread_idx").on(t.threadId),
  ],
);

export const messageMentions = pgTable(
  "message_mentions",
  {
    messageId: text("message_id").notNull(),
    participantKind: text("participant_kind").notNull(),
    participantId: text("participant_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.participantKind, t.participantId] })],
);

export const messageAttachments = pgTable(
  "message_attachments",
  {
    messageId: text("message_id").notNull(),
    artifactId: text("artifact_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.artifactId] })],
);

export const inboxItems = pgTable(
  "inbox_items",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    messageId: text("message_id").notNull(),
    state: text("state").notNull().default("pending"), // pending | delivered | acked | dead
    priority: text("priority").notNull().default("normal"),
    deliveryCount: integer("delivery_count").notNull().default(0),
    leaseExpiresAt: ts("lease_expires_at"),
    deliveredAt: ts("delivered_at"),
    ackedAt: ts("acked_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("inbox_agent_state_idx").on(t.agentId, t.state, t.priority, t.createdAt),
    uniqueIndex("inbox_agent_message_uq").on(t.agentId, t.messageId),
  ],
);

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  acceptanceCriteria: text("acceptance_criteria").notNull().default(""),
  creatorKind: text("creator_kind").notNull(),
  creatorId: text("creator_id").notNull(),
  assigneeAgentId: text("assignee_agent_id").notNull(),
  status: text("status").notNull().default("queued"),
  priority: text("priority").notNull().default("normal"),
  dueAt: ts("due_at"),
  parentTaskId: text("parent_task_id"),
  resultSummary: text("result_summary").notNull().default(""),
  resultArtifacts: jsonb("result_artifacts").$type<string[]>().notNull().default([]),
  history: jsonb("history").$type<{ at: string; by: string; status: string; note?: string }[]>().notNull().default([]),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const artifacts = pgTable("artifacts", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull(),
  uploaderKind: text("uploader_kind").notNull(),
  uploaderId: text("uploader_id").notNull(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  storageKey: text("storage_key").notNull(),
  sha256: text("sha256").notNull(),
  content: bytea("content").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const humanRequests = pgTable("human_requests", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull(),
  agentId: text("agent_id").notNull(),
  messageId: text("message_id").notNull(),
  question: text("question").notNull(),
  optionsJson: jsonb("options_json").$type<string[]>().notNull().default([]),
  urgency: text("urgency").notNull().default("normal"),
  status: text("status").notNull().default("open"), // open | answered | expired
  answer: text("answer"),
  answeredBy: text("answered_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  answeredAt: ts("answered_at"),
});

export const toolActivity = pgTable(
  "tool_activity",
  {
    id: serial("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    tool: text("tool").notNull(),
    status: text("status").notNull(),
    durationMs: integer("duration_ms").notNull().default(0),
    errorCode: text("error_code"),
    summary: text("summary"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("tool_activity_agent_idx").on(t.agentId, t.createdAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    workspaceId: text("workspace_id"), // null = rows written before per-user workspaces existed (ws_default)
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    target: text("target").notNull().default(""),
    detailJson: jsonb("detail_json").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_logs_workspace_idx").on(t.workspaceId, t.id)],
);

// Durable event log for SSE (Last-Event-ID resume). Scoped by workspace so a stream only replays its own tenant.
export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    workspaceId: text("workspace_id"), // null = legacy rows from the single-workspace era (ws_default)
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("events_workspace_idx").on(t.workspaceId, t.id)],
);