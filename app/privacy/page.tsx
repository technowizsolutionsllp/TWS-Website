import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import {
  companyLocation,
  contactEmail,
  legalEntityName,
  legalUpdatedDate,
  siteUrl,
} from '../company-data';
import ContactPopup from '../ContactPopup';
import LegalToc from '../LegalToc';
import MoreMenu from '../MoreMenu';
import ProductMenu from '../ProductMenu';
import SiteFooter from '../SiteFooter';
import { products } from '../products/data';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'Privacy Policy for Technowiz Solutions, covering the Technowiz Solutions website and the NoDupe and PinchPDF Windows desktop applications.',
  alternates: {
    canonical: '/privacy',
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: 'Privacy Policy | Technowiz Solutions',
    description:
      'How Technowiz Solutions collects, uses, and protects information across our website and the NoDupe and PinchPDF applications.',
    url: '/privacy',
    siteName: 'Technowiz Solutions',
    images: ['/og.png'],
    type: 'website',
  },
};

const sections = [
  { id: 'scope', label: 'Scope' },
  { id: 'information-we-collect', label: 'Information we collect' },
  { id: 'how-we-use-information', label: 'How we use information' },
  { id: 'legal-bases', label: 'Legal bases' },
  { id: 'sharing', label: 'Sharing and disclosure' },
  { id: 'app-stores', label: 'App stores and third-party platforms' },
  { id: 'retention', label: 'Data retention' },
  { id: 'international-transfers', label: 'International transfers' },
  { id: 'security', label: 'Security' },
  { id: 'your-rights', label: 'Your rights and choices' },
  { id: 'children', label: "Children's privacy" },
  { id: 'changes', label: 'Changes to this policy' },
  { id: 'contact', label: 'Contact us' },
];

export default function PrivacyPolicyPage() {
  const productNavItems = products.map(({ slug, path, name, category }) => ({
    slug,
    path,
    name,
    category,
  }));

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Privacy Policy',
    url: `${siteUrl}/privacy`,
    isPartOf: {
      '@type': 'Organization',
      name: 'Technowiz Solutions',
      url: siteUrl,
    },
    dateModified: legalUpdatedDate,
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
          <MoreMenu activePath="/privacy" />
          <ContactPopup triggerLabel="Contact" triggerClassName="nav-button" />
        </nav>
      </header>

      <section className="about-hero legal-hero">
        <div className="section-heading">
          <p className="eyebrow">Legal</p>
          <h1>Privacy Policy</h1>
          <p>
            This Privacy Policy explains how {legalEntityName} (&quot;Technowiz
            Solutions,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;)
            collects, uses, shares, and protects information across the
            Technowiz Solutions website and the NoDupe and PinchPDF Windows
            desktop applications (together, the &quot;Software&quot;).
          </p>
          <p className="legal-meta">Last updated: {legalUpdatedDate}</p>
        </div>
      </section>

      <div className="legal-layout">
        <LegalToc sections={sections} />
        <div className="legal-content">
        <section id="scope">
          <h2>1. Scope</h2>
          <p>
            This Policy applies to {siteUrl} (the &quot;Website&quot;) and to
            NoDupe and PinchPDF (each an &quot;App,&quot; together the
            &quot;Apps&quot;), which are Windows desktop applications
            published by Technowiz Solutions. The Apps are currently
            distributed directly from our Website and through the Microsoft
            Store, and we may make them available on additional platforms
            and through additional app stores (such as Apple&apos;s App
            Store and Google Play) in the future; this Policy applies to
            those versions as well unless we state otherwise. It does not
            apply to third-party websites, products, or services that we do
            not control, even if they are linked from our Website or an
            App.
          </p>
        </section>

        <section id="information-we-collect">
          <h2>2. Information we collect</h2>

          <h3>2.1 Information you give us on the Website</h3>
          <p>
            When you use the contact form on our Website, we collect your
            name, email address, an optional service or product interest,
            and the message you submit. We use this information only to
            respond to your enquiry and do not use it for marketing without
            your consent.
          </p>

          <h3>2.2 Information collected automatically on the Website</h3>
          <p>
            Our hosting and content-delivery provider automatically logs
            standard technical information such as IP address, browser type,
            device type, and access timestamps, for security, abuse
            prevention, and performance purposes. We do not currently use
            advertising or analytics cookies on the Website, and we do not
            track your activity across third-party websites, so we do not
            currently respond differently to browser &quot;Do Not
            Track&quot; signals. If that changes, we will update this
            Policy and, where required by law, request your consent.
          </p>

          <h3>2.3 How NoDupe and PinchPDF handle your files</h3>
          <p>
            NoDupe and PinchPDF are local-first Windows applications. Files,
            documents, photos, videos, and folders that you scan, compare,
            or compress are processed on your own device. As part of normal
            scanning, duplicate-detection, comparison, and compression
            functionality, <strong>the Apps do not upload the content of
            your files, filenames, thumbnails, or previews to Technowiz
            Solutions&apos; servers or to any third party.</strong>
          </p>

          <h3>2.4 Data the Apps store locally on your device</h3>
          <p>
            To provide their features, the Apps create and store data only
            on your own device, including:
          </p>
          <ul>
            <li>
              Scan results, similarity and comparison data, keep
              recommendations, and cleanup or compression history.
            </li>
            <li>
              Thumbnails and previews generated for review before you take
              action on a file.
            </li>
            <li>
              Local action logs, undo and recovery history (including
              Recycle Bin and optional Guaranteed Undo records), and
              application settings.
            </li>
            <li>
              Diagnostic and crash logs used to help the Apps recover from
              errors and to help us troubleshoot issues if you choose to
              share them with us.
            </li>
          </ul>
          <p>
            This data remains on your device under your control. We do not
            have access to it unless you voluntarily send it to us, for
            example by attaching a log file or screenshot to a support
            email.
          </p>

          <h3>2.5 Trial usage, license activation, and purchase information</h3>
          <p>
            NoDupe and PinchPDF are available as a free trial with usage
            limits (such as a limited number of scans, cleanups, or
            compressions). To enforce these limits, an App may track basic
            trial usage counters on your own device. Once the trial limit is
            reached, a purchased license is required to continue full use of
            the App.
          </p>
          <p>
            Purchases and license activation are handled by our licensing
            and payments partner, <strong>Lemon Squeezy</strong> (Lemon
            Squeezy, Inc.), which acts as the merchant of record for
            purchases made directly from us. When you purchase a license,
            Lemon Squeezy collects and processes your payment details,
            billing information, and email address to complete the
            transaction, issue a license key, and handle billing support,
            invoicing, and tax collection, under Lemon Squeezy&apos;s own
            privacy policy. We receive limited information from Lemon
            Squeezy needed to activate and validate your license, such as
            your email address, license key, order reference, and a device
            or hardware identifier used to bind the license to your device
            and prevent misuse. Technowiz Solutions does not receive or
            store your full payment card details.
          </p>
          <p>
            If you instead purchase an App or a license through the
            Microsoft Store or another app store, that platform processes
            your payment and account details directly under its own privacy
            policy.
          </p>

          <h3>2.6 Support communications</h3>
          <p>
            If you contact us for support, we collect the information you
            provide in that communication (such as your email address, a
            description of the issue, and any files or logs you choose to
            attach) to diagnose and respond to your request.
          </p>
        </section>

        <section id="how-we-use-information">
          <h2>3. How we use information</h2>
          <ul>
            <li>To respond to enquiries and provide support.</li>
            <li>To operate, maintain, and secure the Website and the Apps.</li>
            <li>
              To validate licenses, process activations, and prevent fraud
              or misuse of the Software.
            </li>
            <li>
              To diagnose crashes and errors when you choose to share
              diagnostic information with us.
            </li>
            <li>
              To communicate updates, security notices, or changes to our
              policies where relevant to you.
            </li>
            <li>To comply with legal obligations and enforce our terms.</li>
          </ul>
        </section>

        <section id="legal-bases">
          <h2>4. Legal bases for processing</h2>
          <p>
            Where applicable data protection law requires a legal basis, we
            rely on: your consent (for example, when you submit the contact
            form); performance of a contract (for example, to provide
            support or activate a license you purchased); our legitimate
            interests in operating, securing, and improving the Website and
            the Apps; and compliance with legal obligations.
          </p>
        </section>

        <section id="sharing">
          <h2>5. Sharing and disclosure</h2>
          <p>
            We do not sell your personal information. We share information
            only in the following circumstances:
          </p>
          <ul>
            <li>
              <strong>Service providers.</strong> With vendors who help us
              operate the Website and Apps, such as our email delivery
              provider (used to route contact-form messages to us), our
              hosting and content-delivery provider, and Lemon Squeezy, our
              licensing and payments partner. These providers may process
              data outside your home country and are only permitted to use
              it to provide services to us.
            </li>
            <li>
              <strong>App stores and payment processors.</strong> If you
              obtain or purchase an App through the Microsoft Store or
              another app store, that platform processes your account and
              payment information under its own privacy policy.
            </li>
            <li>
              <strong>Legal and safety.</strong> If required to comply with
              law, legal process, or to protect the rights, property, or
              safety of Technowiz Solutions, our users, or the public.
            </li>
            <li>
              <strong>Business transfers.</strong> In connection with a
              merger, acquisition, financing, or sale of assets, subject to
              this Policy or a materially equivalent one.
            </li>
            <li>
              <strong>With your direction.</strong> Where you have asked us
              to share information, such as sending us a support log or
              screenshot.
            </li>
          </ul>
        </section>

        <section id="app-stores">
          <h2>6. App stores and third-party platforms</h2>
          <p>
            The Apps are currently listed on the Microsoft Store, and we
            plan to make them available through additional app stores, such
            as Apple&apos;s App Store and Google Play, in the future. When
            you download, install, purchase, review, or activate an App
            through an app store, that platform collects and processes
            information (such as your account details, device information,
            and payment method) under its own privacy policy and terms,
            independent of Technowiz Solutions. We encourage you to review
            the privacy policy of any app store you use to obtain the Apps.
          </p>
        </section>

        <section id="retention">
          <h2>7. Data retention</h2>
          <p>
            We retain contact-form and support communications for as long as
            needed to respond to your request and for a reasonable period
            afterward for record-keeping, unless a longer period is required
            by law. Data created and stored locally by the Apps remains on
            your device and is retained according to your own use of the
            Apps until you delete it, uninstall the App, or clear the
            relevant application data.
          </p>
        </section>

        <section id="international-transfers">
          <h2>8. International transfers</h2>
          <p>
            Technowiz Solutions is based in India. Some of our service
            providers, such as our email delivery, hosting, and licensing
            and payments providers, may process information on servers
            located outside India, including in the United States. Where we
            or our service providers transfer personal information across
            borders, we require appropriate safeguards, such as the EU
            Standard Contractual Clauses or another legally recognized
            transfer mechanism where required by applicable law, so that
            your information continues to receive a comparable level of
            protection.
          </p>
        </section>

        <section id="security">
          <h2>9. Security</h2>
          <p>
            We use reasonable administrative, technical, and organizational
            measures designed to protect information we handle. Because the
            Apps process your files locally by design, the content of those
            files is not exposed to a network transfer as part of normal
            scanning, comparison, or compression functionality. No method of
            transmission or storage is completely secure, and we cannot
            guarantee absolute security.
          </p>
          <p>
            If we become aware of a data breach affecting your personal
            information, we will notify you and, where required by law
            (including India&apos;s Digital Personal Data Protection Act,
            2023 and the EU/UK GDPR), the relevant regulator, without undue
            delay. If you discover a security vulnerability affecting the
            Website or the Apps, please report it to us responsibly at{' '}
            <a href={`mailto:${contactEmail}`}>{contactEmail}</a> instead of
            disclosing it publicly, so we can investigate before it is
            exploited.
          </p>
        </section>

        <section id="your-rights">
          <h2>10. Your rights and choices</h2>

          <h3>10.1 Rights available to you</h3>
          <p>
            Depending on where you live, you may have rights to access,
            correct, delete, or receive a copy of your personal information,
            to object to or restrict certain processing, and to withdraw
            consent where processing is based on consent. Because data
            created by the Apps is stored locally on your device, you can
            typically access, export, or delete it directly by using the
            Apps&apos; own history, settings, or uninstall functions, or by
            deleting the relevant files from your device.
          </p>

          <h3>10.2 European Economic Area, United Kingdom, and similar jurisdictions</h3>
          <p>
            If the GDPR, the UK GDPR, or a similar law applies to you, you
            have the rights described above and the right to lodge a
            complaint with your national or local supervisory authority,
            such as the Information Commissioner&apos;s Office in the
            United Kingdom or your national data protection authority in
            the EEA.
          </p>

          <h3>10.3 India</h3>
          <p>
            If India&apos;s Digital Personal Data Protection Act, 2023
            applies to you, you may exercise the rights it grants,
            including access to a summary of your personal data and
            processing activities, correction and erasure, grievance
            redressal, and nominating another individual to exercise your
            rights in the event of death or incapacity. Our Grievance
            Officer for this purpose can be reached at{' '}
            <a href={`mailto:${contactEmail}`}>{contactEmail}</a>. If your
            grievance is not resolved to your satisfaction, you may
            escalate it to the Data Protection Board of India.
          </p>

          <h3>10.4 California and other U.S. states</h3>
          <p>
            If the California Consumer Privacy Act (as amended by the
            CPRA) or a similar U.S. state law applies to you, you have the
            right to know what personal information we collect, to request
            deletion or correction, and to non-discrimination for
            exercising these rights.{' '}
            <strong>
              We do not sell personal information, and we do not share it
              for cross-context behavioral advertising.
            </strong>{' '}
            We do not use or disclose sensitive personal information for
            any purpose that would trigger a right to limit such use.
          </p>

          <h3>10.5 Other jurisdictions</h3>
          <p>
            If a substantially similar law applies to you, such as
            Brazil&apos;s LGPD, Canada&apos;s PIPEDA (or an applicable
            provincial law such as Quebec&apos;s Law 25), or Australia&apos;s
            Privacy Act, you may have comparable rights of access,
            correction, deletion, and complaint to your relevant regulator.
          </p>

          <h3>10.6 How to exercise your rights</h3>
          <p>
            To exercise any of the rights described in this Section,
            contact us at{' '}
            <a href={`mailto:${contactEmail}`}>{contactEmail}</a>. We may
            need to verify your identity before acting on a request, and we
            will respond within the timeframe required by applicable law.
            If you have opted in to marketing communications, you can
            withdraw consent or unsubscribe at any time using the link in
            the email or by contacting us.
          </p>
        </section>

        <section id="children">
          <h2>11. Children&apos;s privacy</h2>
          <p>
            The Website and the Apps are not directed at children and are
            not intended for use by anyone under the age of 18. We do not
            knowingly collect personal information from children. If you
            believe a child has provided us with personal information,
            please contact us so we can remove it.
          </p>
        </section>

        <section id="changes">
          <h2>12. Changes to this policy</h2>
          <p>
            We may revise and update this Policy at any time, at our sole
            discretion, to reflect changes to our Website, our Apps, our
            data practices, or applicable law. The revised Policy takes
            effect as of the &quot;Last updated&quot; date above, and where
            changes are material, we will provide additional notice (for
            example, by posting a notice on our Website or within an App,
            or by email) and, where a change requires your consent under
            applicable law, we will ask for it before relying on that
            consent.{' '}
            <strong>
              Except where such consent is required, your continued use of
              the Website or the Apps after a revised version of this
              Policy takes effect constitutes your acceptance of the
              revised Policy.
            </strong>{' '}
            We encourage you to review this Policy periodically.
          </p>
        </section>

        <section id="contact">
          <h2>13. Contact us</h2>
          <p>
            If you have questions about this Privacy Policy or our data
            practices, contact us at:
          </p>
          <p>
            {legalEntityName}
            <br />
            {companyLocation}, India
            <br />
            <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
          </p>
        </section>
        </div>
      </div>

      <section className="site-footer">
        <div>
          <p className="eyebrow">Technowiz Solutions</p>
          <h2>Questions about how we handle your data?</h2>
        </div>
        <ContactPopup triggerLabel="Contact us" />
      </section>
      <SiteFooter />
    </main>
  );
}
