// Shared between the support form (client) and /api/get-support (server).

export const MAX_SCREENSHOTS = 5;
export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB per file
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // 20 MB across all files

// Log exports are written to the user's Desktop by the app as
// <ProductName>_<date-time>_log.zip (e.g. PinchPDF_2026-11-19_10-34_log.zip).
export function logFileExample(selectedProduct: string, productNames: string[]) {
  const known = productNames.includes(selectedProduct) ? selectedProduct : null;
  return `${known ?? '<ProductName>'}_<date-time>_log.zip`;
}

// When a specific product is selected the file must come from that product;
// otherwise ("Other / not sure" or nothing chosen yet) any product's export is fine.
export function isLogExport(filename: string, productNames: string[], selectedProduct = '') {
  const lower = filename.toLowerCase();
  const allowed = productNames.includes(selectedProduct) ? [selectedProduct] : productNames;

  return (
    lower.endsWith('_log.zip') &&
    allowed.some((name) => lower.startsWith(`${name.toLowerCase()}_`))
  );
}

export const OTHER_PRODUCT = 'Other / not sure';

export const MAX_NAME = 120;
export const MAX_EMAIL = 180;
export const MAX_SUBJECT = 150;
export const MAX_MESSAGE = 5000;

// Executable / script formats are rejected: mail providers strip them anyway
// and they are the usual vector for malware.
export const BLOCKED_EXTENSIONS = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'dll', 'js', 'jse', 'vbs',
  'vbe', 'wsf', 'ps1', 'jar', 'lnk', 'reg', 'apk', 'app', 'sh',
]);

export function fileExtension(filename: string) {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
