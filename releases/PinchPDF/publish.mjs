// Publishes a PinchPDF release. Usage and the whole process: releases/PinchPDF/RELEASE_MANAGEMENT.md
//   node releases/PinchPDF/publish.mjs <version> <installer.exe> --notes "a|b" [--channel beta] [--rollout 5] [--dry-run]

import { runPublish } from '../../scripts/release-cli.mjs';

await runPublish(process.argv.slice(2), 'PinchPDF');
