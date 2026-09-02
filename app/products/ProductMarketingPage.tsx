import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { contactEmail, siteUrl } from '../company-data';
import ContactPopup from '../ContactPopup';
import ProductMenu from '../ProductMenu';
import type { Product } from './data';
import { products } from './data';

function ProductVisual({ kind }: { kind: 'nodupe' | 'pdf' }) {
  if (kind === 'pdf') {
    return (
      <div className="product-visual pdf-visual" aria-label="PinchPDF workflow preview">
        <div className="pdf-page before">
          <span>Original</span>
          <div className="pdf-block tall" />
          <div className="pdf-line" />
          <div className="pdf-line short" />
        </div>
        <div className="pdf-page after">
          <span>Optimized</span>
          <div className="pdf-block compact" />
          <div className="pdf-line" />
          <div className="pdf-line short" />
        </div>
        <div className="visual-caption">
          <b>Preview first</b>
          <p>Make the file smaller, inspect the result, then save.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="product-visual nodupe-visual" aria-label="NoDupe compare workflow preview">
      <div className="folder-rail">
        <span>Exact</span>
        <span>Similar</span>
        <span>Deep</span>
      </div>
      <div className="dupe-results">
        <div className="result-row safe">
          <span>Duplicate files</span>
          <b>184 GB</b>
        </div>
        <div className="result-row copy">
          <span>Similar media</span>
          <b>426 groups</b>
        </div>
        <div className="result-row review">
          <span>Deep review</span>
          <b>92 items</b>
        </div>
      </div>
      <div className="visual-caption">
        <b>Detection plus decision</b>
        <p>Start with true duplicates, then explore similar and harder matches before cleanup.</p>
      </div>
    </div>
  );
}

export function buildProductMetadata(product: Product): Metadata {
  return {
    title: product.seoTitle,
    description: product.seoDescription,
    keywords: product.keywords,
    alternates: {
      canonical: product.path,
    },
    openGraph: {
      title: product.seoTitle,
      description: product.seoDescription,
      url: product.path,
      siteName: 'Technowiz Solutions',
      images: [product.icon],
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title: product.seoTitle,
      description: product.seoDescription,
      images: [product.icon],
    },
  };
}

export function ProductMarketingPage({ product }: { product: Product }) {
  const heroSlides = product.page.heroSlides ?? [
    {
      eyebrow: product.page.eyebrow,
      headline: product.headline,
      copy: product.page.promise,
    },
  ];
  const primaryActionHref = product.page.scanModes ? '#scan-modes' : '#uses';
  const primaryActionLabel = product.page.scanModes ? 'Compare scan modes' : 'See use cases';
  const productNavItems = products.map(({ slug, path, name, category }) => ({
    slug,
    path,
    name,
    category,
  }));

  const productStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: product.name,
    applicationCategory: product.category,
    operatingSystem: 'Windows',
    description: product.seoDescription,
    image: `${siteUrl}${product.icon}`,
    url: `${siteUrl}${product.path}`,
    publisher: {
      '@type': 'Organization',
      name: 'Technowiz Solutions',
      url: siteUrl,
      email: contactEmail,
    },
    offers: {
      '@type': 'Offer',
      availability: 'https://schema.org/InStock',
      category: 'Software',
    },
  };

  return (
    <main className={`product-page product-page-${product.slug}`}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productStructuredData) }}
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
        <nav aria-label={`${product.name} navigation`}>
          <Link href="/">Home</Link>
          <Link href="/#services">Services</Link>
          <ProductMenu items={productNavItems} activePath={product.path} />
          <Link href="/about">About</Link>
          <ContactPopup triggerLabel="Contact" triggerClassName="nav-button" />
        </nav>
      </header>

      <section className="product-hero">
        <div className={`product-hero-copy ${heroSlides.length > 1 ? 'product-rotating-hero' : ''}`}>
          <div className="product-kicker">
            <Image src={product.icon} alt="" width={56} height={56} priority />
            <span>{product.category}</span>
          </div>
          <div className="hero-slide-stage">
            {heroSlides.map((slide, index) => (
              <div className="hero-slide" key={slide.headline}>
                <p className="eyebrow">{slide.eyebrow}</p>
                {index === 0 ? (
                  <h1>{slide.headline}</h1>
                ) : (
                  <h2 className="hero-slide-heading">{slide.headline}</h2>
                )}
                <p className="lede">{slide.copy}</p>
              </div>
            ))}
          </div>
          {heroSlides.length > 1 ? (
            <div className="hero-slide-dots" aria-hidden="true">
              {heroSlides.map((slide) => (
                <span key={slide.headline} />
              ))}
            </div>
          ) : null}
          <div className="hero-actions">
            <a className="button primary" href={primaryActionHref}>
              {primaryActionLabel}
            </a>
            <ContactPopup triggerLabel="Discuss this product" triggerClassName="button secondary" />
          </div>
        </div>
        <ProductVisual kind={product.visual} />
      </section>

      <section className="metric-strip" aria-label={`${product.name} product facts`}>
        {product.metrics.map((metric) => (
          <article key={metric.label}>
            <strong>{metric.value}</strong>
            <span>{metric.label}</span>
          </article>
        ))}
      </section>

      {product.page.scanModes ? (
        <section id="scan-modes" className="section-block scan-mode-section">
          <div className="section-heading">
            <p className="eyebrow">Scan modes</p>
            <h2>{product.page.scanModes.title}</h2>
            <p>{product.page.scanModes.intro}</p>
          </div>
          <div className="scan-mode-grid">
            {product.page.scanModes.modes.map((mode) => (
              <article key={mode.name}>
                <span>{mode.name}</span>
                <h3>{mode.label}</h3>
                <p>{mode.detail}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="section-block product-story-section">
        <div className="story-grid">
          <article>
            <p className="eyebrow">The product</p>
            <h2>{product.page.marketTitle}</h2>
            <p>{product.page.marketCopy}</p>
          </article>
          <article className="story-emphasis">
            <p className="eyebrow">Why Technowiz</p>
            <h2>{product.page.advantageTitle}</h2>
            <p>{product.page.advantageCopy}</p>
          </article>
        </div>
      </section>

      <section id="uses" className="section-block use-case-section">
        <div className="section-heading">
          <p className="eyebrow">Individual and business use</p>
          <h2>Built for everyday users and serious operating needs</h2>
        </div>
        <div className="use-case-grid">
          {[product.page.individualUse, product.page.businessUse].map((useCase) => (
            <article key={useCase.title}>
              <h3>{useCase.title}</h3>
              <p>{useCase.intro}</p>
              <ul className="proof-list">
                {useCase.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="section-block comparison-section">
        <div className="section-heading">
          <p className="eyebrow">How it is better</p>
          <h2>A clearer workflow than typical one-button tools</h2>
          <p>{product.moat.detail}</p>
        </div>
        <div className="comparison-grid">
          {product.page.comparison.map((item) => (
            <article key={item.title}>
              <span>{product.moat.proofLabel}</span>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section-block coverage-section">
        <div className="section-heading">
          <p className="eyebrow">What it covers</p>
          <h2>Practical coverage for the jobs users actually have</h2>
        </div>
        <div className="coverage-grid">
          {product.page.coverage.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="workflow" className="section-block workflow-section">
        <div className="section-heading">
          <p className="eyebrow">Workflow</p>
          <h2>A clear path from review to result</h2>
        </div>
        <div className="workflow-grid">
          {product.workflow.map((step) => (
            <article key={step.step}>
              <span>{step.step}</span>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section-block two-column">
        <div>
          <p className="eyebrow">Trust proof</p>
          <h2>Confidence built into the product</h2>
          <ul className="proof-list">
            {product.proof.map((proof) => (
              <li key={proof}>{proof}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="eyebrow">Best fit</p>
          <h2>Who this is for</h2>
          <ul className="proof-list">
            {product.audience.map((audience) => (
              <li key={audience}>{audience}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="product-final-cta">
        <div>
          <p className="eyebrow">{product.name}</p>
          <h2>{product.page.finalTitle}</h2>
          <p>{product.page.finalCopy}</p>
        </div>
        <ContactPopup triggerLabel="Discuss this product" />
      </section>
    </main>
  );
}
