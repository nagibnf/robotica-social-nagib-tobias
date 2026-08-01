import type { RobotActivityEntry, RobotActivityKind } from "./robot-activity-feed";
import { FEED_KINDS } from "./robot-activity-feed";

export type RobotTelemetry = {
  batteryPct: number | null;
  cpuPct: number | null;
  tempC: number | null;
  ramPct: number | null;
  stale: boolean;
  source: string | null;
  updatedAt: number | null;
};

export type PrsLiveStatus = {
  ready: boolean | null;
  runtimeState: string | null;
  sessionState: string | null;
  runtimeStream: "idle" | "live" | "reconnecting" | "error";
  transportStream: "idle" | "live" | "reconnecting" | "error";
};

export type PrsSnapshot = {
  ready?: boolean | null;
  runtime?: { state?: string | null; health?: string | null } | null;
  telemetry?: unknown;
  brain_and_soul?: {
    connected?: boolean | null;
    session_state?: string | null;
  } | null;
};

type TransportEntry = {
  entry_id?: string;
  timestamp?: number;
  direction?: string;
  event_type?: string;
  payload?: unknown;
  call_id?: string | null;
  item_id?: string | null;
  response_id?: string | null;
  item_type?: string | null;
};

type FeedRow = RobotActivityEntry & { timestamp: number };

type ToolRecord = {
  callId: string;
  name: string;
  arguments: string;
  provisional: boolean;
  hasInbound: boolean;
  timestamp: number;
  result?: string;
};

const STALE_AFTER_S = 15;
const MAX_TRANSPORT_BUFFER = 320;
const MAX_FEED = 36;
const MAX_ARG_CHARS = 2000;
const MAX_HEADLINE = 180;
const MAX_SPEECH_HEADLINE = 480;

export const EMPTY_TELEMETRY: RobotTelemetry = {
  batteryPct: null,
  cpuPct: null,
  tempC: null,
  ramPct: null,
  stale: true,
  source: null,
  updatedAt: null,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function telemetryFromPayload(payload: unknown, nowSeconds = Date.now() / 1000): RobotTelemetry {
  const root = asRecord(payload);
  const summary = asRecord(root?.summary);
  const robot = asRecord(summary?.robot);
  const system = asRecord(summary?.system);
  const updatedAt = asNumber(root?.updated_at);
  const bodyTemp = asNumber(robot?.body_temperature_c);
  const cpuTemp = asNumber(system?.cpu_temperature_c);

  return {
    batteryPct: asNumber(robot?.battery_percent),
    cpuPct: asNumber(system?.cpu_percent),
    tempC: bodyTemp ?? cpuTemp,
    ramPct: asNumber(system?.ram_percent),
    stale: updatedAt == null ? true : nowSeconds - updatedAt > STALE_AFTER_S,
    source: asString(root?.source),
    updatedAt,
  };
}

export function formatTelemetryValue(value: number | null, digits = 0): string {
  if (value == null) return "—";
  return digits > 0 ? value.toFixed(digits) : String(Math.round(value));
}

/** Turn PRS snapshot_url (/api/vision/...) into browser-fetchable proxy URL. */
export function resolvePrsApiPath(apiBase: string, snapshotUrl: string): string {
  const trimmed = snapshotUrl.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  const q = trimmed.indexOf("?");
  const query = q >= 0 ? trimmed.slice(q) : "";
  let pathPart = q >= 0 ? trimmed.slice(0, q) : trimmed;
  if (pathPart.startsWith("/api/")) pathPart = pathPart.slice("/api/".length);
  else if (pathPart.startsWith("api/")) pathPart = pathPart.slice("api/".length);
  pathPart = pathPart.replace(/^\/+/, "");
  return `${apiBase.replace(/\/$/, "")}/${pathPart}${query}`;
}

function clip(text: string, max = MAX_ARG_CHARS) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function parseArgs(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return clip(JSON.stringify(parsed));
  } catch {
    /* provisional / incomplete JSON */
  }
  return clip(raw);
}

function isGestureToolName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === "execute_gesture" || (n.includes("gesture") && n.endsWith(".execute"));
}

function looksLikeGesturePayload(text: string): boolean {
  return /gesture_name/i.test(text);
}

function extractGestureName(argsRaw: string, resultRaw = ""): string | null {
  for (const raw of [argsRaw, resultRaw]) {
    if (!raw.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const row = parsed as Record<string, unknown>;
        const candidate = row.gesture_name ?? row.gesture ?? row.gesture_id;
        if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
      }
    } catch {
      const match = raw.match(/"gesture_name"\s*:\s*"([^"\\]+)"/);
      if (match?.[1]) return match[1];
    }
  }
  return null;
}

function formatGestureLabel(gestureId: string): string {
  return gestureId.replace(/_/g, " ");
}

function extractJsonFields(argsRaw: string, resultRaw: string, keys: string[]): string | null {
  for (const raw of [argsRaw, resultRaw]) {
    if (!raw.trim()) continue;
    try {
      const row = JSON.parse(raw) as Record<string, unknown>;
      for (const key of keys) {
        const value = row[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    } catch {
      for (const key of keys) {
        const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]+)"`));
        if (match?.[1]) return match[1];
      }
    }
  }
  return null;
}

/** PRS capability args → one-line “what it is doing” for the deck feed. */
const TOOL_ACTION_FIELDS: Record<string, readonly string[]> = {
  execute_gesture: ["gesture_name", "gesture", "gesture_id"],
  play_audio_cue: ["sound_name", "cue", "sound"],
  set_led_emotion: ["emotion"],
  web_search: ["query"],
  walk_distance: ["distance_m", "distance", "meters"],
  sidestep_distance: ["distance_m", "distance", "meters"],
  turn_robot: ["degrees", "angle"],
  walk_to_person: ["person_name", "name"],
  save_memory: ["summary", "content", "text", "topic"],
  recall_memory: ["query", "topic", "key"],
  remember_person: ["name", "person_name"],
  remember_face: ["name", "person_name"],
  who_is_this: ["name", "person_name"],
};

const TOOL_STATIC_ACTION: Record<string, string> = {
  capture_camera_image: "captura da câmera",
};

const GENERIC_ACTION_FIELDS = ["query", "emotion", "sound_name", "gesture_name", "name", "title"] as const;

/** PRS realtime tool_name → deck family (matches presentation legend). */
const TOOL_FAMILY_BY_NAME: Record<string, RobotActivityKind> = {
  set_led_emotion: "emotion",
  get_available_emotions: "emotion",
  execute_gesture: "gesture",
  play_audio_cue: "audio",
  web_search: "web",
  save_memory: "memory",
  recall_memory: "memory",
  remember_person: "memory",
  remember_face: "memory",
  get_memory_summary: "memory",
  list_people_memory: "memory",
  who_is_this: "memory",
  walk_distance: "locomotion",
  sidestep_distance: "locomotion",
  turn_robot: "locomotion",
  halt_motion: "locomotion",
  stop_walking: "locomotion",
  set_robot_motion_state: "locomotion",
  walk_to_person: "locomotion",
  get_locomotion_status: "locomotion",
};

function classifyToolFamily(name: string): RobotActivityKind {
  const key = name.trim().toLowerCase();
  const mapped = TOOL_FAMILY_BY_NAME[key];
  if (mapped) return mapped;
  if (key.includes("gesture")) return "gesture";
  if (key.includes("audio") || key.includes("cue")) return "audio";
  if (key.includes("memory") || key.startsWith("remember") || key.startsWith("recall")) return "memory";
  if (key.includes("walk") || key.includes("turn") || key.includes("motion") || key.includes("locomotion")) {
    return "locomotion";
  }
  if (key.includes("search") || key.includes("web")) return "web";
  if (key.includes("emotion") || key.includes("led")) return "emotion";
  return "action";
}

function extractJsonNumber(argsRaw: string, resultRaw: string, keys: string[]): number | null {
  for (const raw of [argsRaw, resultRaw]) {
    if (!raw.trim()) continue;
    try {
      const row = JSON.parse(raw) as Record<string, unknown>;
      for (const key of keys) {
        const value = row[key];
        if (typeof value === "number" && Number.isFinite(value)) return value;
      }
    } catch {
      for (const key of keys) {
        const match = raw.match(new RegExp(`"${key}"\\s*:\\s*(-?[0-9]+(?:\\.[0-9]+)?)`));
        if (match?.[1]) return Number(match[1]);
      }
    }
  }
  return null;
}

function describeToolAction(name: string, args: string, result: string): string | null {
  const tool = name.trim();
  if (!tool) return null;

  const gesture =
    extractGestureName(args, result) ??
    (isGestureToolName(tool) ? null : extractJsonFields(args, result, ["gesture_name", "gesture"]));

  if (gesture || isGestureToolName(tool) || looksLikeGesturePayload(args) || looksLikeGesturePayload(result)) {
    return gesture ? formatGestureLabel(gesture) : null;
  }

  const staticLabel = TOOL_STATIC_ACTION[tool];
  const fields = TOOL_ACTION_FIELDS[tool] ?? GENERIC_ACTION_FIELDS;
  const extracted = extractJsonFields(args, result, [...fields]);
  if (extracted) return clip(extracted, MAX_HEADLINE);
  if (staticLabel) return staticLabel;

  const distance = extractJsonNumber(args, result, ["distance_m", "distance", "meters"]);
  if (distance != null && (tool === "walk_distance" || tool === "sidestep_distance")) {
    return `${distance} m`.replace(".", ",");
  }
  const degrees = extractJsonNumber(args, result, ["degrees", "angle"]);
  if (degrees != null && tool === "turn_robot") {
    return `${degrees}°`;
  }

  if (!args.trim() && !result.trim()) return null;
  return tool;
}

function normalizeFeedEntry(entry: RobotActivityEntry): RobotActivityEntry {
  const gesture =
    extractGestureName(entry.headline, entry.body ?? "") ??
    (entry.kind === "gesture" && !entry.headline.startsWith("{") ? entry.headline : null);

  if (gesture) {
    return {
      ...entry,
      id: entry.id.startsWith("gesture-") ? entry.id : `gesture-${gesture}`,
      kind: "gesture",
      headline: formatGestureLabel(gesture),
      body: undefined,
    };
  }

  if (entry.kind === "gesture") {
    return { ...entry, body: undefined };
  }

  return entry;
}

type ToolFeedCard = {
  kind: RobotActivityKind;
  feedId: string;
  headline: string;
  body?: string;
};

function toolFeedCard(
  callId: string,
  name: string,
  args: string,
  result: string,
): ToolFeedCard | null {
  if (name.trim() === "capture_camera_image") return null;

  const argText = args.trim();
  const resultText = result.trim();
  if (!argText && !resultText) return null;

  const action = describeToolAction(name, args, result);
  if (!action) return null;

  const gesture = extractGestureName(args, result);
  const isGesture =
    gesture != null ||
    isGestureToolName(name) ||
    looksLikeGesturePayload(args) ||
    looksLikeGesturePayload(result);

  if (isGesture) {
    const feedKey = gesture ?? action.replace(/\s+/g, "_");
    return {
      kind: "gesture",
      feedId: `gesture-${feedKey}`,
      headline: action,
    };
  }

  return {
    kind: classifyToolFamily(name),
    feedId: `tool-${callId}`,
    headline: action,
  };
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const row = asRecord(part);
      return asString(row?.text) ?? asString(row?.transcript) ?? "";
    })
    .filter(Boolean)
    .join(" ");
}

function extractResponseText(payload: unknown): string {
  const root = asRecord(payload);
  const response = asRecord(root?.response);
  const output = response?.output;
  if (!Array.isArray(output)) {
    return asString(root?.text) ?? asString(root?.transcript) ?? "";
  }
  const parts: string[] = [];
  for (const item of output) {
    const row = asRecord(item);
    if (!row) continue;
    const type = asString(row.type);
    if (type === "message" || type == null) parts.push(contentText(row.content));
  }
  return parts.filter(Boolean).join(" ");
}

function quote(text: string) {
  return `“${clip(text.trim(), MAX_SPEECH_HEADLINE)}”`;
}

/**
 * PRS inject_channel labels (system_module.py / telemetry_module.py).
 * Appear as outbound `conversation.item.create` user messages — not real speech.
 */
const PRS_INJECTED_MESSAGE_PREFIXES = [
  "SYSTEM CONTEXT:",
  "TELEMETRY CONTEXT:",
  "MEMORY CONTEXT:",
] as const;

/** Capability ids that should not surface as TOOL rows in the deck feed. */
const PRS_SKIP_TOOL_NAMES = new Set([
  "system.context.prepare",
  "telemetry.context.prepare",
  "memory.context.prepare",
]);

function isInjectedContextMessage(text: string): boolean {
  const t = text.trim();
  return PRS_INJECTED_MESSAGE_PREFIXES.some((prefix) => t.startsWith(prefix));
}

function skipToolName(name: string): boolean {
  const n = name.trim();
  const lower = n.toLowerCase();
  if (PRS_SKIP_TOOL_NAMES.has(lower)) return true;
  if (lower.endsWith(".context.prepare")) return true;
  return false;
}

function skipFeedText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isInjectedContextMessage(t)) return true;
  if (t.startsWith("Parâmetro não")) return true;
  if (t.startsWith("Parametro não") || t.startsWith("Parametro nao")) return true;
  return false;
}

function skipFeedCard(headline: string, body: string | undefined): boolean {
  const bare = headline.replace(/^“|”$/g, "").trim();
  if (!bare && !body?.trim()) return true;
  if (skipFeedText(bare)) return true;
  if (body && skipFeedText(body)) return true;
  const toolHeadline = headline.match(/^(?:Chamou|Retorno) · (.+)$/);
  if (toolHeadline && skipToolName(toolHeadline[1])) return true;
  return false;
}

/**
 * Projects transport into one feed row per speech, tool, or error — no lifecycle noise.
 */
export class TransportProjector {
  private envelopes: TransportEntry[] = [];
  private tools = new Map<string, ToolRecord>();
  private feed = new Map<string, FeedRow>();

  ingest(entry: TransportEntry) {
    this.envelopes.push(entry);
    if (this.envelopes.length > MAX_TRANSPORT_BUFFER) {
      this.envelopes = this.envelopes.slice(-MAX_TRANSPORT_BUFFER);
    }
    this.applyEntry(entry);
    this.trimFeed();
  }

  /** Presentation runtime: vision.capture_image finished → fetch JPEG via snapshot_url. */
  ingestVisionFrame(payload: unknown, timestamp = Date.now() / 1000) {
    const row = asRecord(payload);
    const snapshotUrl = asString(row?.snapshot_url);
    if (!snapshotUrl) return;
    const captureCount = asNumber(row?.capture_count);
    const capturedAt = asNumber(row?.captured_at) ?? timestamp;
    const id = captureCount != null ? `vision-${captureCount}` : `vision-${capturedAt}`;
    this.feed.set(id, {
      id,
      kind: "vision",
      headline: "",
      imageUrl: snapshotUrl,
      timestamp: capturedAt,
    });
    this.trimFeed();
  }

  private upsert(
    id: string,
    kind: RobotActivityKind,
    headline: string,
    body: string | undefined,
    timestamp: number,
  ) {
    if (skipFeedCard(headline, body)) return;
    const prev = this.feed.get(id);
    this.feed.set(id, {
      id,
      kind,
      headline,
      body,
      timestamp: prev?.timestamp ?? timestamp,
    });
  }

  private trimFeed() {
    if (this.feed.size <= MAX_FEED) return;
    const ordered = [...this.feed.values()].sort((a, b) => a.timestamp - b.timestamp);
    for (const row of ordered.slice(0, ordered.length - MAX_FEED)) {
      this.feed.delete(row.id);
    }
  }

  private upsertSpeech(
    id: string,
    kind: "speak" | "utterance",
    text: string,
    timestamp: number,
  ) {
    if (!text.trim() || skipFeedText(text)) return;
    this.upsert(id, kind, quote(text), undefined, timestamp);
  }

  /** One row per tool call; gestures collapse to name only (no JSON wall). */
  private upsertToolCard(
    callId: string,
    name: string,
    timestamp: number,
    args?: string,
    result?: string,
  ) {
    if (skipToolName(name)) return;
    const prev = this.tools.get(callId);
    const mergedArgs = args ?? prev?.arguments ?? "";
    const mergedResult = result ?? prev?.result ?? "";

    const card = toolFeedCard(callId, name, mergedArgs, mergedResult);
    if (!card) return;

    this.tools.set(callId, {
      callId,
      name,
      arguments: mergedArgs,
      provisional: false,
      hasInbound: prev?.hasInbound ?? false,
      timestamp: prev?.timestamp ?? timestamp,
      result: mergedResult || prev?.result,
    });
    if (card.kind === "gesture") {
      if (card.feedId !== `tool-${callId}`) {
        this.feed.delete(`tool-${callId}`);
      }
      for (const [feedId, row] of this.feed) {
        if (!feedId.startsWith("tool-")) continue;
        if (
          extractGestureName(row.headline, row.body ?? "") ||
          looksLikeGesturePayload(row.body ?? row.headline)
        ) {
          this.feed.delete(feedId);
        }
      }
    }
    this.upsert(
      card.feedId,
      card.kind,
      card.headline,
      card.body,
      prev?.timestamp ?? timestamp,
    );
  }

  private applyEntry(entry: TransportEntry) {
    const type = entry.event_type ?? "";
    const payload = asRecord(entry.payload) ?? {};
    const ts = entry.timestamp ?? Date.now() / 1000;
    const entryId = entry.entry_id ?? `${type}-${ts}`;

    if (type === "conversation.item.input_audio_transcription.delta") {
      const id = `hear-${asString(entry.item_id) ?? entryId}`;
      const prev = this.feed.get(id);
      const prevText = prev?.headline.replace(/^“|”$/g, "") ?? "";
      const delta = asString(payload.delta) ?? "";
      const text = `${prevText}${delta}`;
      if (!text.trim() || skipFeedText(text)) return;
      this.upsertSpeech(id, "utterance", text, prev?.timestamp ?? ts);
      return;
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const id = `hear-${asString(entry.item_id) ?? entryId}`;
      const text = asString(payload.transcript) ?? this.feed.get(id)?.headline.replace(/^“|”$/g, "") ?? "";
      if (!text.trim() || skipFeedText(text)) return;
      this.upsertSpeech(id, "utterance", text, this.feed.get(id)?.timestamp ?? ts);
      return;
    }

    if (
      type === "response.output_text.delta" ||
      type === "response.text.delta" ||
      type === "response.output_audio_transcript.delta" ||
      type === "response.audio_transcript.delta"
    ) {
      const id = `say-${asString(entry.response_id) ?? asString(entry.item_id) ?? entryId}`;
      const prev = this.feed.get(id);
      const prevText = prev?.headline.replace(/^“|”$/g, "") ?? "";
      const delta = asString(payload.delta) ?? "";
      const text = `${prevText}${delta}`;
      if (!text.trim()) return;
      this.upsertSpeech(id, "speak", text, prev?.timestamp ?? ts);
      return;
    }

    if (
      type === "response.output_text.done" ||
      type === "response.text.done" ||
      type === "response.output_audio_transcript.done" ||
      type === "response.audio_transcript.done"
    ) {
      const id = `say-${asString(entry.response_id) ?? asString(entry.item_id) ?? entryId}`;
      const text =
        asString(payload.text) ??
        asString(payload.transcript) ??
        this.feed.get(id)?.headline.replace(/^“|”$/g, "") ??
        "";
      if (!text.trim()) return;
      this.upsertSpeech(id, "speak", text, this.feed.get(id)?.timestamp ?? ts);
      return;
    }

    if (type === "response.done") {
      const responseId = asString(entry.response_id) ?? entryId;
      const text = extractResponseText(payload);
      if (text.trim()) {
        this.upsertSpeech(`say-${responseId}`, "speak", text, ts);
      }
      return;
    }

    if (type === "response.created") {
      return;
    }

    if (type === "conversation.item.created" || type === "conversation.item.create") {
      const item = asRecord(payload.item);
      if (!item) return;
      const itemType = asString(item.type);

      if (itemType === "function_call_output") {
        const callId = asString(item.call_id) ?? asString(entry.call_id) ?? entryId;
        const prev = this.tools.get(callId);
        const output =
          asString(item.output) ??
          (item.output != null ? clip(JSON.stringify(item.output), 280) : "");
        const name = prev?.name ?? "tool";
        this.upsertToolCard(callId, name, ts, prev?.arguments, output);
        return;
      }

      if (itemType === "function_call") {
        const callId = asString(item.call_id) ?? asString(entry.call_id) ?? entryId;
        const name = asString(item.name) ?? "tool";
        if (skipToolName(name)) return;
        const rawArgs = asString(item.arguments) ?? "";
        this.tools.set(callId, {
          callId,
          name,
          arguments: rawArgs ? parseArgs(rawArgs) : "",
          provisional: !rawArgs,
          hasInbound: entry.direction === "inbound",
          timestamp: ts,
        });
        if (rawArgs.trim()) {
          this.upsertToolCard(callId, name, ts, parseArgs(rawArgs));
        }
        return;
      }

      if (itemType === "message") {
        const role = asString(item.role) === "user" ? "user" : "assistant";
        const id = role === "user"
          ? `hear-${asString(item.id) ?? entryId}`
          : `say-${asString(item.id) ?? entryId}`;
        const text = contentText(item.content);
        if (!text || skipFeedText(text)) return;
        this.upsertSpeech(id, role === "user" ? "utterance" : "speak", text, ts);
      }
      return;
    }

    if (type === "response.function_call_arguments.delta") {
      const callId = asString(entry.call_id) ?? asString(payload.call_id) ?? entryId;
      const prev = this.tools.get(callId);
      const delta = asString(payload.delta) ?? "";
      const name = asString(payload.name) ?? prev?.name ?? "tool";
      if (skipToolName(name)) return;
      const args = `${prev?.arguments ?? ""}${delta}`;
      this.tools.set(callId, {
        callId,
        name,
        arguments: args,
        provisional: true,
        hasInbound: entry.direction === "inbound" || (prev?.hasInbound ?? false),
        timestamp: prev?.timestamp ?? ts,
        result: prev?.result,
      });
      if (args.trim()) {
        this.upsertToolCard(callId, name, prev?.timestamp ?? ts, parseArgs(args));
      }
      return;
    }

    if (type === "response.function_call_arguments.done") {
      const callId = asString(entry.call_id) ?? asString(payload.call_id) ?? entryId;
      const prev = this.tools.get(callId);
      const name = asString(payload.name) ?? prev?.name ?? "tool";
      if (skipToolName(name)) return;
      const raw = asString(payload.arguments) ?? prev?.arguments ?? "";
      const args = parseArgs(raw);
      this.tools.set(callId, {
        callId,
        name,
        arguments: args,
        provisional: false,
        hasInbound: entry.direction === "inbound" || (prev?.hasInbound ?? false),
        timestamp: prev?.timestamp ?? ts,
        result: prev?.result,
      });
      if (raw.trim()) {
        this.upsertToolCard(callId, name, prev?.timestamp ?? ts, args);
      }
      return;
    }

    if (type === "response.output_item.added" || type === "response.output_item.done") {
      const item = asRecord(payload.item);
      if (asString(item?.type) !== "function_call") return;
      const callId = asString(item?.call_id) ?? asString(entry.call_id) ?? entryId;
      const prev = this.tools.get(callId);
      const name = asString(item?.name) ?? prev?.name ?? "tool";
      if (skipToolName(name)) return;
      const rawArgs = asString(item?.arguments) ?? prev?.arguments ?? "";
      this.tools.set(callId, {
        callId,
        name,
        arguments: rawArgs ? parseArgs(rawArgs) : prev?.arguments ?? "",
        provisional: prev?.provisional ?? true,
        hasInbound: entry.direction === "inbound" || (prev?.hasInbound ?? false),
        timestamp: prev?.timestamp ?? ts,
        result: prev?.result,
      });
      if (rawArgs.trim()) {
        this.upsertToolCard(callId, name, prev?.timestamp ?? ts, parseArgs(rawArgs));
      }
      return;
    }

    if (type === "input_audio_buffer.speech_started" || type === "input_audio_buffer.speech_stopped") {
      return;
    }

    if (type === "error" || type.endsWith(".error")) {
      return;
    }
  }

  toActivityEntries(): RobotActivityEntry[] {
    return [...this.feed.values()]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-MAX_FEED)
      .map(({ timestamp, ...entry }) => {
        void timestamp;
        return normalizeFeedEntry(entry);
      })
      .filter((row) => FEED_KINDS.includes(row.kind))
      .filter((row) => row.imageUrl || !skipFeedCard(row.headline, row.body));
  }
}

export function sessionActivity(state: string | null | undefined): RobotActivityEntry | null {
  if (!state) return null;
  return {
    id: `session-${state}`,
    kind: "perception",
    headline: `Sessão → ${state}`,
    body: "brain_and_soul",
  };
}
