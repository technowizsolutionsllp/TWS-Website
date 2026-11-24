import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { contactEmail, legalEntityName, legalUpdatedDate, siteUrl } from '../company-data';
import ContactPopup from '../ContactPopup';
import { jsonLd } from '../json-ld';
import MoreMenu from '../MoreMenu';
import ProductMenu from '../ProductMenu';
import SiteFooter from '../SiteFooter';
import { latestLegal } from '../pinchpdf/legal/latest';
import { latestNodupeLegal } from '../nodupe/legal/latest';
import { products } from '../products/data';

// One place that lists every legal document and when it was last updated. The addresses are stable
// and always show the latest text; the documents live at /privacy and /terms and this page links to them.
// Keep this list in step with docs/legal/STRUCTURE.md.

const terms = latestLegal('terms');
const privacy = latestLegal('privacy');
const nodupeTerms = latestNodupeLegal('terms');
const nodupePrivacy = latestNodupeLegal('privacy');

const documents = [
  {
    title: 'Privacy Policy',
    href: '/privacy',
    applies: 'The website, NoDupe and PinchPDF, including the free-trial registration of each (Annex A for PinchPDF, Annex B for NoDupe), license events, and install and uninstall events.',
    updated: legalUpdatedDate,
  },
  {
    title: 'Terms of Service',
    href: '/terms',
    applies: 'Part A: use of this website. Part B: the NoDupe and PinchPDF software license agreement, with a schedule for each product.',
    updated: legalUpdatedDate,
  },
  {
    title: privacy.document.title,
    href: '/privacy#pinchpdf-trial',
    applies: 'Annex A of the Privacy Policy: what the PinchPDF free-trial registration collects and why.',
    updated: privacy.document.effective,
  },
  {
    title: terms.document.title,
    href: '/terms#schedule-a-trial',
    applies: 'Part B, Schedule A of the Terms of Service.',
    updated: terms.document.effective,
  },
  {
    title: nodupePrivacy.document.title,
    href: '/privacy#nodupe-trial',
    applies: 'Annex B of the Privacy Policy: what the NoDupe free-trial registration collects and why.',
    updated: nodupePrivacy.document.effective,
  },
  {
    title: nodupeTerms.document.title,
    href: '/terms#schedule-b-trial',
    applies: 'Part B, Schedule B of the Terms of Service.',
    updated: nodupeTerms.document.effective,
  },
];

export const metadata: Metadata = {
  title: 'Legal documents',
  description: 'All Technowiz Solutions legal documents in one place: privacy, terms and the PinchPDF and NoDupe trial notices.',
  alternates: { canonical: '/legal' },
};

export default function LegalIndexPage() {
  const productNavItems = products.map(({ slug, path, name, category }) => ({ slug, path, name, category }));
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Legal documents',
    url: `${siteUrl}/legal`,
    isPartOf: { '@type': 'Organization', name: 'Technowiz Solutions', url: siteUrl },
  };

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(structuredData) }} />
      <header className="site-header">
        <Link href="/" className="brand">
          <Image src="/technowiz-lockup.svg" alt="Technowiz Solutions" width={224} height={60} priority />
        </Link>
        <nav aria-label="Primary navigation">
          <Link href="/#services">Services</Link>
          <ProductMenu items={productNavItems} />
          <MoreMenu activePath="/legal" />
          <ContactPopup triggerLabel="Contact" triggerClassName="nav-button" />
        </nav>
      </header>

      <section className="about-hero legal-hero">
        <div className="section-heading">
          <p className="eyebrow">Legal</p>
          <h1>Legal documents</h1>
          <p>
            Every document that applies to our website and software, with the date each was last updated. These
            addresses always show the current text.
          </p>
          <p className="legal-meta">{legalEntityName}</p>
        </div>
      </section>

      <div className="legal-content">
        <ul>
          {documents.map((document) => (
            <li key={document.href}>
              <h2>
                <Link href={document.href}>{document.title}</Link>
              </h2>
              <p>
                {document.applies} Last updated {document.updated}.
              </p>
            </li>
          ))}
        </ul>
        <p>
          Questions about any of these: <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
        </p>
      </div>

      <SiteFooter />
    </main>
  );
}
