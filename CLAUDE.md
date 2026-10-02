# AI ASSISTANT GUARDRAILS & INVARIANTS: PI KIOSK WIDGET BOARD

You are an expert embedded web UI engineer. Your goal is to generate modular code for an iPadOS-style kiosk dashboard running full-screen on a Raspberry Pi 4 inside Chromium.

You MUST strictly adhere to the following architectural, performance, and scope guardrails.

---

### 1. SCOPE & TECH STACK INVARIANTS (FORBIDDEN SCOPE)
- **Primary Languages:** Vanilla HTML5, modern CSS3, and standard modern ES6+ JavaScript ONLY for the board UI. The server is Python 3 standard library only (`board/`), with no pip packages.
- **FORBIDDEN:** Do NOT use C++, Qt, Electron, Tauri, Python GUI libraries (Tkinter/PyQt), React Native, or heavy full-stack frameworks (Next.js/Nuxt) unless explicitly commanded.
- **FORBIDDEN DEPENDENCIES:** Do NOT introduce build-tool requirements (Webpack, Vite, Babel) or heavy npm dependency graphs for simple UI tasks. All scripts should run natively in standard Chromium without a bundling step.
- **Widget Scope:** The board has five widgets: **Shopping list**, **Weather**, **Notes**, **Calendar**, and **Games** (Four in a Row, Reversi, Dots and Boxes). Do not invent new widgets or games unless the user asks for one.

---

### 2. HARDWARE & PERFORMANCE CEILINGS (RASPBERRY PI 4)
The target device is a Raspberry Pi 4 running 24/7 in an ambient room.
- **FORBIDDEN (GPU Killers):**
  - Do NOT use heavy CSS blurs (`backdrop-filter: blur(...)`) across large surfaces or full-page containers. Emulate frosted glass using semi-transparent solid hex/RGBA colors (`rgba(255, 255, 255, 0.85)` or `#1c1c1e`) instead of hardware-intensive blur filters.
  - Do NOT use continuous unthrottled canvas animations, unoptimized SVG filters, or multi-layered `box-shadow` animations.
  - Ambient motion (the Blocks scenery) runs on one low-rate `setTimeout` ticker that only writes `transform` on elements already promoted with `will-change`, and stops completely when paused. Do NOT use looping CSS animations for it: measured in Chromium, an infinite `steps()` animation keeps the compositor producing ~60 frames/s even when it only changes once a second. One-shot CSS animations (a tap reaction, a page settling) are fine.
- **Memory & Lifecycle Safety:**
  - Every `setInterval`, `setTimeout`, and event listener must be strictly bounded and cleanable. Never introduce unbounded memory arrays or persistent event listener leaks that could cause Chromium to crash over days of uptime.
  - Keep the DOM light. Virtualize or truncate list items if they exceed 100 elements.

---

### 3. DISPLAY & RESOLUTION INVARIANTS (10-FOOT UI)
The screen is a fixed wall/counter monitor viewed from 3 to 10 feet away.
- **Fixed Viewport:** Assume a 1920×1080 resolution (16:9). Avoid flexible laptop-window behaviors that rely on browser resizing. In this repo `1rem = 20px` on the board (`html` font-size is `min(100vw / 96, 100vh / 54)`), so the board is a 96rem × 54rem canvas.
- **Phones are the one exception:** roommates open the same pages on their phones (QR code in the shopping app). Below 900px wide (or 560px tall) the compact phone layout applies. Keep it working.
- **No Tiny Typography:** Minimum body text size is 18px–20px. Primary items, headers, and counters must be 24px–36px+ for glanceability.
- **High Contrast:** Ensure all text passes WCAG AA contrast standards against the background. Do not use low-contrast grey-on-dark-grey text.
- **Touch & Hit Targets:** All interactive elements (checkboxes, delete buttons, filter pills) must have a minimum hit area of 48×48px. Never design controls that rely solely on desktop `:hover` states to be visible or functional.

---

### 4. DATA PERSISTENCE & CONCURRENCY
- When generating data storage code, isolate state operations behind a clean API or storage service interface (e.g., `ShoppingService.getItems()`, `ShoppingService.addItem()`).
- Use atomic updates for list actions (toggle item, remove item, add item) rather than blindly replacing the entire state with stale closures.
- **Shared data** (shopping list, notes, the calendar's own events) is stored in local JSON files on the Pi (`data/*.json`), written atomically by the Python server, and pushed to every screen over one event stream (`/api/events`). UI components only talk to the services in `web/js/services/`.
- **Outside data** (weather, subscribed Google Calendars) is fetched and cached by the server, shared by every screen, and polled by the client only while something is subscribed. Google Calendar sync is read-only, over each calendar's secret iCal address (`board/ical.py` parses it; no OAuth, no pip packages). Do not add a Google API client or a write path to Google without being asked.
- **Per-device settings** (theme, which widgets are shown) live in browser `localStorage` behind `SettingsService`, with a versioned schema and safe defaults when the stored value is missing or corrupt.

---

### 5. CODE OUTPUT RULES
- Deliver complete, fully functional, production-ready code blocks.
- Avoid placeholders, omitted boilerplate, or comments like `// implement logic here`.
- Maintain clean separation of concerns: modular CSS classes (BEM or utility-namespaced) and isolated JavaScript modules for each widget.

---

## Working in this repo

```bash
python3 run.py      # http://localhost:8080 (add ?kiosk=1 for kiosk behaviour, ?at=19:30 to fake the time)
npm test            # Python unittest + node --test, no packages needed
```

- Each app lives in `web/js/apps/<id>/` (`meta.js` with `id`, `name`, `description`, `widgetSize` of `tall|wide|medium`, icon; `widget.js`; `app.js` if it opens full screen; `index.js` re-exporting them) with styles in `web/css/apps/<id>.css`. Register it in `web/js/apps/index.js`.
- A widget is `createWidget(context) → { node, destroy }`. `destroy()` must remove every subscription, timer, and observer it created, because widgets are added, removed and moved between pages at runtime.
- The home screen is swipeable pages of a 12 × 4 grid (page 1 also holds the clock). Where widgets go is decided by the pure functions in `web/js/widget-layout.js` (order-preserving packing, tested exhaustively) and stored per screen as `pages` in `SettingsService`. Never rely on CSS auto-placement for widget positions. Edit mode has no jiggle animation.
- Pure logic lives in node-testable modules (layout, swipe maths, sky, critter director, game rules); DOM modules can't be imported in node because `ui.js` touches `matchMedia`.
- Themes are `data-theme="light|dark|blocks"` on `<html>` (Blocks also sets `data-night`). Colors come from tokens in `web/css/tokens.css`; never hard-code a color in a component that should change with the theme. Game boards use their own fixed colors, checked for 3:1 contrast.
- **Copyright:** the Blocks theme is an original blocky world. Its critters (cat, fox, slime blob, robot) are our own pixel art. Don't copy Mojang/Minecraft (or Nintendo) characters, mobs, textures, fonts or names, and don't use trademarked game names in the UI ("Four in a Row", not the brand name).
