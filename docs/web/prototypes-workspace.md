# Prototype workspace (PRD 0025 / T1)

The prototype workspace at `/prds/$id/prototype/$slug` renders an iterative
HTML prototype attached to a PRD revision. The web UI is read-only on every
structural mutation — pages, versions and variants are only created via the
CLI (`depot prd prototype …`) or the chat sub-agent. The only mutating
endpoints in the web API are the feedback ones.

## Iframe shim & CSP

The `/api/prototype-variants/:id/raw` route serves the variant's
self-contained HTML with a small shim injected before `</body>`. The shim:

- intercepts `[data-depot-page]` link clicks and posts `depot:nav { page, variant }` to the parent;
- listens for `depot:set-feedback-mode { mode: "pin" | "off" }` and toggles `body.fb-mode`;
- in pin mode, captures the next click → computes a CSS selector → posts `depot:feedback-pin { selector, x, y }` to the parent.

The CSP is `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-…'; img-src data:; font-src data:`. `style-src 'unsafe-inline'` stays because prototypes are self-contained HTML and routinely inline `<style>` blocks. `script-src` only allows the per-request nonce stamped on the injected shim; inline scripts authored by the prototype itself are blocked by design.

## Anchored pin popup

When the parent receives `depot:feedback-pin`, it opens an anchored popup at
`(x, y)` inside the iframe wrapper (clamped to the wrapper bounds). The popup
exposes the selector in a violet mono badge, an autofocused textarea, and two
buttons. Cmd/Ctrl+Enter submits, Escape cancels. Submission goes through the
existing `POST /api/prototype-variants/:id/feedback` mutation and invalidates
the feedback query.

The popup lives in `src/web/components/prototype-pin-popup.tsx` as a pure
presentational component so it can be tested in isolation (cf.
`tests/web/components/prototype-pin-popup.render.test.tsx`).

## Visual validation

Visual smoke-tested via `agent-browser` on 2026-06-02 with a seeded PRD +
prototype + 2 variants in the dev DB. The reproducer:

```sh
bun run build && bun run build:web
node --env-file-if-exists=.env dist/index.mjs serve --port 4242 &

# In another shell
agent-browser open http://localhost:4242/prds/<id>/prototype/<slug>
agent-browser snapshot -i        # confirms sub-toolbar + iframe + feedback panel
agent-browser click @<feedback-dropdown>  # opens dropdown with "Mode pin"
agent-browser click @<mode-pin>           # banner appears, dropdown shows "(pin)"
agent-browser eval 'window.postMessage({ type: "depot:feedback-pin", selector: "#cta", x: 240, y: 200 }, "*")'
# Popup appears at (240, 200)
agent-browser fill @<popup-textarea> "feedback text"
agent-browser click @<popup-submit>       # "1 open" appears in the feedback panel
```

The five validation screenshots are kept off-tree in `/tmp/depot-impl-0{1..5}-*.png`.
