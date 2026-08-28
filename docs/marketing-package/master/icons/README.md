# Technowiz Master Icon System

This is the active shared icon system for Technowiz Solutions products.

Files:

- `tws-icons-001-500.svg` - visual master sheet with 500 icons.
- `tws-icons-001-500-dark.svg` - dark-background visual master sheet with 500 icons.
- `tws-icons-001-100.svg` - batch 1 review sheet.
- `tws-icons-101-200.svg` - batch 2 review sheet.
- `tws-icons-201-300.svg` - batch 3 review sheet.
- `tws-icons-301-400.svg` - batch 4 review sheet.
- `tws-icons-401-500.svg` - batch 5 review sheet.
- `tws-icons-001-100-dark.svg` through `tws-icons-401-500-dark.svg` - dark-background batch review sheets.
- `tws-icons-sprite.svg` - reusable SVG symbol sprite.
- `tws-icons-manifest.json` - IDs, display names, and categories.

## Rules

- Industry-standard icon metaphors stay primary.
- The official R2 crown-spark is a small brand accent, not the main shape.
- Base icons use `currentColor`.
- Accent spark uses `#c77a15`.
- Light and dark sheets are presentation exports only; the sprite stays themeable.
- 24px viewBox.
- 1.8px base stroke.
- 1.55px modifier stroke.
- Rounded caps and joins.

## Structure

The first 100 icons are base concepts. The remaining 400 extend the set with standard states and modifiers:

- checked
- add
- remove
- locked
- alert

This gives each app a broad shared language without inventing unfamiliar product metaphors.

Regenerate with:

```bash
node ./scripts/generate-tws-icon-sheet.mjs
```
