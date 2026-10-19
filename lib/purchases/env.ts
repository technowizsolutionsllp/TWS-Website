// Reads a Worker secret/var. Falls back to process.env for the local Node server.
export async function getEnv(name: string): Promise<string | undefined> {
  try {
    const { env } = await import('cloudflare:workers');
    const value = (env as Record<string, unknown>)[name];
    if (typeof value === 'string' && value) return value;
  } catch {
    // not running on Workers
  }
  return process.env[name]?.trim() || undefined;
}

export async function getDb(): Promise<D1Database | undefined> {
  try {
    const { env } = await import('cloudflare:workers');
    return (env as { DB?: D1Database }).DB;
  } catch {
    return undefined;
  }
}
