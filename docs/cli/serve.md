# Serve Command

`depot serve` starts the local web server.

## What It Does

The command:

- ensures the depot data directory exists
- starts a Hono server
- mounts the API under `/api`
- serves static frontend assets from `dist/web`
- falls back to `index.html` for app routes

## Usage

```bash
depot serve [--port <port>] [--portless]
```

| Option       | Description                                                             |
| ------------ | ----------------------------------------------------------------------- |
| `--port`     | Port to listen on. Precedence: `--port` › `$PORT` › `4242`.             |
| `--portless` | Also expose the server through `portless` at `https://depot.localhost`. |

The default port is `4242`. When `--port` is omitted, the `PORT` environment
variable is used if set (so the server works when launched through a supervisor
that injects `PORT`, e.g. `portless run`).

## Portless URL

With `--portless`, depot registers a stable portless route so the server is
always reachable at the same URL regardless of its port:

```bash
depot serve --portless
# Depot serving at http://localhost:4242
# Depot also reachable at https://depot.localhost
```

Internally depot runs `portless alias depot <port>` on start and
`portless alias --remove depot` on shutdown (Ctrl+C). The portless proxy must be
running (`portless proxy start`). If `portless` is not installed or the route
cannot be registered, depot prints a warning and keeps serving on
`http://localhost:<port>`.

## API Surface

The server exposes:

- `GET /api/ping`
- `GET /api/context`
- `GET /api/prds`
- `GET /api/prds/:id`

## UI Surface

The frontend provides:

- a PRD list view at `/`
- a PRD detail view at `/prds/:id`

The web UI is currently read-only.

## Important Build Note

`depot serve` expects frontend assets in `dist/web`.

From a source checkout, you will typically need:

```bash
bun run build:web
depot serve
```

`bun run build` builds the CLI bundle and migrations, but not the web assets.
