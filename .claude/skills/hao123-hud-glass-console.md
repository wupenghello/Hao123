# Hao123 HUD Glass Console

Project-specific UI redesign skill for Hao123 / TodayOps. Use this when updating popovers, modals, command palettes, dashboards, cards, status panels, or assistant-facing UI so they match the current “HUD glass console” visual system established in:

- `src/features/model-config/components/ModelConfigModal.vue`
- `src/features/chat/components/ChatCommandPalette.vue`

## When to Use

Use this skill when the user says things like:

- “按照大模型设置弹窗的标准改一下”
- “和小吴对话框/模型设置保持一致”
- “这个弹窗太丑了，优化成现在那种 HUD 风格”
- “统一工作台 UI 风格”
- “重构某个面板/弹窗/卡片的样式”
- “让它更像控制台/玻璃/HUD/科技感/线路台”

This skill is especially relevant for Vue SFCs in this project using scoped CSS and Iconify icons.

## Design Direction

### Subject

Hao123 / TodayOps is a personal workbench for 小吴. The UI should feel like a compact **operations console** rather than a generic SaaS panel. The user is configuring routes, asking an assistant, inspecting work items, launching dev services, and operating Git — so the visual language should suggest routing, signals, status, and controlled execution.

### One-line Standard

Dark navy glass surfaces, cyan-led route accents, restrained violet secondary glow, thin grid texture, visible status rails, and explicit interaction affordances.

## Token System

Use these as conceptual tokens; local component CSS may define scoped variables with component-specific prefixes.

```css
--tone: #22d3ee;          /* primary signal cyan */
--tone-2: #a78bfa;        /* secondary model/assistant violet */
--success: #34d399;
--warning: #fbbf24;
--danger: #fb7185;
--panel: rgba(6, 13, 28, 0.78);
--panel-strong: rgba(8, 17, 36, 0.88);
--border: rgba(148, 163, 184, 0.16);
--text: rgba(248, 250, 252, 0.92);
--muted: rgba(226, 232, 240, 0.52);
```

### Palette Roles

- **Primary cyan**: active route, focus, send/confirm, live status, selected model.
- **Violet**: assistant/model intelligence, secondary atmospheric glow, quality tags.
- **Green**: confirmed/healthy/available.
- **Amber**: warning, pending confirmation, waiting for configuration.
- **Rose**: destructive, failed, rejected, unreachable business errors.
- **Navy/black glass**: all surfaces; avoid flat `bg-slate-900` panels unless layered with gradient/border.

## Structural Pattern

Every major overlay should follow this hierarchy:

```text
shell/backdrop
└─ console/card
   ├─ accent beam / top rail
   ├─ header: identity + status + primary controls
   ├─ body: main content, cards, lists, forms
   ├─ contextual bars: warning/connectivity/quote/attachments
   └─ footer: low-priority help, keyboard hints, secondary metadata
```

### Required Console Traits

- Rounded but not pillowy: `10px–14px` for panels, `999px` only for pills.
- Thin border using current tone: `color-mix(in srgb, var(--tone) 14–24%, rgba(...))`.
- Subtle grid texture on large panels:

```css
background:
  linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px),
  linear-gradient(180deg, rgba(255,255,255,0.026) 1px, transparent 1px);
background-size: 28px 28px;
mask-image: linear-gradient(135deg, rgba(0,0,0,0.55), transparent 58%);
```

- At least one explicit **signal rail** on important cards:

```css
.card::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  content: '';
  background: linear-gradient(180deg, transparent, var(--tone), transparent);
  opacity: 0.72;
}
```

- Hover should usually brighten border/background and optionally `translateY(-1px/-2px)`. Do not scale large containers.
- Always include `:focus-visible` for interactive elements.
- Always include `prefers-reduced-motion` if adding animation.

## Component Patterns

### Header

Use header for identity and top-level operations. Do not bury close/clear/destructive controls in the input area or footer.

```text
[brand mark]  Eyebrow
              Title
              Subtitle
                         [status pill] [secondary action] [close]
```

Rules:

- Eyebrow should be monospace, uppercase, letter-spaced.
- Title should be 20–22px, heavy weight, slight negative letter spacing.
- Brand mark should be a square glass tile with tone glow.
- Status pill should be explicit: “线路就绪”, “等待配置”, “运行中”, “需要确认”.

### Cards and Rows

Use a common pattern for provider cards, model rows, suggestions, tool activities, and work items:

- Relative positioned.
- `overflow: hidden`.
- Border + radial glow + left signal rail.
- Active state increases border tone and shows rail.
- Use text truncation for metadata rows.

### Forms

Inputs should look like embedded console fields:

```css
input,
textarea {
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.58), rgba(2, 6, 23, 0.46));
  color: rgba(248,250,252,0.92);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.035);
}
input:focus,
textarea:focus {
  border-color: color-mix(in srgb, var(--tone) 50%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--tone) 14%, transparent);
}
```

### Buttons

Primary buttons should be bright route controls; secondary buttons should remain glass.

- Primary: cyan gradient, dark text, glow.
- Ghost: translucent glass, border, muted text, cyan border on hover.
- Danger: rose tint on hover/focus.
- Disabled: lower opacity, no glow, cursor not-allowed.

### Assistant / Chat UI

For 小吴-like UI:

- Use a header: assistant identity, live status, clear/close controls.
- User messages: command/input cards, right aligned, cyan/violet gradient.
- Assistant messages: left aligned glass information cards with signal rail.
- Tool calls: compact status cards with per-tool accent colors.
- Input composer: bottom glass strip, focus glow, send/stop as primary buttons.
- Footer: only metadata and keyboard hints; no primary operations.
- Quote/image/connectivity bars: contextual bars between message area and composer.

Avoid:

- Close button in the input row.
- Footer overloaded with primary actions.
- Floating controls with no header hierarchy.
- Message bubbles that look disconnected from tool cards.

### Modal / Settings UI

For settings-like UI:

- Two-zone layout works well: left rail for saved routes/list, main area for health/presets/forms.
- Health score blocks should read like instrument panels.
- Preset/provider cards should use provider accent as `--preset-tone` and follow the left rail + orb pattern.
- Long metadata should be monospace and truncated.

## Implementation Workflow

1. **Inspect before editing**
   - Read the target Vue file.
   - Identify template structure, existing class names, and any child components.
   - Check whether the issue is purely visual or also structural.

2. **Fix structural hierarchy first**
   - Add or normalize header/body/context/footer sections if needed.
   - Move primary controls to the header.
   - Keep contextual state near the affected area.
   - Do not change store/business logic unless explicitly needed.

3. **Unify style tokens**
   - Define scoped variables at root component card level, e.g. `--cmd-tone`, `--mm-tone`, `--gd-tone`.
   - Use the same values unless the feature has a strong reason to vary.

4. **Apply component patterns**
   - Console shell/backdrop.
   - Header mark/pill/buttons.
   - Cards/rows with signal rail.
   - Inputs and buttons.
   - Responsive and reduced-motion rules.

5. **Preserve behavior**
   - Avoid changing Pinia store contracts.
   - Avoid renaming classes consumed by JS unless updating all references.
   - Keep accessibility attributes, disabled states, and keyboard behavior.

6. **Verify**
   - Run `npm run build`.
   - If UI behavior is involved, use the project run/preview workflow to inspect the actual app.
   - Report build warnings honestly; existing chunk warnings are not UI failures.

## Self-Critique Checklist

Before delivering, check:

- [ ] Does the component now clearly belong to the same family as `ModelConfigModal.vue` and `ChatCommandPalette.vue`?
- [ ] Is there a clear identity header?
- [ ] Are primary actions in the right place?
- [ ] Are all clickable elements visibly clickable and keyboard focusable?
- [ ] Are status colors meaningful, not decorative?
- [ ] Is the footer low-priority rather than a junk drawer?
- [ ] Does mobile layout avoid horizontal scroll?
- [ ] Is `prefers-reduced-motion` respected for new animations?
- [ ] Did `npm run build` pass?

## Anti-patterns to Avoid

- Generic dark cards with only `bg-slate-900` and no hierarchy.
- Random gradients that do not encode status or route identity.
- Emoji as UI icons; use `~icons/mdi/...` imports.
- Primary actions hidden in footers.
- Invisible focus states.
- Large scale transforms on hover.
- Dense status text with no grouping.
- Mixing several unrelated glass styles in one component.
- Making style-only refactors that accidentally change user data, localStorage keys, or store behavior.

## Canonical References

Use these as live examples before making future changes:

- `src/features/model-config/components/ModelConfigModal.vue` — settings route console, provider presets, forms, model rows.
- `src/features/chat/components/ChatCommandPalette.vue` — assistant command center, message flow, tool cards, composer.

If these files evolve, prefer their current code over this document for exact CSS values, but keep this document as the design intent and checklist.
