export type Product = {
  slug: string;
  path: string;
  name: string;
  category: string;
  platform: string;
  icon: string;
  seoTitle: string;
  seoDescription: string;
  keywords: string[];
  headline: string;
  shortPitch: string;
  longPitch: string;
  moat: {
    title: string;
    detail: string;
    against: string;
    proofLabel: string;
  };
  cta: string;
  metrics: { label: string; value: string }[];
  highlights: string[];
  workflow: { step: string; title: string; detail: string }[];
  proof: string[];
  audience: string[];
  page: {
    eyebrow: string;
    promise: string;
    marketTitle: string;
    marketCopy: string;
    advantageTitle: string;
    advantageCopy: string;
    individualUse: {
      title: string;
      intro: string;
      points: string[];
    };
    businessUse: {
      title: string;
      intro: string;
      points: string[];
    };
    comparison: { title: string; detail: string }[];
    coverage: { title: string; detail: string }[];
    scanModes?: {
      title: string;
      intro: string;
      modes: { name: string; label: string; detail: string }[];
    };
    outcomes: { title: string; detail: string }[];
    heroSlides?: { eyebrow: string; headline: string; copy: string }[];
    finalTitle: string;
    finalCopy: string;
  };
  visual: 'nodupe' | 'pdf';
};

export const products: Product[] = [
  {
    slug: 'nodupe',
    path: '/nodupe',
    name: 'NoDupe',
    category: 'Duplicate file cleaner',
    platform: 'Windows desktop',
    icon: '/nodupe-n1c-light-bg.svg',
    seoTitle: 'NoDupe duplicate file cleaner for Windows',
    seoDescription:
      'NoDupe helps Windows users find duplicate files, spot similar photos, audio, video, and documents, and clean file libraries with review and recovery.',
    keywords: [
      'NoDupe',
      'duplicate file cleaner',
      'duplicate file finder for Windows',
      'photo duplicate cleaner',
      'backup drive cleanup software',
      'file consolidation tool',
      'safe duplicate removal',
    ],
    headline: 'Find duplicate files without turning cleanup into guesswork.',
    shortPitch:
      'NoDupe finds exact duplicates, similar files, and deeper media or document matches so users can clean storage with more confidence.',
    longPitch:
      'NoDupe is a Windows duplicate cleaner for real file mess: copied folders, photos, videos, music, documents, archives, old drives, and backup sprawl. It starts with fast exact duplicate detection, adds similarity checks where they help, and offers deeper analysis for harder cases.',
    moat: {
      title: 'Find duplicates, compare similar files, and clean with review.',
      detail:
        'NoDupe is built for people who need more than a list of matching filenames. It finds byte-for-byte duplicates, flags similar media and documents, explains why a file is recommended to keep, and keeps cleanup decisions reviewable.',
      against:
        'Many duplicate cleaners focus on a quick scan and delete flow. That can miss similar files, edited documents, re-encoded media, or the safety questions users face before cleanup.',
      proofLabel: 'Exact, Similar, and Deep detection',
    },
    cta: 'Review NoDupe',
    metrics: [
      { label: 'Detection modes', value: 'Exact, Similar, Deep' },
      { label: 'Best for', value: 'Photos, media, documents, backups' },
      { label: 'Cleanup model', value: 'Review first, recover if needed' },
    ],
    highlights: [
      'Find byte-for-byte duplicate files quickly with Exact mode',
      'Spot similar images, audio, and documents with Similar mode',
      'Use Deep mode for video-frame similarity, edited document versions, and broader near-duplicate review',
      'Review thumbnails, media previews, file details, and keep recommendations before cleanup',
      'Clean photos, videos, music, documents, ZIP archives, junk files, and empty folders',
      'Use Recycle Bin, optional Guaranteed Undo, history, and audit logs for safer cleanup',
    ],
    workflow: [
      {
        step: '01',
        title: 'Choose the scan depth',
        detail:
          'Use Exact for the fastest duplicate check, Similar for photos, audio, and documents, or Deep when the library needs the most careful analysis.',
      },
      {
        step: '02',
        title: 'Review what was found',
        detail:
          'NoDupe groups duplicates and similar files, shows previews, explains the detection method, and recommends what to keep.',
      },
      {
        step: '03',
        title: 'Clean with a fallback',
        detail:
          'Move files to the Recycle Bin by default, use optional Guaranteed Undo for higher-risk cleanup, and review history later if needed.',
      },
    ],
    proof: [
      'Exact mode uses full-file matching to identify files that are truly the same.',
      'Similar mode adds visual-image, audio, and document-content matching for files that changed format, size, or encoding.',
      'Deep mode adds video-frame similarity, edited document detection, looser near-duplicate review, and optional Photo Quality Review.',
      'Keep recommendations are explained with named reasons such as better resolution, cleaner filename, larger file, older date, or path order.',
      'Cleanup uses Recycle Bin by default, optional VSS-based Guaranteed Undo, persisted history, crash diagnostics, and local action logs.',
      'Business use can include exportable audit records for delete and restore activity.',
    ],
    audience: [
      'Home users consolidating old drives and phone imports',
      'Creators cleaning photo, video, and audio libraries',
      'Small teams needing reviewable cleanup and audit exports',
    ],
    page: {
      eyebrow: 'NoDupe for safer file cleanup',
      promise:
        'NoDupe is primarily a duplicate cleaner. It also gives users a deeper way to explore similar photos, re-encoded media, edited documents, archives, and backup folders when exact matching is not enough.',
      marketTitle: 'Duplicate cleanup starts with exact matches, but real file libraries are messier than that.',
      marketCopy:
        'People rarely have one neat folder with obvious copies. They have old drives, phone imports, exported albums, renamed documents, re-encoded videos, ZIP archives, and backup folders with uncertain history. NoDupe covers the straightforward duplicate-cleaner job first, then gives stronger review tools for the files that need more judgment.',
      advantageTitle: 'NoDupe is built around finding better and keeping better.',
      advantageCopy:
        'Exact, Similar, and Deep modes share the same scanning pipeline and caches, so users can start fast and go deeper when needed. The app explains what it found, why a file is recommended to keep, and where analysis was limited by file format or machine support.',
      individualUse: {
        title: 'For personal storage cleanup',
        intro:
          'NoDupe helps people clean everyday file clutter without losing the photos, videos, music, documents, and backups they actually care about.',
        points: [
          'Find exact duplicate downloads, copied folders, and repeated media files.',
          'Spot similar photos or documents that are not byte-for-byte identical.',
          'Preview files, compare details, and choose what to keep before cleanup.',
        ],
      },
      businessUse: {
        title: 'For business file libraries',
        intro:
          'NoDupe gives teams a more controlled way to review project folders, client handovers, shared drives, archived work, and repeated backups.',
        points: [
          'Use Compare and Consolidate flows when one library needs to stay protected.',
          'Review missing, better, duplicate, and needs-review outcomes before action.',
          'Use local history, recovery paths, and audit exports where cleanup needs a record.',
        ],
      },
      comparison: [
        {
          title: 'Starts with true duplicate cleaning',
          detail:
            'Exact mode is built for the core job: find files that are truly identical and help users remove redundant copies.',
        },
        {
          title: 'Goes deeper when exact is not enough',
          detail:
            'Similar and Deep modes help with resized images, re-encoded audio, video-frame matches, same-content documents, and edited document versions.',
        },
        {
          title: 'Makes safety part of the product',
          detail:
            'NoDupe pairs detection with previews, keep reasons, protected workflows, Recycle Bin cleanup, optional Guaranteed Undo, and audit-friendly records.',
        },
      ],
      coverage: [
        {
          title: 'Exact duplicate files',
          detail:
            'Fast duplicate detection using file size, partial checks, and full-file hashes.',
        },
        {
          title: 'Similar photos and media',
          detail:
            'Similarity checks for images, audio, video, and media files that may have been resized, renamed, or re-encoded.',
        },
        {
          title: 'Documents and revisions',
          detail:
            'Document content matching across PDFs, Office files, text formats, and deeper edited-version analysis.',
        },
        {
          title: 'Archives, junk, and workflows',
          detail:
            'ZIP duplicate scanning, junk and empty-folder cleanup, Explorer integration, scheduled scans, Compare, and Consolidate.',
        },
      ],
      scanModes: {
        title: 'Three ways to look at the same file mess',
        intro:
          'NoDupe lets users start with the clean duplicate-cleaner job and move deeper only when the files deserve more review.',
        modes: [
          {
            name: 'Exact',
            label: 'Fast duplicate cleanup',
            detail:
              'Find files that are truly identical. Best for downloads, copied folders, repeated exports, and obvious storage waste.',
          },
          {
            name: 'Similar',
            label: 'Everyday near-match review',
            detail:
              'Explore similar photos, same-content documents, and re-encoded audio where the file changed but the content may be the same.',
          },
          {
            name: 'Deep',
            label: 'Exploratory analysis',
            detail:
              'Go further into video-frame similarity, edited document versions, broader image near-duplicates, and optional photo quality signals.',
          },
        ],
      },
      outcomes: [
        {
          title: 'Trusted folders stay protected',
          detail:
            'Master locations are treated as the library to preserve, not another place to casually clean.',
        },
        {
          title: 'Cleanup becomes explainable',
          detail:
            'Users see whether files are safe to remove, missing from the library, better copied first, or need review.',
        },
        {
          title: 'Actions can be reviewed later',
          detail:
            'History, recovery options, and audit records support serious cleanup work where proof matters.',
        },
      ],
      heroSlides: [
        {
          eyebrow: 'NoDupe duplicate cleaner',
          headline: 'Find duplicate files without guesswork.',
          copy:
            'Start with the core cleanup job: find true duplicate files across folders, drives, photos, videos, music, documents, archives, and backups.',
        },
        {
          eyebrow: 'Similarity and Deep analysis',
          headline: 'Find similar, edited, and re-encoded files.',
          copy:
            'Use Similar and Deep modes to explore near-duplicate photos, re-encoded audio or video, same-content documents, edited revisions, and quality clues before deciding what to keep.',
        },
      ],
      finalTitle: 'Ready to turn file clutter into a trusted library?',
      finalCopy:
        'Use NoDupe when duplicate cleanup needs strong detection, clear review, and practical recovery.',
    },
    visual: 'nodupe',
  },
  {
    slug: 'pdf-compressor',
    path: '/pdf-compressor',
    name: 'PinchPDF',
    category: 'Local PDF optimizer',
    platform: 'Windows desktop',
    icon: '/pdf-compressor-p4e-light-bg.svg',
    seoTitle: 'PinchPDF local PDF optimizer for Windows',
    seoDescription:
      'PinchPDF helps Windows users make PDFs smaller locally, preview the result, and save only when the output looks right.',
    keywords: [
      'PinchPDF',
      'local PDF compressor',
      'PDF optimizer for Windows',
      'offline PDF compression',
      'compress PDF locally',
      'PDF compression software',
      'private PDF compressor',
    ],
    headline: 'Make PDFs smaller without uploading them or guessing settings.',
    shortPitch:
      'PinchPDF keeps documents on your computer, explains the compression opportunity, and lets you preview the result before saving.',
    longPitch:
      'Most online PDF tools ask users to upload sensitive documents and hope the output is acceptable. PinchPDF is built for a safer workflow: open the file locally, understand what can be reduced, preview the actual output, and save only after review.',
    moat: {
      title: 'Smaller files with a review step before save.',
      detail:
        'PinchPDF helps users reduce file size while keeping control over privacy, visual quality, and the final saved document.',
      against:
        'Many PDF tools hide the tradeoff behind a single upload-and-compress button.',
      proofLabel: 'Local preview-first compression',
    },
    cta: 'Review PinchPDF',
    metrics: [
      { label: 'Best for', value: 'Private PDFs and upload limits' },
      { label: 'Review model', value: 'Preview before save' },
      { label: 'Workflows', value: 'Single files and batches' },
    ],
    highlights: [
      'Compress private PDFs without sending them to an upload service',
      'See what kind of document you are working with before choosing an output',
      'Preview original and compressed pages side by side before saving',
      'Use Auto for sensible compression choices across mixed document types',
      'Handle single files, batches, and repeated desktop workflows',
      'Save through the normal Windows file flow only after accepting the result',
    ],
    workflow: [
      {
        step: '01',
        title: 'Open the PDF locally',
        detail:
          'Drop a PDF or choose one from the file picker. The document stays on the computer.',
      },
      {
        step: '02',
        title: 'Understand the opportunity',
        detail:
          'The app shows where size can be reduced and chooses a sensible compression approach.',
      },
      {
        step: '03',
        title: 'Preview before saving',
        detail:
          'Review the compressed PDF visually, then save the file only when the result is acceptable.',
      },
    ],
    proof: [
      'Built for users who cannot treat private documents like disposable uploads.',
      'Makes compression decisions visible instead of hiding them behind a blind preset.',
      'Supports everyday desktop work: batches, Explorer integration, and a command-line path for repeat jobs.',
    ],
    audience: [
      'Professionals preparing documents for email or upload limits',
      'Privacy-sensitive users who avoid cloud PDF processing',
      'Teams with repeated PDF optimization and batch needs',
    ],
    page: {
      eyebrow: 'PinchPDF for private document work',
      promise:
        'For people who need smaller PDFs but cannot casually upload documents, PinchPDF keeps the work local and puts review before save.',
      marketTitle: 'Online compressors make PDFs smaller, but the workflow often asks users to trust a black box.',
      marketCopy:
        'Common PDF tools lead with upload, compress, and download. That may be fine for disposable files, but it is not a strong fit for private documents, client records, internal reports, signed files, or repeated desktop work.',
      advantageTitle: 'PinchPDF is built around compression confidence.',
      advantageCopy:
        'The product analyzes the file locally, explains the compression opportunity, chooses a sensible strategy, and lets users preview the actual output before they save. The promise is not just a smaller PDF. It is control over the tradeoff.',
      individualUse: {
        title: 'For personal document tasks',
        intro:
          'PinchPDF is for users who need to send, upload, archive, or share PDFs without giving private documents to a website first.',
        points: [
          'Reduce PDFs for email, forms, portals, applications, and upload limits.',
          'Keep personal documents on the computer during compression.',
          'Preview the result before saving over or sharing a smaller file.',
        ],
      },
      businessUse: {
        title: 'For business document work',
        intro:
          'PinchPDF helps teams handle reports, proposals, invoices, scanned documents, client files, and recurring PDF batches with a more controlled desktop workflow.',
        points: [
          'Avoid uploading confidential documents to browser-based compression tools.',
          'Use repeatable compression for document-heavy teams and shared workflows.',
          'Review quality before files are sent to clients, portals, or internal systems.',
        ],
      },
      comparison: [
        {
          title: 'Local by design',
          detail:
            'Many PDF compressors start with an upload. PinchPDF keeps the core file work on the user machine.',
        },
        {
          title: 'Preview before save',
          detail:
            'Instead of asking users to trust the output, the product makes the before-and-after result visible.',
        },
        {
          title: 'Clearer compression choices',
          detail:
            'The app explains the compression opportunity and uses sensible automatic choices instead of hiding the tradeoff behind one button.',
        },
      ],
      coverage: [
        {
          title: 'Private PDFs',
          detail:
            'Work with documents that should not be casually uploaded to a third-party compression page.',
        },
        {
          title: 'Scans and image-heavy files',
          detail:
            'Reduce documents where large embedded images are driving file size.',
        },
        {
          title: 'Email and portal limits',
          detail:
            'Prepare PDFs for upload forms, client sharing, email attachments, and document portals.',
        },
        {
          title: 'Batches and repeat jobs',
          detail:
            'Support repeated desktop compression work across single files, batches, and automation paths.',
        },
      ],
      outcomes: [
        {
          title: 'Documents stay on the computer',
          detail:
            'The core compression workflow is local, which makes privacy easier to understand and explain.',
        },
        {
          title: 'Users see the result first',
          detail:
            'Before-and-after preview helps users catch quality issues before the optimized file becomes the saved file.',
        },
        {
          title: 'Repeated work is supported',
          detail:
            'Batch flows, desktop integration, and a command-line path make the product useful beyond one-off uploads.',
        },
      ],
      finalTitle: 'Need smaller PDFs without giving up control?',
      finalCopy:
        'Use PinchPDF when the file size matters, but privacy, quality, and review matter too.',
    },
    visual: 'pdf',
  },
];

export function getProduct(slug: string) {
  return products.find((product) => product.slug === slug);
}
