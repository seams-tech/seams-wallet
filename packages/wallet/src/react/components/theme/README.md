# Theming

A single theme module powers the UI using a scoped token → CSS variable system applied via a provider and a boundary element.

## Exports (single module)

- `Theme` — consolidated component. By default provides theme context and renders a boundary that applies CSS variables and `data-seams-theme`. `mode` controls behavior: `'provider+scope' | 'provider-only' | 'scope-only'`.
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
}} as="div" className="seams-theme-provider">
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

## Notes

- `variables.css` in AccountMenuButton is legacy and safe to remove if unused.
