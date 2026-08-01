"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export type RobotActivityKind =
  | "speak"
  | "utterance"
  | "action"
  | "gesture"
  | "emotion"
  | "audio"
  | "memory"
  | "web"
  | "locomotion"
  | "vision"
  | "perception";

export const TOOL_FEED_KINDS: RobotActivityKind[] = [
  "emotion",
  "gesture",
  "audio",
  "memory",
  "web",
  "locomotion",
  "action",
];

export const FEED_KINDS: RobotActivityKind[] = ["speak", "utterance", "vision", ...TOOL_FEED_KINDS];

export type RobotActivityEntry = {
  id: string;
  kind: RobotActivityKind;
  headline: string;
  body?: string;
  /** Resolved PRS proxy URL to latest captured JPEG (vision.frame.updated). */
  imageUrl?: string;
};

const KIND_LABEL: Record<RobotActivityKind, string> = {
  speak: "FALA",
  utterance: "OUVIU",
  action: "TOOL",
  gesture: "GESTO",
  emotion: "EMOÇÃO",
  audio: "ÁUDIO",
  memory: "MEMÓRIA",
  web: "WEB",
  locomotion: "LOCOMOÇÃO",
  vision: "VISÃO",
  perception: "EVENTO",
};

const LIVE_RISE_S = 22;
/** Vertical gap between stacked cards (same column); rise duration stays fixed for all kinds. */
const LINE_STEP_VH = 2.28;
const MAX_ON_SCREEN = 10;
const CHARS_PER_LINE = 46;

function stackUnits(entry: RobotActivityEntry): number {
  // ~label + max-height thumb, in --line-step units (keeps column aligned with layout).
  if (entry.imageUrl) return 3.4;
  const bare = entry.headline.replace(/^“|”$/g, "").trim();
  const lines = Math.max(1, Math.ceil(bare.length / CHARS_PER_LINE));
  return 0.58 + lines * 0.72;
}

type LiveCard = RobotActivityEntry & { releaseIndex: number };

type RobotActivityFeedProps = {
  entries?: RobotActivityEntry[];
};

function sameEntry(a: RobotActivityEntry, b: RobotActivityEntry) {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.headline === b.headline &&
    a.body === b.body &&
    a.imageUrl === b.imageUrl
  );
}

export function RobotActivityFeed({ entries = [] }: RobotActivityFeedProps) {
  const [liveCards, setLiveCards] = useState<LiveCard[]>([]);
  const releaseIndexRef = useRef(0);
  const knownIdsRef = useRef(new Set<string>());
  const expiredIdsRef = useRef(new Set<string>());
  const latestByIdRef = useRef(new Map<string, RobotActivityEntry>());

  useEffect(() => {
    const activeIds = new Set(entries.map((entry) => entry.id));
    for (const id of expiredIdsRef.current) {
      if (!activeIds.has(id)) expiredIdsRef.current.delete(id);
    }

    const known = knownIdsRef.current;
    const expired = expiredIdsRef.current;
    const latest = latestByIdRef.current;
    const fresh: RobotActivityEntry[] = [];
    let copyDirty = false;

    for (const entry of entries) {
      if (expired.has(entry.id)) {
        latest.set(entry.id, entry);
        continue;
      }

      const prev = latest.get(entry.id);
      latest.set(entry.id, entry);

      if (!known.has(entry.id)) {
        known.add(entry.id);
        fresh.push(entry);
        continue;
      }

      if (prev && sameEntry(prev, entry)) continue;
      copyDirty = true;
    }

    if (!copyDirty && fresh.length === 0) return;

    setLiveCards((cards) => {
      let next = cards.filter((card) => !expired.has(card.id));

      if (copyDirty) {
        next = next.map((card) => {
          const updated = latest.get(card.id);
          if (!updated || sameEntry(card, updated)) return card;
          return { ...card, ...updated, releaseIndex: card.releaseIndex };
        });
      }

      if (fresh.length === 0) return next;

      const born: LiveCard[] = fresh.map((entry) => {
        const releaseIndex = releaseIndexRef.current;
        releaseIndexRef.current += 1;
        return { ...entry, releaseIndex };
      });

      return [...next, ...born].slice(-MAX_ON_SCREEN);
    });
  }, [entries]);

  const ordered = [...liveCards].sort((a, b) => a.releaseIndex - b.releaseIndex);
  const units = ordered.map((card) => stackUnits(card));

  return (
    <div
      className="activity-feed"
      aria-hidden="true"
      style={{ ["--line-step" as string]: `${LINE_STEP_VH}vh` }}
    >
      <div className="activity-feed__viewport">
        {ordered.map((entry, index) => {
          let push = 0;
          for (let j = index + 1; j < ordered.length; j += 1) {
            push += units[j] ?? 1;
          }
          return (
            <article
              key={`${entry.id}-${entry.releaseIndex}`}
              className={`activity-feed__block activity-feed__block--${entry.kind} activity-feed__block--live`}
              style={{
                ["--push" as string]: push,
                zIndex: entry.releaseIndex,
              }}
            >
              <div
                className="activity-feed__lift"
                style={{ ["--cycle" as string]: `${LIVE_RISE_S}s` }}
                onAnimationEnd={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.animationName !== "activity-feed-rise") return;
                  expiredIdsRef.current.add(entry.id);
                  setLiveCards((cards) => cards.filter((card) => card.releaseIndex !== entry.releaseIndex));
                }}
              >
                <FeedCopy entry={entry} swayDelay={-(entry.releaseIndex * 0.73)} />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function FeedCopy({
  entry,
  swayDelay,
}: {
  entry: RobotActivityEntry;
  swayDelay: number;
}) {
  return (
    <div className="activity-feed__sway" style={{ animationDelay: `${swayDelay}s` }}>
      <p className="activity-feed__kind">{KIND_LABEL[entry.kind]}</p>
      {entry.imageUrl ? (
        <Image
          className="activity-feed__vision"
          src={entry.imageUrl}
          alt=""
          width={144}
          height={88}
          sizes="9rem"
          unoptimized
          loading="lazy"
        />
      ) : null}
      {entry.headline ? <p className="activity-feed__headline">{entry.headline}</p> : null}
    </div>
  );
}
