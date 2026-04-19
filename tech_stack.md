# Sudoku App — Tech Stack

## Architecture

**One file. One `index.html`. Ships as both the website and the downloadable offline version.**

Same file, two distribution channels:
- Served from the website for SEO + instant play
- Offered as a direct download for offline / trust-conscious users

No build step. No bundler. No framework. No runtime dependencies. No CDN fetches.

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Markup | Vanilla HTML5 | Zero deps, crawlable, fast LCP |
| Styling | Vanilla CSS (inline `<style>`) | CSS Grid for the 9x9 board, CSS custom properties for theming, `@media (prefers-color-scheme: dark)` for dark mode |
| Logic | Vanilla JavaScript (inline `<script>`) | Modern browsers ship everything needed; no polyfills |
| Fonts | System font stack (`system-ui, -apple-system, sans-serif`) | No Google Fonts, no external requests |
| Icons | Inline SVG | Everything stays in the file |
| State persistence | `localStorage` | Works reliably from both `https://` and `file://`, no IndexedDB flakiness on downloaded files |
| State model | Event sourcing (append-only event log in localStorage) | Unlocks undo/redo, replay, export, stats for free |

## Hard Constraints

- **No external network requests at runtime.** No CDN scripts, no Google Fonts links, no analytics pixels. The "audit offline" promise must hold.
- **No minification on the shipped file.** Readable source is the trust signal.
- **No build step.** What you write is what ships.
- **Single file only.** No sidecar CSS/JS files, no assets directory. Everything inline.

## Browser APIs Used (all built-in, zero deps)

- `document.querySelector` / DOM methods — rendering & updates
- `addEventListener` — input handling
- `localStorage` — event log persistence
- `JSON.parse` / `JSON.stringify` — event serialization
- `Math.random` — puzzle generation
- CSS Grid — board layout
- `pointerdown` / `pointermove` / `pointerup` — unified mouse + touch input
- `keydown` with `e.key` — keyboard input
- `setInterval` / `setTimeout` — game timer, replay animation
- `Blob` + `URL.createObjectURL` — export play history as downloadable JSON

## Event Sourcing Layer

Append-only event log in `localStorage` under a versioned key (`sudoku:events:v1`). All state is a pure fold over the log.

**Event types (initial set):**
- `GameStarted` — `{ puzzle, difficulty, ts }`
- `CellFilled` — `{ row, col, value, ts }`
- `CellCleared` — `{ row, col, ts }`
- `PencilToggled` — `{ row, col, value, ts }`
- `HintUsed` — `{ row, col, ts }`
- `GameCompleted` — `{ ts }`
- `ActionUndone` — `{ refSeq, ts }` (optional, if doing pure-ES undo)

**Core API:**
- `appendEvent(event)` — write to log, assign sequence number
- `replay()` — fold entire log into current state on page load
- `applyEvent(state, event)` — pure reducer

**Capacity:** ~5MB localStorage limit = thousands of completed games before hitting it. Add log compaction / snapshotting later if ever needed.

## File Layout