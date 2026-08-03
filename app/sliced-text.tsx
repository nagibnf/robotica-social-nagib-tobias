"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactElement,
  type ReactNode,
} from "react";

const GLITCH_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ÁÉÍÓÚÃÕÇ≠×·#$@%&<>/-";

type SlicedTextProps<T extends ElementType> = {
  as?: T;
  children: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

function plainText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    if (node.type === "br") return " ";
    return plainText(node.props.children);
  }
  return "";
}

function splitToGlyphs(
  node: ReactNode,
  keyPrefix: string,
  indexRef: { current: number },
): ReactNode {
  if (node == null || typeof node === "boolean") return null;

  if (typeof node === "string" || typeof node === "number") {
    return Array.from(String(node), (char, charIndex) => {
      if (char === "\n" || char === "\u2060") return null;
      const glyphIndex = indexRef.current;
      indexRef.current += 1;
      const isSpace = char === " " || char === "\t";
      return (
        <span
          key={`${keyPrefix}-${charIndex}-${glyphIndex}`}
          className={isSpace ? "glyph glyph--space" : "glyph"}
          data-char={isSpace ? " " : char}
          style={{ ["--glyph-i" as string]: glyphIndex } as CSSProperties}
        >
          {isSpace ? "\u00a0" : char}
        </span>
      );
    });
  }

  if (Array.isArray(node)) {
    return Children.map(node, (child, i) =>
      splitToGlyphs(child, `${keyPrefix}.${i}`, indexRef),
    );
  }

  if (isValidElement(node)) {
    const element = node as ReactElement<{ children?: ReactNode; className?: string }>;
    if (element.type === "br") return element;
    return cloneElement(element, {
      ...element.props,
      children: splitToGlyphs(element.props.children, `${keyPrefix}.c`, indexRef),
    });
  }

  return node;
}

function scrambleGlyphs(glyphs: HTMLElement[], mode: "in" | "out") {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const timeouts: number[] = [];
  const intervals: number[] = [];

  for (const [i, el] of glyphs.entries()) {
    const finalChar = el.dataset.char ?? "";
    if (!finalChar || finalChar === " ") {
      el.textContent = finalChar === " " ? "\u00a0" : finalChar;
      continue;
    }

    if (reduced) {
      el.textContent = finalChar;
      continue;
    }

    const delay = mode === "in" ? 40 + i * 16 : i * 10;
    const ticks = mode === "in" ? 4 : 3;

    timeouts.push(
      window.setTimeout(() => {
        let n = 0;
        const id = window.setInterval(() => {
          el.textContent = GLITCH_CHARS[(Math.random() * GLITCH_CHARS.length) | 0] ?? finalChar;
          n += 1;
          if (n >= ticks) {
            window.clearInterval(id);
            el.textContent =
              mode === "in"
                ? finalChar
                : (GLITCH_CHARS[(Math.random() * GLITCH_CHARS.length) | 0] ?? finalChar);
          }
        }, 28);
        intervals.push(id);
      }, delay),
    );
  }

  return () => {
    for (const id of timeouts) window.clearTimeout(id);
    for (const id of intervals) window.clearInterval(id);
  };
}

/**
 * Per-glyph Codrops-style enter/exit: staggered offset plus random character
 * scramble before landing on the real glyph. Visual glyphs are aria-hidden;
 * the host element carries the accessible label.
 */
export function SlicedText<T extends ElementType = "span">({
  as,
  children,
  className = "",
  ...rest
}: SlicedTextProps<T>) {
  const Tag = (as ?? "span") as ElementType;
  const classes = className ? `sliced ${className}` : "sliced";
  const reactId = useId();
  const rootRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const indexRef = { current: 0 };
  const glyphs = splitToGlyphs(children, reactId, indexRef);
  const label = plainText(children).replace(/\s+/g, " ").trim();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const section = root.closest("section");
    if (!section) return;

    const glyphsInRoot = () =>
      [...root.querySelectorAll<HTMLElement>(".glyph:not(.glyph--space)")];

    const resetGlyphs = () => {
      for (const el of glyphsInRoot()) {
        el.textContent = el.dataset.char ?? "";
      }
    };

    let last = "";
    const sync = () => {
      const exiting = section.classList.contains("is-exiting");
      const present = section.classList.contains("present");
      const state = exiting ? "out" : present ? "in" : "idle";
      if (state === last) return;
      last = state;
      cancelRef.current?.();
      cancelRef.current = null;

      if (state === "in") {
        resetGlyphs();
        cancelRef.current = scrambleGlyphs(glyphsInRoot(), "in");
        return;
      }
      if (state === "out") {
        cancelRef.current = scrambleGlyphs(glyphsInRoot(), "out");
        return;
      }
      resetGlyphs();
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(section, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
      cancelRef.current?.();
    };
  }, []);

  return (
    <Tag
      ref={(node: HTMLElement | null) => {
        rootRef.current = node;
      }}
      className={classes}
      aria-label={label || undefined}
      {...rest}
    >
      <span className="sliced__glyphs" aria-hidden="true">
        {glyphs}
      </span>
    </Tag>
  );
}
