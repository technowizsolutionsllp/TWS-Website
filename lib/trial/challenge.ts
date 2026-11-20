// Stateless challenge and proof of work (protocol section 5). Plain JSON, not sealed.
//
// challenge (57 bytes) = ts(8, BE, server clock) || rand(16) || difficulty(1) || mac(32)
// mac = HMAC-SHA256(CHALLENGE_KEY, "pinchpdf-trial-challenge-v1" || ts || rand || difficulty || SHA-256(pubkey))
// PoW: find an 8-byte BE `sol` with SHA-256(challenge || sol) having >= difficulty leading zero bits.

import { b64urlDecode, concat, leadingZeroBits, randomBytes, readU64be, u64be, utf8 } from './bytes';
import { hmacSha256, hmacVerify, sha256 } from './crypto';
import {
  CHALLENGE_FUTURE_TOLERANCE_SECONDS,
  CHALLENGE_MAX_AGE_SECONDS,
  difficultyRange,
  type TrialEnv,
} from './config';

export const CHALLENGE_LENGTH = 57;
const DOMAIN = utf8('pinchpdf-trial-challenge-v1');

async function macInput(ts: Uint8Array, rand: Uint8Array, difficulty: number, pubkey: Uint8Array) {
  return concat(DOMAIN, ts, rand, Uint8Array.of(difficulty), await sha256(pubkey));
}

export async function issueChallenge(
  env: TrialEnv,
  pubkey: Uint8Array,
  nowSeconds: number,
  difficultyOverride?: number,
  rand: Uint8Array = randomBytes(16),
): Promise<{ challenge: Uint8Array<ArrayBuffer>; expiresAt: number }> {
  const difficulty = difficultyOverride ?? difficultyRange(env).current;
  const ts = u64be(nowSeconds);
  const mac = await hmacSha256(env.CHALLENGE_KEY, await macInput(ts, rand, difficulty, pubkey));
  return {
    challenge: concat(ts, rand, Uint8Array.of(difficulty), mac),
    expiresAt: nowSeconds + CHALLENGE_MAX_AGE_SECONDS,
  };
}

export type ChallengeCheck =
  | 'ok'
  | 'malformed' // wrong length, bad MAC, wrong pubkey, future timestamp, bad solution
  | 'expired'; // too old, or issued at a difficulty the server no longer issues

export async function verifyChallenge(
  env: TrialEnv,
  challengeB64: unknown,
  solutionB64: unknown,
  pubkey: Uint8Array,
  nowSeconds: number,
): Promise<ChallengeCheck> {
  const challenge = b64urlDecode(challengeB64);
  const solution = b64urlDecode(solutionB64);
  if (!challenge || challenge.length !== CHALLENGE_LENGTH || !solution || solution.length !== 8) {
    return 'malformed';
  }

  const ts = challenge.subarray(0, 8);
  const rand = challenge.subarray(8, 24);
  const difficulty = challenge[24];
  const mac = challenge.subarray(25, 57);

  // The MAC covers SHA-256(pubkey), so a challenge cannot move to another key.
  if (!(await hmacVerify(env.CHALLENGE_KEY, mac, await macInput(ts, rand, difficulty, pubkey)))) {
    return 'malformed';
  }

  const issuedAt = readU64be(ts);
  if (issuedAt > nowSeconds + CHALLENGE_FUTURE_TOLERANCE_SECONDS) return 'malformed';
  if (nowSeconds - issuedAt > CHALLENGE_MAX_AGE_SECONDS) return 'expired';

  const range = difficultyRange(env);
  if (difficulty < range.min || difficulty > range.max) return 'malformed';
  // Difficulty can be raised during abuse; a challenge from before the change
  // is simply stale (the app refetches once, automatically).
  if (difficulty !== range.current) return 'expired';

  const digest = await sha256(concat(challenge, solution));
  return leadingZeroBits(digest) >= difficulty ? 'ok' : 'malformed';
}
