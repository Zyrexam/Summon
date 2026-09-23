# Design

White theme, shadcn concept system, Ink & Ember.

## Tokens

- Base: shadcn `base-nova` preset (`globals.css`). Neutral oklch scale, `--radius: 0.625rem`.
- Ink: `--foreground` / `--primary` — neutral near-black. Humans.
- Ember: `--ember: oklch(0.65 0.19 35)` (light), `oklch(0.7 0.17 35)` (dark). AI only.
  - `--ember-muted` for AI avatar wash; `--ember-foreground` for AI label text.
  - Ember caret, `::selection` wash (28%), and `*:focus-visible` outline.

## Color law

| Actor | Color |
| --- | --- |
| Human message bubble | muted ink |
| "You" bubble | secondary ink, right-aligned |
| Summon AI bubble | white + ember left edge (`AIEdge`) + ember avatar wash + ember "Summon AI" label |
| Ember anywhere else | forbidden (selection/caret/focus only) |

## Layout

- Login: centered Card, ember flame mark above title, full-width primary button.
- Rooms shell: fixed Sidebar (256px, collapsible to icon rail) + main column.
  - Main: header (collapse toggle, `# room`, member/E2EE meta) → MessageScroller → composer.
  - MessageScroller content is `min-h-full` → messages `justify-end` (bottom-packed).
  - Mobile: sidebar becomes Sheet via header trigger.
- New room: Dialog + label + input.

## Components

Installed shadcn (style `base-nova`, `@base-ui/react`): sidebar, card, input, button, avatar, skeleton, empty, badge, separator, scroll-area, tooltip, dialog, label, sheet, message-scroller, message, bubble, marker, attachment.
`cn` from `cn` package. `TooltipProvider delay={0}` at layout root.

## Behavior contracts

- No `@ai` autocomplete — summon is deliberate (raw input).
- AI answers whole-arrival (no streaming shimmer); mock: append complete message.
- AI never on roster; header meta is human member count only.
- Mock data only (`lib/data.ts`): rooms `design-crit` / `standup` / `infra`, user Mohit.

## Evidence

- Screenshots: `.impeccable/review/*.png` (login desktop/mobile/error, rooms desktop/mobile/send/dialog/empty, breakpoints 375–1440).
- `impeccable detect --json` on page/rooms/layout/globals: `[]`.
- Gates: `pnpm typecheck && pnpm test` green.
- Gap: UIZZE catalogue auth-gated this session; decisions from product constraint + shadcn defaults, not pattern extraction.
