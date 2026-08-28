# Technowiz Icon System

Batch 001 contains the first 100 icons.

Files:

- `tws-icons-001-100.svg` - visual 10x10 icon sheet.
- `tws-icons-sprite.svg` - reusable SVG symbol sprite.
- `tws-icons-manifest.json` - icon IDs, names, and categories.

## Design Rules

- 24px viewBox.
- 1.8px stroke.
- Rounded line caps and joins.
- Base icon uses `currentColor`.
- Brand accent uses the official R2 crown-spark in `#c77a15`.
- Icons should remain recognizable using industry-standard metaphors.
- The crown-spark should be subtle and secondary, not the main symbol.

## Growth Plan

The system is structured to grow to 500 icons in five 100-icon batches:

- 001-100: core navigation, files, security, status, product, and system icons.
- 101-200: advanced file operations, media workflows, licensing, support, and QA.
- 201-300: dashboard, analytics, commerce, settings, automation, and integrations.
- 301-400: product-specific NoDupe and PDF Compressor workflow states.
- 401-500: marketing, documentation, platform, localization, and enterprise/governance icons.

Regenerate the current batch with:

```bash
node ./scripts/generate-tws-icon-sheet.mjs
```
