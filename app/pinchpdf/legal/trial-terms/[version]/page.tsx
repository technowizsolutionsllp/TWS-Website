import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import LegalVersionPage, { legalPath } from '../../LegalVersionPage';
import { getLegalVersion, legalVersions } from '../../versions';

type Params = { version: string };

export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return Object.keys(legalVersions.terms).map((version) => ({ version }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { version } = await params;
  const document = getLegalVersion('terms', version);
  if (!document) return {};
  return {
    title: `${document.title} (${version})`,
    description: document.intro,
    alternates: { canonical: legalPath('terms', version) },
    // A draft stays out of search until it has been reviewed.
    robots: { index: document.reviewed, follow: true },
  };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { version } = await params;
  const document = getLegalVersion('terms', version);
  if (!document) notFound();
  return <LegalVersionPage kind="terms" version={version} document={document} />;
}
