"use client";

import { useEffect, useRef, useState } from "react";
import type { RobotActivityEntry } from "./robot-activity-feed";
import {
  EMPTY_TELEMETRY,
  TransportProjector,
  resolvePrsApiPath,
  sessionActivity,
  telemetryFromPayload,
  type PrsLiveStatus,
  type PrsSnapshot,
  type RobotTelemetry,
} from "./prs-live";

/**
 * Always same-origin `/prs-api` so the raw PRS API is never a public URL/port.
 * - Docker/LAN/Cloudflare: presentation gateway on the page port proxies SSE
 *   unbuffered to the loopback PRS proxy → Tailscale PRS host.
 * - `next dev` only: optional direct loopback :3010 (Next rewrites buffer SSE).
 */
function prsApiBase() {
  if (typeof window !== "undefined") {
    const { hostname } = window.location;
    const isLoopback = hostname === "localhost" || hostname === "127.0.0.1";
    if (
      process.env.NODE_ENV === "development" &&
      isLoopback &&
      process.env.NEXT_PUBLIC_PRS_LIVE === "1"
    ) {
      const proxyPort = process.env.NEXT_PUBLIC_PRS_PROXY_PORT ?? "3010";
      return `http://127.0.0.1:${proxyPort}/prs-api`;
    }
  }
  return "/prs-api";
}

function withTrailingSlash(path: string) {
  return path.endsWith("/") ? path : `${path}/`;
}

export type PrsLiveState = {
  telemetry: RobotTelemetry;
  entries: RobotActivityEntry[];
  status: PrsLiveStatus;
};

const INITIAL_STATUS: PrsLiveStatus = {
  ready: null,
  runtimeState: null,
  sessionState: null,
  runtimeStream: "idle",
  transportStream: "idle",
};

export function usePrsLive(): PrsLiveState {
  const [telemetry, setTelemetry] = useState<RobotTelemetry>(EMPTY_TELEMETRY);
  const [entries, setEntries] = useState<RobotActivityEntry[]>([]);
  const [status, setStatus] = useState<PrsLiveStatus>(INITIAL_STATUS);

  const projectorRef = useRef(new TransportProjector());
  const seenRuntime = useRef(new Set<string>());
  const seenTransport = useRef(new Set<string>());
  const pendingTransport = useRef<Array<Record<string, unknown>>>([]);
  const rafRef = useRef(0);
  const sessionEntryRef = useRef<RobotActivityEntry | null>(null);
  const debugRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const runtimeIds = seenRuntime.current;
    const transportIds = seenTransport.current;
    const projector = projectorRef.current;
    const api = prsApiBase();
    debugRef.current =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("prsDebug");

    const publishFeed = () => {
      const live = projector.toActivityEntries().map((entry) =>
        entry.imageUrl
          ? { ...entry, imageUrl: resolvePrsApiPath(api, entry.imageUrl) }
          : entry,
      );
      setEntries(live.slice(-36));
    };

    const flushTransport = () => {
      rafRef.current = 0;
      const batch = pendingTransport.current;
      pendingTransport.current = [];
      for (const entry of batch) {
        projector.ingest(entry);
      }
      if (!cancelled) publishFeed();
    };

    const queueTransport = (entry: Record<string, unknown>) => {
      pendingTransport.current.push(entry);
      if (!rafRef.current) {
        rafRef.current = window.requestAnimationFrame(flushTransport);
      }
    };

    const runtimeSource = new EventSource(
      `${withTrailingSlash(`${api}/runtime/events/stream`)}?view=presentation&replay=100&follow=1`,
    );
    const transportSource = new EventSource(
      `${withTrailingSlash(`${api}/brain_and_soul/transport/stream`)}?view=presentation&replay=300&follow=1`,
    );

    runtimeSource.addEventListener("runtime", (message) => {
      try {
        const event = JSON.parse((message as MessageEvent).data) as {
          event_id?: string;
          type?: string;
          payload?: unknown;
        };
        if (!event?.event_id || runtimeIds.has(event.event_id)) return;
        runtimeIds.add(event.event_id);

        const type = event.type ?? "";
        if (type === "telemetry.updated") {
          setTelemetry(telemetryFromPayload(event.payload));
        }
        if (type === "vision.frame.updated") {
          projector.ingestVisionFrame(event.payload);
          publishFeed();
        }
        if (type === "brain_and_soul.session.state_changed") {
          const payload = event.payload as { state?: string } | null;
          const state = payload?.state ?? null;
          setStatus((prev) => ({ ...prev, sessionState: state }));
          sessionEntryRef.current = sessionActivity(state);
        }
        if (type.startsWith("runtime.")) {
          setStatus((prev) => ({
            ...prev,
            runtimeState: type.replace(/^runtime\./, ""),
            ready:
              type === "runtime.started"
                ? true
                : type === "runtime.stopped" || type === "runtime.error"
                  ? false
                  : prev.ready,
          }));
        }
      } catch {
        /* ignore malformed */
      }
    });

    transportSource.addEventListener("transport", (message) => {
      try {
        const entry = JSON.parse((message as MessageEvent).data) as {
          entry_id?: string;
          timestamp?: number;
          event_type?: string;
        } & Record<string, unknown>;
        if (!entry?.entry_id || transportIds.has(entry.entry_id)) return;
        transportIds.add(entry.entry_id);

        if (typeof entry.timestamp === "number" && debugRef.current) {
          const ageMs = Date.now() - entry.timestamp * 1000;
          console.log("PRS transport age:", Math.round(ageMs), "ms", entry.event_type);
        }

        queueTransport(entry);
      } catch {
        /* ignore malformed */
      }
    });

    runtimeSource.onopen = () => {
      if (!cancelled) setStatus((prev) => ({ ...prev, runtimeStream: "live" }));
    };
    transportSource.onopen = () => {
      if (!cancelled) setStatus((prev) => ({ ...prev, transportStream: "live" }));
    };
    runtimeSource.onerror = () => {
      if (!cancelled) setStatus((prev) => ({ ...prev, runtimeStream: "reconnecting" }));
    };
    transportSource.onerror = () => {
      if (!cancelled) setStatus((prev) => ({ ...prev, transportStream: "reconnecting" }));
    };

    void fetch(withTrailingSlash(`${api}/presentation/snapshot`), { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`PRS snapshot failed: ${response.status}`);
        return response.json() as Promise<PrsSnapshot>;
      })
      .then((snapshot) => {
        if (cancelled) return;
        setStatus((prev) => ({
          ...prev,
          ready: snapshot.ready ?? null,
          runtimeState: snapshot.runtime?.state ?? prev.runtimeState,
          sessionState: snapshot.brain_and_soul?.session_state ?? prev.sessionState,
        }));
        setTelemetry(telemetryFromPayload(snapshot.telemetry));
        sessionEntryRef.current = sessionActivity(snapshot.brain_and_soul?.session_state);
        publishFeed();
      })
      .catch(() => {
        /* streams carry live data */
      });

    const staleTimer = window.setInterval(() => {
      setTelemetry((prev) => {
        if (prev.updatedAt == null) return prev;
        const stale = Date.now() / 1000 - prev.updatedAt > 15;
        return prev.stale === stale ? prev : { ...prev, stale };
      });
    }, 5000);

    const onHide = () => {
      runtimeSource.close();
      transportSource.close();
    };
    window.addEventListener("pagehide", onHide);

    return () => {
      cancelled = true;
      window.clearInterval(staleTimer);
      window.removeEventListener("pagehide", onHide);
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      runtimeSource.close();
      transportSource.close();
    };
  }, []);

  return { telemetry, entries, status };
}
