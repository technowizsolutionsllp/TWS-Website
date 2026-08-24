import Link from 'next/link';
import { products } from './products/data';

const strengths = [
  {
    label: 'Local-first desktop software',
    detail:
      'Windows utilities where sensitive documents and files stay on the user machine.',
  },
  {
    label: 'Explainable automation',
    detail:
      'Tools that show what they found, what they will change, and why a recommendation is safe.',
  },
  {
    label: 'Commercial-ready foundations',
    detail:
      'Licensing, offline license cache, native installers, update paths, and audit-focused workflows.',
  },
];

const services = [
  'Digital software product development',
  'Application design and engineering',
  'ITES and support services',
  'Technology consulting and advisory',
  'Product licensing and commercialization',
  'Import, export, and distribution of software solutions',
];

function InterfacePreview() {
  return (
    <div className="hero-visual" aria-label="Technowiz product preview">
      <div className="preview-topbar">
        <span />
        <span />
        <span />
      </div>
      <div className="preview-grid">
        <div className="preview-panel strong">
          <p>2 products</p>
          <strong>Local utilities</strong>
        </div>
        <div className="preview-panel accent">
          <p>Core promise</p>
          <strong>Know before you change files</strong>
        </div>
        <div className="preview-workspace">
          <div className="workspace-line wide" />
          <div className="workspace-line medium" />
          <div className="workspace-step active">
            <span>Analyze</span>
            <b>Format-aware review</b>
          </div>
          <div className="workspace-step">
            <span>Recommend</span>
            <b>Explainable action</b>
          </div>
          <div className="workspace-step">
            <span>Save</span>
            <b>User-approved output</b>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <Link href="/" className="brand">
          <span className="brand-mark">TW</span>
          <span>Technowiz Solutions</span>
        </Link>
        <nav aria-label="Primary navigation">
          <Link href="#products">Products</Link>
          <Link href="#services">Services</Link>
          <Link href="#contact">Contact</Link>
        </nav>
      </header>

      <section className="hero-section">
        <div className="hero-copy">
          <p className="eyebrow">Software products, ITES, consulting, support</p>
          <h1>Technowiz Solutions builds focused utilities for high-trust file work.</h1>
          <p className="lede">
            We develop, design, market, license, and support digital software products
            that help people clean, optimize, and manage local files with confidence.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="#products">
              View products
            </Link>
            <Link className="button secondary" href="#contact">
              Start a conversation
            </Link>
          </div>
        </div>
        <InterfacePreview />
      </section>

      <section className="signal-strip" aria-label="Company strengths">
        {strengths.map((item) => (
          <article key={item.label}>
            <h2>{item.label}</h2>
            <p>{item.detail}</p>
          </article>
        ))}
      </section>

      <section id="products" className="section-block">
        <div className="section-heading">
          <p className="eyebrow">Product portfolio</p>
          <h2>Two launch-ready product stories</h2>
          <p>
            The initial marketing system starts with NoDupe and PDF Compressor,
            each positioned around the strongest differentiator in its category.
          </p>
        </div>

        <div className="product-grid">
          {products.map((product) => (
            <article className="product-card" key={product.slug}>
              <div className="product-card-head">
                <img src={product.icon} alt="" />
                <span>{product.platform}</span>
              </div>
              <h3>{product.name}</h3>
              <p>{product.shortPitch}</p>
              <ul>
                {product.highlights.slice(0, 4).map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
              <Link className="text-link" href={`/products/${product.slug}`}>
                Open product page
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section id="services" className="section-block service-section">
        <div className="section-heading">
          <p className="eyebrow">Company scope</p>
          <h2>Product engineering with advisory and support capacity</h2>
          <p>
            Technowiz Solutions can build and commercialize owned software while also
            providing IT-enabled services, consulting, advisory, and support.
          </p>
        </div>
        <div className="service-list">
          {services.map((service) => (
            <span key={service}>{service}</span>
          ))}
        </div>
      </section>

      <section className="section-block research-section">
        <div className="section-heading">
          <p className="eyebrow">Positioning approach</p>
          <h2>Borrow the patterns, sharpen the promise</h2>
          <p>
            Current product pages in this market lead with an immediate job, simple
            workflow, trust claims, proof points, and a direct CTA. This prototype uses
            the same clarity, but avoids generic commodity claims by emphasizing local
            processing, review-before-change, explainability, and professional workflows.
          </p>
        </div>
      </section>

      <footer id="contact" className="site-footer">
        <div>
          <p className="eyebrow">Technowiz Solutions</p>
          <h2>Ready for the next prototype pass.</h2>
        </div>
        <a className="button primary" href="mailto:hello@technowiz.solutions">
          hello@technowiz.solutions
        </a>
      </footer>
    </main>
  );
}
