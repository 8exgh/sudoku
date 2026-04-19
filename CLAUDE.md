# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running and testing

There is no build step, package manager, test runner, or linter. The entire app is `index.html`.

- **Run locally**: open `index.html` directly in a browser (`file://` works — that's a hard requirement, see below), or `python3 -m http.server` and browse to `localhost:8000`.
- **Run in Docker** (matches prod): `docker build -t sudoku . && docker run --rm -p 8080:80 sudoku`. The `Dockerfile` is a 3-line nginx:alpine that copies `index.html` into the web root.
- **Deploy**: pushing to `main` triggers `.github/workflows/build_and_push.yml`, which builds and pushes to `ghcr.io/<owner>/sudoku` (tags `latest` and a timestamp), then POSTs a `repository_dispatch` (`deploy-dad-sudoku`) to a separate `devops` repo that handles the actual rollout. Deploy credentials come from the `DEPLOY_TOKEN` secret.

## Architecture

**`specification.md` is the canonical design document.** Read it before making non-trivial changes — it captures the hard constraints, event schema, reducer rules, UI states, and accepted trade-offs. The rest of this section is orientation, not a replacement.

### Single-file, zero-dependency, offline-capable

One hard constraint drives every tech choice: **the file must run from `file://`**. That means no bundlers, no external CDN scripts, no fonts, no analytics, no sidecar assets, no minification. Readable source is the trust signal. Don't introduce a build step, npm, or external URLs — if you find yourself wanting to, push back on the requirement first.

State persistence uses `localStorage` (not IndexedDB — it's flaky on downloaded files).

### Event-sourced state

State is a **pure fold over an append-only event log** stored at `localStorage` key `sudoku:events:v1`. Nothing else is persisted — current board, timer, history all derive from replaying events.

Four layers, cleanly separated inside `index.html`'s `<script>` block:

1. **Persistence** — `loadEvents`, `saveEvents`, `appendEvent`
2. **Reducer** — `applyEvent(state, event) → state'` is pure; deep-clones before mutating; rejects writes to clue cells and pencil marks on filled cells. No side effects, no cascading events.
3. **Dispatcher** — appends event → applies → checks for completion (emits `GameCompleted` separately) → renders. Side effects live here, never in the reducer.
4. **UI** — render from state, bind pointer/keyboard input.

Event types: `GameStarted`, `CellFilled`, `CellCleared`, `PencilToggled`, `HintUsed`, `GameCompleted`, `ActionUndone`. Undo is implemented by appending `ActionUndone { refSeq }` — the target event stays in the log forever but is filtered during replay. **No event is ever deleted or rewritten.** This is load-bearing for export, stats, and replay features.

The full solution is stored alongside the puzzle inside the `GameStarted` event, so hints always work even if the generator produced a non-unique puzzle (v1 skips the uniqueness check — acknowledged trade-off).

### Code layout inside `index.html`

The `<script>` tag is organized into 11 numbered sections matching `specification.md` §13. Respect that structure when editing — it's the mental map for the file:

```
1. Persistence   2. Reducer      3. Puzzle        4. Validation
5. Runtime/dispatch              6. Input actions 7. Rendering
8. Timer         9. Overlay     10. Event binding 11. Boot
```

Target size is ~900 lines, heavily commented, no clever abbreviations. Prefer clarity over compactness.

### Conflict detection doubles as hint system

`findConflicts` checks all 27 groups (9 rows, 9 cols, 9 boxes) and highlights **both sides** of a violation. There is intentionally no per-cell "wrong answer" flash and no always-on correctness check — the conflict highlight *is* the feedback. If adding validation UI, read spec §14 first.
