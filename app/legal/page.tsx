import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { contactEmail, legalEntityName, legalUpdatedDate, siteUrl } from '../company-data';
import ContactPopup from '../ContactPopup';
import { jsonLd } from '../json-ld';
import MoreMenu from '../MoreMenu';
import ProductMenu from '../ProductMenu';
import SiteFooter from '../SiteFooter';
import { latestLegal, latestPaths } from '../pinchpdf/legal/latest';
import { products } from '../products/data';

// One place that lists every legal document and when it was last updated. The addresses are stable
// and always show the latest text. Keep this list in step with docs/legal/STRUCTURE.md.

const terms = latestLegal('terms');
const privacy = latestLegal('privacy');

const documents = [
  {
    title: 'Privacy Policy',
    href: '/privacy',
    applies: 'The website, NoDupe, PinchPDF and the PinchPDF free-trial registration.',
    updated: legalUpdatedDate,
  },
  {
    title: 'Terms of Service',
    href: '/terms',
    applies: 'The website and the NoDupe and PinchPDF software.',
    updated: legalUpdatedDate,
  },
  {
    title: terms.document.title,
    href: latestPaths.terms,
    applies: 'The PinchPDF free trial.',
    updated: terms.document.effective,
  },
  {
    title: privacy.document.title,
    href: latestPaths.privacy,
    applies: 'What the PinchPDF free-trial registration collects and why.',
    updated: privacy.document.effective,
  },
];

export const metadata: Metadata = {
  title: 'Legal documents',
  description: 'All Technowiz Solutions legal documents in one place: privacy, terms and the PinchPDF trial notices.',
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
