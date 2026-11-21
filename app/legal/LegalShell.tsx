import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import ContactPopup from '../ContactPopup';
import { jsonLd } from '../json-ld';
import { legalEntityName, legalUpdatedDate, siteUrl } from '../company-data';
import LegalToc from '../LegalToc';
import MoreMenu from '../MoreMenu';
import ProductMenu from '../ProductMenu';
import SiteFooter from '../SiteFooter';
import { products } from '../products/data';

// Shared page frame for the legal documents (header, title block, table of contents, footer).
// The text of each document lives in its own page file.

export type LegalShellProps = {
  title: string;
  path: string;
  intro: ReactNode;
  toc: { id: string; label: string }[];
  children: ReactNode;
  updated?: string;
  draft?: boolean;
  footerHeading?: string;
};

export default function LegalShell({ title, path, intro, toc, children, updated = legalUpdatedDate, draft = true, footerHeading }: LegalShellProps) {
  const productNavItems = products.map(({ slug, path: productPath, name, category }) => ({ slug, path: productPath, name, category }));
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    url: `${siteUrl}${path}`,
    isPartOf: { '@type': 'Organization', name: 'Technowiz Solutions', url: siteUrl },
    dateModified: updated,
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
          <MoreMenu activePath={path} />
          <ContactPopup triggerLabel="Contact" triggerClassName="nav-button" />
        </nav>
      </header>

      <section className="about-hero legal-hero">
        <div className="section-heading">
          <p className="eyebrow">Legal</p>
          <h1>{title}</h1>
          <p>{intro}</p>
          <p className="legal-meta">
            Last updated: {updated} · {legalEntityName}
          </p>
          {draft ? (
            <p className="legal-meta">
              <strong>Draft:</strong> this text has not yet been reviewed by a legal professional and may change.
            </p>
          ) : null}
        </div>
      </section>

      <div className="legal-layout">
        <LegalToc sections={toc} />
        <div className="legal-content">{children}</div>
      </div>

      <section className="site-footer">
        <div>
          <p className="eyebrow">Technowiz Solutions</p>
          <h2>{footerHeading ?? `Questions about these ${title.toLowerCase()}?`}</h2>
        </div>
        <ContactPopup triggerLabel="Contact us" />
      </section>
      <SiteFooter />
    </main>
  );
}
