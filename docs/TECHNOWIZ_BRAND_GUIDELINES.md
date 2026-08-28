# Technowiz Solutions Brand Guidelines

Version: prototype 1
Date: 2026-08-24

## Package Map

This is an internal brand package, not a public website page.

- Package index: `marketing-package/README.md`
- Website-ready TypeScript tokens: `../lib/brand-system.ts`
- Master brand logos: `marketing-package/master/logos/`
- Master JSON design tokens: `marketing-package/master/tokens/design-tokens.json`
- Master CSS token starter: `marketing-package/master/tokens/brand-tokens.css`
- Master 500-icon system: `marketing-package/master/icons/`
- Product app logos: `marketing-package/products/`
- Logo and icon concepts: `marketing-package/LOGO_ICON_CONCEPTS.md`
- Archived explorations: `marketing-package/archive/`
- Website copy briefs: `marketing-package/WEBSITE_COPY_BRIEFS.md`
- Social and media templates: `marketing-package/SOCIAL_MEDIA_TEMPLATES.md`

## Brand Role

Technowiz Solutions is an umbrella software company for focused, local-first desktop products and related IT-enabled services. The brand should not read as a generic outsourcing shop. It should read as a modern product engineering company with enough enterprise discipline to be trusted for serious file workflows.

Core position:

> Local-first software for high-trust file decisions.

Company scope:

- Digital software product development, design, marketing, licensing, import, export, and sale.
- Applications, utilities, and workflow products.
- ITES, consulting, advisory, and support services.

## Brand Promise

Technowiz products help users understand what will happen, why it is recommended, and how to stay in control before making changes to local files.

This promise should show up in every product page:

- Files stay local unless the user explicitly opens checkout or support.
- Recommendations are explained in plain language.
- Risky operations have previews, review states, recovery paths, or audit trails.
- The product is honest about capability limits.

## Personality

Technowiz Solutions should feel:

- Precise
- Trustworthy
- Product-led
- Modern
- Practical
- Calm under pressure
- Slightly enterprise, without becoming stiff

Avoid:

- Buzzword-heavy AI language
- Overpromising automation
- Generic "save time and money" copy
- Consumer-cleaner hype
- Dark, abstract, crypto-like visuals
- Dense corporate jargon

## Messaging Architecture

Umbrella headline pattern:

- "Technowiz Solutions builds local-first software for high-trust file work."
- "Software that helps people decide before they change important files."
- "Focused desktop products for privacy-sensitive file workflows."

Product headline pattern:

- NoDupe: "Build one trusted library from messy backups without deleting the wrong copy."
- PDF Compressor: "Compress PDFs locally, preview the result, and understand exactly what changed."

Proof pattern:

1. Say the high-trust outcome.
2. Name the workflow that makes it believable.
3. Surface implementation proof without burying the user in architecture.

Example:

"NoDupe protects Master folders, verifies copy-to-Master actions, and logs cleanup work locally before redundant Target files are removed."

## Market Positioning Notes

Common category patterns observed:

- PDF compressors lead with drag-and-drop, speed, browser convenience, selectable compression levels, security claims, and file-size reduction.
- Online PDF tools commonly reassure users with encryption, deletion windows, compliance badges, or scale/trust numbers.
- Duplicate cleaner pages lead with storage recovery, scan breadth, photo/music/video support, auto-selection, safe deletion, and visual preview.
- Established utility brands lean heavily on "safe", "trusted", download counts, reviews, and easy start CTAs.

Technowiz should borrow the clarity but sharpen the promise:

- Compete on confidence, not just compression or detection.
- Lead with local privacy where browser tools require upload.
- Lead with decision workflow where duplicate cleaners mostly say scan, select, delete.
- Use architecture proof only when it reinforces trust.

Research references used for this prototype:

- Adobe Acrobat PDF compression docs: https://experienceleague.adobe.com/en/docs/document-cloud-learn/acrobat-learning/advanced-tasks/prepare/reduce
- Adobe online PDF compressor: https://www.adobe.com/acrobat/online/compress-pdf.html
- Smallpdf PDF compressor: https://smallpdf.com/compress-pdf
- iLovePDF PDF compressor: https://www.ilovepdf.com/compress_pdf
- Duplicate Cleaner: https://www.duplicatecleaner.com/index.html
- Duplicate Finder: https://www.duplicatefinder.com/
- CCleaner product policy and safety positioning: https://www.ccleaner.com/legal/products-policy
- Gemini 2 App Store listing: https://apps.apple.com/us/app/gemini-2-the-duplicate-finder/id1090488118

## Logo System

Primary wordmark:

- Text: Technowiz Solutions
- Mark: compact "TW" monogram
- Shape: 8px-radius square or shield-like container
- Style: engineered, simple, readable at favicon scale

Primary lockup:

- TW mark on the left
- Wordmark on the right
- Use on website header, invoices, pitch decks, and product splash screens

Compact mark:

- TW only
- Use for favicon, app launcher, footer stamps, and social avatars

Logo construction:

- Mark container: 1:1 ratio
- Inner initials: centered, uppercase, medium-bold
- Clear space: at least one-half mark width around the lockup
- Minimum digital size: 32px for compact mark, 120px wide for full lockup

Do not:

- Add gradients inside the initials.
- Put the mark on low-contrast backgrounds.
- Stretch the mark.
- Replace TW with product initials on umbrella-brand surfaces.

## Color System

The palette is designed to feel technical and trustworthy without becoming a one-note blue brand.

Primary:

- Ink: #102033
- Signal Blue: #2356d9
- Trust Teal: #008f7a

Support:

- Action Amber: #c77a15
- Review Rose: #d94b5c
- Verified Green: #198754

Neutrals:

- Canvas: #f8fafc
- Panel: #ffffff
- Line: #d9e1ea
- Text Muted: #667085

Recommended usage:

- Ink for brand mark, headlines, strong text.
- Signal Blue for primary CTAs and product selection.
- Trust Teal for safety, privacy, local processing, and explainability.
- Amber for pending review, warnings, staged actions.
- Rose only for destructive or risk states.
- Green for verified, complete, and recovered states.

Accessibility rule:

- Do not use color alone to communicate state.
- Buttons and badges need readable text contrast.
- Keep large text on near-white or ink backgrounds.

## Typography

Current website implementation:

- Primary UI and marketing font: Geist Sans.
- Technical/code font: Geist Mono.
- Fallback stack: Arial, Helvetica, sans-serif.

Type roles:

- Hero H1: direct product/company promise. Keep it short.
- Section H2: plain-English positioning statement.
- H3: concrete capability or proof point.
- Body: practical explanation, not slogans.
- Mono: version labels, file paths, technical tokens, short product specs.

Avoid:

- Negative letter spacing.
- Viewport-width font scaling.
- Oversized headings inside compact panels.

## Icon Language

Icon style:

- 24px grid for interface icons.
- 2px stroke or solid simple geometry.
- 8px outer radius when an icon needs a container.
- Minimal detail, no shadows inside icons.

Core umbrella icons:

- Local device: desktop window with storage bar.
- Explain: document with checkline.
- Shield: protected workflow.
- Preview: split pane before/after.
- Recover: clockwise restore arrow.
- Audit: list with export marker.

Product-specific icon directions:

- NoDupe: overlapping folders with one protected check mark.
- PDF Compressor: document page with compression rails and a preview split.

## Product Page Formula

Each page should follow this order:

1. Immediate product outcome.
2. Why the existing market is insufficient.
3. The Technowiz wedge.
4. Three-step workflow.
5. Trust proof.
6. Audience.
7. Pricing or availability CTA.

NoDupe product story:

- Commodity job: find duplicates and reclaim storage.
- Technowiz wedge: safe consolidation into a trusted library.
- Proof: Master/Target roles, protected originals, verified copy-to-Master, Recycle Bin default, optional VSS, audit logs, capability reporting.

PDF Compressor product story:

- Commodity job: make a PDF smaller.
- Technowiz wedge: local compression confidence.
- Proof: Smart Analyze, Auto per-resource strategy, actual full-page preview, no upload service, preserved text/vector content, per-format reporting.

## Website Visual Direction

Use:

- Full-width sections.
- Dense but readable product evidence.
- Real product icons and product-specific interface previews.
- Clear CTAs.
- Calm white/canvas backgrounds with selective dark sections.
- Enterprise signals such as proof rows, governance language, auditability, support readiness, and clear product scopes.

Avoid:

- Generic SaaS hero illustrations.
- Abstract gradient blobs.
- Decorative cards nested inside other cards.
- Pure hype sections without product proof.
- Overly playful colors, mascots, or novelty copy.

## Voice Examples

Use:

- "Preview the actual output before saving."
- "Master folders stay protected."
- "Unsupported formats are disclosed instead of silently skipped."
- "The app works locally; checkout is the only intentional online step."

Avoid:

- "AI-powered magic cleanup."
- "One click fixes everything."
- "Military-grade compression."
- "Never lose files again."

## Social And Marketing Templates

Launch post:

"Technowiz Solutions is building local-first desktop products for high-trust file workflows. Our first product stories are NoDupe, for safe library consolidation, and PDF Compressor, for private PDF optimization with real preview-before-save confidence."

NoDupe short ad:

"Old drives, copied folders, and backup sprawl? NoDupe helps you build one trusted library with protected Master folders, explainable keep decisions, and recoverable cleanup."

PDF Compressor short ad:

"Compress PDFs without uploading them. PDF Compressor analyzes the document locally, chooses a safe strategy, and lets you preview the actual output before saving."

Meta description:

"Technowiz Solutions builds local-first Windows software products for privacy-sensitive file workflows, including NoDupe and PDF Compressor."

## Asset Checklist

Needed next:

- Final vector TW logo.
- Product screenshots from real NoDupe and PDF Compressor builds.
- Favicon and app-icon export set.
- Social preview card.
- Product-specific pricing blocks once offers are final.
- Customer/support email and legal footer details.
