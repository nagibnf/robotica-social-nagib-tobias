# Engineering learnings

Standing conventions and a dated decision log for this presentation deck.

## Conventions

- Keep slide motion CSS-owned and synchronized with Reveal’s lifecycle. Do not let Reveal hide an outgoing slide before its exit animation finishes (`is-exiting` + delayed `hidden` restore).
- Prefer small focused modules (field, feed, sliced text) over growing `page.tsx` into a monolith.
- Slide narrative copy may use decorative motion; telemetry, live feed, and deck chrome stay stable.

## Decision log

### 2026-08-01 — Sliced text IN/OUT transitions

- Added `SlicedText`: per-glyph spans with accessible `aria-label` on the host; visual glyphs are `aria-hidden`.
- Codrops/Quai-inspired motion: each glyph staggers with alternating offset, plus a short random character scramble before landing on the real glyph (IN and OUT).
- Kept the wireframe outline→fill title treatment on impact glyphs.
- Accent color uses an explicit `.text-accent` class so structural wrappers do not steal green styling.
- `prefers-reduced-motion` skips scramble and glyph transform animations.
