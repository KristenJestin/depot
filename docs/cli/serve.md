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
depot serve [--port <port>]
```

The default port is `4242`.

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
