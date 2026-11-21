import type { Metadata } from 'next';
import LegalShell from '../legal/LegalShell';
import SoftwareLicense, { licenseSections } from './SoftwareLicense';
import WebsiteTerms, { websiteSections } from './WebsiteTerms';

// DRAFT (see docs/legal/STRUCTURE.md). /terms is the one address for the terms: Part A covers the website,
// Part B is the software license agreement with a schedule per product. The privacy policy is /privacy.

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    'Terms of Service for Technowiz Solutions: website terms and the software license agreement for the NoDupe and PinchPDF Windows desktop applications.',
  alternates: { canonical: '/terms' },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Terms of Service | Technowiz Solutions',
    description: 'The terms that govern use of the Technowiz Solutions website and the NoDupe and PinchPDF applications.',
    url: '/terms',
    siteName: 'Technowiz Solutions',
    images: ['/og.png'],
    type: 'website',
  },
};

const toc = [
  { id: 'website-terms', label: 'Part A: Website Terms of Use' },
  ...websiteSections,
  { id: 'software-license', label: 'Part B: Software License Agreement' },
  ...licenseSections,
];

export default function TermsOfServicePage() {
  return (
    <LegalShell
      title="Terms of Service"
      path="/terms"
      toc={toc}
      footerHeading="Questions about these terms?"
      intro="These terms have two parts. Part A covers use of the Technowiz Solutions website. Part B is the license agreement for the NoDupe and PinchPDF Windows desktop applications, with a schedule for each product, including the PinchPDF free trial."
    >
      <WebsiteTerms />
      <SoftwareLicense />
    </LegalShell>
  );
}
