// Regenerates a product's public downloads page (<Product>/README.md in the releases repository) from the list that is
// published now. Publishing or changing a release does this by itself; run this the first time, or after editing the list by hand.
//
//   node scripts/release-page.mjs <PinchPDF|NoDupe> [--dry-run]
//
// The product repositories have a shorter wrapper: npm run release:page

import { runPage } from './release-cli.mjs';

const [product, ...rest] = process.argv.slice(2);
if (!product || product.startsWith('--')) {
  console.error('Usage: node scripts/release-page.mjs <PinchPDF|NoDupe> [--dry-run]');
  process.exit(2);
}
await runPage(rest, product);
