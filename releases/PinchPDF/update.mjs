// Changes a published PinchPDF release (rollout, pause, withdraw, mandatory, notes). Needs no signing key.
//   node releases/PinchPDF/update.mjs <version> --rollout 25
//   node releases/PinchPDF/update.mjs <version> --pause

import { runUpdate } from '../../scripts/release-cli.mjs';

await runUpdate(process.argv.slice(2), 'PinchPDF');
