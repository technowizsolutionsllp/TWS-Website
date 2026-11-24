// Operator actions for the PinchPDF and NoDupe trial services (protocol 3.4, website plan section 8).
// Runs from a developer machine only. The admin page /admin/records and POST /api/<product>/records/v1/{search,delete}
// do the same erase and delete actions (same audit entries); retention is applied daily by the tws-retention Worker.
//
//   node scripts/trial-admin.mjs <command> [--product pinchpdf|nodupe] [--env local|staging|prod] [options]
//
// --product picks the service and its database (default pinchpdf; NoDupe's is the D1 database "nodupe", with its own
// secrets file suffix unchanged: both products share PII_KEY and PEPPER_EMAIL). NoDupe has one counter per scan mode,
// so adjust-limit takes --mode basic|similar|deep. NoDupe has no staging database unless you pass --staging-db <name>.
//
//   find            --ref <support_ref> | --email <address>
//   reset-device    --id <id> | --ref <ref>   --reason "..."
//   adjust-limit    --id | --ref   --limit <1-255> [--mode basic|similar|deep]   --reason "..."   (--mode is required for NoDupe)
//   revoke          --id | --ref   --reason "..."
//   unrevoke        --id | --ref   --reason "..."
//   erase-contact   --id | --ref   --reason "..."
//   delete-all      --id | --ref   --reason "..."
//   export-contact  --id | --ref   --reason "..."      (the only command that prints name and email)
//
// Every state-changing command needs a non-empty --reason and writes a trial_audit row in the
// same statement batch. On staging and prod nothing is changed without --yes (otherwise the SQL
// is printed as a dry run). Secrets (PII_KEY, PEPPER_EMAIL) come from .dev.vars (local),
// .dev.vars.staging or .dev.vars.prod, all git-ignored.

import { spawnSync } from 'node:child_process';
import { randomBytes, webcrypto } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WRANGLER = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));

const { subtle } = webcrypto;
const enc = new TextEncoder();

// ------------------------------------------------------------------ arguments
const [command, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i += 1) {
  if (!rest[i].startsWith('--')) fail(`Unexpected argument: ${rest[i]}`);
  const key = rest[i].slice(2);
  const next = rest[i + 1];
  if (next === undefined || next.startsWith('--')) args[key] = true;
  else { args[key] = next; i += 1; }
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

const COMMANDS = ['find', 'reset-device', 'adjust-limit', 'revoke', 'unrevoke', 'erase-contact', 'delete-all', 'export-contact'];
if (!COMMANDS.includes(command)) fail(`Unknown command. Use one of: ${COMMANDS.join(', ')}`);

const product = args.product ?? 'pinchpdf';
if (product !== 'pinchpdf' && product !== 'nodupe') fail('--product must be pinchpdf or nodupe');
const NODUPE = product === 'nodupe';
const PRODUCT_NAME = NODUPE ? 'NoDupe' : 'PinchPDF';
const MODES = ['basic', 'similar', 'deep'];

const environment = args.env ?? 'local';
const TARGETS = {
  local: { db: NODUPE ? 'NODUPE_DB' : 'TRIAL_DB', flag: '--local', vars: '.dev.vars' },
  staging: { db: NODUPE ? (typeof args['staging-db'] === 'string' ? args['staging-db'] : fail('NoDupe has no staging database: create one and pass --staging-db <name>')) : 'pinchpdf-trial-staging', flag: '--remote', vars: '.dev.vars.staging' },
  prod: { db: NODUPE ? 'nodupe' : 'pinchpdf', flag: '--remote', vars: '.dev.vars.prod' },
};
const target = TARGETS[environment] ?? fail('--env must be local, staging or prod');

// ------------------------------------------------------------------ safe SQL literals
// wrangler d1 execute takes SQL text, not bound parameters, so every value is validated
// against a strict pattern before it goes into a statement.
const lit = {
  id: (v) => (/^[A-Za-z0-9_-]{1,64}$/.test(v) ? `'${v}'` : fail('invalid trial id')),
  ref: (v) => (/^[0-9A-HJKMNP-TV-Z]{8}$/.test(v) ? `'${v}'` : fail('support reference must be 8 characters, 0-9 and A-Z without I, L, O, U')),
  b64u: (v) => (/^[A-Za-z0-9_-]{1,100}$/.test(v) ? `'${v}'` : fail('invalid value')),
  int: (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? String(v) : fail(`number must be an integer from ${min} to ${max}`)),
  text: (v) => {
    if (typeof v !== 'string' || /[\u0000-\u001f\u007f]/.test(v) || v.length > 500) fail('text must be printable and at most 500 characters');
    return `'${v.replaceAll("'", "''")}'`;
  },
};

// ------------------------------------------------------------------ wrangler
function runSql(sql) {
  const file = join(tmpdir(), `trial-admin-${randomBytes(6).toString('hex')}.sql`);
  writeFileSync(file, sql);
  try {
    const result = spawnSync(process.execPath, [WRANGLER, 'd1', 'execute', target.db, target.flag, '--config', 'wrangler.json', '--json', '--file', file], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0) fail(`wrangler failed:\n${result.stderr || result.stdout}`);
    const start = result.stdout.indexOf('[');
    return JSON.parse(result.stdout.slice(start));
  } finally {
    rmSync(file, { force: true });
  }
}

const select = (sql) => runSql(sql).flatMap((r) => r.results ?? []);

// ------------------------------------------------------------------ secrets (find by email, export-contact)
function loadVars() {
  const path = new URL(`../${target.vars}`, import.meta.url);
  if (!existsSync(path)) fail(`${target.vars} not found (needed for PII_KEY and PEPPER_EMAIL)`);
  const vars = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) vars[m[1]] = m[2].trim();
  }
  return vars;
}
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const unb64u = (s) => new Uint8Array(Buffer.from(s, 'base64url'));

async function emailIndex(email) {
  const key = await subtle.importKey('raw', unb64u(loadVars().PEPPER_EMAIL), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(new Uint8Array(await subtle.sign('HMAC', key, enc.encode(email.trim().toLowerCase()))));
}

async function decryptField(id, field, stored) {
  if (!stored) return null;
  const [version, iv, ct] = stored.split('.');
  if (version !== 'v1') return null;
  const key = await subtle.importKey('raw', unb64u(loadVars().PII_KEY), 'AES-GCM', false, ['decrypt']);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv), additionalData: enc.encode(`${id}|${field}`) }, key, unb64u(ct));
  return new TextDecoder().decode(pt);
}

// ------------------------------------------------------------------ lookups
const MODE_COLUMNS = NODUPE ? 'used_basic, used_similar, used_deep, limit_basic, limit_similar, limit_deep, ' : '';
const COLUMNS = `id, support_ref, status, used, limit_total, ${MODE_COLUMNS}used_at_reset, pubkey IS NOT NULL AS has_key, name_enc IS NOT NULL AS has_contact, created_at, last_server_contact_at, terms_version, privacy_version`;

async function findRows() {
  if (args.ref) return select(`SELECT ${COLUMNS} FROM trials WHERE support_ref = ${lit.ref(args.ref)};`);
  if (args.id) return select(`SELECT ${COLUMNS} FROM trials WHERE id = ${lit.id(args.id)};`);
  if (args.email) return select(`SELECT ${COLUMNS} FROM trials WHERE email_bidx = ${lit.b64u(await emailIndex(args.email))};`);
  return fail('give --ref, --id or --email');
}

async function oneRow() {
  if (args.email) fail('this command takes --id or --ref (look the row up with find first)');
  const rows = await findRows();
  if (rows.length !== 1) fail(rows.length === 0 ? 'no matching trial' : `${rows.length} trials match; use --id`);
  return rows[0];
}

const show = (row) => ({ ...row, has_key: !!row.has_key, has_contact: !!row.has_contact, created_at: new Date(row.created_at * 1000).toISOString(), last_server_contact_at: new Date(row.last_server_contact_at * 1000).toISOString() });

// ------------------------------------------------------------------ commands
if (command === 'find') {
  const rows = await findRows();
  console.log(rows.length ? JSON.stringify(rows.map(show), null, 2) : 'no matching trial');
  process.exit(0);
}

const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
if (!reason) fail('--reason is required');
const operator = String(args.operator ?? process.env.USERNAME ?? process.env.USER ?? 'unknown').replace(/[^\w .@-]/g, '').slice(0, 60) || 'unknown';
const row = await oneRow();
const idLit = lit.id(row.id);
const now = Math.floor(Date.now() / 1000);

if (command === 'export-contact') {
  const [contact] = select(`SELECT name_enc, email_enc FROM trials WHERE id = ${idLit};`);
  const out = { id: row.id, support_ref: row.support_ref, name: await decryptField(row.id, 'name', contact.name_enc), email: await decryptField(row.id, 'email', contact.email_enc) };
  audit(`INSERT INTO trial_audit (trial_id, action, reason, operator, at, details) VALUES (${idLit}, 'export-contact', ${lit.text(reason)}, ${lit.text(operator)}, ${now}, NULL);`, false);
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

// Previous values go in the audit entry; never names, emails or hashes.
const previous = JSON.stringify({ status: row.status, used: row.used, limit_total: row.limit_total, ...(NODUPE ? Object.fromEntries(MODES.flatMap((m) => [[`used_${m}`, row[`used_${m}`]], [`limit_${m}`, row[`limit_${m}`]]])) : {}), support_ref: row.support_ref });
const auditSql = (action, details) =>
  `INSERT INTO trial_audit (trial_id, action, reason, operator, at, details) VALUES (${idLit}, '${action}', ${lit.text(reason)}, ${lit.text(operator)}, ${now}, ${details === null ? 'NULL' : lit.text(details)});`;

let changes;
switch (command) {
  case 'reset-device':
    if (row.status === 'reset') fail('already reset');
    changes = [
      auditSql('reset-device', previous),
      `UPDATE trials SET status = 'reset', pubkey_retired = pubkey, pubkey = NULL, h_guid = NULL, h_smbios = NULL, h_board = NULL, used_at_reset = used WHERE id = ${idLit} AND status != 'reset';`,
    ];
    console.log(`Note: the server count (${row.used}) is only a lower bound if the machine was used offline.\nBefore resetting, ask the user to open ${PRODUCT_NAME} online so unreported usage is sent. After the reset, grant at most the unused remainder: ${row.limit_total - row.used > 0 ? `adjust-limit on the NEW trial to ${row.limit_total - row.used}${NODUPE ? ' scans in total (set each mode with --mode)' : ''}` : 'nothing is left, so the new trial would be a support decision'}.`);
    break;
  case 'adjust-limit': {
    if (typeof args.limit !== 'string' || !/^[0-9]{1,3}$/.test(args.limit)) fail('--limit needs a number from 1 to 255, for example --limit 3');
    const limit = Number(args.limit);
    if (row.status === 'reset') fail('this trial was reset; adjust the new trial instead');
    if (NODUPE) {
      // One counter per mode: change one mode's limit, then keep the totals (used and limit_total) equal to the sums.
      if (!MODES.includes(args.mode)) fail('NoDupe needs --mode basic, similar or deep');
      const mode = args.mode;
      changes = [
        auditSql('adjust-limit', previous),
        `UPDATE trials SET limit_${mode} = ${lit.int(limit, 1, 255)}, used_${mode} = MIN(used_${mode}, ${limit}) WHERE id = ${idLit};`,
        `UPDATE trials SET limit_total = limit_basic + limit_similar + limit_deep, used = used_basic + used_similar + used_deep WHERE id = ${idLit};`,
      ];
      break;
    }
    changes = [auditSql('adjust-limit', previous), `UPDATE trials SET limit_total = ${lit.int(limit, 1, 255)}, used = MIN(used, ${limit}) WHERE id = ${idLit};`];
    break;
  }
  case 'revoke':
    if (row.status !== 'active') fail(`cannot revoke a trial that is ${row.status}`);
    changes = [auditSql('revoke', previous), `UPDATE trials SET status = 'revoked' WHERE id = ${idLit} AND status = 'active';`];
    break;
  case 'unrevoke':
    if (row.status !== 'revoked') fail(`trial is ${row.status}, not revoked`);
    changes = [auditSql('unrevoke', previous), `UPDATE trials SET status = 'active' WHERE id = ${idLit} AND status = 'revoked';`];
    break;
  case 'erase-contact':
    changes = [auditSql('erase-contact', previous), `UPDATE trials SET name_enc = NULL, email_enc = NULL, email_bidx = NULL WHERE id = ${idLit};`];
    break;
  case 'delete-all':
    console.log('WARNING: this removes the whole row. That machine can then register a new trial.');
    changes = [auditSql('delete-all', null), `DELETE FROM trials WHERE id = ${idLit};`];
    break;
}
audit(changes.join('\n'), true);

function audit(sql, announce) {
  if (environment !== 'local' && args.yes !== true) {
    console.log(`DRY RUN (add --yes to apply on ${environment}):\n${sql}`);
    process.exit(0);
  }
  runSql(sql);
  if (announce) console.log(`${command} applied to ${row.id} (${row.support_ref}) on ${environment}; audit entry written.`);
}
