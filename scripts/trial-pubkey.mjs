// Prints the X25519 PUBLIC key for an existing trial private key, for when the private half was
// generated elsewhere and only it was stored as TRIAL_KEY_<kid>.
//
//   PowerShell:  $env:TRIAL_PRIVATE = Read-Host; node scripts/trial-pubkey.mjs
//   (paste the private value at the prompt; it is not printed and stays out of shell history)
//
// Accepts the private key as base64url (43 characters, the format the server needs) or as hex
// (64 characters). For hex it also prints the base64url form, because TRIAL_KEY_<kid> must be
// base64url: a hex value makes the server answer every request with a 400.
// Put the printed public value in the PinchPDF app next to its kid.

import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const secret = (process.env.TRIAL_PRIVATE ?? '').trim();

let raw;
let wasHex = false;
if (/^[0-9a-fA-F]{64}$/.test(secret)) {
  raw = Buffer.from(secret, 'hex');
  wasHex = true;
} else if (/^[A-Za-z0-9_-]{43}$/.test(secret)) {
  raw = Buffer.from(secret, 'base64url');
} else {
  console.error(
    `Expected a 32-byte private key as base64url (43 characters) or hex (64 characters); got ${secret.length} characters. ` +
      'Remove any quotes, spaces or "=" padding.',
  );
  process.exit(1);
}
if (raw.length !== 32) {
  console.error(`The private key decodes to ${raw.length} bytes, not 32.`);
  process.exit(1);
}

const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), raw]);
const key = await subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, true, ['deriveBits']);
console.log(`public  (app)       ${(await subtle.exportKey('jwk', key)).x}`);
if (wasHex) {
  console.log(`private (secret)    ${raw.toString('base64url')}`);
  console.log('\nThat was hex. Set TRIAL_KEY_<kid> to the private (secret) value above, in base64url, not the hex.');
}
