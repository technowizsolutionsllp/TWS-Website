export const brand = {
  name: 'Technowiz Solutions',
  position: 'Local-first software for high-trust file decisions',
  promise:
    'We build practical software that helps people review, understand, and safely change important local files.',
  personality: [
    'Modern',
    'Clear',
    'Trustworthy',
    'Slightly enterprise',
    'Practical',
  ],
} as const;

export const colors = {
  ink: '#102033',
  signalBlue: '#2356d9',
  trustTeal: '#008f7a',
  actionAmber: '#c77a15',
  reviewRose: '#d94b5c',
  verifiedGreen: '#198754',
  canvas: '#f8fafc',
  panel: '#ffffff',
  line: '#d9e1ea',
  muted: '#667085',
} as const;

export const typography = {
  sans: 'Geist Sans, Arial, Helvetica, sans-serif',
  mono: 'Geist Mono, Consolas, monospace',
  rules: {
    letterSpacing: '0',
    heroLineHeight: '0.96',
    bodyLineHeight: '1.55',
  },
} as const;

export const layout = {
  pageX: 'clamp(20px, 5vw, 72px)',
  sectionY: 'clamp(62px, 8vw, 102px)',
  radius: '8px',
  buttonHeight: '46px',
} as const;

export const iconSystem = {
  grid: 24,
  stroke: 2,
  containerRadius: 8,
  concepts: [
    {
      name: 'Local device',
      use: 'Local processing, desktop products, no upload workflow',
    },
    {
      name: 'Protected workflow',
      use: 'Safety, Master folders, recovery, guarded actions',
    },
    {
      name: 'Preview split',
      use: 'Before/after review, comparison, visual confirmation',
    },
    {
      name: 'Audit trail',
      use: 'Business tier, logs, support evidence, governance',
    },
  ],
} as const;

export const voice = {
  use: [
    'Preview the actual output before saving.',
    'Master folders stay protected.',
    'Unsupported formats are disclosed instead of silently skipped.',
    'Files stay local unless the user explicitly opens checkout or support.',
  ],
  avoid: [
    'One click fixes everything.',
    'AI-powered magic cleanup.',
    'Works perfectly with every file.',
    'Military-grade compression.',
  ],
} as const;
