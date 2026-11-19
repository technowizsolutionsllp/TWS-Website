import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { contactEmail, siteUrl } from '../company-data';
import ContactPopup from '../ContactPopup';
import MoreMenu from '../MoreMenu';
import ProductMenu from '../ProductMenu';
import SiteFooter from '../SiteFooter';
import { products } from '../products/data';
import SupportForm from './SupportForm';

export const metadata: Metadata = {
  title: 'Get Support',
  description:
    'Get help with NoDupe, PinchPDF, or any Technowiz Solutions product. Describe your issue and attach screenshots or files, and our team will reply by email.',
  alternates: {
    canonical: '/get-support',
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: 'Get Support | Technowiz Solutions',
    description:
      'Describe your issue, attach screenshots or files, and our support team will reply by email.',
    url: '/get-support',
    siteName: 'Technowiz Solutions',
    images: ['/og.png'],
    type: 'website',
  },
};

export default function GetSupportPage() {
  const productNavItems = products.map(({ slug, path, name, category }) => ({
    slug,
    path,
    name,
    category,
  }));

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'ContactPage',
    name: 'Get Support',
    url: `${siteUrl}/get-support`,
    isPartOf: {
      '@type': 'Organization',
      name: 'Technowiz Solutions',
      url: siteUrl,
    },
  };

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <header className="site-header">
        <Link href="/" className="brand">
          <Image
            src="/technowiz-lockup.svg"
            alt="Technowiz Solutions"
            width={224}
            height={60}
            priority
          />
        </Link>
        <nav aria-label="Primary navigation">
          <Link href="/#services">Services</Link>
          <ProductMenu items={productNavItems} />
          <MoreMenu activePath="/get-support" />
          <ContactPopup triggerLabel="Contact" triggerClassName="nav-button" />
        </nav>
      </header>

      <section className="about-hero legal-hero">
        <div className="section-heading">
          <p className="eyebrow">Support</p>
          <h1>Get support</h1>
          <p>
            Something not working in NoDupe, PinchPDF, or another Technowiz
            product? Tell us what happened and attach screenshots or files, and
            our team will reply by email.
          </p>
        </div>
      </section>

      <div className="support-layout">
        <SupportForm products={products.map((product) => product.name)} />

        <aside className="support-aside" aria-label="Tips for a faster fix">
          <h2>For a faster fix</h2>
          <ul>
            <li>Name the product and its version, and your Windows version.</li>
            <li>List the steps that lead to the problem.</li>
            <li>Include the exact error message, or a screenshot of it.</li>
            <li>Attach a log or the file that fails, if there is one.</li>
          </ul>
          <p>
            Prefer plain email? Write to{' '}
            <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
          </p>
        </aside>
      </div>

      <SiteFooter />
    </main>
  );
}
