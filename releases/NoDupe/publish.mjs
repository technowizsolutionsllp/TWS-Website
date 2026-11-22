// Publishes a NoDupe release. Usage and the whole process: releases/NoDupe/RELEASE_MANAGEMENT.md
//   node releases/NoDupe/publish.mjs <version> <installer.exe> --notes "a|b" [--channel beta] [--rollout 5] [--dry-run]

import { runPublish } from '../../scripts/release-cli.mjs';

await runPublish(process.argv.slice(2), 'NoDupe');
