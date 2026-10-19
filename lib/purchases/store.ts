import { getDb } from './env';

export type Purchase = {
  id: number;
  provider: string;
  order_ref: string;
  name: string | null;
  email: string | null;
  license_key: string | null;
  product: string | null;
  created_at: string;
  updated_at: string;
};

export type PurchaseUpdate = {
  provider: 'lemonsqueezy' | 'dodo';
  orderRef: string;
  name?: string | null;
  email?: string | null;
  licenseKey?: string | null;
  product?: string | null;
};

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error('D1 binding "DB" is not configured');
  return db;
}

// Insert or merge: later events only fill fields that are present, so the
// payment event and the license-key event can arrive in either order.
export async function upsertPurchase(update: PurchaseUpdate) {
  const db = await requireDb();
  await db
    .prepare(
      `INSERT INTO purchases (provider, order_ref, name, email, license_key, product)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (provider, order_ref) DO UPDATE SET
         name        = COALESCE(excluded.name, name),
         email       = COALESCE(excluded.email, email),
         license_key = COALESCE(excluded.license_key, license_key),
         product     = COALESCE(excluded.product, product),
         updated_at  = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
    )
    .bind(
      update.provider,
      update.orderRef,
      update.name ?? null,
      update.email ?? null,
      update.licenseKey ?? null,
      update.product ?? null,
    )
    .run();
}

export async function listPurchases(limit = 5000): Promise<Purchase[]> {
  const db = await requireDb();
  const { results } = await db
    .prepare('SELECT * FROM purchases ORDER BY created_at DESC, id DESC LIMIT ?1')
    .bind(limit)
    .all<Purchase>();
  return results;
}
