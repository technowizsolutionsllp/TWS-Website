// Changes a published release: raise or lower the rollout, pause, withdraw, make mandatory, edit notes.
// Needs no signing key, because only the unsigned switches change.
//
//   node scripts/release-update.mjs <PinchPDF|NoDupe> <version> [--rollout 25 | --pause | --withdraw | --enable] ...
//
// The per-product wrappers are shorter: node releases/PinchPDF/update.mjs <version> --rollout 25

import { runUpdate } from './release-cli.mjs';

const [product, ...rest] = process.argv.slice(2);
if (!product || product.startsWith('--')) {
  console.error('Usage: node scripts/release-update.mjs <PinchPDF|NoDupe> <version> [--rollout 25 | --pause | --withdraw | --enable] [options]');
  process.exit(2);
}
await runUpdate(rest, product);
