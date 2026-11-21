import type { Metadata } from 'next';
import LegalVersionPage from '../LegalVersionPage';
import { latestLegal, latestPaths } from '../latest';

// The stable address for the trial terms: always the latest text.
const { document } = latestLegal('terms');

export const metadata: Metadata = {
  title: document.title,
  description: document.intro,
  alternates: { canonical: latestPaths.terms },
  // A draft stays out of search until it has been reviewed.
  robots: { index: document.reviewed, follow: true },
};

export default function Page() {
  return <LegalVersionPage kind="terms" document={document} />;
}
