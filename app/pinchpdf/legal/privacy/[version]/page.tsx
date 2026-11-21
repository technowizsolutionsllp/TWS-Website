import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import LegalVersionPage, { legalPath } from '../../LegalVersionPage';
import { getLegalVersion, legalVersions } from '../../versions';

type Params = { version: string };

export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return Object.keys(legalVersions.privacy).map((version) => ({ version }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { version } = await params;
  const document = getLegalVersion('privacy', version);
  if (!document) return {};
  return {
    title: `${document.title} (${version})`,
    description: document.intro,
    alternates: { canonical: legalPath('privacy', version) },
    // A draft stays out of search until it has been reviewed.
    robots: { index: document.reviewed, follow: true },
  };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { version } = await params;
  const document = getLegalVersion('privacy', version);
  if (!document) notFound();
  return <LegalVersionPage kind="privacy" version={version} document={document} />;
}
