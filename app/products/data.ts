export type Product = {
  slug: string;
  name: string;
  category: string;
  platform: string;
  icon: string;
  headline: string;
  shortPitch: string;
  longPitch: string;
  cta: string;
  metrics: { label: string; value: string }[];
  highlights: string[];
  workflow: { step: string; title: string; detail: string }[];
  proof: string[];
  audience: string[];
  visual: 'nodupe' | 'pdf';
};

export const products: Product[] = [
  {
    slug: 'nodupe',
    name: 'NoDupe',
    category: 'Duplicate file cleaner',
    platform: 'Windows desktop',
    icon: '/nodupe-icon.png',
    headline: 'Build one trusted library from messy backups without deleting the wrong copy.',
    shortPitch:
      'NoDupe finds exact and similar files across photos, videos, audio, documents, archives, and backups, then helps users review what is safe to clean.',
    longPitch:
      'NoDupe is positioned for people with years of downloads, copied folders, old drives, phone imports, and backup sprawl. The product story is not just disk space. It is safe consolidation: compare trusted Master folders against cleanup Targets, preserve originals, explain why a copy is recommended, and recover from actions when needed.',
    cta: 'Review NoDupe',
    metrics: [
      { label: 'Install footprint target', value: '~14 MB app' },
      { label: 'Scan modes', value: 'Exact, Similar, Deep' },
      { label: 'Trial model', value: 'Mode-counted free scans' },
    ],
    highlights: [
      'Exact, perceptual, audio, video, document, MIDI, and ZIP duplicate detection',
      'Master/Target Compare and stricter Consolidate Folders workflows',
      'Explainable keep recommendations with protected original handling',
      'Recycle Bin by default, optional VSS Guaranteed Undo, deletion history, and audit logs',
      'Explorer right-click integration, scheduled scans, local cloud-folder quick-add',
      'Business audit-log export for reviewable cleanup operations',
    ],
    workflow: [
      {
        step: '01',
        title: 'Select trusted and cleanup folders',
        detail:
          'Mark Master locations as protected and Target locations as candidates for cleanup.',
      },
      {
        step: '02',
        title: 'Review plain-English outcomes',
        detail:
          'See safe-to-clean, missing-from-master, better-copy, unique, and needs-review groups.',
      },
      {
        step: '03',
        title: 'Copy, verify, then clean',
        detail:
          'Copy missing files into the trusted library, verify size and hash, then clean redundant Target copies.',
      },
    ],
    proof: [
      'Rust backend with Tauri 2 and React frontend for native Windows performance.',
      'Capability-aware format reporting tells users when files were fully analyzed or exact-only.',
      'Action logs, crash logs, signed license cache, and recovery surfaces support trust claims.',
    ],
    audience: [
      'Home users consolidating old drives and phone imports',
      'Creators cleaning photo, video, and audio libraries',
      'Small teams needing reviewable cleanup and audit exports',
    ],
    visual: 'nodupe',
  },
  {
    slug: 'pdf-compressor',
    name: 'PDF Compressor',
    category: 'Local PDF optimizer',
    platform: 'Windows desktop',
    icon: '/pdf-compressor-icon.png',
    headline: 'Compress PDFs locally, preview the result, and understand exactly what changed.',
    shortPitch:
      'PDF Compressor turns a commodity task into a visual, controllable workflow: analyze the document, recommend a strategy, preview before saving, and keep PDF bytes on-device.',
    longPitch:
      'PDF Compressor is built for users who need smaller PDFs but cannot treat documents like disposable uploads. The product story centers on privacy, explainability, full-page before-and-after review, per-format reporting, and smarter Auto compression instead of blind quality sliders.',
    cta: 'Review PDF Compressor',
    metrics: [
      { label: 'Privacy posture', value: '100% local file handling' },
      { label: 'Optimization modes', value: 'Auto plus presets' },
      { label: 'Free tier', value: '5 free compressions' },
    ],
    highlights: [
      'Fully local PDF processing with no telemetry or document upload service',
      'Smart Analyze explains document composition, opportunities, and preservation decisions',
      'Full-page original vs compressed preview using a crash-isolated PDFium renderer',
      'Auto resolves per-resource strategies instead of forcing one global quality setting',
      'Batch compression, CLI automation, and Explorer context-menu integration',
      'Per-format reporting for JPEG, CCITT, JBIG2, Flate, CMYK, and JPEG2000 handling',
    ],
    workflow: [
      {
        step: '01',
        title: 'Drop a PDF',
        detail:
          'The app registers the source locally and opens the comparison workspace immediately.',
      },
      {
        step: '02',
        title: 'Analyze and resolve strategy',
        detail:
          'Auto decides what to recompress, downscale, optimize losslessly, or preserve.',
      },
      {
        step: '03',
        title: 'Preview before saving',
        detail:
          'Users inspect actual rendered pages and save only after accepting the result.',
      },
    ],
    proof: [
      'Rust optimizer built on lopdf and image, with native codecs isolated in sidecars.',
      'Text and vector content are preserved; raster images are changed only when beneficial.',
      'Offline license cache and local usage guard keep the core workflow account-free.',
    ],
    audience: [
      'Professionals preparing documents for email or upload limits',
      'Privacy-sensitive users who avoid cloud PDF processing',
      'Teams with repeated PDF optimization and batch needs',
    ],
    visual: 'pdf',
  },
];

export function getProduct(slug: string) {
  return products.find((product) => product.slug === slug);
}
