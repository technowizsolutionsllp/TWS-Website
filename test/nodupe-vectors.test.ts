// Checks lib/trial and the telemetry server against NoDupe's shared vectors (scripts/generate-trial-vectors.mjs nodupe,
// scripts/generate-telemetry-vectors.mjs nodupe). The generators use only node:crypto and are written independently of
// lib/, so these tests check the implementation against a second one. If a vector fails here, a NoDupe app built from
// the same vectors would be refused in production.

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import trialText from './nodupe-trial-protocol-vectors.json?raw';
import trialHash from './nodupe-trial-protocol-vectors.sha256?raw';
import telemetryText from './nodupe-telemetry-protocol-vectors.json?raw';
import telemetryHash from './nodupe-telemetry-protocol-vectors.sha256?raw';
import { call, licenseHash, NOW } from './client';
import { b64urlDecode, b64urlEncode, concat, utf8 } from '../lib/trial/bytes';
import { issueChallenge, verifyChallenge } from '../lib/trial/challenge';
import { aesGcmOpen, ed25519Verify, hkdfSha256, hmacSha256, sha256, x25519Shared } from '../lib/trial/crypto';
import { openRequest } from '../lib/trial/envelope';
import { NODUPE, PINCHPDF } from '../lib/trial/product';
import { clientSignalHash, parseClientSignals } from '../lib/trial/signals';
import type { TrialEnv } from '../lib/trial/config';

const trial = JSON.parse(trialText);
const telemetry = JSON.parse(telemetryText);
const bytes = (value: string) => b64urlDecode(value)!;
const hex = (data: Uint8Array) => [...data].map((b) => b.toString(16).padStart(2, '0')).join('');
const e = env as unknown as TrialEnv;
const nodupe = (q: string, ...a: unknown[]) => e.NODUPE_DB!.prepare(q).bind(...a).all<Record<string, unknown>>().then((r) => r.results);

describe('NoDupe vectors files', () => {
  it('match their recorded SHA-256 (the NoDupe app repository must hold the identical files)', async () => {
    expect(hex(await sha256(utf8(trialText)))).toBe(trialHash.trim());
    expect(hex(await sha256(utf8(telemetryText)))).toBe(telemetryHash.trim());
  });
  it('are protocol 1 for NoDupe', () => {
    expect(trial).toMatchObject({ protocol: 1, product: 'nodupe' });
    expect(telemetry).toMatchObject({ protocol: 1, product: 'nodupe' });
    expect(telemetry.test_pepper).toBe((env as unknown as { PEPPER: string }).PEPPER);
  });
  it('have no PinchPDF-only parts: no local record (NoDupe has its own record format)', () => {
    expect(trial.record).toBeUndefined();
  });
});

describe('NoDupe trial vectors', () => {
  it('hash signals with the nodupe- prefix, and differently from PinchPDF', async () => {
    for (const c of trial.signals.cases) {
      expect(await clientSignalHash(c.name, c.normalized, NODUPE)).toBe(c.client_hash);
      expect(await clientSignalHash(c.name, c.normalized, PINCHPDF)).not.toBe(c.client_hash);
      const server = await hmacSha256(trial.signals.pepper, concat(utf8(`${c.name}|`), bytes(c.client_hash)));
      expect(b64urlEncode(server)).toBe(c.server_hmac);
    }
  });

  it('treats every placeholder, including NoDupe\'s own fallback constant, as unusable', async () => {
    expect(trial.placeholders.values).toContain('duplicate-cleaner-fallback-machine-id');
    for (const p of trial.placeholders.hashes) {
      expect(await parseClientSignals({ guid: p.hashes.guid, smbios: p.hashes.smbios, board: p.hashes.board }, NODUPE)).toEqual({ guid: null, smbios: null, board: null });
    }
    // PinchPDF does not treat NoDupe's constant as a placeholder
    const fallback = trial.placeholders.hashes.find((p: { value: string }) => p.value === 'duplicate-cleaner-fallback-machine-id');
    const asPinch = await parseClientSignals({ guid: await clientSignalHash('guid', 'duplicate-cleaner-fallback-machine-id', PINCHPDF), smbios: null, board: null }, PINCHPDF);
    expect(asPinch?.guid).not.toBeNull();
    expect(fallback).toBeDefined();
  });

  it('derives the envelope keys with the nodupe- labels and opens the vector request only on the NoDupe path', async () => {
    const v = trial.envelope;
    const shared = await x25519Shared(bytes(v.server_private), bytes(v.ephemeral_public));
    expect(b64urlEncode(await hkdfSha256(shared!, bytes(v.request_nonce), 'nodupe-trial-v1 req'))).toBe(v.k_req);
    expect(b64urlEncode(await hkdfSha256(shared!, bytes(v.request_nonce), 'nodupe-trial-v1 resp'))).toBe(v.k_resp);
    const plain = await aesGcmOpen(bytes(v.k_req), bytes(v.request.n), utf8(v.request_aad), bytes(v.request.ct));
    expect(new TextDecoder().decode(plain!)).toBe(v.request_plaintext);
    expect(v.request_aad).toBe(`POST /api/nodupe/trial/v1/usage|${v.kid}`);

    const vectorEnv = { ...env, ACCEPTED_KIDS: v.kid, [`TRIAL_KEY_${v.kid}`]: v.server_private } as unknown as TrialEnv;
    const post = (envelope: unknown) => new Request('https://x/api/nodupe/trial/v1/usage', { method: 'POST', body: JSON.stringify(envelope) });
    const ok = await openRequest(post(v.request), 'usage', vectorEnv, NODUPE);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.opened.body).toEqual({ proto: 1, hello: 'envelope vector' });
    expect((await openRequest(post(v.request), 'usage', vectorEnv, PINCHPDF)).ok).toBe(false); // the other product cannot open it
    expect((await openRequest(post(v.request), 'register', vectorEnv, NODUPE)).ok).toBe(false); // nor the other endpoint
    for (const c of v.reject) expect((await openRequest(post(c.request), 'usage', vectorEnv, NODUPE)).ok, c.name).toBe(false);
  });

  it('verifies the per-mode usage signatures, and rejects any other counts', async () => {
    const pub = bytes(trial.usage_signature.public);
    for (const c of trial.usage_signature.cases) {
      expect(c.message).toMatch(/^nodupe-trial-usage-v1\|TRIALID123\|\d+\|\d+\|\d+$/);
      expect(await ed25519Verify(pub, bytes(c.signature), utf8(c.message))).toBe(true);
    }
    const other = `nodupe-trial-usage-v1|${trial.usage_signature.trial_id}|4|0|0`;
    expect(await ed25519Verify(pub, bytes(trial.usage_signature.cases[0].signature), utf8(other))).toBe(false);
  });

  it('issues the exact vector challenge, only valid for NoDupe', async () => {
    const c = trial.challenge;
    const challengeEnv = { ...env, CHALLENGE_KEY: c.key, TRIAL_DIFFICULTY: String(c.difficulty), TRIAL_DIFFICULTY_MIN: '4' } as TrialEnv;
    const issued = await issueChallenge(challengeEnv, bytes(c.pubkey), c.ts, c.difficulty, bytes(c.rand), NODUPE);
    expect(b64urlEncode(issued.challenge)).toBe(c.challenge);
    expect(await verifyChallenge(challengeEnv, c.challenge, c.solution, bytes(c.pubkey), c.ts, NODUPE)).toBe('ok');
    expect(await verifyChallenge(challengeEnv, c.challenge, c.solution, bytes(c.pubkey), c.ts, PINCHPDF)).toBe('malformed'); // domain separation
    for (const b of c.boundaries as { name: string; now: number; expect: string }[]) {
      expect(await verifyChallenge(challengeEnv, c.challenge, c.solution, bytes(c.pubkey), b.now, NODUPE), b.name).toBe(b.expect);
    }
  });

  it('follows the per-mode counter rule: highest value per mode, capped at 5 / 3 / 1, exhausted only when all are', () => {
    for (const c of trial.counters as { S: Record<string, number>; T: Record<string, number>; used: Record<string, number>; S_new: Record<string, number>; state: string }[]) {
      for (const mode of ['basic', 'similar', 'deep']) expect(c.S_new[mode]).toBe(Math.max(c.S[mode], Math.min(c.used[mode], c.T[mode])));
      expect(c.state).toBe(['basic', 'similar', 'deep'].every((m) => c.S_new[m] >= c.T[m]) ? 'exhausted' : 'active');
    }
  });
});

describe('NoDupe telemetry vectors', () => {
  const body = (fields: Record<string, unknown>, sig: string) => ({ proto: 1, ...fields, pubkey: telemetry.install.public_key, sig });

  it('hash licenses with the nodupe- prefix', async () => {
    for (const k of telemetry.license_hashes) expect(await licenseHash(k.normalized_key, NODUPE), k.name).toBe(k.hash);
  });

  it('verify under the vector install key, over messages that start with nodupe-telemetry-v1', async () => {
    const pub = bytes(telemetry.install.public_key);
    for (const v of telemetry.events) {
      expect(v.message.startsWith('nodupe-telemetry-v1|'), v.name).toBe(true);
      expect(await ed25519Verify(pub, bytes(v.sig), utf8(v.message)), v.name).toBe(true);
    }
  });

  it('are accepted in order by NoDupe\'s server, including install and uninstall, and stored in its own database', async () => {
    for (const v of telemetry.events) {
      expect((await call(e, 'telemetry', body(v.fields, v.sig), { now: NOW, product: NODUPE })).result, v.name).toEqual({ result: 'ok' });
    }
    expect(await nodupe('SELECT type FROM telemetry_events ORDER BY seq')).toEqual(telemetry.events.map((v: { fields: { type: string } }) => ({ type: v.fields.type })));
    expect(await nodupe("SELECT install_kind FROM telemetry_events WHERE type = 'install' ORDER BY seq")).toEqual([{ install_kind: 'new' }, { install_kind: 'upgrade' }, { install_kind: 'reinstall' }]);
    const stored = (await nodupe("SELECT license_fp FROM telemetry_events WHERE type = 'license_activated' ORDER BY seq"))[0].license_fp;
    const first = telemetry.events.find((v: { name: string }) => v.name === 'activation, individual');
    expect(stored).toBe(telemetry.license_hashes.find((k: { hash: string }) => k.hash === first.fields.license).server_fingerprint_with_test_pepper);
  });

  it('are refused by PinchPDF\'s server (a different product), and PinchPDF\'s are refused by NoDupe\'s', async () => {
    const v = telemetry.events[0];
    expect((await call(e, 'telemetry', body(v.fields, v.sig), { now: NOW, product: PINCHPDF })).status).toBe(400); // signed with the nodupe- prefix
    expect(await e.TRIAL_DB.prepare('SELECT 1 FROM telemetry_events').all().then((r) => r.results)).toHaveLength(0);
  });

  it('refuses every reject vector with a plain 400 and writes nothing', async () => {
    for (const v of telemetry.rejects) {
      expect((await call(e, 'telemetry', body(v.fields, v.sig), { now: NOW, product: NODUPE })).status, `${v.name}: ${v.reason}`).toBe(400);
    }
    expect(await nodupe('SELECT 1 FROM telemetry_events')).toHaveLength(0);
    expect(await nodupe('SELECT 1 FROM telemetry_customers')).toHaveLength(0);
  });
});
