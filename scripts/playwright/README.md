# Playwright MCP setup for Claude Code

Two MCP servers are registered in this project so Claude can drive a real browser while you watch:

| MCP name | What it does | When to use |
|---|---|---|
| `playwright` | Launches its own headed Chromium with the cursor overlay | Default. Always works. |
| `playwright-cdp` | Attaches to YOUR running Chrome via DevTools Protocol on `localhost:9222` | When you want Claude to drive your own browser (same cookies, same tabs, no re-sign-in) |

Both register the `--init-script` flag pointing at `cursor-overlay.js`, which paints a glowing electric-blue cursor + click ripple + typed-key indicator on every page Claude visits.

## Cursor overlay — what you'll see

- **Glowing blue dot** following the synthetic mouse position.
- **"CLAUDE" label** floating next to the dot.
- **Ripple** at every click point (one-shot, ~620ms).
- **`TAP` / `TYPE: <key>` flash** in the label on click + typed character.
- **Pulse** on scroll so silent scrolls are visible.

No OS cursor moves — Playwright fires synthetic DOM events. The overlay is the only visual indicator of where Claude is "looking."

The overlay is z-index 2147483647, `pointer-events: none`, and `contain: strict`, so it never blocks the page and is hidden from the page's own JS via `window.__claudeCursorOverlay`. If it ever causes a render bug, blow it away with:

```js
document.getElementById("claude-cursor-overlay")?.remove();
window.__claudeCursorOverlay = false;
```

## Using `playwright` (default — own browser)

Just ask Claude to do something browser-y in a fresh session:

> "Navigate to http://localhost:3000/games/party and take a screenshot."

A headed Chromium window pops up on your screen with the cursor overlay active. Move it to a second monitor and watch Claude work.

## Using `playwright-cdp` (attach to your Chrome)

1. Quit your existing Chrome.
2. Relaunch Chrome with the DevTools port open:

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

3. In a fresh Claude session, ask Claude to use the `playwright-cdp` MCP (Claude can target it by tool prefix — tools will be named `mcp__playwright_cdp__*`).
4. Claude drives the existing Chrome — same tabs, same cookies, same logged-in state.

## Switching off the overlay temporarily

Edit `cursor-overlay.js` to early-return at the top (or remove the `--init-script` flag from the MCP registration with `claude mcp remove playwright -s local && claude mcp add playwright -- npx @playwright/mcp@latest`). The script is project-local; it does not affect anything outside `~/Desktop/lionade`.

## Cleaning up the duplicate-scope warning

`claude mcp list` flags that `playwright` is registered at both user scope (the older `@microsoft/playwright-mcp` package) and local scope (this project's `@playwright/mcp` with the overlay). The local one wins for THIS project, so the warning is harmless. If it bothers you:

```bash
claude mcp remove playwright -s user
```

Only do this if you don't use Playwright MCP in other projects (this would remove it everywhere).
