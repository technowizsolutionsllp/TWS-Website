import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { companyLocation, contactEmail, siteUrl } from '../company-data';
import ContactPopup from '../ContactPopup';
import ProductMenu from '../ProductMenu';
import { products } from '../products/data';

const principles = [
  {
    title: 'Understand the work first',
    detail:
      'The real brief is usually inside the handoffs, approvals, files, exceptions, and repeated decisions behind the request.',
  },
  {
    title: 'Build for adoption',
    detail:
      'Useful software needs more than screens. It needs reliability, performance, onboarding, error handling, and support.',
  },
  {
    title: 'Make control visible',
    detail:
      'When software touches documents, files, payments, or business data, users should understand what changed and why.',
  },
  {
    title: 'Improve from evidence',
    detail:
      'Prototypes, QA evidence, support patterns, and user feedback should decide what gets improved next.',
  },
];

export const metadata: Metadata = {
  title: 'About Technowiz Solutions',
  description:
    'Learn about Technowiz Solutions, a product-led software company in Mumbai building software products, workflow systems, automation, desktop utilities, and IT-enabled operations.',
  keywords: [
    'about Technowiz Solutions',
    'local-first software company',
    'desktop software company',
    'workflow automation company',
    'IT enabled services company',
  ],
  alternates: {
    canonical: '/about',
  },
  openGraph: {
    title: 'About Technowiz Solutions',
    description:
      'Technowiz Solutions builds software products, workflow systems, automation, desktop utilities, and IT-enabled operations.',
    url: '/about',
    siteName: 'Technowiz Solutions',
    images: ['/og.png'],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'About Technowiz Solutions',
    description:
      'Technowiz Solutions builds software products, workflow systems, automation, desktop utilities, and IT-enabled operations.',
    images: ['/og.png'],
  },
};

export default function AboutPage() {
  const productNavItems = products.map(({ slug, path, name, category }) => ({
    slug,
    path,
    name,
    category,
  }));

  const aboutStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    name: 'About Technowiz Solutions',
    url: `${siteUrl}/about`,
    description:
      'Technowiz Solutions builds software products, workflow systems, automation, desktop utilities, and IT-enabled operations for businesses that need clarity, control, and speed.',
    about: {
      '@type': 'Organization',
      name: 'Technowiz Solutions',
      url: siteUrl,
      email: contactEmail,
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Mumbai',
        addressRegion: 'Maharashtra',
        addressCountry: 'IN',
      },
    },
    mainEntity: {
      '@type': 'Organization',
      name: 'Technowiz Solutions',
      url: siteUrl,
      knowsAbout: [
        'Local-first software',
        'Desktop application engineering',
        'Workflow automation',
        'Duplicate file cleanup',
        'PDF compression',
        'IT-enabled services',
      ],
    },
  };

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(aboutStructuredData) }}
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
        <nav aria-label="About navigation">
          <Link href="/">Home</Link>
          <Link href="/#services">Services</Link>
          <ProductMenu items={productNavItems} />
          <ContactPopup triggerLabel="Contact" triggerClassName="nav-button" />
        </nav>
      </header>

      <section className="about-hero">
        <div className="section-heading">
          <p className="eyebrow">About Technowiz Solutions</p>
          <h1>A product-led software company built for real operations.</h1>
          <p>
            Technowiz Solutions is based in Mumbai and builds software where
            operational clarity matters: workflow systems, automation, desktop
            utilities, IT-enabled processes, and owned products that solve specific
            business problems.
          </p>
        </div>
      </section>

      <section className="about-facts" aria-label="Company details">
        <article>
          <span>Location</span>
          <strong>{companyLocation}</strong>
        </article>
        <article>
          <span>Contact</span>
          <strong>{contactEmail}</strong>
        </article>
      </section>

      <section className="section-block about-focus-section">
        <div className="section-heading">
          <p className="eyebrow">What we are building</p>
          <h2>Owned products and implementation depth</h2>
          <p>
            The company is being built around two connected capabilities: creating an
            owned software portfolio and helping businesses replace fragile manual
            processes with maintainable systems. That includes product strategy,
            UX, engineering, automation, desktop software, launch planning,
            documentation, and support.
          </p>
        </div>
        <div className="about-product-list">
          {products.map((product) => (
            <Link href={product.path} key={product.slug}>
              <span>{product.category}</span>
              <strong>{product.name}</strong>
              <p>{product.shortPitch}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <p className="eyebrow">Operating principles</p>
          <h2>How our work should feel</h2>
        </div>
        <div className="principle-grid">
          {principles.map((principle) => (
            <article key={principle.title}>
              <h3>{principle.title}</h3>
              <p>{principle.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="site-footer">
        <div>
          <p className="eyebrow">Work with Technowiz</p>
          <h2>Turn operational complexity into software people can rely on.</h2>
        </div>
        <ContactPopup triggerLabel="Discuss a project" />
      </section>
    </main>
  );
}
