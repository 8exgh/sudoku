# sudoku

A single-file, zero-dependency sudoku game. The entire app is `index.html` and runs from `file://`.

## Run the app

- **Local**: open `index.html` directly in a browser, or `python3 -m http.server` and visit `http://localhost:8000`.
- **Docker (matches prod)**: `docker build -t sudoku . && docker run --rm -p 8080:80 sudoku`, then visit `http://localhost:8080`.

## Run the tests

Tests run entirely inside a Docker container — no Node, no `npm install`, and no `node_modules/` on the host.

Build the test image once (or after editing `index.html`, `package.json`, or anything in `test/`):

```sh
docker build -f Dockerfile.test -t sudoku-test .
```

Run the full test suite:

```sh
docker run --rm sudoku-test
```

Run a single test by name:

```sh
docker run --rm sudoku-test sh -c 'node --test --test-name-pattern="clue count" test/*.test.js'
```

The test image uses `node:22-alpine` plus `jsdom`, loads `index.html` via jsdom, and calls the in-page functions directly. `index.html` itself is never modified for testing.
