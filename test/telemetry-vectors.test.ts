// Checks the telemetry server against the shared protocol vectors (scripts/generate-telemetry-vectors.mjs).
// If a vector fails here, an app built from the same vectors would be rejected in production.

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import vectorsText from './telemetry-protocol-vectors.json?raw';
import recordedHash from './telemetry-protocol-vectors.sha256?raw';
import { call, licenseHash, NOW } from './client';
import { b64urlDecode, b64urlEncode, utf8 } from '../lib/trial/bytes';
import { ed25519Verify, sha256 } from '../lib/trial/crypto';
import type { TrialEnv } from '../lib/trial/config';

const e = env as unknown as TrialEnv;
const vectors = JSON.parse(vectorsText);
const rows = (q: string, ...a: unknown[]) => e.TRIAL_DB.prepare(q).bind(...a).all<Record<string, unknown>>().then((r) => r.results);
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

// Each vector event is sent as the app would: the fields, the install public key and the signature.
const body = (fields: Record<string, unknown>, sig: string) => ({ proto: 1, ...fields, pubkey: vectors.install.public_key, sig });

describe('shared telemetry vectors file', () => {
  it('matches its recorded SHA-256 (the app repository must hold the identical file)', async () => {
    expect(hex(await sha256(utf8(vectorsText)))).toBe(recordedHash.trim());
  });
  it('is protocol 1 and uses the test pepper from the Vitest config', () => {
    expect(vectors.protocol).toBe(1);
    expect(vectors.test_pepper).toBe((env as unknown as { PEPPER: string }).PEPPER);
  });
});

describe('license hash', () => {
  it('matches SHA-256("pinchpdf-telemetry-license-v1|" + key) for every vector key', async () => {
    for (const k of vectors.license_hashes) expect(await licenseHash(k.normalized_key), k.name).toBe(k.hash);
  });
});

describe('signatures', () => {
  it('verify under the vector install key, over the message built the way the protocol states', async () => {
    const pub = b64urlDecode(vectors.install.public_key)!;
    for (const v of vectors.events) {
      expect(await ed25519Verify(pub, b64urlDecode(v.sig)!, utf8(v.message)), v.name).toBe(true);
    }
  });
});

describe('server against the vectors', () => {
  it('accepts every valid event, in order, and answers ok', async () => {
    for (const v of vectors.events) {
      const reply = await call(e, 'telemetry', body(v.fields, v.sig), { now: NOW });
      expect(reply.result, v.name).toEqual({ result: 'ok' });
    }
    expect(await rows('SELECT type FROM telemetry_events ORDER BY seq')).toEqual(vectors.events.map((v: { fields: { type: string } }) => ({ type: v.fields.type })));
  });

  it('stores the license as the keyed fingerprint the vectors give (so a stored value can be reproduced)', async () => {
    const activation = vectors.events.find((v: { name: string }) => v.name === 'activation, business');
    await call(e, 'telemetry', body(activation.fields, activation.sig), { now: NOW });
    const stored = (await rows('SELECT license_fp FROM telemetry_events'))[0].license_fp;
    const expected = vectors.license_hashes.find((k: { hash: string }) => k.hash === activation.fields.license).server_fingerprint_with_test_pepper;
    expect(stored).toBe(expected);
    expect(b64urlEncode(b64urlDecode(stored as string)!)).toBe(stored); // canonical base64url
  });

  it('refuses every reject vector with a plain 400 and writes nothing', async () => {
    for (const v of vectors.rejects) {
      const reply = await call(e, 'telemetry', body(v.fields, v.sig), { now: NOW });
      expect(reply.status, `${v.name}: ${v.reason}`).toBe(400);
    }
    expect(await rows('SELECT 1 FROM telemetry_events')).toHaveLength(0);
    expect(await rows('SELECT 1 FROM telemetry_customers')).toHaveLength(0);
  });
});
