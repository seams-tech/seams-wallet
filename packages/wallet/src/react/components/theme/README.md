# Theming

A single theme module powers the UI using a scoped token → CSS variable system applied via a provider and a boundary element.

## Exports (single module)

- `Theme` provides theme context and renders a boundary with CSS variables, `data-seams-root`, `data-seams-theme`, and the `seams-theme-provider` class.
- `useTheme` — reads from context and returns `{ theme, tokens, isDark }`.

Import from the barrel for clarity:

```
import { Theme, useTheme } from '@seams/wallet/react';
// or within this repo: from '../theme'
```

## Token → CSS Variable Mapping

Tokens are defined in `design-tokens.ts` and converted to CSS custom properties with a prefix (default `--seams`) via `createCSSVariables` in `utils.ts`.

- Colors: `tokens.colors.<key>` → `--<prefix>-colors-<key>`
- Spacing: `tokens.spacing.<key>` → `--<prefix>-spacing-<key>`
- Radius: `tokens.borderRadius.<key>` → `--<prefix>-border-radius-<key>`
- Shadows: `tokens.shadows.<key>` → `--<prefix>-shadows-<key>`

The mapping is applied inline by the `Theme` boundary element.

## Naming Convention

- Token keys are lowerCamelCase (e.g., `colorBackground`, `textSecondary`).
- CSS variables are prefixed with `--seams` by default. Change via `Theme`'s `prefix` prop to avoid collisions when embedding.

Examples in CSS:

- Background: `background-color: var(--seams-colors-colorBackground);`
- Border: `border-color: var(--seams-colors-borderPrimary);`
- Text: `color: var(--seams-colors-textPrimary);`
- Hover border: `border-color: var(--seams-colors-borderHover);`

## Controlled Only

- Pass `theme="dark" | "light"` and treat the host app as the source of truth.
- `Theme` does not persist or auto-derive theme state; it only reflects the provided value.

## Token Overrides (per instance)

Pass partial overrides for dark/light only for the keys you need to change:

```
<Theme tokens={{
  dark: { colors: { colorBackground: 'oklch(0.25 0.012 240)' } },
  light: { colors: { borderHover: '#cbd5e1' } }
}} tag="div" className="wallet-theme">
  ...
```

You can also provide a function to compute overrides from the base tokens via the `tokens` prop.

## CSS Color Variables (reference)

The following CSS variables are generated from `tokens.colors.*` with the default prefix `--seams`.

```
/* Color variables applied on the Theme boundary (default prefix: --seams) */
--seams-colors-primary
--seams-colors-primaryHover
--seams-colors-secondary
--seams-colors-accent
--seams-colors-textPrimary
--seams-colors-textSecondary
--seams-colors-textMuted
--seams-colors-colorBackground
--seams-colors-surface
--seams-colors-surface2
--seams-colors-hover
--seams-colors-active
--seams-colors-focus
--seams-colors-success
--seams-colors-warning
--seams-colors-error
--seams-colors-info
--seams-colors-highlightPrimary
--seams-colors-highlightHalo
--seams-colors-highlightReceiver
--seams-colors-highlightMethodName
--seams-colors-highlightAmount
--seams-colors-borderPrimary
--seams-colors-borderSecondary
--seams-colors-borderHover
```

## Component styles and application CSS

Import `@seams/wallet/react/styles` to load the SDK styles.
`Theme` always retains `data-seams-root` and `seams-theme-provider`, including when you pass a custom class or theme attribute.
Standalone SDK overlays apply their own theme boundary. Keep the boundary inside the portal when you portal an SDK component.

Themed component selectors start with `[data-seams-root].seams-theme-provider` and use component classes.
A single component class gives specificity `0,3,0`: three class or attribute selectors.
Native controls add their element type, for example `button.seams-account-back`.
This keeps component defaults stronger than the shared reset and broad application selectors such as `.app button[type]`.
The default stylesheet includes all component rules after the shared reset.
External wallet pickers, device linking, and the settings page establish their own theme boundaries.
Standalone icons carry their own namespace and honor their size and style props.
Host-page overlay frames use the same namespace. The wallet UI inside its iframe is isolated from application styles.
The SDK uses no `!important` declarations to enforce this boundary.
Controls inside SDK surfaces receive explicit defaults. Other application controls retain their styles.

Use theme tokens or `--seams-*` variables for routine customization.
For structural changes, load a matching component selector after the SDK stylesheet:

```css
[data-seams-root].seams-theme-provider
  .seams-profile-dropdown-menu
  button.seams-dropdown-menu-item {
  padding-block: 10px;
}
```
