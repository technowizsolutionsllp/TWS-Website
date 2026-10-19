import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { adminCookieName, isAdmin } from '../../lib/purchases/admin-auth';
import { listPurchases, type Purchase } from '../../lib/purchases/store';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const cell = { padding: '8px 12px', borderBottom: '1px solid #d9e1ea', textAlign: 'left' as const };

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const authed = await isAdmin((await cookies()).get(adminCookieName)?.value);

  if (!authed) {
    return (
      <main style={{ maxWidth: 420, margin: '96px auto', padding: '0 20px' }}>
        <h1>Admin</h1>
        <form method="post" action="/api/admin/login" style={{ display: 'grid', gap: 12 }}>
          <input
            type="password"
            name="secret"
            placeholder="Admin secret"
            autoComplete="current-password"
            required
            style={{ padding: 10, border: '1px solid #d9e1ea', borderRadius: 8 }}
          />
          <button type="submit" style={{ padding: 10, borderRadius: 8 }}>
            Sign in
          </button>
          {error ? (
            <p role="alert" style={{ color: '#d94b5c' }}>
              {error === 'rate' ? 'Too many attempts. Wait a minute.' : 'Incorrect secret.'}
            </p>
          ) : null}
        </form>
      </main>
    );
  }

  let purchases: Purchase[] = [];
  let loadError = false;
  try {
    purchases = await listPurchases(500);
  } catch {
    loadError = true;
  }

  return (
    <main style={{ maxWidth: 1100, margin: '48px auto', padding: '0 20px' }}>
      <h1>Purchases</h1>
      <p>
        <a href="/api/admin/export?format=xlsx">Download Excel (.xlsx)</a>
        {' · '}
        <a href="/api/admin/export?format=csv">Download CSV</a>
      </p>
      {loadError ? <p role="alert">Could not read the database (is the D1 binding set up?).</p> : null}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
          <thead>
            <tr>
              {['Date', 'Provider', 'Name', 'Email', 'License key'].map((h) => (
                <th key={h} style={cell}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {purchases.map((p) => (
              <tr key={p.id}>
                <td style={cell}>{p.created_at.replace('T', ' ').replace('Z', '')}</td>
                <td style={cell}>{p.provider}</td>
                <td style={cell}>{p.name}</td>
                <td style={cell}>{p.email}</td>
                <td style={{ ...cell, fontFamily: 'monospace' }}>{p.license_key}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: '#667085' }}>Showing the latest {purchases.length}. Exports include all rows.</p>
    </main>
  );
}
