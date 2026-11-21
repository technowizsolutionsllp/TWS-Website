// OpenAPI 3.1 description of the PinchPDF trial service (protocol v1).
// Served, behind a user ID and password, by the docs routes. Keep it in step with
// TRIAL_REGISTRATION_PROTOCOL.md; test/docs.test.ts checks the main facts.

import { BASE_PATH, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, PROTOCOL_VERSION } from './config';

const b64url = (description: string, extra: Record<string, unknown> = {}) => ({
  type: 'string',
  pattern: '^[A-Za-z0-9_-]*$',
  description: `${description} Base64url, no padding.`,
  ...extra,
});

const sealedNote =
  'This endpoint is **sealed**: the request body is an application-layer envelope (X25519 ephemeral key, HKDF-SHA256, AES-256-GCM) on top of TLS, and a 200 response is a sealed envelope too. ' +
  'Swagger cannot produce or open envelopes, so "Try it out" is disabled; see the Envelope schema and the protocol document. `scripts/trial-smoke.mjs` is a working client.';

export function buildOpenApiSpec() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'PinchPDF trial service',
      version: `v${PROTOCOL_VERSION}`,
      description:
        'Free-trial registration for PinchPDF: one trial per computer, decided by the **device matching policy**. ' +
        'Not an account system: no passwords, sessions or email verification.\n\n' +
        `Limits: request body at most ${MAX_REQUEST_BYTES / 1024} KiB, response at most ${MAX_RESPONSE_BYTES / 1024} KiB. ` +
        'Binary values are base64url without padding. Unknown JSON fields are ignored.\n\n' +
        '**Failure handling in the app:** anything that is not a valid envelope, or does not open under the response key, is treated as "service unavailable", never as a trial decision.',
    },
    servers: [{ url: 'https://technowizsolutions.com', description: 'Production' }],
    tags: [
      { name: 'Challenge', description: 'Plain JSON proof-of-work challenge.' },
      { name: 'Sealed', description: 'Endpoints that use the application-layer envelope.' },
    ],
    paths: {
      [`${BASE_PATH}challenge`]: {
        post: {
          tags: ['Challenge'],
          operationId: 'challenge',
          summary: 'Get a challenge for an install key',
          description:
            'Plain JSON over TLS, not sealed: nothing here is secret, and it is the cheapest endpoint to flood. ' +
            'The challenge is stateless and bound to the public key (the MAC covers `SHA-256(pubkey)`). ' +
            'Solve it by finding an 8-byte big-endian `sol` such that `SHA-256(challenge || sol)` has at least `difficulty` leading zero bits ' +
            '(`difficulty` is byte 24 of the challenge). Clients must treat a challenge that is not 57 bytes, or has difficulty above 26, as "unavailable", ' +
            'and stop after `2^(difficulty+4)` attempts. A challenge may be reused for the same key for 10 minutes.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ChallengeRequest' } } },
          },
          responses: {
            '200': {
              description: 'Challenge issued.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ChallengeResponse' } } },
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '429': { $ref: '#/components/responses/RateLimited' },
            '503': { $ref: '#/components/responses/Unavailable' },
          },
        },
      },
      [`${BASE_PATH}register`]: {
        post: {
          tags: ['Sealed'],
          operationId: 'register',
          summary: 'Start the free trial',
          description:
            `${sealedNote}\n\n` +
            'Plaintext request: `RegisterPlaintext`. Plaintext answer: one of the `RegisterResult` variants. AAD for the request is `POST /api/pinchpdf/trial/v1/register|<kid>`.\n\n' +
            'Server order, cheapest first, with **no database access before step 5**: (1) open envelope, (2) validate fields, (3) verify challenge, (4) verify proof of work, ' +
            '(5) an active row with this `pubkey` returns its `registered` answer unchanged (idempotent; `used` and `state` are the current values), (6) no usable signal gives `unsupported_device`, ' +
            '(7) device matching policy, (8) insert.\n\n' +
            '**Device matching policy:** signal types never cross. For each stored row that is not reset: `B` = signals usable in both, `M` = how many in `B` are equal, ' +
            'the row blocks iff `|B| >= 1` and `M >= min(2, |B|)`. The answer never says which signals matched.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } },
          },
          responses: {
            '200': {
              description: 'Sealed answer. After opening: `RegisterResult`.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/SealedResponse' } } },
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '421': { $ref: '#/components/responses/KidUnsupported' },
            '429': { $ref: '#/components/responses/RateLimited' },
            '503': { $ref: '#/components/responses/Unavailable' },
          },
        },
      },
      [`${BASE_PATH}usage`]: {
        post: {
          tags: ['Sealed'],
          operationId: 'usage',
          summary: 'Report cumulative trial usage',
          description:
            `${sealedNote}\n\n` +
            'Best effort and never in the critical path: sent in the background after a counted completion, and at launch only when local usage is above the last confirmed count. ' +
            'The report is cumulative (`used`), never a delta, so duplicates and delayed lower counts are harmless: `S_new = max(S, min(used, T))`. ' +
            'The signature is verified **before** any write. AAD for the request is `POST /api/pinchpdf/trial/v1/usage|<kid>`.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } },
          },
          responses: {
            '200': {
              description: 'Sealed answer. After opening: `UsageResult`.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/SealedResponse' } } },
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '421': { $ref: '#/components/responses/KidUnsupported' },
            '429': { $ref: '#/components/responses/RateLimited' },
            '503': { $ref: '#/components/responses/Unavailable' },
          },
        },
      },
    },
    components: {
      schemas: {
        ChallengeRequest: {
          type: 'object',
          required: ['proto', 'pubkey'],
          properties: {
            proto: { const: PROTOCOL_VERSION },
            pubkey: b64url('Ed25519 install public key, 32 bytes.', { examples: ['11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo'] }),
          },
        },
        ChallengeResponse: {
          type: 'object',
          required: ['challenge', 'expires_at'],
          properties: {
            challenge: b64url(
              '57 bytes: `ts`(8, big-endian server Unix seconds) `|| rand`(16) `|| difficulty`(1) `|| mac`(32). `mac = HMAC-SHA256(CHALLENGE_KEY, "pinchpdf-trial-challenge-v1" || ts || rand || difficulty || SHA-256(pubkey))`.',
            ),
            expires_at: { type: 'integer', description: 'Unix seconds; challenges are accepted for 600 s (30 s future tolerance).' },
          },
        },
        Envelope: {
          type: 'object',
          description:
            'Request envelope. Client makes a **fresh** X25519 key pair and a fresh 12-byte nonce for every request. ' +
            '`shared = X25519(eph_private, server_public(kid))` (abort if all zeros); `k_req = HKDF-SHA256(ikm=shared, salt=n, info="pinchpdf-trial-v1 req", L=32)`; ' +
            '`k_resp` is the same with info `"pinchpdf-trial-v1 resp"`. `ct` is AES-256-GCM of the JSON plaintext under `k_req`, nonce `n`, with the 16-byte tag appended.',
          required: ['v', 'kid', 'epk', 'n', 'ct'],
          properties: {
            v: { const: PROTOCOL_VERSION },
            kid: { type: 'string', pattern: '^[A-Za-z0-9]{1,16}$', description: 'Server key id. On HTTP 421 try the next embedded key.' },
            epk: b64url('Ephemeral X25519 public key, 32 bytes.'),
            n: b64url('Random 12-byte nonce.'),
            ct: b64url('Ciphertext plus tag.'),
          },
        },
        SealedResponse: {
          type: 'object',
          description:
            'Response envelope: AES-256-GCM under `k_resp`, a fresh random 12-byte `n`, AAD `"<request n, base64url>|<endpoint>"`. ' +
            'A response that does not open is "service unavailable", never a result: it also proves the server holds the private key.',
          required: ['v', 'n', 'ct'],
          properties: { v: { const: PROTOCOL_VERSION }, n: b64url('12 bytes.'), ct: b64url('Ciphertext plus tag.') },
        },
        Signals: {
          type: 'object',
          description:
            'Each value is `SHA-256("pinchpdf-trial-signal-v1|<name>|" || normalized value)` (32 bytes), or null when the app found no usable value. Placeholder hashes are treated as unusable by the server.',
          required: ['guid', 'smbios', 'board'],
          properties: {
            guid: { oneOf: [b64url('Windows MachineGuid hash.'), { type: 'null' }] },
            smbios: { oneOf: [b64url('SMBIOS system UUID hash.'), { type: 'null' }] },
            board: { oneOf: [b64url('Baseboard serial hash.'), { type: 'null' }] },
          },
        },
        RegisterPlaintext: {
          type: 'object',
          description: 'Plaintext inside the `/register` envelope.',
          required: ['proto', 'challenge', 'solution', 'pubkey', 'name', 'email', 'consent', 'signals'],
          properties: {
            proto: { const: PROTOCOL_VERSION },
            challenge: b64url('The 57-byte challenge.'),
            solution: b64url('8-byte big-endian proof-of-work solution.'),
            pubkey: b64url('Ed25519 install public key, 32 bytes. Registration is idempotent per active key.'),
            name: { type: 'string', minLength: 1, maxLength: 100 },
            email: { type: 'string', maxLength: 254, description: 'Syntax-checked only; never verified.' },
            consent: {
              type: 'object',
              required: ['terms_version', 'privacy_version', 'accepted_at'],
              properties: {
                terms_version: { type: 'string', examples: ['2026-11-20'], description: 'Must equal the current published version, else `terms_outdated`.' },
                privacy_version: { type: 'string', examples: ['2026-11-20'] },
                accepted_at: { type: 'integer', description: 'Client clock, Unix seconds. The server also stores its own `received_at`.' },
              },
            },
            signals: { $ref: '#/components/schemas/Signals' },
            app_version: { type: 'string', maxLength: 32 },
            os_build: { type: 'string', maxLength: 64 },
          },
        },
        RegisterResult: {
          description: 'Plaintext answer of `/register`. The app\'s behaviour per result is fixed by protocol section 6.3.',
          oneOf: [
            {
              type: 'object',
              title: 'registered',
              required: ['result', 'trial_id', 'state', 'used', 'limit', 'registered_at', 'support_ref'],
              properties: {
                result: { const: 'registered' },
                trial_id: { type: 'string' },
                state: { $ref: '#/components/schemas/TrialState' },
                used: { type: 'integer', minimum: 0 },
                limit: { type: 'integer', minimum: 1 },
                registered_at: { type: 'integer', description: 'Server `received_at`, Unix seconds.' },
                support_ref: { type: 'string', examples: ['K7QF2M9X'], description: '8 characters (40 random bits) to quote to support.' },
              },
            },
            { type: 'object', title: 'already_used', required: ['result', 'support_ref'], properties: { result: { const: 'already_used' }, support_ref: { type: 'string' } } },
            { type: 'object', title: 'unsupported_device', required: ['result'], properties: { result: { const: 'unsupported_device' } } },
            { type: 'object', title: 'invalid', required: ['result', 'field'], properties: { result: { const: 'invalid' }, field: { enum: ['name', 'email', 'consent'] } } },
            { type: 'object', title: 'challenge_expired', required: ['result'], properties: { result: { const: 'challenge_expired' } } },
            {
              type: 'object',
              title: 'terms_outdated',
              required: ['result', 'terms_version', 'privacy_version'],
              properties: { result: { const: 'terms_outdated' }, terms_version: { type: 'string' }, privacy_version: { type: 'string' } },
            },
          ],
        },
        UsagePlaintext: {
          type: 'object',
          description: 'Plaintext inside the `/usage` envelope.',
          required: ['proto', 'trial_id', 'used', 'sig'],
          properties: {
            proto: { const: PROTOCOL_VERSION },
            trial_id: { type: 'string' },
            used: { type: 'integer', minimum: 0, description: 'Cumulative completed uses, never a delta. The server clamps it to the limit.' },
            sig: b64url('Ed25519 signature by the install key over the UTF-8 bytes of `"pinchpdf-trial-usage-v1|<trial_id>|<used>"`.'),
            app_version: { type: 'string' },
          },
        },
        UsageResult: {
          description: 'Plaintext answer of `/usage`.',
          oneOf: [
            {
              type: 'object',
              title: 'ok',
              required: ['result', 'state', 'used', 'limit'],
              properties: {
                result: { const: 'ok' },
                state: { $ref: '#/components/schemas/TrialState' },
                used: { type: 'integer', description: 'The server high-water mark `S` after this report.' },
                limit: { type: 'integer' },
              },
            },
            { type: 'object', title: 'unknown_trial', required: ['result'], properties: { result: { const: 'unknown_trial' } } },
          ],
        },
        TrialState: {
          enum: ['active', 'exhausted', 'revoked'],
          description: 'Computed, never stored for exhausted: `revoked` if revoked; else `exhausted` if used >= limit; else `active`.',
        },
        PlainError: {
          type: 'object',
          required: ['error'],
          properties: { error: { enum: ['bad_request', 'kid_unsupported', 'rate_limited', 'unavailable'] } },
        },
      },
      responses: {
        BadRequest: {
          description: 'Malformed envelope or body, oversize body, unsupported `v`, bad challenge or proof of work, or bad signature. A genuine client never sends these.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/PlainError' }, example: { error: 'bad_request' } } },
        },
        KidUnsupported: {
          description: 'The `kid` is unknown or retired. Try the next embedded public key.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/PlainError' }, example: { error: 'kid_unsupported' } } },
        },
        RateLimited: {
          description: 'Try later. Never a trial decision.',
          headers: { 'Retry-After': { schema: { type: 'integer' }, description: 'Seconds.' } },
          content: { 'application/json': { schema: { $ref: '#/components/schemas/PlainError' }, example: { error: 'rate_limited' } } },
        },
        Unavailable: {
          description: 'Database or quota unavailable, or the service is not configured. Never a trial decision.',
          headers: { 'Retry-After': { schema: { type: 'integer' } } },
          content: { 'application/json': { schema: { $ref: '#/components/schemas/PlainError' }, example: { error: 'unavailable' } } },
        },
      },
    },
  };
}
