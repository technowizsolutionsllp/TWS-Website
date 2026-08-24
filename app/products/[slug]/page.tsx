import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProduct, products } from '../data';

type ProductPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return products.map((product) => ({ slug: product.slug }));
}

function ProductVisual({ kind }: { kind: 'nodupe' | 'pdf' }) {
  if (kind === 'pdf') {
    return (
      <div className="product-visual pdf-visual" aria-label="PDF Compressor workflow preview">
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
          <b>Auto strategy</b>
          <p>Preserve text, reduce image weight, preview the real output.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="product-visual nodupe-visual" aria-label="NoDupe compare workflow preview">
      <div className="folder-rail">
        <span>Master</span>
        <span>Target A</span>
        <span>Target B</span>
      </div>
      <div className="dupe-results">
        <div className="result-row safe">
          <span>Safe to clean</span>
          <b>184 GB</b>
        </div>
        <div className="result-row copy">
          <span>Copy then verify</span>
          <b>41 GB</b>
        </div>
        <div className="result-row review">
          <span>Needs review</span>
          <b>312 groups</b>
        </div>
      </div>
      <div className="visual-caption">
        <b>Protected cleanup</b>
        <p>Master folders stay protected while cleanup targets are verified.</p>
      </div>
    </div>
  );
}

export async function generateMetadata({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = getProduct(slug);

  if (!product) {
    return {};
  }

  return {
    title: `${product.name} | Technowiz Solutions`,
    description: product.shortPitch,
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = getProduct(slug);

  if (!product) {
    notFound();
  }

  return (
    <main>
      <header className="site-header">
        <Link href="/" className="brand">
          <span className="brand-mark">TW</span>
          <span>Technowiz Solutions</span>
        </Link>
        <nav aria-label="Product navigation">
          <Link href="/">Home</Link>
          <Link href="/#products">Products</Link>
          <Link href="/#contact">Contact</Link>
        </nav>
      </header>

      <section className="product-hero">
        <div className="product-hero-copy">
          <div className="product-kicker">
            <img src={product.icon} alt="" />
            <span>{product.category}</span>
          </div>
          <h1>{product.headline}</h1>
          <p className="lede">{product.longPitch}</p>
          <div className="hero-actions">
            <a className="button primary" href="#workflow">
              See workflow
            </a>
            <a className="button secondary" href="mailto:hello@technowiz.solutions">
              Discuss launch
            </a>
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

      <section className="section-block">
        <div className="section-heading">
          <p className="eyebrow">Product promise</p>
          <h2>What the page should sell</h2>
        </div>
        <div className="feature-list">
          {product.highlights.map((highlight) => (
            <article key={highlight}>
              <span />
              <p>{highlight}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="workflow" className="section-block workflow-section">
        <div className="section-heading">
          <p className="eyebrow">Workflow</p>
          <h2>Show the user a confident path</h2>
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
          <h2>Claims grounded in the product architecture</h2>
          <ul className="proof-list">
            {product.proof.map((proof) => (
              <li key={proof}>{proof}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="eyebrow">Audience</p>
          <h2>Initial buyer and user targets</h2>
          <ul className="proof-list">
            {product.audience.map((audience) => (
              <li key={audience}>{audience}</li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
