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
import { jsonLd } from '../json-ld';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    'Terms of Service for Technowiz Solutions, covering use of the Technowiz Solutions website and the NoDupe and PinchPDF Windows desktop applications.',
  alternates: {
    canonical: '/terms',
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: 'Terms of Service | Technowiz Solutions',
    description:
      'The terms that govern use of the Technowiz Solutions website and the NoDupe and PinchPDF applications.',
    url: '/terms',
    siteName: 'Technowiz Solutions',
    images: ['/og.png'],
    type: 'website',
  },
};

const sections = [
  { id: 'acceptance', label: 'Acceptance of terms' },
  { id: 'definitions', label: 'Definitions' },
  { id: 'eligibility', label: 'Eligibility and export compliance' },
  { id: 'license', label: 'License grant' },
  { id: 'restrictions', label: 'Restrictions' },
  { id: 'anti-piracy', label: 'Unauthorized distribution and anti-piracy' },
  { id: 'fees', label: 'Fees, licenses, and trials' },
  { id: 'updates', label: 'Updates and changes' },
  { id: 'your-files', label: 'Your files and data' },
  { id: 'ip', label: 'Intellectual property and copyright' },
  { id: 'security', label: 'Security' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'third-party', label: 'Third-party and open-source components' },
  { id: 'app-store-terms', label: 'App store terms' },
  { id: 'termination', label: 'Termination' },
  { id: 'disclaimer', label: 'Disclaimer of warranties' },
  { id: 'liability', label: 'Limitation of liability' },
  { id: 'indemnification', label: 'Indemnification' },
  { id: 'governing-law', label: 'Governing law' },
  { id: 'changes', label: 'Changes to these terms' },
  { id: 'general', label: 'General' },
  { id: 'contact', label: 'Contact us' },
];

export default function TermsOfServicePage() {
  const productNavItems = products.map(({ slug, path, name, category }) => ({
    slug,
    path,
    name,
    category,
  }));

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Terms of Service',
    url: `${siteUrl}/terms`,
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
        dangerouslySetInnerHTML={{ __html: jsonLd(structuredData) }}
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
          <MoreMenu activePath="/terms" />
          <ContactPopup triggerLabel="Contact" triggerClassName="nav-button" />
        </nav>
      </header>

      <section className="about-hero legal-hero">
        <div className="section-heading">
          <p className="eyebrow">Legal</p>
          <h1>Terms of Service</h1>
          <p>
            These Terms of Service (&quot;Terms&quot;) govern your access to
            and use of the Technowiz Solutions website and the NoDupe and
            PinchPDF Windows desktop applications (together, the
            &quot;Software&quot;), provided by {legalEntityName}{' '}
            (&quot;Technowiz Solutions,&quot; &quot;we,&quot;
            &quot;us,&quot; or &quot;our&quot;).
          </p>
          <p className="legal-meta">Last updated: {legalUpdatedDate}</p>
        </div>
      </section>

      <div className="legal-layout">
        <LegalToc sections={sections} />
        <div className="legal-content">
        <section id="acceptance">
          <h2>1. Acceptance of terms</h2>
          <p>
            By accessing our website, or downloading, installing, activating,
            or using NoDupe or PinchPDF, you agree to be bound by these
            Terms and by our{' '}
            <Link href="/privacy">Privacy Policy</Link>, which is
            incorporated by reference. If you do not agree, do not use the
            Software.
          </p>
        </section>

        <section id="definitions">
          <h2>2. Definitions</h2>
          <p>
            &quot;App&quot; or &quot;Apps&quot; means NoDupe, PinchPDF, and
            any other application we designate as covered by these Terms.
            &quot;Software&quot; means the Apps together with our website.
            &quot;You&quot; means the individual or entity using the
            Software.
          </p>
        </section>

        <section id="eligibility">
          <h2>3. Eligibility and export compliance</h2>
          <p>
            You must be at least 18 years old, or the age of majority in
            your jurisdiction, and have the legal capacity to enter into
            these Terms, to use the Software. If you use the Software on
            behalf of an organization, you represent that you have the
            authority to bind that organization to these Terms.
          </p>
          <p>
            The Software may be subject to export control and economic
            sanctions laws, including those of India, the United States, and
            the European Union. By using the Software, you represent that
            you are not located in, and are not a national or resident of,
            any country or region subject to a comprehensive embargo, and
            that you are not identified on any government list of
            prohibited or restricted parties (such as the U.S. Treasury
            Department&apos;s Specially Designated Nationals list). You
            agree not to use, export, or re-export the Software in
            violation of any applicable export control or sanctions law.
          </p>
        </section>

        <section id="license">
          <h2>4. License grant</h2>
          <p>
            Subject to your compliance with these Terms, Technowiz Solutions
            grants you a limited, non-exclusive, non-transferable,
            revocable license to install and use NoDupe and/or PinchPDF on
            devices you own or control, for your personal or internal
            business purposes, whether the App (or a given feature) is used
            under a usage-limited free trial or activated with a license key
            purchased through Lemon Squeezy or an app store. This license is
            personal to you and may not be sublicensed, sold, or
            transferred except as expressly permitted by these Terms or by
            the app store through which you obtained the App.
          </p>
        </section>

        <section id="restrictions">
          <h2>5. Restrictions</h2>
          <p>You agree not to, and not to permit others to:</p>
          <ul>
            <li>
              Copy, modify, reverse engineer, decompile, or disassemble an
              App, except to the extent this restriction is prohibited by
              applicable law.
            </li>
            <li>
              Rent, lease, sell, sublicense, redistribute, or otherwise make
              an App available to third parties without our prior written
              consent.
            </li>
            <li>
              Circumvent, disable, or attempt to circumvent any license,
              activation, encryption, or usage-limiting mechanism in an App.
            </li>
            <li>
              Use an App to build a product or service that competes with
              it, or for any unlawful, fraudulent, or harmful purpose.
            </li>
            <li>
              Remove, obscure, or alter any copyright, trademark, or other
              proprietary notices on or within an App or the Website.
            </li>
            <li>
              Introduce viruses, malware, or other harmful code into the
              Software, or use the Software to gain or attempt to gain
              unauthorized access to any system, network, account, or file
              that you are not authorized to access.
            </li>
            <li>
              Use the Website or an App in a way that could disable,
              overburden, impair, or interfere with its normal operation, or
              attempt to gain unauthorized access to it, its related
              systems, or the accounts of other users.
            </li>
          </ul>
        </section>

        <section id="anti-piracy">
          <h2>6. Unauthorized distribution and anti-piracy</h2>
          <p>
            NoDupe and PinchPDF are made available only through our Website,
            Lemon Squeezy checkout, and the app stores expressly named in
            these Terms (currently the Microsoft Store, and in the future
            Apple&apos;s App Store and Google Play). You agree not to:
          </p>
          <ul>
            <li>
              Obtain, host, mirror, distribute, or share an App, its
              installer, or a license key through any website, file-sharing
              service, peer-to-peer network, marketplace, or channel that we
              have not authorized.
            </li>
            <li>
              Use, generate, sell, distribute, or attempt to obtain a
              license key, activation code, or &quot;crack&quot; that was
              not issued to you directly by us or by an authorized app
              store for your own use.
            </li>
            <li>
              Use a license on more devices than the number of devices or
              seats it was issued for, or share a license with individuals
              or entities outside the scope of your purchase.
            </li>
            <li>
              Repackage, bundle, or redistribute an App together with other
              software, including adware, bundleware, or unrelated
              installers, without our prior written consent.
            </li>
            <li>
              Present a modified, cracked, or unofficially distributed copy
              of an App as genuine or as endorsed by Technowiz Solutions.
            </li>
          </ul>
          <p>
            A copy of NoDupe or PinchPDF obtained from a source other than
            our Website, Lemon Squeezy, or an app store we have expressly
            authorized is not supported by us, may have been altered, and
            is used entirely at your own risk. If we reasonably believe a
            license key or copy of the Software is pirated, cloned, shared
            in violation of these Terms, or fraudulently obtained, we may
            suspend or deactivate it without notice and without a refund.
            We reserve the right to pursue all remedies available to us at
            law or in equity, including injunctive relief and damages,
            against unauthorized distribution, reproduction, or use of the
            Software.
          </p>
        </section>

        <section id="fees">
          <h2>7. Fees, licenses, and trials</h2>

          <h3>7.1 Free trial</h3>
          <p>
            NoDupe and PinchPDF are offered with a free trial that gives you
            full access to the App&apos;s features up to certain usage
            limits (for example, a limited number of scans, cleanups, or
            compressions). Once you reach a trial limit, you must purchase a
            license to continue using the App, or the affected features may
            be restricted or disabled.
          </p>

          <h3>7.2 Purchases through Lemon Squeezy</h3>
          <p>
            Licenses purchased directly from us (on our website or within an
            App) are sold and billed through{' '}
            <strong>Lemon Squeezy</strong>, our authorized reseller and
            merchant of record. Lemon Squeezy handles payment processing,
            invoicing, tax collection and remittance, and issues your
            license key. Your purchase is also subject to Lemon
            Squeezy&apos;s own terms of service, in addition to these Terms.
          </p>

          <h3>7.3 No refunds</h3>
          <p>
            Because a full-featured free trial is available before purchase,
            giving you the opportunity to evaluate the App before you buy,{' '}
            <strong>all purchases are final and non-refundable</strong>,
            except where a refund is required by applicable law. This
            no-refund policy applies to purchases made directly through us
            via Lemon Squeezy. If you instead purchase a license through an
            app store, such as the Microsoft Store, Apple&apos;s App Store,
            or Google Play, using that platform&apos;s in-app payment
            system, your purchase and any refund request are instead
            governed by that app store&apos;s own refund and billing
            policies.
          </p>

          <h3>7.4 Statutory consumer rights</h3>
          <p>
            If you are a consumer in the European Economic Area or the
            United Kingdom, you generally have a 14-day statutory right to
            withdraw from an online purchase of digital content. By
            completing a purchase, you expressly request immediate delivery
            and activation of your license and acknowledge that, once your
            license key has been delivered, you lose this right of
            withdrawal, to the extent permitted by applicable law.
          </p>
          <p>
            If you are a consumer in Australia or New Zealand, our Software
            comes with guarantees that cannot be excluded under the
            Australian Consumer Law or the New Zealand Consumer Guarantees
            Act, and you are entitled to a replacement, resupply, or refund
            for a major failure. Nothing in Section 7.3 is intended to
            exclude, restrict, or modify any consumer guarantee, right, or
            remedy that cannot lawfully be excluded, restricted, or
            modified in your jurisdiction, and Section 7.3 applies only to
            the extent permitted by applicable law.
          </p>
        </section>

        <section id="updates">
          <h2>8. Updates and changes</h2>
          <p>
            We may release updates, patches, or new versions of the Apps,
            and may add, change, or remove features over time. Some updates
            may be installed automatically. We may also modify or
            discontinue all or part of the Software, though we will try to
            give reasonable notice of material changes that affect paid
            features you have already licensed.
          </p>
        </section>

        <section id="your-files">
          <h2>9. Your files and data</h2>
          <p>
            NoDupe and PinchPDF process your files locally on your device.
            You are solely responsible for the files, documents, and data
            you process with the Apps, and for maintaining independent
            backups of anything important before using detection, cleanup,
            consolidation, or compression features. Features such as
            previews, keep recommendations, the Recycle Bin, optional
            Guaranteed Undo, and action history are provided as a
            convenience to help you review decisions, but{' '}
            <strong>
              they do not guarantee that any file, or any version of a
              file, can be recovered.
            </strong>{' '}
            To the fullest extent permitted by law, Technowiz Solutions is
            not liable for any loss, corruption, or unintended modification
            of files arising from your use of the Apps.
          </p>
        </section>

        <section id="ip">
          <h2>10. Intellectual property and copyright</h2>

          <h3>10.1 Our intellectual property</h3>
          <p>
            The Software, including its source code, object code,
            architecture, user interface, design, and documentation, and
            the Website&apos;s text, graphics, and other content, is owned
            by Technowiz Solutions or its licensors and is protected by
            copyright, trade secret, and other intellectual property laws.
            Except for the limited license granted in Section 4, no right,
            title, or interest in the Software or the Website is
            transferred to you.
          </p>

          <h3>10.2 Trademarks</h3>
          <p>
            &quot;Technowiz Solutions,&quot; &quot;NoDupe,&quot;
            &quot;PinchPDF,&quot; and their associated logos are trademarks
            of Technowiz Solutions. You may not use these marks, or any
            confusingly similar marks, without our prior written
            permission, including in connection with any unauthorized
            distribution of the Software described in Section 6.
          </p>

          <h3>10.3 Your files and content</h3>
          <p>
            You retain all rights in the files, documents, and other
            content you process using an App. You represent and warrant
            that you have all rights, licenses, and permissions necessary
            to process, copy, compress, consolidate, or delete such files
            using the App, and that doing so will not infringe the
            copyright or other rights of any third party. Technowiz
            Solutions does not review, and is not responsible for, the
            content of files you process, and disclaims all liability for
            your compliance with copyright and other laws applicable to
            your files.
          </p>

          <h3>10.4 Copyright and trademark complaints</h3>
          <p>
            If you believe that the Website, an App, or content we have
            published infringes your copyright or trademark, contact us at{' '}
            <a href={`mailto:${contactEmail}`}>{contactEmail}</a> with (a) a
            description of the copyrighted work or mark you believe is
            infringed, (b) a description and location of the specific
            material you believe is infringing, and (c) your contact
            information. We will review and respond to good-faith
            complaints.
          </p>

          <h3>10.5 Enforcement</h3>
          <p>
            We reserve the right to investigate suspected violations of
            this Section and Section 6 (Unauthorized distribution and
            anti-piracy), and to take appropriate action, including
            suspending or terminating a license, removing infringing
            content we control, and pursuing legal remedies.
          </p>
        </section>

        <section id="security">
          <h2>11. Security</h2>
          <p>
            You must not probe, scan, or test the vulnerability of the
            Software or any system used to deliver, license, or activate
            it, attempt to breach or bypass any security or authentication
            measure, or otherwise interfere with the security of the
            Software, without our prior written authorization.
          </p>
          <p>
            If you discover a security vulnerability in NoDupe, PinchPDF, or
            our Website, please report it responsibly to{' '}
            <a href={`mailto:${contactEmail}`}>{contactEmail}</a> rather
            than disclosing it publicly, so we can investigate and address
            it before it is exploited. We do not currently operate a paid
            bug bounty program but will acknowledge good-faith reports.
          </p>
          <p>
            While we take reasonable measures to secure the Software, no
            software or system is completely secure, and we do not
            guarantee that the Software is free of vulnerabilities. Section
            13 (Disclaimer of warranties) and Section 14 (Limitation of
            liability) apply to any security incident affecting the
            Software.
          </p>
        </section>

        <section id="feedback">
          <h2>12. Feedback</h2>
          <p>
            If you send us feedback, suggestions, or ideas about the
            Software, you grant us a perpetual, irrevocable, royalty-free
            license to use them for any purpose without obligation to you.
          </p>
        </section>

        <section id="third-party">
          <h2>13. Third-party and open-source components</h2>
          <p>
            The Apps may include third-party or open-source components,
            which remain subject to their own license terms. Nothing in
            these Terms limits your rights under an applicable open-source
            license.
          </p>
        </section>

        <section id="app-store-terms">
          <h2>14. App store terms</h2>
          <p>
            The Apps are currently distributed through the Microsoft Store,
            and we may distribute them through additional app stores, such
            as Apple&apos;s App Store and Google Play, in the future. If you
            obtained an App through the Microsoft Store or another app
            store, your use of the App is also subject to that
            platform&apos;s usage terms. If there is a conflict between
            these Terms and a platform&apos;s mandatory terms for that
            platform, the platform&apos;s terms will govern solely to the
            extent of the conflict, for that platform only. You acknowledge
            that the applicable app store is not responsible for providing
            maintenance or support for the App, and is not a party to these
            Terms except as a third-party beneficiary where its own terms
            require that status.
          </p>
        </section>

        <section id="termination">
          <h2>15. Termination</h2>
          <p>
            We may suspend or terminate your access to the Software if you
            violate these Terms. We may also immediately revoke a license,
            without refund, if we reasonably believe it was obtained or is
            being used in violation of Section 6 (Unauthorized distribution
            and anti-piracy). You may stop using the Software and uninstall
            the Apps at any time. Sections of these Terms that by their
            nature should survive termination will survive, including
            intellectual property, security, disclaimers, limitation of
            liability, indemnification, and governing law.
          </p>
        </section>

        <section id="disclaimer">
          <h2>16. Disclaimer of warranties</h2>
          <p>
            THE SOFTWARE IS PROVIDED &quot;AS IS&quot; AND &quot;AS
            AVAILABLE,&quot; WITHOUT WARRANTIES OF ANY KIND, WHETHER
            EXPRESS, IMPLIED, OR STATUTORY, INCLUDING WARRANTIES OF
            MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND
            NON-INFRINGEMENT. WE DO NOT WARRANT THAT DUPLICATE, SIMILARITY,
            OR COMPRESSION RESULTS WILL BE ACCURATE, COMPLETE, OR ERROR-FREE,
            OR THAT THE SOFTWARE WILL BE UNINTERRUPTED, ERROR-FREE, OR
            SECURE, OR THAT ANY VULNERABILITY WILL BE IDENTIFIED OR
            CORRECTED.
          </p>
        </section>

        <section id="liability">
          <h2>17. Limitation of liability</h2>
          <p>
            TO THE FULLEST EXTENT PERMITTED BY LAW, TECHNOWIZ SOLUTIONS WILL
            NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
            CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA, FILES,
            PROFITS, OR GOODWILL, ARISING FROM YOUR USE OF THE SOFTWARE.
            OUR TOTAL LIABILITY FOR ANY CLAIM RELATING TO THE SOFTWARE WILL
            NOT EXCEED THE AMOUNT YOU PAID US, IF ANY, FOR THE APP GIVING
            RISE TO THE CLAIM IN THE 12 MONTHS BEFORE THE CLAIM AROSE. THESE
            LIMITATIONS DO NOT APPLY TO LIABILITY THAT CANNOT BE LIMITED OR
            EXCLUDED UNDER APPLICABLE LAW, INCLUDING LIABILITY FOR GROSS
            NEGLIGENCE, WILLFUL MISCONDUCT, OR FRAUD. SOME JURISDICTIONS DO
            NOT ALLOW THE EXCLUSION OR LIMITATION OF CERTAIN DAMAGES, SO
            SOME OF THE ABOVE LIMITATIONS MAY NOT APPLY TO YOU.
          </p>
        </section>

        <section id="indemnification">
          <h2>18. Indemnification</h2>
          <p>
            You agree to indemnify and hold Technowiz Solutions harmless
            from any claims, damages, or expenses (including reasonable
            legal fees) arising from: (a) your misuse of the Software or
            violation of these Terms; (b) the files, documents, or content
            you process with an App, including any claim that such content
            or your use of it infringes the intellectual property or other
            rights of a third party; or (c) your violation of Section 6
            (Unauthorized distribution and anti-piracy) or Section 11
            (Security).
          </p>
        </section>

        <section id="governing-law">
          <h2>19. Governing law</h2>
          <p>
            These Terms are governed by the laws of India, without regard
            to conflict-of-law principles. Any dispute arising from these
            Terms or the Software will be subject to the exclusive
            jurisdiction of the courts located in Mumbai, Maharashtra,
            India, except where applicable law requires otherwise. If you
            are a consumer resident in a jurisdiction that grants you
            mandatory consumer protections, a right to bring proceedings in
            your local courts, or the application of your local law that
            cannot be waived by contract (such as an EU Member State, the
            United Kingdom, or Australia), this Section applies only to the
            extent permitted by that law, and nothing in this Section
            limits those mandatory rights.
          </p>
        </section>

        <section id="changes">
          <h2>20. Changes to these terms</h2>
          <p>
            We may revise and update these Terms at any time, at our sole
            discretion, for any reason, including to reflect changes to the
            Software, our business, or applicable law. The revised Terms
            take effect as of the &quot;Last updated&quot; date above, and
            where changes are material, we will provide reasonable notice
            (for example, by posting a notice on our Website or within an
            App). It is your responsibility to review these Terms
            periodically.{' '}
            <strong>
              Your continued access to or use of the Software after a
              revised version of these Terms takes effect constitutes your
              acceptance of, and agreement to be bound by, the revised
              Terms.
            </strong>{' '}
            If you do not agree to a revised version of these Terms, your
            only remedy is to stop using the Software.
          </p>
        </section>

        <section id="general">
          <h2>21. General</h2>
          <p>
            These Terms, together with our{' '}
            <Link href="/privacy">Privacy Policy</Link>, constitute the
            entire agreement between you and Technowiz Solutions regarding
            the Software. If any provision is found unenforceable, the
            remaining provisions will remain in full effect. Our failure to
            enforce a provision is not a waiver of it. You may not assign
            these Terms without our consent; we may assign them in
            connection with a merger, acquisition, or sale of assets.
          </p>
        </section>

        <section id="contact">
          <h2>22. Contact us</h2>
          <p>If you have questions about these Terms, contact us at:</p>
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
          <h2>Questions about these terms?</h2>
        </div>
        <ContactPopup triggerLabel="Contact us" />
      </section>
      <SiteFooter />
    </main>
  );
}
