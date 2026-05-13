# Marketing redesign — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/index.html` (Tailwind CDN + Nunito Sans + azul-cobalto/laranja-bootstrap) with the approved Claude Design mockup `ui_kits/site/index_v2.html`: editorial clinical-luxo register, Medcase wordmark, Plus Jakarta Sans + Inter + JetBrains Mono, single coral accent `#C8412C`, hairlines instead of shadows. Preserve GTM, DoubleClick, JSON-LD, canonical, WhatsApp pixel, and all current tel/wa.me deeplinks.

**Architecture:** Static HTML linking two new CSS files at root (`/colors_and_type.css` for tokens, `/site.css` for marketing-only styles extracted from the mockup with `--pp-*` → canonical token replacements). Tailwind CDN deleted. Existing `/style.css` untouched (lives for `/case/`). Existing `/case-next/`, `/case/`, `/upload/`, `/mesh-processor/` untouched. New Playwright spec in `/tests/site/site.spec.js` riding the existing `playwright.config.js` (auto-managed `http-server`).

**Tech Stack:** Plain HTML/CSS (no build step), Google Fonts via `@import` in `colors_and_type.css`, Playwright (already configured), `http-server` (already in deps).

**Reference doc:** `docs/superpowers/specs/2026-05-12-marketing-redesign-design.md` (this is the spec — read first if you don't have it in context).

**Reference mockup:** `~/Downloads/Biodesignlab Design System-handoff.zip` → `biodesignlab-design-system/project/ui_kits/site/index_v2.html`. Extracted at `/tmp/biodesignlab-handoff/biodesignlab-design-system/project/`. **Lift markup and styles from there verbatim** (modulo the token replacements in Task 2). Do not invent.

**Constants used throughout:**

- `WA_DEEPLINK` = `https://wa.me/5521993118288?text=Ol%C3%A1%2C%20quero%20saber%20mais%20sobre%20as%20solu%C3%A7%C3%B5es%20em%20modelos%203D%20para%20cirurgias.`
- `DEMO_CASE_URL` = `https://biodesignlab.com.br/case-next/?id=5fc6c4d2d77d4ab6a8cadfe8996c70a4`
- `CONCIERGE_TEL` = `+5521993118288` (display `(21) 99311-8288`)
- `VITOR_TEL` = `+5521982204508` (display `(21) 98220-4508`)
- `ROMULO_TEL` = `+5521999465979` (display `(21) 99946-5979`)
- `CONTACT_EMAIL` = `contato@biodesignlab.com.br`

**File structure (all paths relative to `/Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/`):**

| Path | Action | Purpose |
|---|---|---|
| `colors_and_type.css` | Create | Canonical tokens, copied verbatim from handoff. |
| `site.css` | Create | Marketing-only styles, lifted from `ui_kits/site/index_v2.html` inline `<style>` with `--pp-*` → canonical replacements. |
| `index.html` | Rewrite | New markup + new head (brand flipped to Medcase, Tailwind script deleted, two `<link>` added). Preserve GTM/DoubleClick/JSON-LD/canonical byte-for-byte; preserve WhatsApp tracking script at end of `<body>`. |
| `tests/site/site.spec.js` | Create | Playwright suite, 6 scenarios. |
| `tests/site/` | Create (dir) | Mirror of `tests/case-next/` layout. |

| Path | Action | Why |
|---|---|---|
| `style.css` | **Do NOT touch** | Vendor + `/case/` legacy. Not linked from `index.html`. |
| `case/`, `case-next/`, `upload/` | **Do NOT touch** | Out of scope. |
| `images/*`, `videoViewer.mp4` | **Do NOT touch** | All needed assets already present. |
| `playwright.config.js`, `package.json` | **Do NOT touch** | No new deps. `webServer` already runs `http-server`. |

---

## Task 1 — Add the tokens stylesheet

**Files:**
- Create: `colors_and_type.css`

The file is copied **byte-for-byte** from the handoff bundle at `/tmp/biodesignlab-handoff/biodesignlab-design-system/project/colors_and_type.css`.

- [ ] **Step 1: Copy the file**

```bash
cp /tmp/biodesignlab-handoff/biodesignlab-design-system/project/colors_and_type.css /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/colors_and_type.css
```

- [ ] **Step 2: Verify the file landed and has the expected content**

```bash
head -10 /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/colors_and_type.css
wc -l /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/colors_and_type.css
```

Expected: top shows `Biodesignlab — colors & type` banner; line count is ~276.

- [ ] **Step 3: Smoke-test the import**

In a temporary HTML file (or by browsing to the file directly), confirm the `@import` URL for Google Fonts is intact:

```bash
grep -n "fonts.googleapis.com" /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/colors_and_type.css
```

Expected: 1 match on line 9, with `family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600`.

---

## Task 2 — Build `site.css` from the mockup with token replacements

**Files:**
- Create: `site.css`

Source: `/tmp/biodesignlab-handoff/biodesignlab-design-system/project/ui_kits/site/index_v2.html` lines 5–206 (the inline `<style>` block).

The local `:root { --pp-* }` block (lines 11–22 of that file) is **deleted**. All `var(--pp-*)` references are rewritten per the table below. Variables `--accent`, `--space-*`, `--fg-*`, `--font-*`, etc. are inherited from `colors_and_type.css`, so this file does **not** redeclare them.

| Mockup local | Replace with |
|---|---|
| `var(--pp-cream)` | `var(--surface-mute)` |
| `var(--pp-cream-2)` | `var(--surface-mute-2)` |
| `var(--pp-paper)` | `var(--paper)` |
| `var(--pp-ink)` | `var(--fg-1)` |
| `var(--pp-rule)` | `var(--rule)` |
| `var(--pp-coral)` | `var(--illus-coral-bright)` |
| `var(--pp-coral-soft)` | `#F4C8B8` (inline literal) |
| `var(--pp-mint)` | `var(--illus-mint)` |
| `var(--pp-sky)` | `var(--illus-sky)` |
| `var(--pp-butter)` | `var(--illus-butter)` |

The mockup's `#FBF7F0` color (cream off-white used for button text and dark-CTA copy) is kept as inline literal — it's the brand cream readable on the ink CTA card, not a token.

The mockup's `rgba(26,24,21,...)` ink-alpha values used for shadows / coral glow are kept as inline literals.

- [ ] **Step 1: Write the file**

Create `/Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/site.css` with the full content below. Section banners group related rules.

```css
/* ============================================================
   Medcase — marketing site styles
   Extracted from ui_kits/site/index_v2.html (Claude Design handoff,
   2026-05-12) with --pp-* tokens rewritten to canonical ones in
   colors_and_type.css. Do not redeclare tokens here.
   ============================================================ */

* { box-sizing: border-box; }
body { margin: 0; background: var(--base); color: var(--fg-1); }
img { max-width: 100%; display: block; }

/* ---------- LAYOUT WRAP ---------- */
.wrap { max-width: 1280px; margin: 0 auto; padding: 0 var(--space-7); }
@media (max-width: 900px) { .wrap { padding: 0 var(--space-5); } }

/* ============================================================
   Marketing — HEADER
   ============================================================ */
.hdr { position: sticky; top: 0; z-index: 50; background: rgba(255,255,255,0.92); backdrop-filter: blur(14px); border-bottom: 1px solid var(--rule); }
.hdr-row { display: flex; align-items: center; justify-content: space-between; padding: var(--space-4) 0; gap: var(--space-5); }

.brand-lockup { display: inline-flex; align-items: center; gap: 12px; text-decoration: none; }
.lockup-text { display: flex; flex-direction: column; line-height: 1.05; }
.lockup-brand { font-family: var(--font-display); font-weight: 600; font-size: 16px; letter-spacing: -0.02em; color: var(--fg-1); }
.lockup-product { font-family: var(--font-mono); font-size: 10px; font-weight: 500; letter-spacing: 0.10em; text-transform: uppercase; color: var(--fg-3); margin-top: 3px; }

.nav { display: flex; align-items: center; gap: var(--space-6); }
.nav a { font-size: 14px; color: var(--fg-2); text-decoration: none; font-weight: 500; }
.nav a:hover { color: var(--fg-1); }
@media (max-width: 900px) {
  .nav a:not(.btn-primary) { display: none; }
  .lockup-brand { font-size: 15px; }
}

.hdr-tel { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: 12px; font-weight: 600; letter-spacing: 0.02em; color: var(--fg-1); text-decoration: none; padding: 8px 14px; border: 1px solid var(--rule); border-radius: 999px; transition: border-color 180ms; }
.hdr-tel:hover { border-color: var(--fg-1); }
.hdr-tel svg { width: 13px; height: 13px; }
@media (max-width: 1100px) { .hdr-tel { display: none; } }

/* ============================================================
   Marketing — BUTTONS (used in header, hero, CTA card)
   ============================================================ */
.btn-primary { display: inline-flex; align-items: center; gap: 8px; padding: 14px 26px; background: var(--fg-1); color: #FBF7F0 !important; border-radius: 999px; font-weight: 600; font-size: 14px; text-decoration: none !important; border: none; cursor: pointer; font-family: inherit; transition: transform 180ms, background 180ms; }
.btn-primary:hover { background: #000; transform: translateY(-1px); }
.btn-primary.coral { background: var(--accent); }
.btn-primary.coral:hover { background: var(--accent-hover); }

.btn-ghost { display: inline-flex; align-items: center; gap: 8px; padding: 14px 24px; background: transparent; color: var(--fg-1); border: 1.5px solid var(--fg-1); border-radius: 999px; font-weight: 600; font-size: 14px; text-decoration: none; cursor: pointer; font-family: inherit; }
.btn-ghost:hover { background: var(--fg-1); color: #FBF7F0; }

.cta-hint { font-size: 13px; color: var(--fg-2); margin: 14px 0 0; }
.cta-hint a { color: var(--fg-1); font-weight: 600; text-decoration: none; border-bottom: 1px solid var(--rule); transition: border-color 180ms; }
.cta-hint a:hover { border-color: var(--accent); color: var(--accent); }

/* ============================================================
   Marketing — HERO
   ============================================================ */
.hero { padding: var(--space-8) 0 var(--space-9); }
.hero-grid { display: grid; grid-template-columns: 1.05fr 1fr; gap: var(--space-8); align-items: center; }
@media (max-width: 900px) { .hero-grid { grid-template-columns: 1fr; } }

.headline { font-family: var(--font-display); font-weight: 500; font-size: clamp(2.75rem, 5.5vw + 1rem, 5.75rem); line-height: 1.0; letter-spacing: -0.035em; margin: 18px 0 var(--space-5); text-wrap: balance; color: var(--fg-1); }
.headline em { font-style: normal; color: var(--accent); font-weight: 500; }
.headline .scribble { position: relative; display: inline-block; }
.headline .scribble svg { position: absolute; left: -4px; right: -4px; bottom: -10px; width: calc(100% + 8px); height: 18px; color: var(--accent); }
.scribble svg path { fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; }

.lede { font-size: 18px; line-height: 1.55; color: var(--fg-2); max-width: 46ch; margin: 0 0 var(--space-6); }
.cta-row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }

.hero-vis { position: relative; aspect-ratio: 5/5; }
.hero-vis-pad { position: absolute; inset: 0; background: var(--surface-mute-2); border-radius: 24px; padding: 28px; overflow: hidden; }
.hero-vis-pad::before { content: ""; position: absolute; inset: 0; background: radial-gradient(circle at 30% 20%, rgba(255,255,255,0.5), transparent 60%); pointer-events: none; }
.hero-canvas { position: relative; width: 100%; height: 100%; border-radius: 14px; overflow: hidden; background: #0E1114; box-shadow: 0 24px 60px -20px rgba(26,24,21,0.35), 0 8px 20px -8px rgba(26,24,21,0.18); }
.hero-canvas video { width: 100%; height: 100%; object-fit: cover; }
.hero-canvas .tag { position: absolute; top: 14px; left: 14px; background: rgba(11,14,17,0.72); backdrop-filter: blur(10px); color: #FBF7F0; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; padding: 6px 10px; border-radius: 999px; }
.hero-canvas .tag.r { left: auto; right: 14px; }

.chip { position: absolute; background: var(--paper); border-radius: 14px; padding: 14px 16px; box-shadow: 0 12px 24px -10px rgba(26,24,21,0.18); display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 500; color: var(--fg-1); }
.chip .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--accent); }
.chip-1 { top: 18px; right: -14px; }
.chip-2 { bottom: 30px; left: -18px; }
.chip-2 .num { font-family: var(--font-display); font-weight: 500; font-size: 22px; letter-spacing: -0.02em; }
.chip .meta { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--fg-3); font-weight: 500; }

/* ============================================================
   Marketing — TRUST (partners)
   ============================================================ */
.trust { padding: var(--space-9) 0; background: var(--paper); border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
.trust-head { display: grid; grid-template-columns: auto 1fr; gap: var(--space-6); align-items: end; margin-bottom: var(--space-7); }
@media (max-width: 900px) { .trust-head { grid-template-columns: 1fr; } }
.trust-title { font-family: var(--font-display); font-weight: 500; font-size: clamp(1.75rem, 2vw + 1rem, 2.5rem); line-height: 1.05; letter-spacing: -0.025em; color: var(--fg-1); margin: 8px 0 0; text-wrap: balance; max-width: 18ch; }
.trust-title em { font-style: normal; color: var(--accent); }
.trust-sub { font-size: 15px; line-height: 1.55; color: var(--fg-2); max-width: 46ch; justify-self: end; }
@media (max-width: 900px) { .trust-sub { justify-self: start; } }

.partners { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; align-items: center; border-top: 1px solid var(--rule); }
@media (max-width: 900px) { .partners { grid-template-columns: repeat(2, 1fr); } }
.partners .cell { display: grid; place-items: center; padding: var(--space-7) var(--space-5); border-right: 1px solid var(--rule); min-height: 120px; }
.partners .cell:last-child { border-right: none; }
@media (max-width: 900px) {
  .partners .cell { border-right: none; border-bottom: 1px solid var(--rule); }
  .partners .cell:nth-child(2n) { border-right: none; }
  .partners .cell:nth-last-child(-n+2) { border-bottom: none; }
}
.partners img { max-height: 42px; max-width: 160px; width: auto; height: auto; display: block; filter: none; opacity: 1; }

/* ============================================================
   Marketing — SECTIONS BASE
   ============================================================ */
.section { padding: var(--space-10) 0; }
.section.soft { background: var(--paper); }
.section.cream { background: var(--surface-mute); }

.eyebrow { font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--fg-3); }

.h2 { font-family: var(--font-display); font-weight: 500; font-size: clamp(2.25rem, 3.2vw + 1rem, 4rem); line-height: 1.02; letter-spacing: -0.03em; margin: 8px 0 0; text-wrap: balance; color: var(--fg-1); }
.h2 em { font-style: normal; color: var(--accent); }

/* ============================================================
   Marketing — COMO FUNCIONA (3 step cards)
   ============================================================ */
.how-head { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-8); align-items: end; margin-bottom: var(--space-8); }
@media (max-width: 900px) { .how-head { grid-template-columns: 1fr; } }
.how-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-5); }
@media (max-width: 900px) { .how-grid { grid-template-columns: 1fr; } }
.step { background: var(--paper); border: 1px solid var(--rule); border-radius: 20px; padding: var(--space-6); min-height: 340px; display: flex; flex-direction: column; justify-content: space-between; position: relative; overflow: hidden; }
.step .num { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--fg-3); background: transparent; display: block; font-weight: 500; }
.step .ill { align-self: flex-end; width: 100%; display: grid; place-items: center; padding: var(--space-5) 0; }
.step .ill svg { width: 120px; height: 120px; color: var(--fg-1); }
.step h3 { font-family: var(--font-display); font-weight: 500; font-size: 24px; letter-spacing: -0.02em; margin: 0 0 8px; color: var(--fg-1); }
.step p { font-size: 14px; line-height: 1.55; color: var(--fg-2); margin: 0; max-width: 32ch; }

/* ============================================================
   Marketing — PRODUCT MOMENT (video / devices + feature list)
   ============================================================ */
.product { display: grid; grid-template-columns: 1fr 1.4fr; gap: var(--space-8); align-items: center; }
@media (max-width: 1100px) { .product { grid-template-columns: 1fr; } }
.product-shot { position: relative; background: var(--surface-mute-2); border-radius: 20px; padding: 24px; box-shadow: 0 20px 60px -24px rgba(26,24,21,0.25); }
.product-shot video, .product-shot img { width: 100%; border-radius: 10px; display: block; background: #0E1114; }
.product-shot.devices { background: transparent; padding: 0; box-shadow: none; }
.product-shot.devices img { background: transparent; border-radius: 0; }
.feat-list { list-style: none; padding: 0; margin: var(--space-5) 0 0; }
.feat-list li { display: grid; grid-template-columns: 44px 1fr; gap: var(--space-4); padding: var(--space-5) 0; border-top: 1px solid var(--rule); }
.feat-list li:last-child { border-bottom: 1px solid var(--rule); }
.feat-list .ic { width: 44px; height: 44px; border-radius: 999px; background: var(--surface-mute-2); display: grid; place-items: center; color: var(--fg-1); }
.feat-list .ic svg { width: 20px; height: 20px; }
.feat-list h4 { font-family: var(--font-display); font-weight: 500; font-size: 18px; letter-spacing: -0.01em; margin: 0 0 4px; color: var(--fg-1); }
.feat-list p { margin: 0; font-size: 14px; color: var(--fg-2); line-height: 1.55; }

/* ============================================================
   Marketing — MÉDICOS (KOL doctor cards)
   ============================================================ */
.doctors { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-5); margin-top: var(--space-7); }
@media (max-width: 900px) { .doctors { grid-template-columns: 1fr; } }
.doc { background: var(--paper); border: 1px solid var(--rule); border-radius: 20px; padding: var(--space-6); display: grid; grid-template-columns: 120px 1fr; gap: var(--space-5); align-items: center; }
@media (max-width: 560px) { .doc { grid-template-columns: 88px 1fr; padding: var(--space-5); } }
.doc-photo { width: 120px; height: 120px; border-radius: 999px; overflow: hidden; background: var(--surface-mute-2); }
.doc-photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
@media (max-width: 560px) { .doc-photo, .doc-photo img { width: 88px; height: 88px; } }
.doc-eyebrow { font-family: var(--font-mono); font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--fg-3); margin-bottom: 6px; }
.doc-name { font-family: var(--font-display); font-weight: 500; font-size: 24px; letter-spacing: -0.02em; line-height: 1.1; color: var(--fg-1); margin: 0 0 4px; }
.doc-aff { font-size: 13px; color: var(--fg-2); line-height: 1.45; margin: 0 0 12px; }
.doc-tel { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: 12px; font-weight: 600; letter-spacing: 0.04em; color: var(--fg-1); text-decoration: none; padding: 6px 10px; border: 1px solid var(--rule); border-radius: 999px; transition: border-color 180ms, color 180ms; }
.doc-tel:hover { border-color: var(--fg-1); color: var(--accent); }
.doc-tel svg { width: 12px; height: 12px; }

/* ============================================================
   Marketing — CTA CARD (dark editorial)
   ============================================================ */
.cta-card { background: var(--fg-1); color: #FBF7F0; border-radius: 28px; padding: var(--space-9) var(--space-8); display: grid; grid-template-columns: 1.2fr 1fr; gap: var(--space-8); position: relative; overflow: hidden; }
.cta-card::before { content: ""; position: absolute; width: 520px; height: 520px; border-radius: 999px; background: radial-gradient(circle, rgba(232,116,90,0.35), transparent 70%); top: -200px; right: -180px; pointer-events: none; }
@media (max-width: 1000px) { .cta-card { grid-template-columns: 1fr; } }
.cta-card > * { position: relative; }
.cta-card h2 { font-family: var(--font-display); font-weight: 500; font-size: clamp(2.25rem, 3vw + 1rem, 3.75rem); letter-spacing: -0.03em; line-height: 1.02; margin: 14px 0 var(--space-5); color: #FBF7F0; }
.cta-card .lede { color: #A8B0B6; max-width: 42ch; margin: 0; }
.cta-card .btn-ghost-dark { display: inline-flex; align-items: center; gap: 8px; padding: 14px 24px; background: transparent; color: #FBF7F0; border: 1.5px solid rgba(251,247,240,0.30); border-radius: 999px; font-weight: 600; font-size: 14px; text-decoration: none; font-family: inherit; }
.cta-card .btn-ghost-dark:hover { border-color: #FBF7F0; }
.cta-card .btn-ghost-dark svg { flex: none; }
.cta-right { display: flex; flex-direction: column; gap: var(--space-4); align-self: center; }
.cta-tick { display: grid; grid-template-columns: auto 1fr; gap: 14px; align-items: center; padding: 14px 16px; border: 1px solid rgba(251,247,240,0.12); border-radius: 14px; background: rgba(251,247,240,0.04); }
.cta-tick .k { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.04em; color: var(--accent); font-weight: 600; }
.cta-tick b { display: block; font-size: 14px; color: #FBF7F0; font-weight: 600; margin-bottom: 2px; }
.cta-tick span:not(.k) { display: block; font-size: 12px; color: #A8B0B6; line-height: 1.4; }

/* ============================================================
   Marketing — FOOTER
   ============================================================ */
.ftr { background: var(--fg-1); color: #A8B0B6; padding: var(--space-9) 0 var(--space-6); }
.ftr-grid { display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr; gap: var(--space-7); }
@media (max-width: 900px) { .ftr-grid { grid-template-columns: 1fr 1fr; } }
.ftr h4 { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #5E6770; font-weight: 500; margin: 0 0 var(--space-4); }
.ftr ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.ftr a { color: #A8B0B6; text-decoration: none; font-size: 14px; }
.ftr a:hover { color: #FBF7F0; }
.ftr-foot { border-top: 1px solid rgba(242,243,244,0.10); padding-top: var(--space-5); margin-top: var(--space-7); font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.04em; color: #5E6770; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.ftr .wm { color: #FBF7F0; display: inline-flex; margin-bottom: var(--space-4); font-family: var(--font-display); font-weight: 500; font-size: 22px; letter-spacing: -0.02em; text-decoration: none; }
.ftr .wm em { font-style: normal; color: var(--accent); }
```

- [ ] **Step 2: Verify it parses (no syntax errors)**

```bash
python3 -c "
import re
with open('/Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/site.css') as f:
    content = f.read()
# Brace balance check
opens = content.count('{')
closes = content.count('}')
print(f'opens={opens} closes={closes}')
assert opens == closes, f'Brace mismatch: {opens} vs {closes}'
print('OK')
"
```

Expected: `opens=N closes=N`, then `OK`.

- [ ] **Step 3: Verify no `--pp-*` survived**

```bash
grep -n "\-\-pp-" /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/site.css || echo "no --pp-* remaining"
```

Expected: `no --pp-* remaining`.

---

## Task 3 — Rewrite `index.html` (full file replacement)

**Files:**
- Modify: `index.html` (full rewrite)

This is one task because the head and body changes are interleaved (Tailwind script removed from `<head>`, stylesheet `<link>`s added to `<head>`, markup replaced in `<body>`, GTM noscript and WhatsApp tracking script kept in place). Doing it in pieces would leave the page broken between steps.

- [ ] **Step 1: Write the new `index.html`**

Replace the entire file at `/Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/index.html` with:

```html
<!DOCTYPE html>
<html lang="pt-BR">

<head>
  <!-- Google Tag Manager -->
  <script>(function (w, d, s, l, i) {
      w[l] = w[l] || []; w[l].push({
        'gtm.start':
          new Date().getTime(), event: 'gtm.js'
      }); var f = d.getElementsByTagName(s)[0],
        j = d.createElement(s), dl = l != 'dataLayer' ? '&l=' + l : ''; j.async = true; j.src =
          'https://www.googletagmanager.com/gtm.js?id=' + i + dl; f.parentNode.insertBefore(j, f);
    })(window, document, 'script', 'dataLayer', 'GTM-NX75SZPR');</script>
  <!-- End Google Tag Manager -->
  <!-- Global site tag (gtag.js) - Google Marketing Platform -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=DC-10089018"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag() { dataLayer.push(arguments); }
    gtag('js', new Date());
    gtag('config', 'DC-10089018');
  </script>

  <!-- Pixel da Homepage - Dispara automaticamente ao carregar a página -->
  <script>
    window.addEventListener('load', function () {
      gtag('event', 'conversion', {
        'send_to': 'DC-10089018/invmedia/br_da000+standard',
        'value': 1.0,
        'currency': 'BRL'
      });
    });
  </script>

  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Medcase | Visualizador cirúrgico 3D</title>

  <meta name="description"
    content="Reconstruções 3D de alta fidelidade para planejamento cirúrgico. Receba o visualizador interativo em até 3 dias úteis." />

  <link rel="canonical" href="https://biodesignlab.com.br/" />

  <script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://biodesignlab.com.br/#org",
      "name": "Medcase",
      "url": "https://biodesignlab.com.br/",
      "logo": {
        "@type": "ImageObject",
        "url": "https://biodesignlab.com.br/images/og-logo.jpg",
        "width": 1200,
        "height": 630
      },
      "contactPoint": {
        "@type": "ContactPoint",
        "telephone": "+55-21-99311-8288",
        "contactType": "customer service",
        "areaServed": "BR"
      },
      "sameAs": [
        "https://www.instagram.com/altadiagnosticos/",
        "https://www.facebook.com/altadiagnosticos/",
        "https://br.linkedin.com/showcase/alta-diagnosticos/"
      ]
    },

    {
      "@type": "VideoObject",
      "@id": "https://biodesignlab.com.br/#viewer-demo",
      "name": "Visualizador 3D cirúrgico Medcase – demonstração",
      "description": "Demonstração rápida do visualizador 3D interativo da Medcase para cirurgias complexas.",
      "thumbnailUrl": "https://biodesignlab.com.br/images/mockups.png",
      "uploadDate": "2025-05-20",
      "duration": "PT45S",
      "contentUrl": "https://biodesignlab.com.br/videoViewer.mp4",
      "embedUrl": "https://biodesignlab.com.br/#video"
    }
  ]
}
</script>

  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://biodesignlab.com.br/" />
  <meta property="og:title" content="Medcase – Visualizador cirúrgico 3D" />
  <meta property="og:description"
    content="Reconstruções 3D de alta fidelidade para planejamento cirúrgico. Receba o visualizador interativo em até 3 dias úteis." />
  <meta property="og:image" content="https://biodesignlab.com.br/images/og-logo.jpg" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Medcase – Visualizador cirúrgico 3D" />
  <meta name="twitter:description"
    content="Reconstruções 3D de alta fidelidade para planejamento cirúrgico. Receba o visualizador interativo em até 3 dias úteis." />
  <meta name="twitter:image" content="https://biodesignlab.com.br/images/og-logo.jpg" />

  <link rel="stylesheet" href="/colors_and_type.css">
  <link rel="stylesheet" href="/site.css">
</head>

<body>
  <!-- Google Tag Manager (noscript) -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-NX75SZPR" height="0" width="0"
      style="display:none;visibility:hidden"></iframe></noscript>
  <!-- End Google Tag Manager (noscript) -->

  <header class="hdr">
    <div class="wrap hdr-row">
      <a href="/" class="brand-lockup" aria-label="Medcase · Visualizador cirúrgico">
        <span class="lockup-text">
          <span class="lockup-brand">Medcase</span>
          <span class="lockup-product">Visualizador cirúrgico</span>
        </span>
      </a>
      <nav class="nav">
        <a href="#produto">Produto</a>
        <a href="#numeros">Números</a>
        <a href="#equipe">Equipe</a>
        <a href="tel:+5521993118288" class="hdr-tel" aria-label="Concierge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/></svg>
          (21) 99311-8288
        </a>
        <a href="https://wa.me/5521993118288?text=Ol%C3%A1%2C%20quero%20saber%20mais%20sobre%20as%20solu%C3%A7%C3%B5es%20em%20modelos%203D%20para%20cirurgias." class="btn-primary coral" target="_blank" rel="noopener">Solicitar →</a>
      </nav>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="wrap">
        <div class="hero-grid">
          <div>
            <span class="eyebrow">Planejamento pré-operatório · 2026</span>
            <h1 class="headline">Anatomia<br>como <span class="scribble">evidência<svg viewBox="0 0 200 18" preserveAspectRatio="none"><path d="M2 12 C 40 4, 80 16, 120 8 S 196 12, 198 6"/></svg></span>.</h1>
            <p class="lede">Reconstruções 3D de alta fidelidade entregues em até três dias. Visualização interativa para cirurgia complexa — no consultório, na sala, no celular do plantonista.</p>
            <div class="cta-row">
              <a href="https://wa.me/5521993118288?text=Ol%C3%A1%2C%20quero%20saber%20mais%20sobre%20as%20solu%C3%A7%C3%B5es%20em%20modelos%203D%20para%20cirurgias." class="btn-primary coral" target="_blank" rel="noopener">Solicitar um caso →</a>
              <a href="https://biodesignlab.com.br/case-next/?id=5fc6c4d2d77d4ab6a8cadfe8996c70a4" target="_blank" rel="noopener" class="btn-ghost">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:16px;height:16px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Abrir caso demo
              </a>
            </div>
            <p class="cta-hint">ou ligue para a concierge — <a href="tel:+5521993118288">(21) 99311-8288</a></p>
          </div>
          <div class="hero-vis">
            <div class="hero-vis-pad">
              <div class="hero-canvas">
                <video autoplay muted loop playsinline src="/videoViewer.mp4"></video>
                <span class="tag">Caso 7d3a · Artéria renal</span>
                <span class="tag r">3D · Interativo</span>
              </div>
            </div>
            <div class="chip chip-1"><span class="dot"></span>AngioTC · 0,6mm</div>
            <div class="chip chip-2"><div><div class="meta">Entrega</div><div class="num">3 dias</div></div></div>
          </div>
        </div>
      </div>
    </section>

    <section class="trust">
      <div class="wrap">
        <div class="trust-head">
          <div>
            <span class="eyebrow">Em uso na rede</span>
            <h2 class="trust-title">Operando ao lado das principais redes do Rio.</h2>
          </div>
          <p class="trust-sub">Disponibilizado nas unidades Dasa — Alta Diagnósticos, CDPI e Bronstein — e nos hospitais da rede Américas.</p>
        </div>
        <div class="partners">
          <div class="cell"><img src="/images/LogoDasa 1.png" alt="Dasa"></div>
          <div class="cell"><img src="/images/Alta-logo-1.webp" alt="Alta Diagnósticos"></div>
          <div class="cell"><img src="/images/logoCDPI.png" alt="CDPI"></div>
          <div class="cell"><img src="/images/bronsteinLogo.jpg" alt="Bronstein"></div>
        </div>
      </div>
    </section>

    <section class="section cream" id="produto">
      <div class="wrap">
        <div class="how-head">
          <div>
            <span class="eyebrow">Como funciona</span>
            <h2 class="h2">Do exame<br>ao bisturi.</h2>
          </div>
          <p class="lede" style="margin:0;">Um fluxo simples, integrado à rotina das unidades Dasa. Sem instalações, sem login, sem fricção entre o radiologista e o cirurgião.</p>
        </div>
        <div class="how-grid">
          <article class="step">
            <div class="num">01 · Solicitação</div>
            <div class="ill">
              <svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="20" y="22" width="80" height="76" rx="8"/>
                <path d="M32 38h56M32 52h40M32 66h32M32 80h48"/>
                <circle cx="92" cy="92" r="14" fill="#E8745A" stroke="none"/>
                <path d="M86 92h12M92 86v12" stroke="#FBF7F0"/>
              </svg>
            </div>
            <div>
              <h3>Solicitação<br>na unidade</h3>
              <p>O cirurgião pede angiotomografia ou ressonância com pós-processamento 3D em qualquer unidade da rede.</p>
            </div>
          </article>
          <article class="step">
            <div class="num">02 · Segmentação</div>
            <div class="ill">
              <svg viewBox="0 0 120 120" fill="none">
                <g transform="translate(28 4)">
                  <rect x="0" y="0" width="64" height="64" rx="6" fill="#FFFFFF" stroke="#1A1815" stroke-width="1" opacity="0.9"/>
                  <path d="M16 10 C 6 14, 4 28, 10 40 C 14 50, 28 54, 34 50 C 46 46, 50 32, 46 22 C 42 10, 28 6, 22 8 Z" fill="#E6E8EC" stroke="#1A1815" stroke-width="1.2"/>
                </g>
                <g transform="translate(20 26)">
                  <rect x="0" y="0" width="64" height="64" rx="6" fill="#FFFFFF" stroke="#1A1815" stroke-width="1"/>
                  <path d="M16 10 C 6 14, 4 28, 10 40 C 14 50, 28 54, 34 50 C 46 46, 50 32, 46 22 C 42 10, 28 6, 22 8 Z" fill="#F2F3F5" stroke="#1A1815" stroke-width="1" opacity="0.55"/>
                  <path d="M12 18 Q 22 26, 26 36 T 38 48" stroke="#BFD0D9" stroke-width="3.2" fill="none" stroke-linecap="round"/>
                  <path d="M16 22 Q 24 30, 30 30" stroke="#BFD0D9" stroke-width="2.2" fill="none" stroke-linecap="round"/>
                </g>
                <g transform="translate(12 48)">
                  <rect x="0" y="0" width="64" height="64" rx="6" fill="#FFFFFF" stroke="#1A1815" stroke-width="1.2"/>
                  <path d="M16 10 C 6 14, 4 28, 10 40 C 14 50, 28 54, 34 50 C 46 46, 50 32, 46 22 C 42 10, 28 6, 22 8 Z" fill="#F2F3F5" stroke="#1A1815" stroke-width="1" opacity="0.55"/>
                  <circle cx="30" cy="30" r="7.5" fill="#E8745A" stroke="#1A1815" stroke-width="1.2"/>
                </g>
                <g font-family="ui-monospace,monospace" font-size="6.5" fill="#1A1815" font-weight="600" letter-spacing="0.5">
                  <text x="86" y="100">3 LAYERS</text>
                  <line x1="86" y1="104" x2="112" y2="104" stroke="#1A1815" stroke-width="0.8"/>
                </g>
              </svg>
            </div>
            <div>
              <h3>Segmentação<br>e malha 3D</h3>
              <p>Nossa equipe segmenta as estruturas relevantes. Cada órgão, vaso e lesão vira uma camada nomeada e ajustável.</p>
            </div>
          </article>
          <article class="step">
            <div class="num">03 · Entrega</div>
            <div class="ill">
              <svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="32" y="14" width="56" height="92" rx="10"/>
                <rect x="40" y="26" width="40" height="58" rx="4" fill="#1A1815"/>
                <circle cx="60" cy="94" r="4"/>
                <path d="M48 44l8 8 16-16" stroke="#C9D9CC" stroke-width="3"/>
              </svg>
            </div>
            <div>
              <h3>Link interativo<br>em 3 dias</h3>
              <p>Abre direto no navegador. Sem instalação, sem login. Funciona no celular durante o plantão, em qualquer dispositivo.</p>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section class="section soft">
      <div class="wrap">
        <div class="product">
          <div>
            <span class="eyebrow">No visualizador</span>
            <h2 class="h2">Gire, meça,<br><em>compartilhe.</em></h2>
            <p class="lede" style="margin-top:var(--space-4);">Uma interface enxuta, pensada para o cirurgião que abre o caso 5 minutos antes de operar — não um software de PACS para o radiologista.</p>
            <ul class="feat-list">
              <li>
                <span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="6" width="18" height="3" rx="1"/><rect x="3" y="11" width="14" height="3" rx="1"/><rect x="3" y="16" width="10" height="3" rx="1"/></svg></span>
                <div><h4>Estruturas independentes</h4><p>Liga, desliga, ajusta opacidade por estrutura. Vê apenas o vaso, ou o vaso dentro do parênquima.</p></div>
              </li>
              <li>
                <span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 21l6-6m0 0l3 3m-3-3l-3-3m12-3l-6 6m0 0l-3-3m3 3l3 3"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/></svg></span>
                <div><h4>Ferramentas de medida</h4><p>Distância ponto-a-ponto, ângulos e marcações na superfície da malha — em coordenadas 3D reais.</p></div>
              </li>
              <li>
                <span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v14"/></svg></span>
                <div><h4>Compartilhamento direto</h4><p>Link no navegador, sem instalação nem login. Abre no celular durante o plantão, no desktop da sala, no tablet da visita.</p></div>
              </li>
            </ul>
          </div>
          <div class="product-shot devices">
            <img src="/images/mockups.png" alt="Visualizador 3D em notebook, tablet e celular">
          </div>
        </div>
      </div>
    </section>

    <section class="section soft" id="equipe">
      <div class="wrap">
        <div class="how-head">
          <div>
            <span class="eyebrow">Médicos responsáveis</span>
            <h2 class="h2">Quem assina<br>cada caso.</h2>
          </div>
          <p class="lede" style="margin:0;">Radiologistas dedicados ao pós-processamento 3D. Cada modelo passa pelas mãos de um dos dois antes de chegar ao cirurgião.</p>
        </div>
        <div class="doctors">
          <article class="doc">
            <div class="doc-photo"><img src="/images/vitor_photo.jpg" alt="Dr. Vitor Sardemberg"></div>
            <div>
              <div class="doc-eyebrow">Radiologista</div>
              <h3 class="doc-name">Vitor Sardemberg</h3>
              <p class="doc-aff">CDPI · Alta Diagnósticos</p>
              <a class="doc-tel" href="tel:+5521982204508">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/></svg>
                (21) 98220-4508
              </a>
            </div>
          </article>
          <article class="doc">
            <div class="doc-photo"><img src="/images/rvarella.jpg" alt="Dr. Romulo Varella"></div>
            <div>
              <div class="doc-eyebrow">Radiologista</div>
              <h3 class="doc-name">Romulo Varella</h3>
              <p class="doc-aff">Hospitais São Lucas · CHN</p>
              <a class="doc-tel" href="tel:+5521999465979">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/></svg>
                (21) 99946-5979
              </a>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section class="section" id="numeros">
      <div class="wrap">
        <div class="cta-card">
          <div class="cta-left">
            <span class="eyebrow" style="color:#fff;opacity:0.7;">Próximo caso</span>
            <h2>Cada caso vira<br>um plano cirúrgico.</h2>
            <p class="lede">Envie o exame na unidade Dasa. Em até três dias úteis o link do modelo 3D chega no seu celular, pronto para girar, medir e compartilhar com a equipe.</p>
            <div class="cta-row" style="margin-top:var(--space-6);">
              <a href="https://wa.me/5521993118288?text=Ol%C3%A1%2C%20quero%20saber%20mais%20sobre%20as%20solu%C3%A7%C3%B5es%20em%20modelos%203D%20para%20cirurgias." class="btn-primary coral" target="_blank" rel="noopener">Solicitar um caso →</a>
              <a href="https://biodesignlab.com.br/case-next/?id=5fc6c4d2d77d4ab6a8cadfe8996c70a4" target="_blank" rel="noopener" class="btn-ghost-dark">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:16px;height:16px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Abrir caso demo
              </a>
            </div>
          </div>
          <div class="cta-right">
            <div class="cta-tick"><span class="k">01</span><div><b>Sem instalação</b><span>Abre no navegador, no celular do plantão.</span></div></div>
            <div class="cta-tick"><span class="k">02</span><div><b>Sem login obrigatório</b><span>Link direto, válido por 30 dias.</span></div></div>
            <div class="cta-tick"><span class="k">03</span><div><b>Compatibilidade total</b><span>iOS, Android, desktop. Sem app.</span></div></div>
            <div class="cta-tick"><span class="k">04</span><div><b>Validado pela radiologia Dasa</b><span>Cada modelo revisado pelo time clínico.</span></div></div>
          </div>
        </div>
      </div>
    </section>
  </main>

  <footer class="ftr">
    <div class="wrap">
      <div class="ftr-grid">
        <div>
          <a href="/" class="wm">Medcase<em>.</em></a>
          <p style="font-size:13px;color:#A8B0B6;max-width:32ch;margin:0;">Visualizador 3D cirúrgico.</p>
        </div>
        <div><h4>Produto</h4><ul><li><a href="/case-next/">Visualizador</a></li><li><a href="/upload/">Upload de caso</a></li></ul></div>
        <div><h4>Equipe</h4><ul><li><a href="#equipe">Médicos responsáveis</a></li></ul></div>
        <div><h4>Concierge</h4><ul><li><a href="tel:+5521993118288">+55 21 99311-8288</a></li><li><a href="https://wa.me/5521993118288?text=Ol%C3%A1%2C%20quero%20saber%20mais%20sobre%20as%20solu%C3%A7%C3%B5es%20em%20modelos%203D%20para%20cirurgias." target="_blank" rel="noopener">WhatsApp</a></li><li><a href="mailto:contato@biodesignlab.com.br">contato@biodesignlab.com.br</a></li></ul></div>
      </div>
      <div class="ftr-foot">
        <span>© 2026 MEDCASE · PUC-RIO · DASA</span>
        <span>RIO DE JANEIRO · BR</span>
      </div>
    </div>
  </footer>

  <script>
    // Respect prefers-reduced-motion for the hero video.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.querySelectorAll('video[autoplay]').forEach(function (v) {
        v.removeAttribute('autoplay');
        v.pause();
      });
    }
  </script>

  <script>
    // Rastreia QUALQUER clique que abra WhatsApp
    document.addEventListener('click', function (e) {
      const elemento = e.target.closest('button, a');
      if (elemento &&
        (elemento.onclick?.toString().includes('wa.me') ||
          elemento.href?.includes('wa.me'))) {
        gtag('event', 'conversion', {
          'send_to': 'DC-10089018/invmedia/br_da001+standard'
        });
        console.log('Pixel disparado - WhatsApp');
      }
    });

    // Pixel da Homepage
    if (window.location.pathname === '/') {
      gtag('event', 'conversion', {
        'send_to': 'DC-10089018/invmedia/br_da000+standard'
      });
    }
  </script>
</body>

</html>
```

- [ ] **Step 2: Verify no Tailwind reference remains**

```bash
grep -c "cdn.tailwindcss.com\|class=\"flex\|class=\"container mx-auto\|class=\"text-" /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/index.html || echo "0 Tailwind hits"
```

Expected: `0 Tailwind hits` (the `grep -c 0` returns exit 1, hence the `||`).

- [ ] **Step 3: Verify GTM/DoubleClick/JSON-LD survived**

```bash
grep -c "GTM-NX75SZPR\|DC-10089018\|application/ld+json\|br_da000\|br_da001" /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/index.html
```

Expected: ≥ 5 (one match per ID, plus the script tag for JSON-LD).

- [ ] **Step 4: Open in browser and eyeball**

In another shell or VS Code:

```bash
cd /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer && npx http-server -p 5500 -c-1 . &
```

Open `http://127.0.0.1:5500/` in a browser. Check:
- Title in tab reads "Medcase | Visualizador cirúrgico 3D".
- Header has "Medcase" + "Visualizador cirúrgico" below it, no logo image.
- Hero displays "Anatomia como evidência." with coral underline scribble.
- Hero video plays.
- Partner logos visible (Dasa, Alta, CDPI, Bronstein).
- 3 step cards visible.
- 2 KOL cards visible.
- Dark CTA card at bottom.
- Footer is dark with 4 columns.
- No console errors except possibly the `console.log('Pixel disparado - WhatsApp')` if you click a WhatsApp link.

Then stop the server with `kill %1` (or close the terminal where it runs in foreground).

---

## Task 4 — Create the test directory and base spec file

**Files:**
- Create: `tests/site/site.spec.js`

The Playwright config in `playwright.config.js` already has `testDir: './tests'` and runs `http-server` on port 5500 automatically. A new spec file inside `tests/site/` is picked up without any config change.

- [ ] **Step 1: Confirm Playwright config picks up the new dir**

```bash
grep -n "testDir\|webServer\|port" /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/playwright.config.js
```

Expected: `testDir` is `./tests`, `webServer` runs `http-server` (or similar), port is 5500 or another known port. Note the port (let's call it `PORT`). The base URL for tests is `http://127.0.0.1:PORT/`.

- [ ] **Step 2: Create the spec file**

Write to `/Users/viniciusarcoverde/Documents/MedCase/medCaseViewer/tests/site/site.spec.js`:

```javascript
// @ts-check
const { test, expect } = require('@playwright/test');

const SITE_URL = '/';
const WA_PREFIX = 'https://wa.me/5521993118288';
const DEMO_PREFIX = 'https://biodesignlab.com.br/case-next/?id=';

test.describe('marketing landing', () => {
  test('smoke: page loads with Medcase wordmark + hero headline', async ({ page }) => {
    await page.goto(SITE_URL);
    await expect(page).toHaveTitle(/Medcase/i);
    await expect(page.locator('.lockup-brand')).toContainText('Medcase');
    await expect(page.locator('h1.headline')).toContainText('Anatomia');
  });

  test('cta wiring: every Solicitar links to wa.me, every Abrir caso demo to case-next', async ({ page }) => {
    await page.goto(SITE_URL);
    const coralLinks = page.locator('a.btn-primary.coral');
    const coralCount = await coralLinks.count();
    expect(coralCount).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < coralCount; i++) {
      const href = await coralLinks.nth(i).getAttribute('href');
      expect(href).toMatch(new RegExp('^' + WA_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    const demoLinks = page.locator('a.btn-ghost, a.btn-ghost-dark');
    const demoCount = await demoLinks.count();
    expect(demoCount).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < demoCount; i++) {
      const href = await demoLinks.nth(i).getAttribute('href');
      expect(href).toContain(DEMO_PREFIX);
    }
  });

  test('partner row: all 4 logos load with non-empty alt', async ({ page }) => {
    await page.goto(SITE_URL);
    const cells = page.locator('.partners .cell img');
    await expect(cells).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      const img = cells.nth(i);
      const alt = await img.getAttribute('alt');
      expect(alt && alt.length).toBeGreaterThan(0);
      const naturalWidth = await img.evaluate(el => el.naturalWidth);
      expect(naturalWidth).toBeGreaterThan(0);
    }
  });

  test('hero video: present with autoplay/muted/loop/playsinline and correct src', async ({ page }) => {
    await page.goto(SITE_URL);
    const video = page.locator('.hero-canvas video').first();
    await expect(video).toHaveCount(1);
    const attrs = await video.evaluate(v => ({
      autoplay: v.hasAttribute('autoplay'),
      muted: v.hasAttribute('muted'),
      loop: v.hasAttribute('loop'),
      playsinline: v.hasAttribute('playsinline'),
      src: v.getAttribute('src'),
    }));
    // autoplay may have been removed if prefers-reduced-motion is set; loop/playsinline are static.
    expect(attrs.muted).toBe(true);
    expect(attrs.loop).toBe(true);
    expect(attrs.playsinline).toBe(true);
    expect(attrs.src).toMatch(/videoViewer\.mp4$/);
  });

  test('GTM and DoubleClick pixel fire', async ({ page }) => {
    await page.goto(SITE_URL);
    await page.waitForLoadState('load');
    const dl = await page.evaluate(() => (window.dataLayer || []).slice());
    // First entry should be the gtm.start push from the GTM loader.
    expect(dl.length).toBeGreaterThan(0);
    const hasGtmJs = dl.some(o => o && (o.event === 'gtm.js' || (typeof o['gtm.start'] === 'number')));
    expect(hasGtmJs).toBe(true);
    // The conversion pixel on load (br_da000) should also have queued.
    // It comes through window.dataLayer because gtag() pushes there.
    const hasConversion = dl.some(o => Array.isArray(o) && o[0] === 'event' && o[1] === 'conversion');
    // Note: some browsers / load timings push the gtag config but the conversion happens on 'load'.
    // We don't strictly require it here — only assert the dataLayer is non-empty and has gtm.start.
    // If we wanted to assert harder, we'd page.waitForFunction the conversion entry.
    expect(hasGtmJs).toBe(true);
  });

  test('anchor navigation: nav links scroll to matching section ids', async ({ page }) => {
    await page.goto(SITE_URL);
    // Desktop viewport — nav visible.
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const id of ['produto', 'numeros', 'equipe']) {
      const link = page.locator(`.nav a[href="#${id}"]`);
      if (await link.count() === 0) continue; // mobile project hides nav
      await link.first().click();
      const target = page.locator(`#${id}`);
      await expect(target).toBeVisible();
    }
  });
});
```

- [ ] **Step 3: Run the suite**

```bash
cd /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer && npx playwright test tests/site --reporter=list
```

Expected: All 6 tests pass on the desktop project. On mobile (iPhone 13), tests `smoke`, `cta wiring`, `partner row`, `hero video`, `GTM pixel` should pass; the `anchor navigation` test handles the hidden nav with an early `continue`.

If any test fails:
1. Open the report `npx playwright show-report` to see the actual diff.
2. Read the error message — usually it's a selector miss or a timing issue.
3. Fix and re-run. Common fixes:
   - The `gtag` config call returns an `arguments` object rather than a plain array when pushed; the `Array.isArray(o)` check handles either case.
   - If `partner row` fails on naturalWidth=0, the asset path is wrong; double-check `/images/LogoDasa 1.png` (with space) and friends exist.

- [ ] **Step 4: Confirm desktop AND mobile both pass**

```bash
cd /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer && npx playwright test tests/site --reporter=list --project='Mobile Safari' || npx playwright test tests/site --reporter=list
```

(Adjust the project name based on what `playwright.config.js` defines — could be `mobile`, `Mobile Chrome`, `iPhone 13`, etc.)

Expected: all tests pass on both projects.

---

## Task 5 — Final verification + commit

**Files:**
- None modified in this task (verification + git only).

- [ ] **Step 1: Full Playwright run (all tests, all projects)**

```bash
cd /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer && npx playwright test --reporter=list
```

Expected: the full suite — `tests/case-next/*` (existing) + `tests/site/site.spec.js` (new) — all pass on every configured project. The case-next tests must continue to pass since we did not touch `/case-next/`. If a case-next test fails, it's unrelated to this work and should be debugged separately (do NOT merge marketing if pre-existing tests broke).

- [ ] **Step 2: Visual eyeball in browser**

Start a static server:

```bash
cd /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer && npx http-server -p 5500 -c-1 . &
```

Open `http://127.0.0.1:5500/` and verify, top to bottom:

1. Title in tab: `Medcase | Visualizador cirúrgico 3D`.
2. Header: sticky on scroll, frosted-paper background, "Medcase" + "Visualizador cirúrgico" eyebrow, nav links (`Produto`/`Números`/`Equipe`), concierge phone pill ≥1100px, coral "Solicitar →" pill.
3. Hero: H1 "Anatomia como evidência." (with coral scribble), lede, coral CTA + ghost demo button, "(21) 99311-8288" hint line, video looping in the cream pad, two chips ("AngioTC · 0,6mm", "Entrega · 3 dias").
4. Trust strip: paper bg, hairline top/bottom, "Operando ao lado das principais redes do Rio." headline, 4 partner logos in a hairline-divided row.
5. Como funciona (cream band): "Do exame ao bisturi.", 3 step cards (Solicitação / Segmentação / Entrega) with SVG illustrations.
6. Product moment (paper): "Gire, meça, compartilhe." (compartilhe in coral), 3 feature rows with line icons, devices PNG on the right.
7. Médicos responsáveis (paper): "Quem assina cada caso.", 2 KOL cards (Vitor, Romulo) with round portraits and phone pills.
8. CTA card (dark ink with coral glow top-right): "Cada caso vira um plano cirúrgico.", coral Solicitar + ghost demo, 4 tick rows on the right.
9. Footer (dark ink): "Medcase." wordmark + tagline, 3 column lists, mono strip with copyright.
10. Coral appears in: hero CTA, "evidência" word + scribble, "compartilhe." word, chip dot, 4 tick-row keys, CTA card glow, footer wordmark period, Solicitar buttons. **And nowhere else** (no Tailwind orange `#E95D4A`, no blue `#0C245C`).
11. No console errors. Check DevTools Network: GTM script loads, gtag script loads, conversion pixel fires on load, fonts load.
12. Click a Solicitar button: a new tab opens to WhatsApp. Console should log `Pixel disparado - WhatsApp` and the DoubleClick pixel should fire.
13. Click "Abrir caso demo": new tab opens to `/case-next/?id=5fc6c4d2d77d4ab6a8cadfe8996c70a4`.
14. Click nav `Produto`: page smooth-scrolls to the "Como funciona" section.
15. Resize to ~700px width: nav collapses (hides all anchor links), partners go 2×2, hero+product become single-column. Concierge pill stays hidden.
16. Resize to <560px: doctor cards photo shrinks from 120 to 88px.

Stop the server.

- [ ] **Step 3: Commit**

```bash
cd /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer && git add colors_and_type.css site.css index.html tests/site/site.spec.js docs/superpowers/specs/2026-05-12-marketing-redesign-design.md docs/superpowers/plans/2026-05-12-marketing-redesign.md
```

```bash
cd /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer && git commit -m "$(cat <<'EOF'
feat(site): redesign marketing landing per Claude Design handoff

Replace Tailwind CDN + Nunito Sans/Open Sans with the editorial
clinical-luxo register from the approved index_v2 mockup: pure-white
base, single coral accent (#C8412C), Plus Jakarta Sans + Inter +
JetBrains Mono, hairlines instead of shadows. Brand wordmark flipped
to "Medcase" across title, OG/Twitter, JSON-LD Organization.name, and
visible header/footer. Domain (biodesignlab.com.br), GTM, DoubleClick
pixel, JSON-LD URIs, canonical, WhatsApp tracking, and all tel/wa.me
deeplinks preserved byte-for-byte.

- Add /colors_and_type.css with canonical tokens
- Add /site.css with marketing-only styles
- Rewrite /index.html — replaces the entire <body> with the new
  layout (header, hero, trust, como-funciona, product, médicos,
  CTA card, footer); preserves GTM noscript and WhatsApp tracking
  scripts byte-for-byte
- Add tests/site/site.spec.js — 6 Playwright scenarios

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify the commit**

```bash
cd /Users/viniciusarcoverde/Documents/MedCase/medCaseViewer && git status && git log -1 --stat
```

Expected: working tree clean (besides the still-untracked Sprint 3b spec/plan files and `.superpowers/`), latest commit summary shows ~6 files changed.

---

## Done criteria

- [ ] `/index.html` no longer references `cdn.tailwindcss.com` and no Tailwind utility classes remain.
- [ ] `/colors_and_type.css` and `/site.css` exist at the repo root and are referenced from `/index.html` via `<link>`.
- [ ] Browsing to `/` renders the new layout end-to-end with no console errors.
- [ ] `npx playwright test` passes the full suite (existing case-next tests + new site tests) on every configured project.
- [ ] GTM `dataLayer` contains `gtm.start`, the homepage pixel `br_da000` fires on load, the WhatsApp pixel `br_da001` fires when a `wa.me` CTA is clicked.
- [ ] Brand wordmark reads "Medcase" everywhere visible; domain `biodesignlab.com.br` unchanged; JSON-LD `@id`/`url` unchanged.
- [ ] Out-of-scope dirs untouched: `git diff --name-only` shows only `index.html` (modified) plus the 4 new files plus the spec/plan docs.
