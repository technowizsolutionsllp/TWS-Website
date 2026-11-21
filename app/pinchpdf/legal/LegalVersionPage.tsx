import Image from 'next/image';
import Link from 'next/link';
import { contactEmail, legalEntityName, siteUrl } from '../../company-data';
import ContactPopup from '../../ContactPopup';
import { jsonLd } from '../../json-ld';
import LegalToc from '../../LegalToc';
import MoreMenu from '../../MoreMenu';
import ProductMenu from '../../ProductMenu';
import SiteFooter from '../../SiteFooter';
import { products } from '../../products/data';
import type { LegalKind, LegalVersion } from './versions';

const paths: Record<LegalKind, string> = {
  terms: '/pinchpdf/legal/trial-terms',
  privacy: '/pinchpdf/legal/privacy',
};

export function legalPath(kind: LegalKind, version: string) {
  return `${paths[kind]}/${version}`;
}

export default function LegalVersionPage({
  kind,
  version,
  document,
}: {
  kind: LegalKind;
  version: string;
  document: LegalVersion;
}) {
  const productNavItems = products.map(({ slug, path, name, category }) => ({ slug, path, name, category }));
  const url = `${siteUrl}${legalPath(kind, version)}`;
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: document.title,
    url,
    isPartOf: { '@type': 'Organization', name: 'Technowiz Solutions', url: siteUrl },
    dateModified: document.effective,
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
          <MoreMenu activePath="/pinchpdf" />
          <ContactPopup triggerLabel="Contact" triggerClassName="nav-button" />
        </nav>
      </header>

      <section className="about-hero legal-hero">
        <div className="section-heading">
          <p className="eyebrow">Legal</p>
          <h1>{document.title}</h1>
          <p>{document.intro}</p>
          <p className="legal-meta">
            Version {version} · {legalEntityName}
          </p>
          {document.reviewed ? null : (
            <p className="legal-meta">
              <strong>Draft:</strong> this text has not yet been reviewed by a legal professional and may change in
              a later version.
            </p>
          )}
        </div>
      </section>

      <div className="legal-layout">
        <LegalToc sections={document.sections.map(({ id, heading }) => ({ id, label: heading }))} />
        <div className="legal-content">
          {document.sections.map((section, index) => (
            <section key={section.id} id={section.id}>
              <h2>
                {index + 1}. {section.heading}
              </h2>
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.id === 'contact' ? (
                <p>
                  <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
                </p>
              ) : null}
            </section>
          ))}
        </div>
      </div>

      <section className="site-footer">
        <div>
          <p className="eyebrow">Technowiz Solutions</p>
          <h2>Questions about the trial?</h2>
        </div>
        <ContactPopup triggerLabel="Contact us" />
      </section>
      <SiteFooter />
    </main>
  );
}
