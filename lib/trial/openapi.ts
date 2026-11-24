// OpenAPI 3.1 description of the PinchPDF and NoDupe trial services (protocol v1), the app telemetry endpoint,
// the update check and the read-only Insights JSON API.
// Served, behind a user ID and password, by the docs routes, optionally filtered to one product
// (`/api/pinchpdf/trial/docs/spec?product=pinchpdf|nodupe|all`). Keep it in step with
// TRIAL_REGISTRATION_PROTOCOL.md; test/docs.test.ts checks the main facts. RULE: any API change updates this file (CLAUDE.md).

import { BASE_PATH, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, PROTOCOL_VERSION } from './config';
import { NODUPE, NODUPE_LIMITS, PINCHPDF, type ProductSpec } from './product';

export type DocsProduct = 'all' | 'pinchpdf' | 'nodupe';
export const DOCS_PRODUCTS: readonly { id: DocsProduct; label: string }[] = [
  { id: 'all', label: 'All products' },
  { id: 'pinchpdf', label: 'PinchPDF' },
  { id: 'nodupe', label: 'NoDupe' },
];
export const DEFAULT_DOCS_PRODUCT: DocsProduct = 'all';

export function parseDocsProduct(value: string | null): DocsProduct {
  return DOCS_PRODUCTS.some((p) => p.id === value) ? (value as DocsProduct) : DEFAULT_DOCS_PRODUCT;
}

const b64url = (description: string, extra: Record<string, unknown> = {}) => ({
  type: 'string',
  pattern: '^[A-Za-z0-9_-]*$',
  description: `${description} Base64url, no padding.`,
  ...extra,
});

const sealedNote =
  'This endpoint is **sealed**: the request body is an application-layer envelope (X25519 ephemeral key, HKDF-SHA256, AES-256-GCM) on top of TLS, and a 200 response is a sealed envelope too. ' +
  'Swagger cannot produce or open envelopes, so "Try it out" is disabled; see the Envelope schema and the protocol document. `scripts/trial-smoke.mjs` is a working client.';

/** Schema names: PinchPDF keeps its original names, NoDupe's are prefixed. */
const n = (p: ProductSpec, base: string) => (p === PINCHPDF ? base : `NoDupe${base}`);
const ref = (p: ProductSpec, base: string) => ({ $ref: `#/components/schemas/${n(p, base)}` });
const standardErrors = {
  '400': { $ref: '#/components/responses/BadRequest' },
  '421': { $ref: '#/components/responses/KidUnsupported' },
  '429': { $ref: '#/components/responses/RateLimited' },
  '503': { $ref: '#/components/responses/Unavailable' },
};
const sealedBody = (p: ProductSpec) => ({ required: true, content: { 'application/json': { schema: ref(p, 'Envelope') } } });
const sealedOk = (text: string) => ({ description: text, content: { 'application/json': { schema: { $ref: '#/components/schemas/SealedResponse' } } } });

const counters = (p: ProductSpec) => (p.perMode ? 'one counter per scan mode (basic, similar, deep)' : 'one counter');

// ------------------------------------------------------------------ paths per product

function trialPaths(p: ProductSpec) {
  const base = p.basePath;
  const tag = [p.name];
  const x = { 'x-product': p.id };
  const reg = p.perMode
    ? 'NoDupe: an install that already used some free scans before it registered sends them in `used` (`{basic, similar, deep}`), so registering never gives it a fresh trial; the answer returns the merged per-mode values. '
    : '';
  return {
    [`${base}challenge`]: {
      post: {
        ...x,
        tags: tag,
        operationId: `${p.id}Challenge`,
        summary: `${p.name}: get a challenge for an install key`,
        description:
          'Plain JSON over TLS, not sealed: nothing here is secret, and it is the cheapest endpoint to flood. ' +
          'The challenge is stateless and bound to the public key (the MAC covers `SHA-256(pubkey)`). ' +
          'Solve it by finding an 8-byte big-endian `sol` such that `SHA-256(challenge || sol)` has at least `difficulty` leading zero bits ' +
          '(`difficulty` is byte 24 of the challenge). Clients must treat a challenge that is not 57 bytes, or has difficulty above 26, as "unavailable", ' +
          'and stop after `2^(difficulty+4)` attempts. A challenge may be reused for the same key for 10 minutes. ' +
          `The MAC input starts with \`${p.prefix}-trial-challenge-v1\`, so a challenge for one product is not valid for the other.`,
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ChallengeRequest' } } } },
        responses: {
          '200': { description: 'Challenge issued.', content: { 'application/json': { schema: ref(p, 'ChallengeResponse') } } },
          '400': { $ref: '#/components/responses/BadRequest' },
          '429': { $ref: '#/components/responses/RateLimited' },
          '503': { $ref: '#/components/responses/Unavailable' },
        },
      },
    },
    [`${base}register`]: {
      post: {
        ...x,
        tags: tag,
        operationId: `${p.id}Register`,
        summary: `${p.name}: start the free trial`,
        description:
          `${sealedNote}\n\n` +
          `Plaintext request: \`${n(p, 'RegisterPlaintext')}\`. Plaintext answer: one of the \`${n(p, 'RegisterResult')}\` variants. AAD for the request is \`POST ${base}register|<kid>\`. ` +
          `The free trial is ${counters(p)}. ${reg}\n\n` +
          'Server order, cheapest first, with **no database access before step 5**: (1) open envelope, (2) validate fields, (3) verify challenge, (4) verify proof of work, ' +
          '(5) an active row with this `pubkey` returns its `registered` answer unchanged (idempotent; `used` and `state` are the current values), (6) no usable signal gives `unsupported_device`, ' +
          '(7) device matching policy, (8) insert.\n\n' +
          '**Device matching policy:** signal types never cross. For each stored row that is not reset: `B` = signals usable in both, `M` = how many in `B` are equal, ' +
          'the row blocks iff `|B| >= 1` and `M >= min(2, |B|)`. The answer never says which signals matched. ' +
          `Trials are kept per product: a ${p.name} trial is only compared with other ${p.name} trials.`,
        requestBody: sealedBody(p),
        responses: { '200': sealedOk(`Sealed answer. After opening: \`${n(p, 'RegisterResult')}\`.`), ...standardErrors },
      },
    },
    [`${base}usage`]: {
      post: {
        ...x,
        tags: tag,
        operationId: `${p.id}Usage`,
        summary: p.perMode ? 'NoDupe: report cumulative trial usage per scan mode' : 'PinchPDF: report cumulative trial usage',
        description:
          `${sealedNote}\n\n` +
          'Best effort and never in the critical path: sent in the background after a counted completion, and at launch only when local usage is above the last confirmed count. ' +
          (p.perMode
            ? 'The report is cumulative per mode (`used = {basic, similar, deep}`), never a delta, so duplicates and delayed lower counts are harmless: for each mode `S_new = max(S, min(used, T))`, with T = 5 basic, 3 similar, 1 deep. ' +
              'The trial is `exhausted` only when all three modes are at their limit. '
            : 'The report is cumulative (`used`), never a delta, so duplicates and delayed lower counts are harmless: `S_new = max(S, min(used, T))`. ') +
          `The signature is verified **before** any write. AAD for the request is \`POST ${base}usage|<kid>\`.`,
        requestBody: sealedBody(p),
        responses: { '200': sealedOk(`Sealed answer. After opening: \`${n(p, 'UsageResult')}\`.`), ...standardErrors },
      },
    },
    [`${base}telemetry`]: {
      post: {
        ...x,
        tags: tag,
        operationId: `${p.id}Telemetry`,
        summary: `${p.name}: report one app event (buy click, license lifecycle, install or uninstall)`,
        description:
          `${sealedNote}\n\n` +
          'One event per request, sent in the background and retried with the **same** `event_id` until answered (a repeat is ignored, so retries are safe). ' +
          'Events: `buy_clicked`, `license_activated`, `license_deactivated`, `license_key_changed`, and from the installer `install` and `uninstall`. No name, email, raw license key or raw device value is accepted. ' +
          'The app signs each event with its install key; the key is bound to `customer_uuid` on first sight and later events must match it, **including the installer\'s**: the installer and the app share one install id and key. ' +
          `AAD for the request is \`POST ${base}telemetry|<kid>\`. Plaintext answer: \`TelemetryResult\`.\n\n` +
          `Events are stored in ${p.name}'s own database (\`${p.dbName}\`). \`install\` and \`uninstall\` are anonymous: any plan, license, device signals or trial id sent with them are ignored and not stored. ` +
          'An `install` carries `install_kind` (`new`, `upgrade` or `reinstall`); an `uninstall` carries none. An uninstall on a computer with no connection is not reported.',
        requestBody: sealedBody(p),
        responses: { '200': sealedOk('Sealed answer. After opening: `TelemetryResult`.'), ...standardErrors },
      },
    },
  };
}

const INSIGHT_TABS: Record<string, string> = {
  buying: 'buying',
  licenses: 'licenses',
  devices: 'devices',
  installs: 'installs',
  scans: 'scans',
};

function insightsPath(p: ProductSpec) {
  const tabs = p.perMode ? Object.keys(INSIGHT_TABS) : Object.keys(INSIGHT_TABS).filter((tab) => tab !== 'scans');
  return {
    [`${p.insightsBase}{tab}`]: {
      get: {
        'x-product': p.id,
        tags: [p.name],
        operationId: `${p.id}Insights`,
        summary: `${p.name}: telemetry numbers for one Insights tab`,
        description:
          `The data behind the \`/admin/insights\` tab of the same name for ${p.name}, as JSON, for a date range (UTC days, default the last 30). Buckets are one per day, or one per 7 days when the range is longer than 120 days (\`bucket_days\`); \`bucket_starts\` are Unix seconds, oldest first. ` +
          'A buy attempt is a buy click; several clicks by one install inside the window are one attempt. It is **abandoned** when no license was activated (or key changed) by that install within `window` days, ' +
          '**pending** while the window is open. A deactivation is **not** churn: it is classed `moved` (activated on another device afterwards), `same_device`, or `unused` (not in use since). ' +
          '`installs` counts the installer\'s `install` (new, upgrade, reinstall) and `uninstall` events. ' +
          (p.perMode
            ? '`scans` is NoDupe only: scan counts per mode from its trials (how many used 0 to the limit in each mode, how many are at the limit). '
            : '`scans` does not exist for PinchPDF (404). ') +
          'Answers 404 when the admin login is not configured. Limited per IP before credentials are checked. 503 when this product\'s database is not bound.',
        security: [{ basicAuth: [] }],
        parameters: [
          { name: 'tab', in: 'path', required: true, schema: { enum: tabs } },
          { name: 'from', in: 'query', required: false, schema: { type: 'string', format: 'date' }, description: 'First UTC day, inclusive. Default: 29 days before `to`.' },
          { name: 'to', in: 'query', required: false, schema: { type: 'string', format: 'date' }, description: 'Last UTC day, inclusive, not in the future. Default: today. Ranges are limited to 366 days.' },
          {
            name: 'window',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 90 },
            description: 'Abandoned-buy window in days. Defaults to the `INSIGHTS_ABANDON_DAYS` setting (7). Used by `buying`.',
          },
        ],
        responses: {
          '200': {
            description: 'Data for the tab. The shape depends on `tab`.',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/InsightsBuying' },
                    { $ref: '#/components/schemas/InsightsLicenses' },
                    { $ref: '#/components/schemas/InsightsDevices' },
                    { $ref: '#/components/schemas/InsightsInstalls' },
                    ...(p.perMode ? [{ $ref: '#/components/schemas/InsightsScans' }] : []),
                  ],
                },
              },
            },
          },
          '400': { description: 'Bad date range. Body: `{"error":"bad_range","message":"..."}`.' },
          '401': { description: 'Missing or wrong credentials. Sends `WWW-Authenticate: Basic`.' },
          '404': { description: 'Unknown tab, or the admin login is not configured (fails closed).' },
          '429': { $ref: '#/components/responses/RateLimited' },
          '503': { $ref: '#/components/responses/Unavailable' },
        },
      },
    },
  };
}

/** Admin JSON API to find and delete trial records (the people behind free trials). POST only, so no name or email is ever in a URL. */
function recordsPaths(p: ProductSpec) {
  const base = `/api/${p.id}/records/v1/`;
  const common = {
    'x-product': p.id,
    tags: [p.name],
    security: [{ basicAuth: [] }],
  };
  const adminErrors = {
    '400': { description: 'Bad body. `{"error":"bad_request","message":"..."}`.' },
    '401': { description: 'Missing or wrong credentials. Sends `WWW-Authenticate: Basic`.' },
    '403': { description: 'The request came from another site (`Origin` does not match). `{"error":"forbidden"}`.' },
    '404': { description: 'The admin login is not configured (fails closed).' },
    '413': { description: 'The body is larger than 4 KiB.' },
    '415': { description: 'The request is not `Content-Type: application/json`.' },
    '429': { $ref: '#/components/responses/RateLimited' },
    '503': { $ref: '#/components/responses/Unavailable' },
  };
  return {
    [`${base}search`]: {
      post: {
        ...common,
        operationId: `${p.id}RecordsSearch`,
        summary: `${p.name}: find trial records by name, email, support reference or trial id`,
        description:
          `Admin only (the same login as /admin), for answering deletion and access requests. Searches ${p.name}'s trial records. ` +
          'A full email address is looked up exactly (case-insensitive) through the blind index. Anything else is a case-insensitive "contains" match on the decrypted name and email of the newest 20,000 records, or an exact match on the 8-character support reference or the trial id; `capped` is true when older records were not searched. ' +
          'Returns up to 25 records with their **decrypted name and email**. Every record returned is written to the audit log (`view-contact`), and no data is returned if that write fails. ' +
          'POST so that a name or email never appears in a URL or access log. Requests from another site are refused.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RecordsSearchRequest' } } } },
        responses: {
          '200': { description: 'Matches, newest first.', content: { 'application/json': { schema: { $ref: '#/components/schemas/RecordsSearchResponse' } } } },
          ...adminErrors,
        },
      },
    },
    [`${base}delete`]: {
      post: {
        ...common,
        operationId: `${p.id}RecordsDelete`,
        summary: `${p.name}: erase the contact data of a trial record, or delete it`,
        description:
          `Admin only. \`erase_contact\` clears the encrypted name and email and the email index of one ${p.name} trial and keeps the row, so the computer keeps its used scans and cannot start another free trial. ` +
          '`delete` removes the whole row, including the device hashes; that computer can then register a new free trial. Telemetry events (which hold no name or email) are not touched. ' +
          'A `reason` is required. The change and its audit entry (`erase-contact` or `delete-all`, with the reason and the previous counts, never a name, email or hash) are written in one batch. ' +
          'Look the record up with `search` first and use its `id`. Requests from another site are refused.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RecordsDeleteRequest' } } } },
        responses: {
          '200': { description: 'Done.', content: { 'application/json': { schema: { $ref: '#/components/schemas/RecordsDeleteResponse' } } } },
          ...adminErrors,
          '404': { description: 'No trial with that `id` in this product, or the admin login is not configured (fails closed).' },
        },
      },
    },
  };
}

function updatePath(p: ProductSpec) {
  return {
    [`/api/${p.id}/updates/v1/check`]: {
      get: {
        'x-product': p.id,
        tags: [p.name],
        operationId: `${p.id}UpdateCheck`,
        summary: `${p.name}: check for a newer version`,
        description:
          'Public and unsealed. The request carries only the running version, the channel and optional OS and architecture: no installation id, customer id or license. ' +
          'A stable app is offered stable releases only; a beta app the newest of stable and beta. A withdrawn release is skipped. ' +
          '`rollout_percent` tells the app how many installs should take the update: the app compares it with a random number it keeps locally, so nobody is identified. ' +
          '`mandatory` is true when the release is marked mandatory or the running version is below its `min_supported`; then `rollout_percent` is 100, unless the release is paused (rollout 0), which always holds: a paused release is answered with `mandatory` false and `min_supported` null so that no app is forced to it. ' +
          'The app must check `download.sha256`, verify `download.signature` (Ed25519, release key built into the app, over ' +
          '`"pinchpdf-release-v1|<Product>|<channel>|<version>|<sha256>|<size>"`) and the Windows code signature before running the installer. ' +
          'Answers are cacheable for 5 minutes.',
        parameters: [
          { name: 'v', in: 'query', required: true, schema: { type: 'string', example: '1.2.3' }, description: 'The running version, semantic (`1.2.3` or `1.4.0-beta.1`).' },
          { name: 'channel', in: 'query', required: false, schema: { enum: ['stable', 'beta'], default: 'stable' } },
          { name: 'os', in: 'query', required: false, schema: { type: 'string', example: 'win11' }, description: 'Optional, up to 16 characters of letters, digits, dot, dash, underscore. Not stored.' },
          { name: 'arch', in: 'query', required: false, schema: { type: 'string', example: 'x64' }, description: 'Optional, same format as `os`. Not stored.' },
        ],
        responses: {
          '200': { description: 'An update, or the current version is the newest.', content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateAnswer' } } } },
          '400': { $ref: '#/components/responses/BadRequest' },
          '429': { $ref: '#/components/responses/RateLimited' },
          '503': { description: '`unconfigured` (releases repository or release key not set up) or `unavailable` (no readable release list). The app treats it as "no update now" and tries again later.' },
        },
      },
    },
  };
}

// ------------------------------------------------------------------ schemas per product

const modeCounts = (description: string, limit?: boolean) => ({
  type: 'object',
  description,
  required: ['basic', 'similar', 'deep'],
  additionalProperties: false,
  properties: Object.fromEntries(
    (['basic', 'similar', 'deep'] as const).map((mode) => [mode, { type: 'integer', minimum: 0, maximum: limit ? NODUPE_LIMITS[mode] : 1_000_000 }]),
  ),
});

function productSchemas(p: ProductSpec) {
  const prefix = p.prefix;
  const nodupe = p.perMode;
  const consentExample = nodupe ? '2026-11-24' : '2026-11-20';
  return {
    [n(p, 'ChallengeResponse')]: {
      type: 'object',
      required: ['challenge', 'expires_at'],
      properties: {
        challenge: b64url(
          `57 bytes: \`ts\`(8, big-endian server Unix seconds) \`|| rand\`(16) \`|| difficulty\`(1) \`|| mac\`(32). \`mac = HMAC-SHA256(CHALLENGE_KEY, "${prefix}-trial-challenge-v1" || ts || rand || difficulty || SHA-256(pubkey))\`.`,
        ),
        expires_at: { type: 'integer', description: 'Unix seconds; challenges are accepted for 600 s (30 s future tolerance).' },
      },
    },
    [n(p, 'Envelope')]: {
      type: 'object',
      description:
        'Request envelope. Client makes a **fresh** X25519 key pair and a fresh 12-byte nonce for every request. ' +
        `\`shared = X25519(eph_private, server_public(kid))\` (abort if all zeros); \`k_req = HKDF-SHA256(ikm=shared, salt=n, info="${prefix}-trial-v1 req", L=32)\`; ` +
        `\`k_resp\` is the same with info \`"${prefix}-trial-v1 resp"\`. \`ct\` is AES-256-GCM of the JSON plaintext under \`k_req\`, nonce \`n\`, with the 16-byte tag appended. ` +
        `The request AAD includes the endpoint path (\`POST ${p.basePath}<endpoint>|<kid>\`), so an envelope for one product or endpoint does not open on another.`,
      required: ['v', 'kid', 'epk', 'n', 'ct'],
      properties: {
        v: { const: PROTOCOL_VERSION },
        kid: { type: 'string', pattern: '^[A-Za-z0-9]{1,16}$', description: 'Server key id. On HTTP 421 try the next embedded key. Both products use the same server keys.' },
        epk: b64url('Ephemeral X25519 public key, 32 bytes.'),
        n: b64url('Random 12-byte nonce.'),
        ct: b64url('Ciphertext plus tag.'),
      },
    },
    [n(p, 'Signals')]: {
      type: 'object',
      description:
        `Each value is \`SHA-256("${prefix}-trial-signal-v1|<name>|" || normalized value)\` (32 bytes), or null when the app found no usable value. Placeholder hashes are treated as unusable by the server` +
        (nodupe ? ' (NoDupe\'s list also treats its "no MachineGuid" fallback constant as unusable).' : '.'),
      required: ['guid', 'smbios', 'board'],
      properties: {
        guid: { oneOf: [b64url('Windows MachineGuid hash.'), { type: 'null' }] },
        smbios: { oneOf: [b64url('SMBIOS system UUID hash.'), { type: 'null' }] },
        board: { oneOf: [b64url('Baseboard serial hash.'), { type: 'null' }] },
      },
    },
    [n(p, 'RegisterPlaintext')]: {
      type: 'object',
      description: `Plaintext inside the ${p.name} \`/register\` envelope.`,
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
            terms_version: { type: 'string', examples: [consentExample], description: `Must equal the current published ${p.name} trial terms version, else \`terms_outdated\`.` },
            privacy_version: { type: 'string', examples: [consentExample], description: `Must equal the current published ${p.name} trial privacy notice version.` },
            accepted_at: { type: 'integer', description: 'Client clock, Unix seconds. The server also stores its own `received_at`.' },
          },
        },
        signals: ref(p, 'Signals'),
        ...(nodupe ? { used: modeCounts('Optional. Scans the install had already used before registering (clamped to the limits); absent means none. The server keeps the highest value per mode.') } : {}),
        app_version: { type: 'string', maxLength: 32 },
        os_build: { type: 'string', maxLength: 64 },
      },
    },
    [n(p, 'RegisterResult')]: {
      description: `Plaintext answer of \`/register\`. The app's behaviour per result is fixed by protocol section 6.3.`,
      oneOf: [
        {
          type: 'object',
          title: 'registered',
          required: ['result', 'trial_id', 'state', 'used', 'limit', 'registered_at', 'support_ref'],
          properties: {
            result: { const: 'registered' },
            trial_id: { type: 'string' },
            state: { $ref: '#/components/schemas/TrialState' },
            used: nodupe ? modeCounts('Scans used so far, per mode.') : { type: 'integer', minimum: 0 },
            limit: nodupe ? modeCounts('Free allowance per mode: 5 basic, 3 similar, 1 deep.', true) : { type: 'integer', minimum: 1 },
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
    [n(p, 'UsagePlaintext')]: {
      type: 'object',
      description: `Plaintext inside the ${p.name} \`/usage\` envelope.`,
      required: ['proto', 'trial_id', 'used', 'sig'],
      properties: {
        proto: { const: PROTOCOL_VERSION },
        trial_id: { type: 'string' },
        used: nodupe
          ? modeCounts('Cumulative completed scans per mode, never a delta. The server clamps each to its limit and never lowers one.')
          : { type: 'integer', minimum: 0, description: 'Cumulative completed uses, never a delta. The server clamps it to the limit.' },
        sig: b64url(
          nodupe
            ? `Ed25519 signature by the install key over the UTF-8 bytes of \`"${prefix}-trial-usage-v1|<trial_id>|<basic>|<similar>|<deep>"\`.`
            : `Ed25519 signature by the install key over the UTF-8 bytes of \`"${prefix}-trial-usage-v1|<trial_id>|<used>"\`.`,
        ),
        app_version: { type: 'string' },
      },
    },
    [n(p, 'UsageResult')]: {
      description: `Plaintext answer of \`/usage\`.`,
      oneOf: [
        {
          type: 'object',
          title: 'ok',
          required: ['result', 'state', 'used', 'limit'],
          properties: {
            result: { const: 'ok' },
            state: { $ref: '#/components/schemas/TrialState' },
            used: nodupe ? modeCounts('The server high-water mark per mode after this report.') : { type: 'integer', description: 'The server high-water mark `S` after this report.' },
            limit: nodupe ? modeCounts('Free allowance per mode.', true) : { type: 'integer' },
          },
        },
        { type: 'object', title: 'unknown_trial', required: ['result'], properties: { result: { const: 'unknown_trial' } } },
      ],
    },
    [n(p, 'TelemetryPlaintext')]: {
      type: 'object',
      description:
        `Plaintext inside the ${p.name} \`/telemetry\` envelope. \`sig\` is Ed25519 by the install key over the UTF-8 bytes of ` +
        `\`"${prefix}-telemetry-v1|<event_id>|<customer_uuid>|<type>|<occurred_at>|<plan>|<license>|<prev_license>"\` ` +
        'with `plan`, `license` and `prev_license` as sent (empty string when absent; always empty for `buy_clicked`, `install` and `uninstall`; `prev_license` only for `license_key_changed`). ' +
        'For `install` and `uninstall` the message ends with one more field, `|<install_kind>` (`new`, `upgrade` or `reinstall` for an install, empty for an uninstall). ' +
        `\`license\` and \`prev_license\` are \`SHA-256("${prefix}-telemetry-license-v1|" || normalized key)\`; the server keys them again with its pepper.`,
      required: ['proto', 'event_id', 'customer_uuid', 'type', 'occurred_at', 'pubkey', 'sig'],
      properties: {
        proto: { const: PROTOCOL_VERSION },
        event_id: { type: 'string', format: 'uuid', description: 'Fresh UUID per event, reused on retry.' },
        customer_uuid: { type: 'string', format: 'uuid', description: 'Common reference (the install id) minted on first launch or by the installer and kept on the device. The installer and the app use the same one.' },
        type: { enum: ['buy_clicked', 'license_activated', 'license_deactivated', 'license_key_changed', 'install', 'uninstall'] },
        occurred_at: { type: 'integer', description: 'App clock, Unix seconds. Clamped to [server time - 90 days, server time].' },
        plan: { enum: ['individual', 'business'], description: `${p.name} Individual or ${p.name} Business. Required for \`license_activated\` and \`license_key_changed\`.` },
        license: b64url('License hash, 32 bytes. Required except for `buy_clicked`, `install` and `uninstall`.'),
        install_kind: { enum: ['new', 'upgrade', 'reinstall'], description: 'Required for `install`, and not allowed on any other event.' },
        prev_license: b64url('Previous license hash, 32 bytes. Required for `license_key_changed`, and different from `license`.'),
        pubkey: b64url('Ed25519 install public key, 32 bytes.'),
        sig: b64url('Ed25519 signature, see above.'),
        signals: ref(p, 'Signals'),
        trial_id: { type: 'string', maxLength: 64, description: 'Optional: the trial_id if this install registered a trial. Links the two. Ignored for `install` and `uninstall`.' },
        app_version: { type: 'string', maxLength: 32 },
        os_build: { type: 'string', maxLength: 64 },
      },
    },
  };
}

// ------------------------------------------------------------------ shared schemas

const headProps = (tab: string) => ({
  product: { enum: ['pinchpdf', 'nodupe'] },
  tab: { const: tab },
  generated_at: { type: 'integer', description: 'Server time, Unix seconds.' },
});

function sharedSchemas() {
  const scanCounts = (description: string) => ({
    type: 'object',
    description,
    required: ['basic', 'similar', 'deep'],
    properties: { basic: { type: 'integer' }, similar: { type: 'integer' }, deep: { type: 'integer' } },
  });
  return {
    RecordsSearchRequest: {
      type: 'object',
      required: ['q'],
      properties: { q: { type: 'string', minLength: 3, maxLength: 100, description: 'A full email address (exact), part of a name or email, an 8-character support reference, or a trial id.', examples: ['jane@example.com'] } },
    },
    TrialRecord: {
      type: 'object',
      description: 'One trial record with its decrypted contact data. Handle as personal data.',
      required: ['product', 'id', 'support_ref', 'name', 'email', 'status', 'used', 'limit_total', 'modes', 'created_at', 'last_server_contact_at'],
      properties: {
        product: { enum: ['pinchpdf', 'nodupe'] },
        id: { type: 'string', description: 'The trial id. Use it with `delete`.' },
        support_ref: { type: 'string', description: 'The 8-character reference shown to the user.' },
        name: { type: ['string', 'null'], description: 'Null once the contact data was erased.' },
        email: { type: ['string', 'null'], description: 'Null once the contact data was erased.' },
        status: { enum: ['active', 'revoked', 'reset'], description: '`exhausted` is derived from the counts and never stored.' },
        used: { type: 'integer', description: 'Uses so far (NoDupe: the sum over the three modes).' },
        limit_total: { type: 'integer', description: 'Uses allowed (NoDupe: the sum of the three limits).' },
        modes: {
          description: 'NoDupe only: scans used and allowed per mode. Null for PinchPDF.',
          oneOf: [
            { type: 'null' },
            { type: 'object', required: ['used', 'limit'], properties: { used: scanCounts('Scans used per mode.'), limit: scanCounts('Scans allowed per mode.') } },
          ],
        },
        created_at: { type: 'integer', description: 'Unix seconds.' },
        last_server_contact_at: { type: 'integer', description: 'Unix seconds: the last time the app contacted the server.' },
      },
    },
    RecordsSearchResponse: {
      type: 'object',
      required: ['product', 'query', 'count', 'truncated', 'capped', 'results'],
      properties: {
        product: { enum: ['pinchpdf', 'nodupe'] },
        query: { type: 'string' },
        count: { type: 'integer' },
        truncated: { type: 'boolean', description: 'More than 25 records matched; only the first 25 are returned.' },
        capped: { type: 'boolean', description: 'The database holds more than 20,000 records and only the newest were searched (an exact email is not affected).' },
        results: { type: 'array', maxItems: 25, items: { $ref: '#/components/schemas/TrialRecord' } },
      },
    },
    RecordsDeleteRequest: {
      type: 'object',
      required: ['id', 'action', 'reason'],
      properties: {
        id: { type: 'string', description: 'The trial id from `search`.' },
        action: { enum: ['erase_contact', 'delete'], description: '`erase_contact` keeps the row (and the trial limit); `delete` removes it (the computer can register again).' },
        reason: { type: 'string', minLength: 3, maxLength: 500, description: 'Why, for the audit log. Printable text; no personal data.', examples: ['Deletion request received by email on 2026-11-24'] },
      },
    },
    RecordsDeleteResponse: {
      type: 'object',
      required: ['ok', 'product', 'id', 'action', 'support_ref'],
      properties: { ok: { const: true }, product: { enum: ['pinchpdf', 'nodupe'] }, id: { type: 'string' }, action: { enum: ['erase_contact', 'delete'] }, support_ref: { type: 'string' } },
    },
    ChallengeRequest: {
      type: 'object',
      required: ['proto', 'pubkey'],
      properties: {
        proto: { const: PROTOCOL_VERSION },
        pubkey: b64url('Ed25519 install public key, 32 bytes.', { examples: ['11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo'] }),
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
    TelemetryResult: {
      description: 'Plaintext answer of `/telemetry`.',
      type: 'object',
      required: ['result'],
      properties: { result: { const: 'ok' } },
    },
    TrialState: {
      enum: ['active', 'exhausted', 'revoked'],
      description:
        'Computed, never stored for exhausted: `revoked` if revoked; else `exhausted` if used >= limit (NoDupe: when every scan mode is at its limit); else `active`.',
    },
    PlainError: {
      type: 'object',
      required: ['error'],
      properties: { error: { enum: ['bad_request', 'kid_unsupported', 'rate_limited', 'unavailable'] } },
    },
    UpdateAnswer: {
      description: 'Answer of the update check. `update_available: false` carries only `latest`.',
      oneOf: [
        {
          type: 'object',
          required: ['update_available', 'latest'],
          properties: { update_available: { const: false }, latest: { type: ['string', 'null'], description: 'The newest enabled version for the channel, or null when none is published.' } },
        },
        {
          type: 'object',
          required: ['update_available', 'product', 'version', 'channel', 'pub_date', 'notes', 'download', 'mandatory', 'rollout_percent'],
          properties: {
            update_available: { const: true },
            product: { enum: ['PinchPDF', 'NoDupe'] },
            version: { type: 'string' },
            channel: { enum: ['stable', 'beta'] },
            pub_date: { type: 'string', format: 'date-time' },
            notes: { type: 'array', items: { type: 'string' }, description: 'The major changes, 1 to 10 short plain-text lines.' },
            notes_url: { type: ['string', 'null'], description: 'Full release notes (https, on technowizsolutions.com: the app refuses any other address).' },
            download: {
              type: 'object',
              required: ['url', 'sha256', 'size', 'signature'],
              properties: {
                url: { type: 'string', format: 'uri' },
                sha256: { type: 'string', description: 'Lowercase hex SHA-256 of the installer.' },
                size: { type: 'integer' },
                signature: { type: 'string', description: 'Ed25519 release signature, base64url (64 bytes).' },
              },
            },
            min_supported: { type: ['string', 'null'], description: 'Versions below this must update.' },
            mandatory: { type: 'boolean' },
            rollout_percent: { type: 'integer', minimum: 0, maximum: 100 },
          },
        },
      ],
    },
    InsightsRange: {
      type: 'object',
      properties: { from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' }, days: { type: 'integer' } },
    },
    InsightsBuckets: { type: 'array', items: { type: 'integer' }, description: 'Start of each bucket, Unix seconds (UTC), oldest first.' },
    InsightsSeries: { type: 'array', items: { type: 'integer', minimum: 0 }, description: 'One count per bucket, aligned with `bucket_starts`.' },
    InsightsBuying: {
      type: 'object',
      title: 'buying',
      required: ['tab', 'range', 'window_days', 'bucket_starts', 'attempts', 'converted', 'abandoned', 'pending', 'late', 'series'],
      properties: {
        ...headProps('buying'),
        range: { $ref: '#/components/schemas/InsightsRange' },
        window_days: { type: 'integer' },
        bucket_days: { enum: [1, 7] },
        bucket_starts: { $ref: '#/components/schemas/InsightsBuckets' },
        attempts: { type: 'integer', description: 'Buy attempts that started in the range.' },
        converted: { type: 'integer', description: 'Activated (or changed key) within the window.' },
        abandoned: { type: 'integer', description: 'Window passed with no activation. An upper bound: a purchase activated on another install looks abandoned.' },
        pending: { type: 'integer', description: 'Window still open.' },
        late: { type: 'integer', description: 'Abandoned attempts whose install did activate, but after the window.' },
        conversion_rate: { type: ['number', 'null'], description: 'converted / (converted + abandoned); null when neither exists yet.' },
        series: {
          type: 'object',
          description: 'By bucket of the first click.',
          properties: {
            converted: { $ref: '#/components/schemas/InsightsSeries' },
            abandoned: { $ref: '#/components/schemas/InsightsSeries' },
            pending: { $ref: '#/components/schemas/InsightsSeries' },
          },
        },
      },
    },
    InsightsLicenses: {
      type: 'object',
      title: 'licenses',
      required: ['tab', 'range', 'bucket_starts', 'current', 'series'],
      properties: {
        ...headProps('licenses'),
        range: { $ref: '#/components/schemas/InsightsRange' },
        bucket_days: { enum: [1, 7] },
        bucket_starts: { $ref: '#/components/schemas/InsightsBuckets' },
        current: {
          type: 'object',
          description: 'Right now.',
          properties: {
            active: { type: 'integer', description: 'Licenses with at least one active device.' },
            individual: { type: 'integer' },
            business: { type: 'integer' },
            active_devices: { type: 'integer', description: 'Active (license, device) pairs.' },
            on_multiple_devices: { type: 'integer', description: 'Active licenses running on more than one device.' },
          },
        },
        series: {
          type: 'object',
          description: 'At the end of each bucket (history before the range counts).',
          properties: {
            active: { $ref: '#/components/schemas/InsightsSeries' },
            individual: { $ref: '#/components/schemas/InsightsSeries' },
            business: { $ref: '#/components/schemas/InsightsSeries' },
          },
        },
      },
    },
    InsightsDevices: {
      type: 'object',
      title: 'devices',
      required: ['tab', 'range', 'bucket_starts', 'deactivations', 'series'],
      properties: {
        ...headProps('devices'),
        range: { $ref: '#/components/schemas/InsightsRange' },
        bucket_days: { enum: [1, 7] },
        bucket_starts: { $ref: '#/components/schemas/InsightsBuckets' },
        deactivations: { type: 'integer', description: 'In the range. Not churn: see moved / same_device / unused.' },
        moved: { type: 'integer', description: 'Later activated on a different device.' },
        same_device: { type: 'integer', description: 'Later activated again on the same device.' },
        unused: { type: 'integer', description: 'Not in use since.' },
        key_changes: { type: 'integer' },
        series: {
          type: 'object',
          properties: {
            moved: { $ref: '#/components/schemas/InsightsSeries' },
            same_device: { $ref: '#/components/schemas/InsightsSeries' },
            unused: { $ref: '#/components/schemas/InsightsSeries' },
            key_changes: { $ref: '#/components/schemas/InsightsSeries' },
          },
        },
      },
    },
    InsightsInstalls: {
      type: 'object',
      title: 'installs',
      required: ['tab', 'range', 'bucket_starts', 'installs', 'uninstalls', 'series'],
      description: 'Installer events (`install` and `uninstall`). Counts only. An uninstall on a computer with no connection is not reported, so uninstalls are a lower bound.',
      properties: {
        ...headProps('installs'),
        range: { $ref: '#/components/schemas/InsightsRange' },
        bucket_days: { enum: [1, 7] },
        bucket_starts: { $ref: '#/components/schemas/InsightsBuckets' },
        installs: { type: 'integer', description: 'Install events in the range (new + upgrades + reinstalls).' },
        new: { type: 'integer' },
        upgrades: { type: 'integer' },
        reinstalls: { type: 'integer' },
        uninstalls: { type: 'integer' },
        distinct_installs: { type: 'integer', description: 'Different install ids that reported an install.' },
        distinct_uninstalls: { type: 'integer' },
        net_new: { type: 'integer', description: 'New installs minus uninstalls.' },
        uninstall_rate: { type: ['number', 'null'], description: 'uninstalls / installs; null when there are no installs.' },
        series: {
          type: 'object',
          properties: {
            new: { $ref: '#/components/schemas/InsightsSeries' },
            upgrade: { $ref: '#/components/schemas/InsightsSeries' },
            reinstall: { $ref: '#/components/schemas/InsightsSeries' },
            uninstalls: { $ref: '#/components/schemas/InsightsSeries' },
          },
        },
      },
    },
    InsightsScans: {
      type: 'object',
      title: 'scans',
      required: ['tab', 'range', 'free_allowance', 'registered_in_range', 'total', 'at_limit', 'histogram', 'all_time'],
      description:
        'NoDupe scan counts from its trials, one counter per mode. The cohort is the trials registered inside the range; `all_time` covers every NoDupe trial. ' +
        'Each count is the highest value the trial has reported for that mode. Trials reset by support are left out.',
      properties: {
        ...headProps('scans'),
        range: { $ref: '#/components/schemas/InsightsRange' },
        free_allowance: modeCounts('Scans per mode that a free trial may run (5 basic, 3 similar, 1 deep).'),
        registered_in_range: { type: 'integer' },
        total: modeCounts('Scans used by the cohort, summed, by mode.'),
        at_limit: {
          type: 'object',
          description: 'Trials of the cohort that used their whole allowance, per mode and in all three.',
          properties: { basic: { type: 'integer' }, similar: { type: 'integer' }, deep: { type: 'integer' }, all_modes: { type: 'integer' } },
        },
        histogram: {
          type: 'object',
          description: 'Per mode, how many trials of the cohort sit at each count; the index is the number of scans used (0 to the limit).',
          properties: { basic: { type: 'array', items: { type: 'integer' } }, similar: { type: 'array', items: { type: 'integer' } }, deep: { type: 'array', items: { type: 'integer' } } },
        },
        all_time: {
          type: 'object',
          properties: {
            trials: { type: 'integer' },
            total: modeCounts('Scans used across all trials, by mode.'),
            at_limit: { type: 'object', properties: { basic: { type: 'integer' }, similar: { type: 'integer' }, deep: { type: 'integer' }, all_modes: { type: 'integer' } } },
          },
        },
      },
    },
  };
}

const responses = {
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
};

// ------------------------------------------------------------------ filtering

type Json = Record<string, unknown>;

/** Every `$ref` target reachable from `value`, following into the components it points at. */
function reachableRefs(value: unknown, components: Json): Set<string> {
  const seen = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node as Json)) {
      if (key === '$ref' && typeof child === 'string') {
        if (!seen.has(child)) {
          seen.add(child);
          const [, , section, name] = child.split('/');
          const target = (components[section] as Json | undefined)?.[name];
          if (target) visit(target);
        }
      } else visit(child);
    }
  };
  visit(value);
  return seen;
}

/** Keeps only one product's operations, its own schemas (documented even where no operation points at them), and what they use. */
function restrictTo(spec: { paths: Json; components: Json }, product: ProductSpec) {
  const paths: Json = {};
  for (const [path, item] of Object.entries(spec.paths)) {
    const operations = Object.values(item as Json) as Json[];
    if (operations.every((operation) => operation['x-product'] === product.id)) paths[path] = item;
  }
  const own = Object.keys(productSchemas(product)).map((name) => ({ $ref: `#/components/schemas/${name}` }));
  const refs = reachableRefs([paths, own], spec.components);
  const prune = (section: string) =>
    Object.fromEntries(Object.entries(spec.components[section] as Json).filter(([name]) => refs.has(`#/components/${section}/${name}`)));
  return {
    paths,
    components: { ...spec.components, schemas: prune('schemas'), responses: prune('responses') },
  };
}

// ------------------------------------------------------------------ the spec

export function buildOpenApiSpec(filter: DocsProduct = 'all') {
  const full = {
    paths: {
      ...trialPaths(PINCHPDF),
      ...insightsPath(PINCHPDF),
      ...recordsPaths(PINCHPDF),
      ...updatePath(PINCHPDF),
      ...trialPaths(NODUPE),
      ...insightsPath(NODUPE),
      ...recordsPaths(NODUPE),
      ...updatePath(NODUPE),
    } as Json,
    components: {
      securitySchemes: {
        basicAuth: { type: 'http', scheme: 'basic', description: 'The `ADMIN_USER` and `ADMIN_PASSWORD` Worker secrets (the same login as /admin).' },
      },
      schemas: { ...sharedSchemas(), ...productSchemas(PINCHPDF), ...productSchemas(NODUPE) } as Json,
      responses: responses as Json,
    } as Json,
  };
  const chosen = filter === 'all' ? null : filter === 'nodupe' ? NODUPE : PINCHPDF;
  const { paths, components } = chosen ? restrictTo(full as { paths: Json; components: Json }, chosen) : full;
  const title = chosen ? `${chosen.name}: trial, telemetry, updates and insights` : 'PinchPDF and NoDupe: trial, telemetry, updates and insights';

  return {
    openapi: '3.1.0',
    info: {
      title,
      version: `v${PROTOCOL_VERSION}`,
      description:
        'Free-trial registration: one trial per computer per product, decided by the **device matching policy**. ' +
        'Not an account system: no passwords, sessions or email verification.\n\n' +
        'PinchPDF and NoDupe run the **same service**: the same sealed protocol, proof of work, device matching, telemetry events and Insights. ' +
        'Only these differ: the paths (`/api/pinchpdf/...` and `/api/nodupe/...`), the database (separate D1 databases), the signing prefix (`pinchpdf-` and `nodupe-`, so nothing made for one is valid for the other), ' +
        'the trial terms and privacy notice versions, and what the trial counts: PinchPDF has one counter (5 uses), NoDupe one counter per scan mode (5 basic, 3 similar, 1 deep). ' +
        'The server keys (`kid`) and secrets are shared. Use the product filter above to show one product.\n\n' +
        `Limits: request body at most ${MAX_REQUEST_BYTES / 1024} KiB, response at most ${MAX_RESPONSE_BYTES / 1024} KiB. ` +
        'Binary values are base64url without padding. Unknown JSON fields are ignored.\n\n' +
        '**Failure handling in the app:** anything that is not a valid envelope, or does not open under the response key, is treated as "service unavailable", never as a trial decision.',
    },
    servers: [{ url: 'https://technowizsolutions.com', description: 'Production' }],
    tags: [
      ...(chosen === NODUPE ? [] : [{ name: 'PinchPDF', description: `PinchPDF: trial (\`${BASE_PATH}...\`), telemetry, update check, Insights and the admin records API (find and delete trial records).` }]),
      ...(chosen === PINCHPDF ? [] : [{ name: 'NoDupe', description: 'NoDupe: trial (`/api/nodupe/trial/v1/...`), telemetry, update check, Insights and the admin records API (find and delete trial records), with one trial counter per scan mode (5 basic, 3 similar, 1 deep).' }]),
    ],
    paths: paths as Record<string, Record<string, unknown>>,
    components: components as { securitySchemes: Json; schemas: Json; responses: Json },
  };
}
