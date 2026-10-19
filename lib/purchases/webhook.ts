import { NextResponse } from 'next/server';

const maxBodyBytes = 256 * 1024;

export const json = (body: Record<string, unknown>, status: number) =>
  NextResponse.json(body, { status });

// Reads the raw body (needed for signature checks) with a size cap.
export async function readRawBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBodyBytes) return null;
  const raw = await request.text();
  return raw.length > maxBodyBytes ? null : raw;
}

export function str(value: unknown, maxLength = 500): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || null;
}

export function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
