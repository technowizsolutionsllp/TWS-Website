import Image from 'next/image';
import Link from 'next/link';
import { legalEntityName } from './company-data';
import ContactPopup from './ContactPopup';
import { products } from './products/data';

export default function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer-main">
      <div className="site-footer-grid">
        <div className="site-footer-brand">
          <Image
            src="/technowiz-lockup.svg"
            alt="Technowiz Solutions"
            width={240}
            height={65}
          />
          <p>
            Software products, workflow systems, and desktop utilities built
            for clarity, control, and speed.
          </p>
        </div>

        <nav aria-label="Products">
          <p className="site-footer-heading">Products</p>
          {products.map((product) => (
            <Link href={product.path} key={product.slug}>
              {product.name}
            </Link>
          ))}
        </nav>

        <nav aria-label="Company">
          <p className="site-footer-heading">Company</p>
          <Link href="/about">About</Link>
          <Link href="/#services">Services</Link>
          <ContactPopup triggerLabel="Contact" triggerClassName="footer-nav-button" />
        </nav>

        <nav aria-label="Legal">
          <p className="site-footer-heading">Legal</p>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
        </nav>
      </div>

      <div className="site-footer-bottom">
        <p>
          &copy; {year} {legalEntityName}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
