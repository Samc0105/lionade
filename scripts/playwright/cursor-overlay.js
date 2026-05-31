// Cursor overlay for the Playwright MCP — a faux pointer + click ripple + key
// indicator that runs on every page load so the human watching the browser can
// see EXACTLY what Claude is doing.
//
// Wired into the Playwright MCP via `--init-script <this-file>`. The script
// runs in the page context BEFORE the page's own scripts, so it survives SPA
// navigations and re-runs on every fresh document.
//
// Synthetic Playwright events fire real DOM mousemove/mousedown/keydown, so a
// listener can track and visualize them. The OS cursor never moves; this
// overlay is the only visual indicator of where Claude is "looking."

(function () {
  if (window.__claudeCursorOverlay) return;
  window.__claudeCursorOverlay = true;

  function install() {
    if (!document.documentElement) return;

    // ── Container — fixed full-viewport, no pointer-events so it never blocks clicks
    const overlay = document.createElement("div");
    overlay.id = "claude-cursor-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:2147483647;contain:strict;";

    // ── The cursor itself — electric-blue glowing dot
    const cursor = document.createElement("div");
    cursor.style.cssText = `
      position:absolute;
      left:-100px;
      top:-100px;
      width:18px;
      height:18px;
      border-radius:50%;
      background:radial-gradient(circle, rgba(0,191,255,0.85) 0%, rgba(0,191,255,0.2) 70%, transparent 100%);
      border:1.5px solid #00BFFF;
      box-shadow:0 0 12px #00BFFF, 0 0 24px rgba(0,191,255,0.55), 0 0 48px rgba(0,191,255,0.25);
      transform:translate(-50%,-50%);
      transition:left 80ms linear, top 80ms linear;
      will-change:left, top;
    `;

    // ── Label — small "CLAUDE" tag floating next to the cursor; flips to typed key
    const label = document.createElement("div");
    label.style.cssText = `
      position:absolute;
      left:-100px;
      top:-100px;
      padding:3px 8px;
      border-radius:8px;
      background:rgba(0,0,0,0.85);
      color:#00BFFF;
      font:600 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      letter-spacing:0.06em;
      text-transform:uppercase;
      pointer-events:none;
      transform:translate(14px,-50%);
      white-space:nowrap;
      transition:left 80ms linear, top 80ms linear, opacity 200ms;
      opacity:0.9;
      border:1px solid rgba(0,191,255,0.45);
    `;
    label.textContent = "CLAUDE";

    overlay.appendChild(cursor);
    overlay.appendChild(label);
    document.documentElement.appendChild(overlay);

    // ── Ripple keyframe (one-shot per click)
    if (!document.getElementById("claude-cursor-style")) {
      const style = document.createElement("style");
      style.id = "claude-cursor-style";
      style.textContent = `
        @keyframes claudeRipple {
          from { width:8px; height:8px; opacity:1; border-width:2px; }
          to   { width:96px; height:96px; opacity:0; border-width:1px; }
        }
        @keyframes claudeKeyBump {
          from { transform: translate(14px, -50%) scale(1); }
          50%  { transform: translate(14px, -50%) scale(1.15); }
          to   { transform: translate(14px, -50%) scale(1); }
        }
      `;
      document.head.appendChild(style);
    }

    // ── Follow synthetic mouse moves
    let lastX = 0;
    let lastY = 0;
    function moveTo(x, y) {
      lastX = x;
      lastY = y;
      cursor.style.left = x + "px";
      cursor.style.top = y + "px";
      label.style.left = x + "px";
      label.style.top = y + "px";
    }
    document.addEventListener(
      "mousemove",
      function (e) {
        moveTo(e.clientX, e.clientY);
      },
      true,
    );

    // ── Ripple on click — visible "tap" mark wherever Claude clicked
    document.addEventListener(
      "mousedown",
      function (e) {
        const ripple = document.createElement("div");
        ripple.style.cssText = `
          position:absolute;
          left:${e.clientX}px;
          top:${e.clientY}px;
          width:8px;
          height:8px;
          border-radius:50%;
          background:transparent;
          border:2px solid #00BFFF;
          transform:translate(-50%,-50%);
          animation:claudeRipple 620ms ease-out forwards;
          pointer-events:none;
          box-shadow:0 0 10px rgba(0,191,255,0.65);
        `;
        overlay.appendChild(ripple);
        setTimeout(function () {
          ripple.remove();
        }, 700);
        // Snap label to "TAP"
        label.textContent = "TAP";
        label.style.animation = "claudeKeyBump 360ms ease-out";
        clearTimeout(window.__claudeLabelTimer);
        window.__claudeLabelTimer = setTimeout(function () {
          label.textContent = "CLAUDE";
          label.style.animation = "";
        }, 700);
      },
      true,
    );

    // ── Typed-key indicator — flash the typed character in the label
    document.addEventListener(
      "keydown",
      function (e) {
        const key = e.key.length === 1 ? e.key : e.key.toUpperCase();
        label.textContent = "TYPE: " + key;
        label.style.animation = "claudeKeyBump 240ms ease-out";
        clearTimeout(window.__claudeLabelTimer);
        window.__claudeLabelTimer = setTimeout(function () {
          label.textContent = "CLAUDE";
          label.style.animation = "";
        }, 900);
      },
      true,
    );

    // ── Scroll indicator — briefly show a vertical bar so even silent
    //    scrolls are visible
    let scrollTimer = null;
    window.addEventListener(
      "scroll",
      function () {
        cursor.style.boxShadow =
          "0 0 18px #00BFFF, 0 0 36px rgba(0,191,255,0.75), 0 0 64px rgba(0,191,255,0.35)";
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(function () {
          cursor.style.boxShadow =
            "0 0 12px #00BFFF, 0 0 24px rgba(0,191,255,0.55), 0 0 48px rgba(0,191,255,0.25)";
        }, 250);
      },
      { passive: true, capture: true },
    );
  }

  if (document.documentElement) {
    install();
  } else {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  }
})();
