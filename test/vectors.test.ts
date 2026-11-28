// Checks lib/trial against the shared protocol vectors (protocol section 9).

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import vectorsText from './trial-protocol-vectors.json?raw';
import recordedHash from './trial-protocol-vectors.sha256?raw';
import { b64urlDecode, b64urlEncode, concat, isAllZero, leadingZeroBits, utf8 } from '../lib/trial/bytes';
import { issueChallenge, verifyChallenge } from '../lib/trial/challenge';
import { aesGcmOpen, ed25519Verify, hkdfSha256, hmacSha256, sha256, x25519Shared } from '../lib/trial/crypto';
import { openRequest } from '../lib/trial/envelope';
import { findBlockingRow, rowBlocks, type Signals } from '../lib/trial/matching';
import { PLACEHOLDER_LIST_VERSION, PLACEHOLDER_VALUES, clientSignalHash, parseClientSignals } from '../lib/trial/signals';
import type { TrialEnv } from '../lib/trial/config';
import { PINCHPDF } from '../lib/trial/product';
import { maskEmail, maskName, restoreDecision } from '../lib/trial/restore';

const vectors = JSON.parse(vectorsText);
const bytes = (value: string) => b64urlDecode(value)!;
const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((pair) => Number.parseInt(pair, 16)));

async function digestHex(text: string) {
  return [...(await sha256(utf8(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('shared vectors file', () => {
  it('matches its recorded SHA-256 (both repositories must hold the identical file)', async () => {
    expect(await digestHex(vectorsText)).toBe(recordedHash.trim());
  });
  it('is protocol 1', () => expect(vectors.protocol).toBe(1));
});

describe('base64url', () => {
  it('round-trips without padding and rejects non-canonical input', () => {
    for (const length of [0, 1, 2, 3, 31, 32, 57]) {
      const data = crypto.getRandomValues(new Uint8Array(length));
      const text = b64urlEncode(data);
      expect(text).not.toContain('=');
      expect([...b64urlDecode(text)!]).toEqual([...data]);
    }
    expect(b64urlDecode('AA==')).toBeNull(); // padding
    expect(b64urlDecode('A')).toBeNull(); // impossible length
    expect(b64urlDecode('AB')).toBeNull(); // non-zero trailing bits
    expect(b64urlDecode('a+b/')).toBeNull(); // standard alphabet
    expect(b64urlDecode(5)).toBeNull();
  });
  it('counts leading zero bits', () => {
    expect(leadingZeroBits(Uint8Array.of(0, 0, 0x10))).toBe(19);
    expect(leadingZeroBits(Uint8Array.of(0x80))).toBe(0);
    expect(leadingZeroBits(Uint8Array.of(0, 0))).toBe(16);
    expect(isAllZero(new Uint8Array(32))).toBe(true);
  });
});

describe('signals', () => {
  it('uses the vector placeholder list and version', () => {
    expect(PLACEHOLDER_LIST_VERSION).toBe(vectors.placeholders.version);
    expect([...PLACEHOLDER_VALUES]).toEqual(vectors.placeholders.values);
  });
  it('computes client hashes and the peppered server value', async () => {
    for (const c of vectors.signals.cases) {
      expect(await clientSignalHash(c.name, c.normalized)).toBe(c.client_hash);
      const server = await hmacSha256(vectors.signals.pepper, concat(utf8(`${c.name}|`), bytes(c.client_hash)));
      expect(b64urlEncode(server)).toBe(c.server_hmac);
    }
    // identical value, different column, different stored value
    const [, , board, guidSameValue] = vectors.signals.cases;
    expect(board.client_hash).not.toBe(guidSameValue.client_hash);
    expect(board.server_hmac).not.toBe(guidSameValue.server_hmac);
  });
  it('treats every known placeholder hash as unusable', async () => {
    for (const p of vectors.placeholders.hashes) {
      const parsed = await parseClientSignals({ guid: p.hashes.guid, smbios: p.hashes.smbios, board: p.hashes.board });
      expect(parsed).toEqual({ guid: null, smbios: null, board: null });
    }
    // a placeholder hash in the WRONG column is just a normal (usable) hash
    const crossed = await parseClientSignals({ guid: vectors.placeholders.hashes[0].hashes.board, smbios: null, board: null });
    expect(crossed?.guid).not.toBeNull();
  });
  it('rejects malformed signal objects', async () => {
    expect(await parseClientSignals(null)).toBeNull();
    expect(await parseClientSignals({ guid: 'short', smbios: null, board: null })).toBeNull();
    expect(await parseClientSignals({})).toEqual({ guid: null, smbios: null, board: null });
  });
});

describe('device matching policy', () => {
  const row = (signals: Signals) => ({ id: 'x', support_ref: 'REF', status: 'active', signals });
  it.each(vectors.matching.named as { name: string; request: Signals; row: Signals; blocks: boolean }[])('named case: $name', (c) => {
    expect(rowBlocks(c.request, c.row)).toBe(c.blocks);
  });
  it('agrees with every exhaustive vector (3 x 3 signals, all equality patterns)', () => {
    expect(vectors.matching.exhaustive.length).toBe(512);
    for (const c of vectors.matching.exhaustive) expect(rowBlocks(c.request, c.row)).toBe(c.blocks);
  });
  it('ignores reset rows and picks the first blocking row', () => {
    const request = { guid: 'a', smbios: 'b', board: 'c' };
    const reset = { ...row(request), status: 'reset', id: 'reset' };
    const first = { ...row(request), id: 'first' };
    const second = { ...row(request), id: 'second' };
    expect(findBlockingRow(request, [reset])).toBeNull();
    expect(findBlockingRow(request, [reset, first, second])?.id).toBe('first');
  });
});

describe('envelope', () => {
  const e = vectors.envelope;
  it('derives the shared secret and both keys', async () => {
    const shared = await x25519Shared(bytes(e.server_private), bytes(e.ephemeral_public));
    expect(b64urlEncode(shared!)).toBe(e.shared_secret);
    expect(b64urlEncode(await hkdfSha256(shared!, bytes(e.request_nonce), 'pinchpdf-trial-v1 req'))).toBe(e.k_req);
    expect(b64urlEncode(await hkdfSha256(shared!, bytes(e.request_nonce), 'pinchpdf-trial-v1 resp'))).toBe(e.k_resp);
  });
  it('opens the vector request and response ciphertexts', async () => {
    const plain = await aesGcmOpen(bytes(e.k_req), bytes(e.request.n), utf8(e.request_aad), bytes(e.request.ct));
    expect(new TextDecoder().decode(plain!)).toBe(e.request_plaintext);
    const resp = await aesGcmOpen(bytes(e.k_resp), bytes(e.response.n), utf8(e.response_aad), bytes(e.response.ct));
    expect(new TextDecoder().decode(resp!)).toBe(e.response_plaintext);
  });
  it('refuses tampered tag, wrong AAD and wrong kid', async () => {
    for (const c of e.reject) {
      const plain = await aesGcmOpen(bytes(e.k_req), bytes(c.request.n), utf8(e.request_aad), bytes(c.request.ct));
      expect(plain, c.name).toBeNull();
    }
  });
  it('rejects a low-order public key (all-zero shared secret)', async () => {
    expect(await x25519Shared(bytes(e.server_private), new Uint8Array(32))).toBeNull();
  });
  it('openRequest enforces the kid allowlist and the AAD binding', async () => {
    const vectorEnv = {
      ...env,
      ACCEPTED_KIDS: e.kid,
      [`TRIAL_KEY_${e.kid}`]: e.server_private,
    } as unknown as TrialEnv;
    const post = (envelope: unknown) => new Request('https://x/api/pinchpdf/trial/v1/usage', { method: 'POST', body: JSON.stringify(envelope) });

    const ok = await openRequest(post(e.request), 'usage', vectorEnv);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.opened.body).toEqual({ proto: 1, hello: 'envelope vector' });

    // the same bytes are not valid for another endpoint
    const wrongEndpoint = await openRequest(post(e.request), 'register', vectorEnv);
    expect(wrongEndpoint.ok).toBe(false);
    for (const c of e.reject) {
      const r = await openRequest(post(c.request), 'usage', vectorEnv);
      expect(r.ok, c.name).toBe(false);
    }
    // a kid that has a secret but is not on the allowlist gets 421
    const retired = await openRequest(post(e.request), 'usage', { ...vectorEnv, ACCEPTED_KIDS: 'k0' } as TrialEnv);
    expect(!retired.ok && retired.response.status).toBe(421);
  });
});

describe('record MAC and signing seed (consumed by the app; derivations checked here)', () => {
  it('derives the MAC key and the signing seed with separate info strings', async () => {
    const zeroSalt = new Uint8Array(32);
    const macKey = await hkdfSha256(bytes(vectors.record.ikm), zeroSalt, 'pinchpdf-trial-v1 record-mac');
    const seed = await hkdfSha256(bytes(vectors.record.ikm), zeroSalt, 'pinchpdf-trial-v1 sign-seed');
    expect(b64urlEncode(macKey)).toBe(vectors.record.mac_key);
    expect(b64urlEncode(seed)).toBe(vectors.record.sign_seed);
    expect(vectors.record.mac_key).not.toBe(vectors.record.sign_seed);
  });
  it('MACs the canonical serialization', async () => {
    for (const c of vectors.record.cases) {
      const mac = await hmacSha256(vectors.record.mac_key, hexToBytes(c.serialization_hex));
      expect(b64urlEncode(mac)).toBe(c.mac);
    }
  });
});

describe('usage signature', () => {
  it('verifies the vector signatures and rejects any other message', async () => {
    const pub = bytes(vectors.usage_signature.public);
    for (const c of vectors.usage_signature.cases) {
      expect(await ed25519Verify(pub, bytes(c.signature), utf8(c.message))).toBe(true);
    }
    const first = vectors.usage_signature.cases[0];
    const other = `pinchpdf-trial-usage-v1|${vectors.usage_signature.trial_id}|4`;
    expect(await ed25519Verify(pub, bytes(first.signature), utf8(other))).toBe(false);
  });
});

describe('challenge and proof of work', () => {
  const c = vectors.challenge;
  const challengeEnv = {
    ...env,
    CHALLENGE_KEY: c.key,
    TRIAL_DIFFICULTY: String(c.difficulty),
    TRIAL_DIFFICULTY_MIN: '4',
  } as TrialEnv;

  it('issues the exact vector challenge', async () => {
    const issued = await issueChallenge(challengeEnv, bytes(c.pubkey), c.ts, c.difficulty, bytes(c.rand));
    expect(b64urlEncode(issued.challenge)).toBe(c.challenge);
    expect(issued.expiresAt).toBe(c.ts + 600);
  });
  it.each(c.boundaries as { name: string; now: number; expect: string }[])("boundary: $name", async (b) => {
    expect(await verifyChallenge(challengeEnv, c.challenge, c.solution, bytes(c.pubkey), b.now)).toBe(b.expect);
  });
  it('is bound to the public key', async () => {
    const other = crypto.getRandomValues(new Uint8Array(32));
    expect(await verifyChallenge(challengeEnv, c.challenge, c.solution, other, c.ts)).toBe('malformed');
  });
  it('rejects a wrong solution, a wrong length, and a tampered MAC', async () => {
    expect(await verifyChallenge(challengeEnv, c.challenge, b64urlEncode(new Uint8Array(8).fill(9)), bytes(c.pubkey), c.ts)).toBe('malformed');
    expect(await verifyChallenge(challengeEnv, c.challenge.slice(0, -4), c.solution, bytes(c.pubkey), c.ts)).toBe('malformed');
    const tampered = bytes(c.challenge);
    tampered[30] ^= 1;
    expect(await verifyChallenge(challengeEnv, b64urlEncode(tampered), c.solution, bytes(c.pubkey), c.ts)).toBe('malformed');
  });
  it('treats a challenge at a difficulty the server no longer issues as stale', async () => {
    const raised = { ...challengeEnv, TRIAL_DIFFICULTY: '10' } as TrialEnv;
    expect(await verifyChallenge(raised, c.challenge, c.solution, bytes(c.pubkey), c.ts)).toBe('expired');
  });
});

describe('continuing a trial (revision 5)', () => {
  const r = vectors.restore;
  it('is revision 5', () => expect(vectors.revision).toBe(5));
  it('decides revoked, restore or already_used exactly as the vectors say', () => {
    expect(r.decisions).toHaveLength(12);
    for (const c of r.decisions) {
      expect(restoreDecision(c.row, { resume: c.request.resume, emailMatches: c.request.email_matches }), JSON.stringify(c)).toBe(c.decision);
    }
  });
  it('masks emails and names exactly as the vectors say', () => {
    for (const c of r.email_masks) expect(maskEmail(c.email), c.email).toBe(c.hint);
    for (const c of r.name_masks) expect(maskName(c.name), c.name).toBe(c.hint);
  });
  it('opens the sealed lookup vector, and only as a lookup', async () => {
    const e = vectors.envelope;
    const l = e.lookup;
    expect(b64urlEncode(await hkdfSha256((await x25519Shared(bytes(e.server_private), bytes(e.ephemeral_public)))!, bytes(l.request_nonce), 'pinchpdf-trial-v1 req'))).toBe(l.k_req);
    const resp = await aesGcmOpen(bytes(l.k_resp), bytes(l.response.n), utf8(l.response_aad), bytes(l.response.ct));
    expect(new TextDecoder().decode(resp!)).toBe(l.response_plaintext);
    const vectorEnv = { ...env, ACCEPTED_KIDS: e.kid, [`TRIAL_KEY_${e.kid}`]: e.server_private } as unknown as TrialEnv;
    const post = () => new Request('https://x/api/pinchpdf/trial/v1/lookup', { method: 'POST', body: JSON.stringify(l.request) });
    const ok = await openRequest(post(), 'lookup', vectorEnv, PINCHPDF);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(JSON.stringify(ok.opened.body)).toBe(l.request_plaintext);
    expect((await openRequest(post(), 'register', vectorEnv, PINCHPDF)).ok).toBe(false);
  });
});
