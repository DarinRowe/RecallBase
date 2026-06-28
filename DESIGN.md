# RecallBase Design System

## 1. Design Goal

RecallBase should make users feel that their AI conversation history is safely, quietly, and durably stored, while remaining easy to search and recall.

RecallBase is a warm personal archive for AI conversations. It is a brand-led memory product first, and a high-performance tool second.

The product should not feel like a cold database, a complicated knowledge-base admin panel, or a flashy AI tool. It should feel more like a private, warm, well-organized memory space: reliable, soft, restrained, personal, and efficient.

**Core feeling:** Warm Archive, Soft Security, Calm Recall.

**Aesthetic direction:** refined organic minimalism with a warm editorial archive character.

**Memorable visual idea:** The Soft Archive Tile. RecallBase should feel like a set of warm, tactile memory cards that quietly settle into a private archive and can be pulled back instantly through search.

---

## 2. Brand Attributes

- **Local-first:** Users own their data locally first. Cloud access is an explicit sync layer, not the default source of truth.
- **Private:** The interface should feel safe and non-invasive. Avoid surveillance, hacker, or monitoring aesthetics.
- **Personal:** RecallBase should feel like a trusted private memory space, not a generic utility.
- **Fast:** Performance is an interaction promise. Search, import, sync, and agent access should feel instant and direct without making the visual language cold.
- **Warm:** The palette should come from textiles, wood, clay, rugs, and soft interiors rather than cold neon tech colors.
- **Mature:** The design should be simple and generous, not childish, overly cute, or decorative.
- **Brand-led:** The product can carry emotion and recognition. It should be memorable enough to become a daily companion for AI work.

---

## 3. Language

RecallBase user-facing product surfaces should use English by default.

This applies to:

- Web app UI
- Browser extension UI
- Landing/product pages
- Empty states
- Error states
- Privacy copy
- Store listing copy
- Logo wordmark

Developer-facing documentation can include Chinese when useful during internal planning, but product-facing copy should be English-first unless a localization pass is explicitly planned.

---

## 4. Color Palette

### Primary Tokens

```css
:root {
  --rb-cream: #F3EDE2;
  --rb-paper: #FAF7F1;
  --rb-beige: #D8C7AD;
  --rb-clay: #A96445;
  --rb-clay-dark: #7A4633;
  --rb-rose: #C98E86;
  --rb-sage: #9FB39E;
  --rb-aqua: #A7C9C5;
  --rb-espresso: #4A342B;
  --rb-ink: #2D2723;
  --rb-line: #E7E1D8;
}
```

### Usage

- **Background:** `--rb-cream` or `--rb-paper`
- **Primary action:** `--rb-clay`
- **Primary hover/active:** `--rb-clay-dark`
- **Text:** `--rb-ink` for primary text, `--rb-espresso` for warm emphasis
- **Borders/dividers:** `--rb-line`
- **Success/synced state:** `--rb-sage`
- **Search/link/technical hint:** `--rb-aqua`
- **Soft emphasis:** `--rb-rose`
- **Cards/surfaces:** white, `--rb-paper`, or very light beige

### Color Rules

- Do not let the interface become dominated by a single hue.
- Avoid neon blue, high-saturation purple, pure black, or clinical pure-white UI.
- Use clay and aqua intentionally as brand rhythm accents; the base should feel calm, but never timid.
- Important privacy and sync states may use color, but should never rely on color alone.

### Brand Color Proportions

Use this as the default product ratio:

- 55-65% warm paper or cream.
- 15-20% espresso, ink, or deep neutral structure.
- 10-15% sage archive surfaces.
- 5-8% clay for primary action, selection, privacy seal, or import success.
- 2-5% aqua for recall, matched snippets, links, or technical hints.

Avoid the failure mode of an all-beige page with white cards and thin borders. Every primary screen should contain at least one visible RecallBase brand rhythm: a source spine, selected archive tile, clay privacy seal, aqua recall line, or archive tray surface.

### Required Accent Moments

- Active source: espresso or sage spine with a clay tick.
- Selected result: clay edge marker plus a visible folded corner or tab.
- Search focus: aqua recall line or ring, not a generic blue glow.
- Import success: clay seal or check that settles into the tile.
- Cloud/privacy boundary: espresso or clay badge with text, never color alone.

---

## 5. Logo Direction

### Shape

The logo should use a simple, generous, decisive shape with clear brand presence:

- Rounded square, folded tile, archive tab, or soft memory container.
- One smooth inner recall curve, thread, or balloon-like memory loop is acceptable when it feels controlled and mature.
- The symbol should suggest saved AI conversations, warm recall, and a private archive without becoming a literal tool icon.
- Avoid literal database cylinders, chat bubbles, robot heads, mascots, or complex multi-part symbols.
- Avoid overly blobby silhouettes unless they remain controlled, readable as an app icon, and brandable at small sizes.

### Texture

- Matte and tactile.
- A very subtle textile or fabric warmth is acceptable.
- Avoid glassmorphism, neon glow, heavy shadow, 3D mockups, or metallic effects.

### Logo Colors

Preferred logo palette:

- Cream base
- Clay accent
- Sage or aqua secondary accent
- Espresso outline or wordmark

### Wordmark

Use `RecallBase` exactly.

The wordmark should feel modern, calm, readable, and ownable. It can be more expressive than a pure utility logo, but should remain mature and trustworthy. Prefer a refined rounded sans-serif or soft editorial letterform style with enough weight to pair with the icon.

---

## 6. Signature Visual System

RecallBase should not look like a generic SaaS dashboard. The interface should have a recognizable system built from a few repeated motifs.

### Non-Negotiable Brand Moments

Every major Web or extension surface must include at least one of these brand moments:

- **Source Spine:** a vertical or compact edge structure that shows where memories came from.
- **Archive Tray:** a warm sage or paper surface that holds results like stored memory tiles.
- **Aqua Recall Line:** a thin line or highlight that connects search input to matched snippets.
- **Clay Privacy Seal:** a compact badge used for local-only, imported, synced, or locked states.
- **Tile Stack Reveal:** result tiles entering with a subtle stagger, like records being pulled from an archive.

If a screenshot without the logo could be mistaken for Notion, Linear, a generic admin template, or a plain browser history tool, the design is not finished.

### The Soft Archive Tile

Use this as the primary visual metaphor across Web and extension UI:

- Search results are warm archive tiles, not generic list rows.
- Imported conversations should feel like cards settling into a private container.
- Source status can appear as slim archive tabs or file-edge markers.
- Detail pages can open from a selected tile, preserving a sense of place.

### Soft Archive Tile Anatomy

Every full result tile should include these zones:

- **Source spine:** 4-6px left edge on desktop, 3-4px on compact surfaces. Color maps to source or state.
- **Title row:** conversation title on the left, timestamp on the right.
- **Snippet body:** 1-3 lines with matched text highlighted by aqua recall marks.
- **Provenance row:** source name, model/app if known, local/import/sync state, and privacy badge.
- **Fold or tab detail:** one small top-right fold, side tab, or clipped corner. Use only one per tile.
- **Primary action area:** open/detail affordance on hover or focus, never hidden from keyboard users.

Tile states:

- **Default:** paper surface, subtle inner border, visible source spine.
- **Hover:** lift 1-2px and reveal a slightly stronger spine; no glow.
- **Focused:** accessible aqua or clay outline, at least 2px, offset from text.
- **Selected:** clay edge marker, folded corner visible, archive tray background deepens slightly.
- **Loading:** skeleton lines keep the same source spine and tile dimensions.
- **Error:** muted clay/rust badge with plain-language copy.
- **Local-only:** espresso or neutral badge reading "Local only".
- **Synced:** sage badge reading "Synced".
- **Locked/raw unavailable:** espresso badge reading "Raw stays local" or "Locked".

Density:

- Desktop tile width: 520-760px when in a search stage.
- Dense list tile height: 84-112px.
- Rich result tile height: 132-180px.
- Extension popup tile height: 72-96px.
- Mobile tile uses a top source tab instead of a full left spine when width is under 420px.

### Shapes

- Use decisive rounded rectangles with soft corners, not amorphous blobs.
- Prefer one curved cut, folded edge, or tab detail per major surface.
- Corners should feel soft but intentional: 8px for dense UI, 12-16px for larger hero/product surfaces, 20px only for brand moments.
- Avoid decorative blobs, floating orbs, and purely ornamental shapes.

### Visual Rhythm

- Combine generous negative space with compact, scannable data groups.
- Use asymmetry lightly: a source spine, a dominant search stage, and a quieter status thread.
- Let one element own the screen at a time: search, capture, or detail.

### Branded Surface Recipes

Use these surfaces to keep product screens recognizable:

- **Archive tray:** sage or paper panel with a slightly darker inner edge. It holds result tiles and selected detail previews.
- **Source spine:** espresso/sage vertical structure with compact source markers, import health, and active clay tick.
- **Recall field:** search area with cream background, aqua focus line, and no generic search-card chrome.
- **Privacy seal:** clay or espresso capsule with clear status text and an icon.

---

## 7. Typography

### Recommended Style

- Use a distinctive display font for brand moments and a refined sans-serif for product UI.
- Avoid generic default stacks such as Inter, Roboto, Arial, or pure system fonts as the primary design choice.
- Fonts should feel warm, editorial, and trustworthy rather than futuristic or toy-like.

### Font Pairing

Preferred pairing:

- **Display / Logo / Hero:** Fraunces as the default self-hosted display choice. Canela or Recoleta-style fonts may be used only when licensed and intentionally selected for brand work.
- **UI / Body:** IBM Plex Sans as the default product UI font. Avenir Next-style fonts may be used as native fallbacks. Geist is allowed only as a technical fallback, not the primary brand expression.
- **Code / CLI snippets:** IBM Plex Mono or Berkeley Mono-style monospaced font.

Implementation should self-host web fonts where possible to keep performance and privacy predictable.

```css
:root {
  --rb-font-display: "Fraunces", "Canela", "Recoleta", serif;
  --rb-font-ui: "IBM Plex Sans", "Avenir Next", "Geist", sans-serif;
  --rb-font-mono: "IBM Plex Mono", "Berkeley Mono", monospace;
}
```

### Type Scale

```css
--rb-text-xs: 12px;
--rb-text-sm: 14px;
--rb-text-md: 16px;
--rb-text-lg: 18px;
--rb-text-xl: 24px;
--rb-text-2xl: 32px;
```

### Rules

- Use hero-scale text only on true top-level product pages.
- App pages should use compact headings and clear labels.
- Do not use negative letter spacing.
- Do not scale font size with viewport width.

---

## 8. Layout Language

RecallBase should feel like a quiet workspace, not a marketing dashboard.

### Web App

The first screen after login should use a RecallBase-specific composition, not a standard dashboard shell:

- **Search Stage:** the central anchor. It contains the primary search input, recall line, and current query context.
- **Source Spine:** a compact vertical or top-edge source structure. It replaces a generic sidebar and shows source/import health through markers.
- **Archive Tray:** the result area. It holds Soft Archive Tiles and can deepen when a tile is selected.
- **Status Thread:** 2-3 compact sync/privacy signals connected to the search stage, not a grid of metrics cards.
- **Detail Layer:** opens from a selected archive tile and keeps a clear back-to-search path.

Default desktop structure:

- Source Spine: 72-220px depending on density.
- Search Stage + Archive Tray: dominant area, at least 55% of the width.
- Status Thread: compact top-right or inline rail, never a full dashboard column.

Forbidden first-screen structures:

- Generic left navigation + top bar + metric cards.
- Full-width table of conversations as the primary view.
- Settings-first layouts.
- Marketing hero inside the signed-in app.
- White card grid on beige background with no source spine or archive tray.

### Web Composition Rules

- The search input is the visual anchor.
- Results should read as warm memory tiles with source, title, snippet, timestamp, and privacy/sync state.
- Source health should be secondary, but always visible enough to build trust.
- Detail pages should be calm and document-like, with strong provenance and privacy state.

Avoid:

- Marketing hero content inside the app.
- Dashboard sprawl.
- Metrics cards unless they directly help sync or search.
- Settings-heavy first screens.

### Web App States

Design these states before shipping the Web app:

| State | Required UI behavior |
|-------|----------------------|
| First use | Search Stage is present but calm; Archive Tray explains import/sync in one short action. |
| No local import | Source Spine shows empty local source and points to CLI import. |
| Loading search | Tiles keep fixed dimensions with skeleton lines and source spines. |
| No results | Archive Tray remains visible and offers query refinement, not a blank page. |
| Importing | Status Thread shows progress and the target source. |
| Sync pending | Privacy seal explains what is queued and what remains local. |
| Sync error | Muted clay/rust state with retry and last successful sync time. |
| Cloud unavailable | Search can still show cached/indexed state when available; copy stays honest. |
| Auth expired | Compact re-login action without destroying the current search context. |
| Detail locked | Detail layer shows metadata/snippet and explains raw content stays local. |
| Search unavailable | Source Spine and privacy state remain visible; avoid dead empty screens. |

### Responsive Rules

- Desktop: Source Spine + Search Stage + Archive Tray can appear together.
- Desktop breakpoint: 1024px and above.
- Tablet breakpoint: 720-1023px. Source Spine collapses into a top source spine; Archive Tray remains primary.
- Mobile Web breakpoint: under 720px. Search Stage first, compact source spine second, Archive Tray third. Detail opens as a full-screen layer.
- Do not shrink text with viewport width. Reduce columns, not type quality.
- Result tiles must keep stable dimensions; status badges wrap to a second row when needed.

### Source Spine Color Mapping

Use source and state colors consistently:

| Meaning | Spine or marker color |
|---------|-----------------------|
| Active source | `--rb-espresso` with clay tick |
| Synced source | `--rb-sage` |
| Importing or queued | `--rb-aqua` |
| Local-only/private | `--rb-espresso` |
| Failed or attention needed | `--rb-clay-dark` |
| Unknown or disabled | `--rb-beige` |

Do not assign random source colors unless they still fit the approved palette and pass contrast checks.

### Browser Extension

The extension should feel like a compact RecallBase memory surface, not a generic capture panel.

Popup first screen, from top to bottom:

- Current page support/status.
- Primary save/import action.
- Local bridge status: connected, disconnected, importing, imported, queued, or failed.
- Recent captures as compact Soft Archive Tiles.
- Search/history entry.
- Settings as a secondary icon action.

Sidebar structure:

- Source/context header.
- Save/import controls.
- Capture history with filters.
- Detail preview.
- Local RecallBase import state.

Required extension states:

| State | Required UI behavior |
|-------|----------------------|
| Supported page | Primary save action is visible and specific. |
| Unsupported page | Explain unsupported status and keep history/search available. |
| Auto-save on | Show visible state and last save time. |
| Auto-save off | Manual save remains primary. |
| Local bridge connected | Show "Imported to RecallBase" or ready state. |
| Local bridge disconnected | Show one clear action to connect/install. |
| Queued import | Show queue count and do not imply synced. |
| Import failed | Show retry and preserve the capture. |
| Already saved | Show saved state and detail/history entry. |
| Sync available | Make clear that cloud sync happens through `rb sync`, not direct extension upload. |

Compact sizing:

- 320px popup: keep page status, save action, bridge state, and 3 recent captures.
- 400px popup: add search/history entry and one compact filter row.
- Sidebar: preserve Source Spine as a thin top or left edge and show full tile anatomy when width allows.
- Minimum touch target: 40px for compact extension controls, 44px for mobile Web controls.
- Icon-only controls must keep a visible focus target even when the visual icon is smaller.

The extension can borrow the polish of Chat Memo's capture workflow, but RecallBase owns the information architecture:

- Current page support status.
- Manual save and visible auto-save.
- Local bridge/import status.
- Popup/sidebar history.
- Search, filter, detail, export, and settings when they support capture management.

RecallBase-specific addition:

- Every saved capture should clearly show whether it has been imported into local RecallBase.

---

## 9. Components

### Buttons

- Primary: clay background, cream text.
- Secondary: paper background, espresso text, subtle border.
- Destructive: muted red/rust, never bright alarm red unless critical.
- Icon buttons should use familiar icons where possible.

### Inputs

- Search should be prominent and calm.
- Background: white or paper.
- Border: warm line color.
- Focus: aqua or clay ring, subtle and accessible.

### Cards

- Use archive tiles/cards for repeated result items, source rows, and modals.
- Radius: 8px or less unless a component intentionally echoes the rounded logo shape.
- Do not nest cards inside cards.
- Result tiles can include a subtle folded-edge or tab detail, but only one such detail per card.
- Hover should feel like a card being gently lifted or pulled from the archive, not like a glowing tech panel.

### Status

- Synced: sage.
- Pending/importing: beige or aqua.
- Error: muted clay/rust.
- Local-only/private: espresso or warm neutral badge.

### Feedback And Toasts

Every meaningful user action needs a visible feedback path: click, pending, success, fallback, and failure. Short-lived action results should use a shared toast or notice component instead of one-off message UI.

Use toast or notice feedback for:

- Save, export, copy, delete, retry, connection check, cleanup, and settings changes.
- Async work that may take long enough for the user to wonder whether the click worked.
- Successful completion, recoverable fallback, and failure states.

Do not use toast as the only feedback for:

- Field validation or input errors. Put those near the field that needs fixing.
- Destructive or irreversible actions. Use confirmation and a clear settled state.
- Errors that require a decision before the user can continue. Use inline recovery UI or a modal.

Toast copy should be short, direct, and operational:

- "Saved"
- "Export failed. Try again."
- "Copied command"
- "Checking connection..."

Rules:

- Reuse the existing local feedback component for the surface when one exists.
- Use consistent tones: working, success, fallback, failed.
- Use `role="status"` for normal updates and `role="alert"` for failures that need attention.
- Auto-dismiss success messages after a few seconds. Errors may stay longer or include a close affordance.
- Never include raw chat text, tokens, headers, cookies, clipboard content, full URL query strings, or local file paths in toast text.
- Respect `prefers-reduced-motion`; motion should clarify state, not distract.

### Empty States

Keep empty states direct:

- What happened.
- What action to take.
- No long onboarding copy.

Example:

> No synced conversations yet. Run `rb sync` after importing local history.

---

## 10. Texture And Material

The product can use subtle textile/material warmth, but it must stay clean.

Allowed:

- Very light paper grain.
- Soft matte surfaces.
- Warm shadows at low opacity.
- Gentle fabric-inspired color palette.
- Subtle woven or boucle-inspired texture on large brand surfaces.
- Fine inner borders that make tiles feel tactile and handled.

Avoid:

- Strong noise that hurts readability.
- Obvious fur texture in UI surfaces.
- Glassmorphism.
- Neon glow.
- Heavy drop shadows.

### Background Recipe

Use layered warmth rather than flat beige:

```css
.rb-surface {
  background:
    linear-gradient(135deg, rgba(250, 247, 241, 0.96), rgba(243, 237, 226, 0.98)),
    repeating-linear-gradient(
      90deg,
      rgba(74, 52, 43, 0.018) 0,
      rgba(74, 52, 43, 0.018) 1px,
      transparent 1px,
      transparent 14px
    );
}

.rb-grain {
  opacity: 0.035;
  mix-blend-mode: multiply;
}
```

The background should feel like warm paper or textile, not a visible decorative pattern. Grain must be subtle enough that text remains crisp.

---

## 11. Motion

Motion should communicate state, not entertain.

Allowed:

- Fast fade/slide for panels.
- Subtle loading pulse for sync/import.
- Small check transition after local import succeeds.
- One orchestrated page-load reveal: Source Spine, Search Stage, then archive tiles.
- Search result transition that feels like cards being pulled from an archive.
- Import success motion that feels like a card settling into place.

Rules:

- Keep transitions under 180ms for common UI.
- Avoid bouncing, springy, playful motion.
- Respect reduced-motion preferences.

### Motion Tokens

```css
:root {
  --rb-ease-settle: cubic-bezier(0.16, 1, 0.3, 1);
  --rb-ease-quick: cubic-bezier(0.2, 0, 0, 1);
  --rb-motion-fast: 120ms;
  --rb-motion-base: 180ms;
  --rb-motion-slow: 320ms;
}
```

### Signature Interactions

- **Archive reveal:** tiles enter with 8-12px vertical movement, low opacity, and staggered 24ms delay.
- **Local import success:** a tile briefly compresses by 1-2px, then settles back with a check/status change.
- **Search focus:** the search container expands subtly and reveals filter affordances; avoid glowing outlines.

---

## 12. Voice And Copy

Copy should be short, clear, and privacy-forward.

### Preferred Tone

- Calm.
- Honest.
- Operational.
- No hype.

### Examples

Good:

- "Saved locally"
- "Imported to RecallBase"
- "Synced 3 minutes ago"
- "Raw history stays on this device"
- "Cloud search can read titles and snippets, not raw local archives"

Avoid:

- "Unlock the power of your AI memory"
- "We know everything you worked on"
- "Backed up forever"
- "AI brain for all your thoughts"

---

## 13. Privacy Copy Contract

Use consistent wording across CLI, Web, and extension.

| Surface | Cloud can read | Cloud cannot receive/read |
|---------|----------------|---------------------------|
| Search | Source, title, timestamps, bounded snippets, optional summaries | Raw local archives, raw browser DOM |
| Detail | Metadata/snippet/summary and locked encrypted chunk availability | Full normalized messages unless future key unlock exists |
| Extension before sync | Nothing from the capture | Browser-local queue/history |
| Local CLI | Full local imported history | Not uploaded unless the user runs sync |

---

## 14. Accessibility

- Text contrast should meet WCAG AA.
- Token pairs used for body text, buttons, badges, and focus rings must be checked against WCAG AA before release.
- Do not encode status by color only.
- All icon-only controls need accessible labels and tooltips.
- Keyboard navigation must work for search, result list, detail, and extension popup.
- Focus states must be visible.
- Focus rings should use either clay or aqua with at least 2px width and enough offset to remain visible on cream, paper, sage, and clay surfaces.
- Motion must respect `prefers-reduced-motion`; the interface must remain understandable when animation is disabled.

### Preferred Contrast Pairs

These pairs should be used before inventing new combinations:

| Use | Background | Text / foreground |
|-----|------------|-------------------|
| Body text | `--rb-paper` or `--rb-cream` | `--rb-ink` |
| Warm emphasis | `--rb-paper` | `--rb-espresso` |
| Primary button | `--rb-clay` or `--rb-clay-dark` | `--rb-cream` |
| Private badge | `--rb-espresso` | `--rb-cream` |
| Synced badge | `--rb-sage` | `--rb-ink` |
| Technical hint | `--rb-paper` | `--rb-espresso` with aqua marker |
| Focus ring | cream, paper, or sage surface | `--rb-clay` or `--rb-aqua` |

### Keyboard Path

Default keyboard order:

1. Search input.
2. Query filters and Source Spine controls.
3. Archive Tray results.
4. Selected tile actions.
5. Detail Layer.
6. Back to results.

The extension follows the same pattern: page status, save/import action, bridge state, recent captures, search/history, settings.

---

## 15. Do / Don't

### Do

- Use warm neutrals as the base.
- Make primary actions obvious.
- Keep search central.
- Show local/import/sync status clearly.
- Use rounded, clean, decisive shapes.
- Use the Soft Archive Tile metaphor consistently.
- Use distinctive typography instead of generic SaaS defaults.
- Keep the product feeling safe and durable.

### Don't

- Make it look like a crypto dashboard.
- Use cold neon AI gradients as the main identity.
- Hide cloud/privacy boundaries.
- Turn Web into a full chat client.
- Use mascot-style visuals.
- Add decorative cards, blobs, or visual noise that does not serve the workflow.
- Use Inter, Roboto, Arial, or pure system fonts as the primary brand expression.

---

## 16. Frontend Design Compliance Checklist

Before shipping a visual implementation, it should satisfy the frontend-design standard:

- Is the aesthetic direction obvious within 3 seconds?
- Does the screen contain the Soft Archive Tile motif or another deliberate RecallBase-specific visual signature?
- Does the screen include at least one non-negotiable brand moment: Source Spine, Archive Tray, Aqua Recall Line, Clay Privacy Seal, or Tile Stack Reveal?
- Are typography choices distinctive and non-generic?
- Does the background have subtle atmosphere without hurting readability?
- Does motion have one clear, polished moment rather than scattered noise?
- Does the layout avoid default dashboard patterns?
- Does the UI still feel fast, private, and operational?
- If the logo is removed from the screenshot, would the UI still be recognizable as RecallBase rather than Notion, Linear, a browser history page, or an admin template?
- Does the implementation avoid the failure mode of beige page, white cards, thin borders, and no brand structure?

---

## 17. Implementation Checklist

Before shipping a Web or extension UI change:

- Does the screen preserve the warm archive feeling?
- Is search or capture the obvious primary action?
- Can the user tell local-only, imported, queued, and synced states apart?
- Does the copy avoid overpromising cloud backup?
- Is all product-facing copy in English?
- Are colors taken from the approved token set?
- Does text fit on mobile and desktop?
- Are controls keyboard-accessible?
- Does the UI avoid unnecessary dashboard sprawl?
- Do async actions use the shared toast/notice pattern with clear success, fallback, and failure feedback?

---

## 18. Brand Asset Manifest

Canonical logo assets live in `assets/brand/`.

- Treat `recallbase-logo-source.png` as the approved primary logo direction.
- Use `recallbase-logo-mark.png` as the primary app icon and product mark.
- Do not use the experimental vector redraw as the primary product logo; it loses the approved logo's warmth and material quality.
- Use `recallbase-logo-toolbar.svg` only as the source for small browser toolbar and favicon exports so 16px and 32px sizes keep enough contrast. It is intentionally cropped tighter and visually simpler than the primary mark for browser toolbar clarity, with longer white document lines, a heavier balanced balloon-like clay recall loop, and thin cream separation stroke.
- Use `recallbase-logo-lockup.png` or `recallbase-logo-lockup-1024w.png` for brand headers and larger product surfaces.
- Use `recallbase-wordmark.png` only when the mark is already visible nearby.
- Extension icon exports are mirrored to `apps/extension/public/icon-*.png`.
- Web favicon and reusable brand assets are mirrored to `apps/web/public/`.

The primary brand assets are transparent PNG exports from the approved raster logo concept. The toolbar SVG intentionally simplifies the symbol for extreme small-size clarity and is not a replacement for the primary mark.
