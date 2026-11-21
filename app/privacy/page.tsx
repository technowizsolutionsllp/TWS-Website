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
import LegalSections from '../legal/LegalSections';
import { latestLegal } from '../pinchpdf/legal/latest';
import { products } from '../products/data';
import { jsonLd } from '../json-ld';

// DRAFT FOR LEGAL REVIEW (see docs/legal/PRIVACY_LEGAL_REVIEW.md). Items marked TODO need an owner
// decision or a fact that is not in the repository. Several statements describe the
// state of the products AT RELEASE of the PinchPDF trial registration; do not publish this
// page before that release and the checks in section 7 of the review are done.

// The trial notice is Annex A of this page; the trial terms are Schedule A of the terms (Part B).
const trialNoticePath = '#pinchpdf-trial';
const trialTermsPath = '/terms#schedule-a-trial';
const trialNotice = latestLegal('privacy');

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'Privacy Policy for Technowiz Solutions, covering the Technowiz Solutions website, the NoDupe and PinchPDF Windows desktop applications, and PinchPDF free-trial registration.',
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
  { id: 'pinchpdf-trial', label: 'Annex A: PinchPDF free trial' },
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
          <p>
            Registration for the PinchPDF free trial is described in more
            detail in{' '}
            <Link href={trialNoticePath}>Annex A (PinchPDF Free Trial Privacy
            Notice)</Link>, which is part of this Policy. The effective date
            of that notice is recorded when you accept it.
          </p>
        </section>

        <section id="information-we-collect">
          <h2>2. Information we collect</h2>

          <h3>2.1 Information you give us on the Website</h3>
          <p>
            When you use the contact form or the Get Support form on our
            Website, we collect your name, email address, an optional service
            or product interest, the subject and message you submit, and any
            screenshots or files you choose to attach. We use this
            information only to respond to your enquiry or support request
            and do not use it for marketing without your consent.
          </p>
          <p>
            Please do not attach documents, screenshots, or logs that contain
            sensitive information or other people&apos;s personal data unless
            it is needed to resolve the problem. Messages and attachments are
            delivered to us by an email delivery service and are stored in the
            mailboxes we use for support (see Section 5).
          </p>

          <h3>2.2 Information collected automatically on the Website</h3>
          <p>
            Our hosting and content-delivery provider, Cloudflare,
            automatically processes standard technical information such as IP
            address, browser type, device type, requested address, and access
            timestamps, for security, abuse prevention, rate limiting, and
            performance purposes. Request logs for the Website are kept for a
            short period (currently about seven days). We do not currently use
            advertising or analytics cookies on the Website, and we do not
            track your activity across third-party websites, so we do not
            currently respond differently to browser &quot;Do Not
            Track&quot; signals. If that changes, we will update this
            Policy and, where required by law, request your consent.
          </p>
          {/* TODO(verify on the live site): no cookies set (including Cloudflare bot features), fonts self-hosted, no third-party requests on page load. */}

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
              share them with us. These logs can contain file names.
            </li>
            <li>
              A trial and license record, protected on your device, that
              holds your trial usage count and, for PinchPDF, your trial
              registration status.
            </li>
          </ul>
          <p>
            This data remains on your device under your control. We do not
            have access to it unless you voluntarily send it to us, for
            example by attaching a log file or screenshot to a support
            email.
          </p>

          <h3>2.5 Free trials</h3>
          <p>
            NoDupe and PinchPDF are available as a free trial with usage
            limits (such as a limited number of scans, cleanups, or
            compressions). Once the trial limit is reached, a purchased
            license is required to continue full use of the App. The two Apps
            handle the trial differently:
          </p>
          <ul>
            <li>
              <strong>NoDupe</strong> counts trial usage on your own device.
              NoDupe does not currently ask you to register and does not send
              trial data to us.
            </li>
            <li>
              <strong>PinchPDF</strong> asks you to register before you use
              the free trial, as described in Section 2.6. If you have a
              PinchPDF license, you are not asked to register. PinchPDF
              reports license and purchase events to us, as described in
              Section 2.10.
            </li>
          </ul>

          <h3>2.6 PinchPDF free-trial registration</h3>
          <p>
            To start the PinchPDF free trial, you enter your name and email
            address, confirm that you are 18 years old or older, and accept
            the PinchPDF trial terms and the trial privacy notice. We also
            receive one-way hashes of up to three identifiers of your
            computer, which we use to allow one trial per computer, and your
            usage count. What we collect, why, the legal basis, how long we
            keep it and your choices are set out in{' '}
            <Link href={trialNoticePath}>Annex A</Link>.
          </p>
          {/* TODO(counsel): confirm the lawful basis and consent design for the device-identifier check (see review finding B2). The text here, in Section 4 and in Annex A must match the consent screen. */}

          <h3>2.7 Licenses, purchases, and payment providers</h3>
          <p>
            Purchases and license activation are handled by our payment and
            licensing partners, <strong>Dodo Payments</strong> and{' '}
            <strong>Lemon Squeezy</strong>, each of which acts as the merchant
            of record for purchases made directly from us. PinchPDF contacts
            Dodo Payments first and uses Lemon Squeezy as a fallback for older
            keys; NoDupe contacts Lemon Squeezy first and Dodo Payments as a
            secondary provider. The provider that sold you the license is the
            one that collects and processes your payment details, billing
            information, and email address to complete the transaction,
            issue a license key, and handle billing support, invoicing, and
            tax, under that provider&apos;s own privacy policy.
          </p>
          <p>
            When you activate or deactivate a license, the App sends your
            license key and a fixed App name (&quot;PinchPDF&quot; or
            &quot;NoDupe&quot;) to the provider, which also sees your IP
            address. The Apps do not send a hardware identifier to these
            providers. We receive limited information from them that is needed
            to validate your license and help you with it, such as your email
            address, license key, order reference, and how many computers the
            key is activated on. The license is tied to your computer by the
            App on your device. Technowiz Solutions does not receive or store
            your full payment card details.
          </p>
          <p>
            If you instead purchase an App or a license through the
            Microsoft Store or another app store, that platform processes
            your payment and account details directly under its own privacy
            policy.
          </p>

          <h3>2.8 Price display and update checks</h3>
          <p>
            When you open the Upgrade window, PinchPDF reads the current
            price for your region from the public checkout page of the
            provider it will use. The request contains no document, key, or
            personal identifier, but the provider sees your IP address and may
            create a checkout session when the page is requested.
          </p>
          <p>
            NoDupe may check for updates by requesting a release file from
            GitHub, which receives your IP address and basic information such
            as the App version and Windows platform.
          </p>
          {/* TODO(verify): the NoDupe updater is enabled in release builds and sends only version and platform. Remove this paragraph if not. */}

          <h3>2.9 Support communications</h3>
          <p>
            If you contact us for support, we collect the information you
            provide in that communication (such as your email address, a
            description of the issue, your support reference if you have one,
            and any files or logs you choose to attach) to diagnose and
            respond to your request.
          </p>

          <h3 id="pinchpdf-license-events">2.10 PinchPDF license and purchase events</h3>
          <p>
            When you click the buy button in PinchPDF, or activate,
            deactivate or change a license key, PinchPDF reports that event
            to us. Each event contains:
          </p>
          <ul>
            <li>
              The kind of event (buy clicked, license activated, license
              deactivated, license key changed), the time it happened, and
              the license edition (Individual or Business).
            </li>
            <li>
              A random identifier for your installation, which links your
              events together, and the public key that PinchPDF created for
              this installation.
            </li>
            <li>
              The same one-way hashes of computer identifiers used for the
              free trial (Annex A). We store them as keyed hashes. They are
              persistent identifiers of your computer and we treat them as
              personal data.
            </li>
            <li>
              A one-way hash of your license key (never the key itself), and
              of your previous key when you change it.
            </li>
            <li>The PinchPDF and Windows versions.</li>
          </ul>
          <p>
            We do not receive your name or email address in these events. We
            use them to see whether a purchase was completed, to count active
            licenses by edition, to support you if a license does not
            activate, and to detect licenses used on more computers than were
            purchased. Moving a license to another computer is normal and is
            not treated as ending your license. We do not use these events
            for advertising and we do not sell them.
          </p>
          <p>
            PinchPDF asks for your consent before sending these events.{' '}
            <strong>[OWNER TO CONFIRM: the consent wording and where it is shown, whether the events are optional for licensed users, how to turn them off in the app, and the retention period for these events.]</strong>
          </p>
          {/* TODO(counsel): lawful basis for license events (legitimate interest for licence validation vs consent for the device identifiers), and the retention period. The earlier statement that licensed users send nothing to our servers is no longer true and has been removed from this page; check the store listings and in-app text too. */}
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
              To register PinchPDF free trials, allow one trial per computer,
              count and enforce trial limits, and prevent repeated or abusive
              use of the trial.
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
            rely on the following:
          </p>
          <ul>
            <li>
              <strong>Enquiries and support:</strong> our legitimate interest
              in answering you, or steps taken at your request before a
              contract.
            </li>
            <li>
              <strong>Licenses and purchases:</strong> performance of a
              contract.
            </li>
            <li>
              <strong>PinchPDF trial registration:</strong> performance of the
              trial you request (name, email, usage count), and our legitimate
              interest in preventing repeated use of a free trial (the device
              hashes and the one-trial-per-computer decision). Where the law
              requires your consent, for example for reading identifiers from
              your device, we ask for it on the registration screen and you can
              withdraw it by contacting us, which ends the trial.
            </li>
            <li>
              <strong>Security and abuse prevention on the Website:</strong>{' '}
              our legitimate interest in operating and securing the Website.
            </li>
            <li>
              <strong>Legal obligations</strong>, such as tax and accounting
              records and responses to lawful requests.
            </li>
            <li>
              <strong>Consent</strong> for any optional marketing
              communications, which you can withdraw at any time.
            </li>
          </ul>
          <p>
            Where India&apos;s Digital Personal Data Protection Act, 2023
            applies, we process personal data on the basis of your consent or
            for the legitimate uses that Act permits, such as information you
            voluntarily provide to us for a purpose you have indicated (for
            example, a support request) and compliance with law.
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
              operate the Website and Apps and who may process data outside
              your home country. They are only permitted to use it to provide
              services to us. They currently are:
              <ul>
                <li>
                  Cloudflare, which hosts the Website, runs the PinchPDF trial
                  service and its database, applies rate limiting, and keeps
                  request logs.
                </li>
                <li>
                  Resend, the email delivery service that sends contact and
                  support messages to us.
                </li>
                <li>
                  Google, whose email service hosts the mailboxes where we
                  receive those messages.
                </li>
                <li>
                  Dodo Payments and Lemon Squeezy, our payment and licensing
                  partners (Section 2.7).
                </li>
                <li>
                  GitHub, which serves NoDupe update files (Section 2.8).
                </li>
              </ul>
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
          <p>
            Our trial service has no feature that shows your name, email, or
            device hashes to other users. Only authorised Technowiz Solutions
            staff handling support can see contact details, through audited
            tools.
          </p>
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
          {/* TODO(owner): confirm the periods below. Review finding C1 recommends shortening the 5-year device-hash period; the trial notice must carry the same numbers. */}
          <ul>
            <li>
              <strong>Contact and support messages</strong> (including
              attachments): up to 24 months after our last communication with
              you, unless we need them longer for an ongoing dispute or to
              comply with law.
            </li>
            <li>
              <strong>PinchPDF trial data:</strong> for the periods stated in
              <Link href={trialNoticePath}>Annex A</Link>.
              In short, your name and email are erased 24 months after the
              App last contacted our server, and the device hashes, usage
              counts, and support reference are kept for a longer fixed
              period so that the one-trial-per-computer rule keeps working.
              Deleted data can remain in backups and exports for a limited
              time stated in that notice.
            </li>
            <li>
              <strong>PinchPDF license and purchase events:</strong>{' '}
              <strong>[OWNER TO CONFIRM: retention period.]</strong>
            </li>
            <li>
              <strong>Website request logs:</strong> a short period, currently
              about seven days.
            </li>
            <li>
              <strong>License and order records:</strong> held by our payment
              and licensing partners under their own policies, and by us for as
              long as the license is valid and as long as tax, accounting, and
              other laws require.
            </li>
            <li>
              <strong>Data stored locally by the Apps</strong> remains on your
              device and is retained according to your own use of the Apps
              until you delete it, uninstall the App, or clear the relevant
              application data.
            </li>
          </ul>
        </section>

        <section id="international-transfers">
          <h2>8. International transfers</h2>
          <p>
            Technowiz Solutions is based in India. Some of our service
            providers, such as our hosting, email delivery, mailbox, and
            licensing and payments providers, may process information on
            servers located outside India, including in the United States.
            Where applicable law restricts cross-border transfers, we rely on
            appropriate safeguards, such as the EU Standard Contractual
            Clauses or another legally recognized transfer mechanism, so that
            your information continues to receive a comparable level of
            protection.
          </p>
          {/* TODO(owner): confirm signed DPAs and transfer terms exist with Cloudflare, Resend, Google, Dodo Payments and Lemon Squeezy before keeping this paragraph. */}
        </section>

        <section id="security">
          <h2>9. Security</h2>
          <p>
            We use reasonable administrative, technical, and organizational
            measures designed to protect information we handle. Because the
            Apps process your files locally by design, the content of those
            files is not exposed to a network transfer as part of normal
            scanning, comparison, or compression functionality. For the
            PinchPDF trial, requests are sent over an encrypted connection
            and additionally sealed with an application-level encryption
            layer, name and email are stored encrypted, and device
            identifiers are stored only as keyed hashes. No method of
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
            consent where processing is based on consent. Data created by
            the Apps and stored locally on your device you can typically
            access, export, or delete directly by using the Apps&apos; own
            history, settings, or uninstall functions, or by deleting the
            relevant files from your device.
          </p>
          <p>
            Data we hold on our servers, such as PinchPDF trial registration
            data, support messages, and records held for licenses, can only be
            changed or deleted by us. To exercise your rights over it, contact
            us as described in Section 10.6 and include your support reference
            if you have one. Because the email address on a trial is not
            verified, we may ask you to write to us from that address or to
            give us the support reference before we act.
          </p>
          <p>
            If you ask us to erase your name and email from a PinchPDF trial,
            we will, but we may keep the device hashes, support reference, and
            usage count, because deleting them would let the same computer
            start another free trial. You can also ask for full deletion of the
            trial record, which removes the device hashes as well; after full
            deletion that computer can register a new trial. If you object to
            keeping the device hashes, tell us and we will consider your
            request against our reasons for keeping them.
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
          {/* TODO(counsel/owner): GDPR Art. 27 EU representative and UK representative: appoint and name here, or record why none is needed (review finding D1). */}

          <h3>10.3 India</h3>
          <p>
            If India&apos;s Digital Personal Data Protection Act, 2023
            applies to you, you may exercise the rights it grants,
            including access to a summary of your personal data and
            processing activities, correction and erasure, grievance
            redressal, and nominating another individual to exercise your
            rights in the event of death or incapacity. Our Grievance
            Officer for this purpose can be reached at{' '}
            <a href={`mailto:${contactEmail}`}>{contactEmail}</a>, and we
            will respond within the period the law allows. If your
            grievance is not resolved to your satisfaction, you may
            escalate it to the Data Protection Board of India.
          </p>
          {/* TODO(owner): name the Grievance Officer (and a role or person for data protection queries) here and in Section 13. */}

          <h3>10.4 California and other U.S. states</h3>
          <p>
            If the California Consumer Privacy Act (as amended by the
            CPRA) or a similar U.S. state law applies to you, you have the
            right to know what personal information we collect, to request
            deletion or correction, and to non-discrimination for
            exercising these rights. The categories we collect are
            identifiers (name, email address, IP address, hashed device
            identifiers, trial and support identifiers), commercial
            information (license and order records), and internet activity
            (request logs), for the purposes and retention periods in this
            Policy.{' '}
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
            not intended for use by anyone under the age of 18, and the
            PinchPDF trial registration asks you to confirm that you are 18
            or older. We do not knowingly collect personal information from
            children. If you believe a child has provided us with personal
            information, please contact us so we can remove it.
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
            consent. If we change how the PinchPDF trial processes personal
            data in a way that needs your consent, PinchPDF asks you again
            before the change applies to you.{' '}
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
          {/* TODO(owner): add the registered office address, LLP identification number, and the named Grievance Officer. */}
          <p>
            For the PinchPDF free trial, include the support reference shown
            in the App, and see the{' '}
            <Link href={trialNoticePath}>trial privacy notice</Link> and the{' '}
            <Link href={trialTermsPath}>trial terms</Link>.
          </p>
        </section>

        <section id="pinchpdf-trial">
          <h2>Annex A. PinchPDF Free Trial Privacy Notice</h2>
          <p>{trialNotice.document.intro}</p>
          <LegalSections document={trialNotice.document} idPrefix="pinchpdf-trial" />
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
