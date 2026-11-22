// Publishes an app release: signs it, creates the GitHub release with the installer, then publishes the list.
//
//   node scripts/release-publish.mjs <PinchPDF|NoDupe> <version> <installer.exe> --notes "a|b" [options]
//
// The product repositories have shorter wrappers (npm run release:publish). Options and the whole process:
// RELEASE_MANAGEMENT.md in each product repository. Add --dry-run to see what would happen.

import { runPublish } from './release-cli.mjs';

const [product, ...rest] = process.argv.slice(2);
if (!product || product.startsWith('--')) {
  console.error('Usage: node scripts/release-publish.mjs <PinchPDF|NoDupe> <version> <installer.exe> --notes "a|b" [options]');
  process.exit(2);
}
await runPublish(rest, product);
