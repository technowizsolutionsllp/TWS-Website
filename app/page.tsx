import Link from 'next/link';
import Image from 'next/image';
import { services, siteUrl } from './company-data';
import ContactPopup from './ContactPopup';
import ProductMenu from './ProductMenu';
import { products } from './products/data';

const strengths = [
  {
    label: 'Built around the operation',
    detail:
      'We start with the work that is slow, risky, repeated, or hard to control, then design software around that operating reality.',
  },
  {
    label: 'Commercial-grade engineering',
    detail:
      'Architecture, native packaging, performance, licensing, diagnostics, and supportability are treated as part of the product, not afterthoughts.',
  },
  {
    label: 'Product discipline',
    detail:
      'Every build needs a reason to exist, a first useful release, and a path to improve once real users begin using it.',
  },
];

const engagementSteps = [
  {
    step: '01',
    title: 'Find the operational drag',
    detail:
      'Identify the manual work, approval loops, file movement, document handling, and decisions that create delay or risk.',
  },
  {
    step: '02',
    title: 'Define the useful first release',
    detail:
      'Turn the problem into a focused first release with the right workflow, priorities, and delivery plan.',
  },
  {
    step: '03',
    title: 'Build with evidence',
    detail:
      'Prototype the risky parts, validate the core workflow, harden the implementation, and avoid features that do not move the outcome.',
  },
  {
    step: '04',
    title: 'Launch and improve',
    detail:
      'Support onboarding, diagnostics, documentation, fixes, and iteration so the product keeps earning its place in the business.',
  },
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
          <p>Focus</p>
          <strong>Workflow systems</strong>
        </div>
        <div className="preview-panel accent">
          <p>Proof</p>
          <strong>Owned products</strong>
        </div>
        <div className="preview-workspace">
          <div className="workspace-line wide" />
          <div className="workspace-line medium" />
          <div className="workspace-step active">
            <span>Map</span>
            <b>Understand the work behind the request</b>
          </div>
          <div className="workspace-step">
            <span>Build</span>
            <b>Turn the workflow into a usable system</b>
          </div>
          <div className="workspace-step">
            <span>Operate</span>
            <b>Support the product after release</b>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const productNavItems = products.map(({ slug, path, name, category }) => ({
    slug,
    path,
    name,
    category,
  }));

  const organizationStructuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${siteUrl}/#organization`,
        name: 'Technowiz Solutions',
        url: siteUrl,
        logo: `${siteUrl}/technowiz-lockup.svg`,
        description:
          'Technowiz Solutions builds software products, workflow systems, automation, desktop utilities, and IT-enabled operations for businesses that need clarity, control, and speed.',
        knowsAbout: [
          'Software product development',
          'Desktop software development',
          'Workflow automation',
          'IT-enabled services',
          'Technology consulting',
          'Duplicate file cleanup',
          'PDF compression',
        ],
      },
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        name: 'Technowiz Solutions',
        url: siteUrl,
        publisher: {
          '@id': `${siteUrl}/#organization`,
        },
      },
      {
        '@type': 'ItemList',
        name: 'Technowiz Solutions software products',
        itemListElement: products.map((product, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: `${siteUrl}${product.path}`,
          name: product.name,
          description: product.seoDescription,
        })),
      },
      ...services.map((service) => ({
        '@type': 'Service',
        provider: {
          '@id': `${siteUrl}/#organization`,
        },
        name: service.title,
        description: service.detail,
        serviceType: service.title,
      })),
    ],
  };

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(organizationStructuredData),
        }}
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
          <Link href="#services">Services</Link>
          <ProductMenu items={productNavItems} />
          <Link href="/about">About</Link>
          <ContactPopup triggerLabel="Contact" triggerClassName="nav-button" />
        </nav>
      </header>

      <section className="hero-section">
        <div className="hero-copy">
          <p className="eyebrow">Software products, workflow systems, automation</p>
          <h1>Software for operations that need clarity, control, and speed.</h1>
          <p className="lede">
            Technowiz Solutions helps turn manual processes, document-heavy work,
            internal tools, and product ideas into software that teams can adopt,
            operate, and improve with confidence.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="#services">
              See what we do
            </Link>
            <ContactPopup triggerLabel="Discuss a project" triggerClassName="button secondary" />
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

      <section id="services" className="section-block service-section">
        <div className="section-heading">
          <p className="eyebrow">What we do</p>
          <h2>From operational friction to working software</h2>
          <p>
            We work across the places where software creates leverage: owned
            products, custom workflow systems, automation, desktop utilities,
            consulting, and support. The goal is not more technology. The goal is
            better control over work that matters.
          </p>
        </div>
        <div className="service-grid">
          {services.map((service) => (
            <article key={service.title}>
              <span>{service.title}</span>
              <p>{service.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <p className="eyebrow">How we work</p>
          <h2>Strategy, engineering, and operations stay connected</h2>
          <p>
            Strong software delivery starts before code and continues after launch.
            We define the operating problem, build the smallest valuable system, and
            use real feedback to decide what should improve next.
          </p>
        </div>
        <div className="engagement-grid">
          {engagementSteps.map((step) => (
            <article key={step.step}>
              <span>{step.step}</span>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="products" className="section-block product-proof-section">
        <div className="section-heading">
          <p className="eyebrow">Products we build</p>
          <h2>Two products built around safer everyday decisions</h2>
          <p>
            NoDupe and PDF Compressor show the kind of problems Technowiz wants to
            solve: common desktop work where users need a better answer than guess,
            upload, delete, or hope.
          </p>
        </div>

        <div className="product-grid">
          {products.map((product) => (
            <article className="product-card" key={product.slug}>
              <div className="product-card-head">
                <Image src={product.icon} alt="" width={56} height={56} />
                <span>{product.platform}</span>
              </div>
              <h3>{product.name}</h3>
              <p>{product.shortPitch}</p>
              <div className="moat-callout">
                <span>{product.moat.proofLabel}</span>
                <strong>{product.moat.title}</strong>
                <p>{product.moat.detail}</p>
              </div>
              <ul>
                {product.highlights.slice(0, 3).map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
              <Link className="text-link" href={product.path}>
                Open product page
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="section-block research-section">
        <div className="section-heading">
          <p className="eyebrow">Company positioning</p>
          <h2>A product-led software company with implementation depth</h2>
          <p>
            Technowiz is being built as a software company with two connected
            strengths: an owned product portfolio and the capability to help other
            businesses turn operational complexity into maintainable software.
          </p>
        </div>
      </section>

      <footer id="contact" className="site-footer">
        <div>
          <p className="eyebrow">Technowiz Solutions</p>
          <h2>Build software that earns its place in the operation.</h2>
        </div>
        <ContactPopup triggerLabel="Discuss a project" />
      </footer>
    </main>
  );
}
