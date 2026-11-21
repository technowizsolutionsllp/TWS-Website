// Generates one X25519 key pair for the trial envelope (protocol section 7).
//
//   node scripts/trial-keygen.mjs [kid]
//
// Prints the PRIVATE key (store it with `wrangler secret put TRIAL_KEY_<kid>`; never commit it)
// and the PUBLIC key (embedded in the PinchPDF app with its kid). Use different pairs for
// staging and production.

import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const kid = process.argv[2] ?? 'k1';
if (!/^[A-Za-z0-9]{1,16}$/.test(kid)) {
  console.error('kid must be 1 to 16 letters or digits');
  process.exit(1);
}

const pair = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
const jwk = await subtle.exportKey('jwk', pair.privateKey);

console.log(`kid                 ${kid}`);
console.log(`public  (app)       ${jwk.x}`);
console.log(`private (secret)    ${jwk.d}`);
console.log(`\nSet the secret:  npx wrangler secret put TRIAL_KEY_${kid}   (paste the private value)`);
console.log(`Allow the kid:   add "${kid}" to ACCEPTED_KIDS in wrangler.json`);
