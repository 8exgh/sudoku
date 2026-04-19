# Sudoku App — Full Specification

Single-file, zero-dependency, offline-capable sudoku web app with event-sourced state persistence. Ships as both a website and a direct-download HTML file with identical behavior.

---

## 1. Distribution model

One `index.html`. No build step, no bundler, no sidecar assets. Same file ships:

- **From a web server** for SEO, instant play, shareable URL
- **As a direct download** for users who want to audit the source and run offline

The "open it from `file://` and it still works" promise is a hard constraint, not a nice-to-have. It drives the tech choices below.

---

## 2. Hard constraints

- No external network requests at runtime. No CDN scripts, no Google Fonts, no analytics pixels, no telemetry.
- No minification on the shipped file. Readable source is the trust signal.
- No build step. What you write is what ships.
- Single file. No sidecar CSS/JS files, no assets directory. Everything inline.
- Must work from `file://` (localStorage only; IndexedDB is flaky on downloaded files).
- Must work offline after first load, trivially, because there is no first-load fetch.

---

## 3. Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Markup | Vanilla HTML5 | Zero deps, crawlable, fast LCP |
| Styling | Vanilla CSS (inline `<style>`) | CSS Grid for 9×9 board, CSS custom properties for theming, `@media (prefers-color-scheme: dark)` for dark mode |
| Logic | Vanilla JavaScript (inline `<script>`) | Modern browsers ship everything needed; no polyfills |
| Fonts | `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | No external font requests |
| Icons | Inline SVG | Everything stays in the file |
| State persistence | `localStorage` | Works from both `https://` and `file://` |
| State model | Event sourcing (append-only log) | Unlocks undo, replay, export, stats for free |

Browser APIs used (all built-in, zero deps):

- DOM methods (`querySelector`, `createElement`, etc.)
- `addEventListener`
- `localStorage`
- `JSON.parse` / `JSON.stringify`
- `Math.random`
- CSS Grid
- `pointerdown` (unified mouse + touch input)
- `keydown` with `e.key`
- `setInterval` / `setTimeout`
- `Blob` + `URL.createObjectURL` (export to JSON file)

---

## 4. Architecture

Four layers, clean separation:

```
┌─────────────────────────────────────────────┐
│  UI layer (render, input bindings, timer)   │
├─────────────────────────────────────────────┤
│  Dispatch (append event → apply → side fx)  │
├─────────────────────────────────────────────┤
│  Reducer (pure: state + event → state')     │
├─────────────────────────────────────────────┤
│  Persistence (localStorage event log)       │
└─────────────────────────────────────────────┘
```

**State is a pure fold over the event log.** On boot, the log is replayed from scratch to derive the current state. Nothing is stored except events.

---

## 5. Event sourcing model

### Storage

- Key: `sudoku:events:v1`
- Format: JSON-serialized array of event objects
- Capacity: ~5MB localStorage quota = thousands of completed games

### Event envelope

Every event has:

```js
{ seq: number,       // monotonic, = index in log
  ts: number,        // Date.now() at append time
  type: string,      // discriminator
  ...payload         // type-specific fields
}
```

### Event types

| Type | Payload | Semantics |
|------|---------|-----------|
| `GameStarted` | `{ puzzle, solution, difficulty }` | Archives prior completed game to history; initializes new game state |
| `CellFilled` | `{ row, col, value }` | Places a value in a user cell; clears pencil marks in that cell |
| `CellCleared` | `{ row, col }` | Removes value from a user cell |
| `PencilToggled` | `{ row, col, value }` | Toggles a candidate mark (1–9) in an empty user cell |
| `HintUsed` | `{ row, col }` | Fills the cell with the solution value; increments `hintsUsed` |
| `GameCompleted` | `{}` | Marks the current game as completed (emitted by dispatcher, not the user) |
| `ActionUndone` | `{ refSeq }` | Nullifies a prior event by its seq number |

### Reducer rules

`applyEvent(state, event) → state'` is **pure**. It:

- Deep-clones the current game before mutating
- Rejects writes to clue cells (they are immutable)
- Rejects pencil marks on cells that already have a value
- Pushes the event's `seq` to `undoStack` for events the user initiated (fill, clear, pencil, hint — not `GameStarted` or `GameCompleted`)
- Does **not** emit further events. Side effects (completion check, timer stop) live in the dispatcher.

### Replay

```js
function replay(events) {
  const undoneSeqs = new Set();
  for (const e of events) {
    if (e.type === 'ActionUndone') undoneSeqs.add(e.refSeq);
  }
  let state = initialState();
  for (const e of events) {
    if (e.type === 'ActionUndone') continue;
    if (undoneSeqs.has(e.seq)) continue;
    state = applyEvent(state, e);
  }
  return state;
}
```

Undo is implemented by appending `ActionUndone { refSeq }` and re-running `replay()`. The target event stays in the log forever but is filtered on every future fold. **No event is ever deleted or rewritten.**

### Dispatcher

```js
function dispatch(partial) {
  const ev = appendEvent(partial);       // write to log + localStorage
  state = applyEvent(state, ev);          // update in-memory state
  if (state.currentGame &&
      !state.currentGame.completedAt &&
      isGameSolved(state.currentGame)) {
    const done = appendEvent({ type: 'GameCompleted' });
    state = applyEvent(state, done);
    stopTimer();
    showOverlay();
  }
  render();
}
```

Completion is emitted by the dispatcher as a separate event so the log records *when* the win was detected, not just *that* the final cell was filled.

---

## 6. Puzzle generation

MVP generator. No uniqueness check — acknowledged trade-off.

1. `fillSolved(board)` — backtracking solver with randomized digit order fills a 9×9 with a valid solution.
2. `generatePuzzle(difficulty)` — clones the solution, shuffles cell positions, removes N cells based on difficulty target.

### Difficulty → clue count

| Difficulty | Clues | Cells removed |
|------------|-------|---------------|
| Easy | 42 | 39 |
| Medium | 32 | 49 |
| Hard | 26 | 55 |

### Known limitation

Below ~25 clues, random removal occasionally produces puzzles with multiple valid solutions. v1 ships without a uniqueness check. Add a solution-counter in v2 if puzzle quality becomes a complaint.

The full solution is stored alongside the puzzle in the `GameStarted` event so hints always work regardless of puzzle uniqueness.

---

## 7. Validation

### Conflict detection

Run on every render. Returns a `Set<"r,c">` of cells involved in any rule violation.

Checks 27 groups: 9 rows, 9 columns, 9 boxes. For each group, bucket cells by value. Any bucket with length > 1 — all cells in that bucket are conflicting.

Both sides of a conflict are highlighted, not just the offending cell. Conflict highlighting **is** the hint system.

### Completion check

A game is solved when `values[r][c] === solution[r][c]` for all cells. Stricter than "no conflicts + fully filled" — guarantees the user matched the actual solution.

---

## 8. UI specification

### Layout

Vertical stack, 500px max width, centered:

1. Top bar — timer (left), difficulty select (right)
2. Board — 9×9 CSS Grid, 1:1 aspect ratio, fills container width
3. Status line — conflict count or "Solved"
4. Numpad — 1–9 in a horizontal row
5. Action bar — undo, erase, pencil, hint (4-column grid)
6. Footer — new game, export history, reset all

### Board styling

- Outer border: 2px solid (strong)
- 3×3 box borders: 1.5px solid (strong)
- Cell borders: 1px solid (subtle)
- No borders on the outer edge of each cell (handled by outer grid border)

### Cell visual states

Priority order (later wins):

| State | Background | Notes |
|-------|------------|-------|
| default | `--cell-bg` | |
| related | `--cell-related` | same row, col, or box as selected |
| same-value | `--cell-same-value` | value matches the selected cell's value |
| selected | `--cell-selected` + inset 2px accent ring | |
| conflict | `--cell-conflict` + danger text color | overrides everything |

### Cell text styling

- Clue cells: 600 weight, default text color
- User cells: 400 weight, accent blue (`--text-user`)
- Conflict cells: danger red, overrides user/clue color
- Pencil marks: 3×3 mini-grid inside empty cells, muted color, small font

### Number pad

- 9 buttons in a row, 1–9
- Buttons for fully-placed values (9 of that value already on the board) render at 35% opacity

### Action bar

- Icon + label, 4-up grid
- Pencil button shows active state when pencil mode is on
- Undo and hint buttons disable when not applicable

### Dark mode

Driven entirely by `@media (prefers-color-scheme: dark)`. Every color is a CSS custom property; the media query swaps the whole palette. Mental test: if every background flipped to near-black, would every piece of text still be readable? Yes.

---

## 9. Interaction model

### Pointer (mouse + touch, unified via Pointer Events)

- `pointerdown` on a cell → select it, focus the board
- `pointerdown` on a numpad button → trigger `inputNumber(v)` with `preventDefault()`

### Keyboard

| Key | Action |
|-----|--------|
| 1–9 | Fill or toggle pencil (depending on mode) |
| 0, Backspace, Delete | Erase cell value; if empty, clear pencil marks |
| Arrow keys | Move selection |
| P | Toggle pencil mode |
| H | Use hint on selected cell |
| Ctrl+Z / Cmd+Z | Undo |

### Mode toggle

Pencil mode is runtime UI state (not persisted, not in the event log). Numeric input in pencil mode emits `PencilToggled`; in normal mode emits `CellFilled`.

### Numpad behavior

- In normal mode: tap fills the selected cell with that digit
- If the cell already has that digit: tap clears it
- In pencil mode: tap toggles that digit as a candidate mark

### Erase button

- If cell has a value → `CellCleared`
- Else if cell has pencil marks → emit one `PencilToggled` per mark to clear them all
- Else → no-op

### Hint button

Fills the selected cell with the correct value from the stored solution. Emits `HintUsed`. Increments the `hintsUsed` counter shown in the completion overlay.

### Difficulty change

Changing the difficulty select immediately starts a new game at that difficulty. No confirm prompt — abandoned games aren't archived, only completed ones.

---

## 10. Persistence & session behavior

### On boot

- Load events from localStorage
- `replay(events)` to derive state
- If no current game → start a new easy game
- If current game exists and not completed → resume, start timer
- If current game exists and completed → show the completed board + overlay

### On every state change

- Event appended to in-memory log
- Log written to localStorage via `JSON.stringify`
- If serialization fails (quota exceeded, private mode), the game continues in memory but doesn't persist

### Export

Serializes the full event log as pretty-printed JSON and downloads it as `sudoku-history-YYYY-MM-DD.json` using a `Blob` + `URL.createObjectURL`. Useful for:

- Backup
- Replay on a different device
- Debugging
- Stats analysis in external tools

### Reset

`Reset all` wipes the localStorage key after a confirm prompt, then starts fresh.

---

## 11. Timer

- Starts on `startTimer()` (called after `GameStarted` or on boot if resuming)
- Displays `m:ss` with tabular-nums for stable width
- Ticks every 500ms
- Reads `completedAt - startedAt` if completed, otherwise `Date.now() - startedAt`
- Not persisted — derived from event timestamps on every render

---

## 12. Completion overlay

Shown when `GameCompleted` is applied. Card with:

- Time (from event timestamps)
- Difficulty
- Hints used
- Play again button (starts new game at current difficulty)

Overlay re-shows on page reload if the current game is completed. User dismisses by starting a new game.

---

## 13. File layout

```
index.html
├── <head>
│   ├── meta (charset, viewport, description)
│   ├── <title>Sudoku</title>
│   └── <style>
│       ├── Design tokens (CSS custom properties, light + dark)
│       ├── Reset + base
│       ├── Top bar
│       ├── Board (9×9 grid)
│       ├── Cell states (related, selected, same-value, conflict)
│       ├── Pencil marks
│       ├── Numpad
│       ├── Action bar
│       ├── Status + footer
│       └── Completion overlay
└── <body>
    ├── <main> — UI structure
    ├── Overlay div
    └── <script>
        ├── 1. Persistence (loadEvents, saveEvents, appendEvent)
        ├── 2. Reducer (initialState, cloneGame, applyEvent, replay)
        ├── 3. Puzzle (shuffle, isValidPlacement, fillSolved, generatePuzzle)
        ├── 4. Validation (findConflicts, isGameSolved, remainingForValue)
        ├── 5. Runtime state + dispatch
        ├── 6. Input actions (inputNumber, eraseCell, useHint, undo)
        ├── 7. Rendering (render, renderNumpad)
        ├── 8. Timer (fmt, startTimer, stopTimer)
        ├── 9. Overlay (show/hide)
        ├── 10. Event binding (pointer, keyboard, buttons)
        └── 11. Boot
```

Target: ~900 lines. Readable, heavily commented, no clever abbreviations.

---

## 14. Accepted trade-offs (v1 MVP)

| Trade-off | Reason | Mitigation path |
|-----------|--------|-----------------|
| No puzzle uniqueness check | Solver is fast, uniqueness check doubles generation cost | Add solution-counter; reject puzzles with >1 solution |
| Full replay on every undo | Simpler than maintaining inverse operations | Incremental undo via inverse events only if profiling warrants |
| Pencil-clear-all emits N events | Keeps event vocabulary small | Add `PencilsCleared` event type if log chattiness matters |
| Abandoned games aren't archived | History is about completed plays | Add `GameAbandoned` event if needed for stats |
| No per-cell highlight on error input | The cell already turns pink via conflict detection; extra flash would be noisy | N/A |
| No notes about correct/incorrect values | Always-on correctness check = too easy | Add optional "check my work" toggle in settings |

---

## 15. Non-goals for v1

- Multiplayer / online leaderboards
- Cloud sync
- Accounts
- Puzzle of the day
- Difficulty presets beyond easy/medium/hard
- Accessibility beyond semantic HTML + keyboard support (screen-reader announcements for state changes would be v2)
- Customizable color themes
- Move history viewer / replay animation (data exists, UI doesn't)

---

## 16. v2 extension hooks

The event log makes these cheap to add:

- **Stats dashboard** — fold the log into `{ avgTimeByDifficulty, winRate, hintRate, streak }`
- **Replay mode** — step through a game's events with a slider; visual time-travel for free
- **Log compaction** — snapshot the current state periodically, drop archived events before the snapshot
- **Puzzle-of-the-day** — seed `Math.random()` with today's date; everyone who plays today gets the same puzzle
- **Multiplayer race** — two devices, same seed, compare completion times via event log export/import

Nothing in v1 blocks any of these.