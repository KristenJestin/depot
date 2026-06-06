/**
 * Shim injected before `</body>` by the prototype `/raw` route (PRD 0025 / T1).
 *
 * Three responsibilities, expressed in plain JS so it can run inside the
 * `sandbox="allow-scripts"` iframe (no `allow-same-origin`, so no DOM access
 * to the parent or `document.cookie`):
 *
 *   1. Intercept clicks on `[data-depot-page]` links → postMessage
 *      `depot:nav { page, variant }` to the parent. The parent resolves the
 *      target locally and swaps the iframe `src`.
 *   2. Listen for `depot:set-feedback-mode { mode: 'pin' | 'off' }` from the
 *      parent and toggle `body.fb-mode` accordingly (cursor crosshair +
 *      outline at hover via the embedded CSS below).
 *   3. In `fb-mode`, capture the next click (capture phase, prevent default)
 *      → compute a CSS selector for the clicked element and postMessage
 *      `depot:feedback-pin { selector, x, y }` to the parent.
 *
 * `computeSelector` is intentionally homegrown (no external dep): it walks
 * up the tree until `document.querySelectorAll(...).length === 1` so the
 * selector pinpoints the exact element. Classes are filtered to alphanumeric
 * tokens and capped to two per ancestor so the selector stays human-readable.
 *
 * The shim is plain inline script. The `/raw` route serves it under a CSP that
 * allows `script-src 'unsafe-inline'`, which also lets the prototype's own
 * inline scripts run — the whole point of an interactive preview. The iframe
 * sandbox (no `allow-same-origin`, so an opaque origin with no cookies and no
 * parent-DOM access) is the security boundary; the CSP only keeps the preview
 * self-contained by blocking external network fetches.
 */
function buildShim(): string {
  return `
<style id="depot-shim-style">
  body.fb-mode, body.fb-mode * { cursor: crosshair !important; }
  /*
   * box-shadow is used instead of outline so the box-shadow keyframes
   * interpolate reliably across browsers — animated outline-color is flaky
   * on Chromium and silently no-ops on some Safari versions.
   *
   * Two animations stack on the same element to give the highlight a real
   * sense of life:
   *   - depot-pin-pulse  → opacity breathing on the violet ring
   *   - depot-hatch-shift → diagonal hatch lines scrolling sideways
   * The hatch tile is 11.3137px (8 / sin(45°)) so one shift period brings
   * the pattern back into perfect register with no visible jump.
   */
  @keyframes depot-pin-pulse {
    0%, 100% { box-shadow: 0 0 0 2px oklch(0.65 0.27 288 / 1); }
    50% { box-shadow: 0 0 0 2px oklch(0.65 0.27 288 / 0.4); }
  }
  @keyframes depot-hatch-shift {
    from { background-position: 0 0; }
    to { background-position: 11.3137px 0; }
  }
  body.fb-mode .depot-fb-hover {
    box-shadow: 0 0 0 2px oklch(0.65 0.27 288) !important;
    background-image: repeating-linear-gradient(
      45deg,
      transparent,
      transparent 4px,
      oklch(0.65 0.27 288 / 0.1) 4px,
      oklch(0.65 0.27 288 / 0.1) 8px
    ) !important;
    animation:
      depot-pin-pulse 1.6s ease-in-out infinite,
      depot-hatch-shift 0.9s linear infinite !important;
  }
  /*
   * Navigable links get a distinct info-blue treatment so they never compete
   * visually with the pin-mode violet. Same hatch + pulse vocabulary, swapped
   * hue. Hard-coded oklch triple (the iframe is sandbox-isolated and has no
   * access to the parent stylesheet variables).
   */
  @keyframes depot-nav-pulse {
    0%, 100% { box-shadow: 0 0 0 2px oklch(0.58 0.18 240 / 1); }
    50% { box-shadow: 0 0 0 2px oklch(0.58 0.18 240 / 0.4); }
  }
  body.depot-show-nav [data-depot-page] {
    box-shadow: 0 0 0 2px oklch(0.58 0.18 240) !important;
    background-image: repeating-linear-gradient(
      45deg,
      transparent,
      transparent 4px,
      oklch(0.58 0.18 240 / 0.1) 4px,
      oklch(0.58 0.18 240 / 0.1) 8px
    ) !important;
    animation:
      depot-nav-pulse 1.6s ease-in-out infinite,
      depot-hatch-shift 0.9s linear infinite !important;
    cursor: pointer !important;
  }
  /*
   * Links to a page dropped from the current round. The grey-out is coupled to
   * the nav-highlight mode so the prototype renders faithfully when highlight is
   * off; the click interception (the parent shows a "page removed" notice) is
   * always live, independent of this class. The body.depot-show-nav overrides
   * win over the generic navigable rule above because they are more specific.
   */
  body.depot-show-nav [data-depot-page].depot-dropped-link {
    box-shadow: 0 0 0 2px oklch(0.55 0 0) !important;
    background-image: repeating-linear-gradient(
      45deg,
      transparent,
      transparent 4px,
      oklch(0.55 0 0 / 0.1) 4px,
      oklch(0.55 0 0 / 0.1) 8px
    ) !important;
    animation: none !important;
    opacity: 0.5 !important;
    cursor: not-allowed !important;
  }
  .depot-fb-target {
    box-shadow: 0 0 0 2px oklch(0.65 0.27 288) !important;
  }
</style>
<script type="text/javascript">
(function(){
  var FB_MODE = false;
  var hoverEl = null;

  function tokenize(value) {
    if (!value) return [];
    return String(value).split(/\\s+/).filter(function(c){
      return c && /^[A-Za-z0-9_-]+$/.test(c);
    }).slice(0,2);
  }

  function computeSelector(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) return el.tagName.toLowerCase() + "#" + el.id;
    var path = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && node !== document.body && depth < 6) {
      var tag = node.tagName.toLowerCase();
      var classes = tokenize(node.className);
      var part = tag + (classes.length ? "." + classes.join(".") : "");
      var parent = node.parentNode;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function(s){
          return s.tagName === node.tagName;
        });
        if (siblings.length > 1) {
          var idx = siblings.indexOf(node) + 1;
          part += ":nth-of-type(" + idx + ")";
        }
      }
      path.unshift(part);
      try {
        var candidate = path.join(" > ");
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      } catch (e) {}
      node = node.parentNode;
      depth += 1;
    }
    return path.join(" > ");
  }

  function post(parent, type, payload) {
    try { parent.postMessage(Object.assign({ type: type }, payload), "*"); }
    catch (e) {}
  }

  document.addEventListener("click", function(e){
    var anchor = e.target && e.target.closest ? e.target.closest("[data-depot-page]") : null;
    if (anchor) {
      e.preventDefault();
      e.stopPropagation();
      var dropped = anchor.classList && anchor.classList.contains("depot-dropped-link");
      post(window.parent, dropped ? "depot:nav-dropped" : "depot:nav", {
        page: anchor.getAttribute("data-depot-page"),
        variant: anchor.getAttribute("data-depot-variant") || null
      });
      return;
    }
    if (FB_MODE) {
      e.preventDefault();
      e.stopPropagation();
      var selector = computeSelector(e.target);
      post(window.parent, "depot:feedback-pin", {
        selector: selector,
        x: e.clientX,
        y: e.clientY
      });
    }
  }, true);

  document.addEventListener("mouseover", function(e){
    if (!FB_MODE) return;
    if (hoverEl) hoverEl.classList.remove("depot-fb-hover");
    hoverEl = e.target;
    if (hoverEl && hoverEl.classList) hoverEl.classList.add("depot-fb-hover");
  }, true);

  var highlightedEls = [];

  function clearHighlightTargets() {
    for (var i = 0; i < highlightedEls.length; i += 1) {
      try { highlightedEls[i].classList.remove("depot-fb-target"); }
      catch (e) {}
    }
    highlightedEls = [];
  }

  window.addEventListener("message", function(e){
    var data = e.data || {};
    if (data.type === "depot:set-feedback-mode") {
      FB_MODE = data.mode === "pin";
      if (FB_MODE) document.body.classList.add("fb-mode");
      else document.body.classList.remove("fb-mode");
      if (!FB_MODE && hoverEl) {
        hoverEl.classList.remove("depot-fb-hover");
        hoverEl = null;
      }
      return;
    }
    if (data.type === "depot:highlight-selector" && typeof data.selector === "string") {
      clearHighlightTargets();
      try {
        var nodes = document.querySelectorAll(data.selector);
        for (var i = 0; i < nodes.length; i += 1) {
          nodes[i].classList.add("depot-fb-target");
          highlightedEls.push(nodes[i]);
        }
      } catch (err) {}
      return;
    }
    if (data.type === "depot:clear-highlight") {
      clearHighlightTargets();
      return;
    }
    if (data.type === "depot:set-nav-highlight") {
      if (data.enabled) document.body.classList.add("depot-show-nav");
      else document.body.classList.remove("depot-show-nav");
      return;
    }
    if (data.type === "depot:mark-dropped-pages") {
      var slugs = {};
      if (data.slugs && data.slugs.length) {
        for (var s = 0; s < data.slugs.length; s += 1) slugs[data.slugs[s]] = true;
      }
      var links = document.querySelectorAll("[data-depot-page]");
      for (var i = 0; i < links.length; i += 1) {
        var slug = links[i].getAttribute("data-depot-page");
        if (slug && slugs[slug]) links[i].classList.add("depot-dropped-link");
        else links[i].classList.remove("depot-dropped-link");
      }
      return;
    }
  });
})();
</script>
`;
}

/**
 * Inject the shim immediately before the closing `</body>` tag. When the HTML
 * has no `</body>`, the shim is appended — the resulting markup is still
 * valid (browsers tolerate an implicit body close). The injection is
 * case-insensitive on the closing tag.
 */
export function injectPrototypeShim(html: string): string {
  const shim = buildShim();
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${shim}</body>`);
  }
  return `${html}\n${shim}`;
}
