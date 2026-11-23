import Link from 'next/link';
import { companyLocation, contactEmail, legalEntityName } from '../company-data';

// Part A of /terms: short terms for using the website only. DRAFT, see docs/legal/STRUCTURE.md.

export const websiteSections = [
  { id: 'site-about', label: 'About these terms' },
  { id: 'site-use', label: 'Using the website' },
  { id: 'site-forms', label: 'Contact and support forms' },
  { id: 'site-ip', label: 'Our content and trademarks' },
  { id: 'site-complaints', label: 'Copyright and trademark complaints' },
  { id: 'site-links', label: 'Links to other sites' },
  { id: 'site-security', label: 'Security' },
  { id: 'site-disclaimer', label: 'Disclaimer and limit of liability' },
  { id: 'site-governing-law', label: 'Governing law' },
  { id: 'site-changes', label: 'Changes to these terms' },
  { id: 'site-contact', label: 'Contact us' },
];

export default function WebsiteTerms() {
  return (
    <>
      <section id="website-terms">
        <h2>Part A. Website Terms of Use</h2>
        <p>
          These terms govern your use of the Technowiz Solutions website. The NoDupe and PinchPDF applications are
          licensed under Part B of this page, and personal data is handled as described in the{' '}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </section>

      <section id="site-about">
        <h3>A1. About these terms</h3>
        <p>
          By using the Website you agree to these terms. If you do not agree, please do not use it. These terms do
          not cover the software we publish, which has its own license agreement (Part B of this page), or the checkout pages of our
          payment providers, which have their own terms.
        </p>
      </section>

      <section id="site-use">
        <h3>A2. Using the website</h3>
        <p>You may browse the Website and download the software it offers for your own lawful use. You agree not to:</p>
        <ul>
          <li>Interfere with, overload, or try to gain unauthorized access to the Website or its related systems.</li>
          <li>Introduce viruses or other harmful code, or use the Website for any unlawful or fraudulent purpose.</li>
          <li>Copy or republish the Website&apos;s content in a way that suggests it comes from someone else.</li>
        </ul>
      </section>

      <section id="site-forms">
        <h3>A3. Contact and support forms</h3>
        <p>
          When you use the contact form or the Get Support form, please give us accurate information and do not
          send content that is unlawful, infringes the rights of others, or contains malware. Attachments such as
          screenshots and log files may contain personal data, so please check them before sending. We use what you
          send to respond to you, as the Privacy Policy explains.
        </p>
      </section>

      <section id="site-ip">
        <h3>A4. Our content and trademarks</h3>
        <p>
          The Website&apos;s text, graphics, and other content are owned by Technowiz Solutions or its licensors and
          are protected by copyright and other intellectual property laws. &quot;Technowiz Solutions,&quot;
          &quot;NoDupe,&quot; &quot;PinchPDF,&quot; and their logos are our trademarks. You may not use them, or
          confusingly similar marks, without our prior written permission.
        </p>
      </section>

      <section id="site-complaints">
        <h3>A5. Copyright and trademark complaints</h3>
        <p>
          If you believe that the Website or content we have published infringes your copyright or trademark,
          contact us at <a href={`mailto:${contactEmail}`}>{contactEmail}</a> with (a) a description of the work or
          mark you believe is infringed, (b) a description and location of the material you believe is infringing,
          and (c) your contact information. We will review and respond to good-faith complaints.
        </p>
      </section>

      <section id="site-links">
        <h3>A6. Links to other sites</h3>
        <p>
          The Website links to other sites, such as payment providers and app stores. We do not control them and are
          not responsible for their content or practices. Their own terms and privacy policies apply.
        </p>
      </section>

      <section id="site-security">
        <h3>A7. Security</h3>
        <p>
          You must not probe, scan, or test the vulnerability of the Website or any system we use to deliver or
          license our software, or bypass any security measure, without our prior written authorization. If you find
          a security vulnerability, please report it responsibly to{' '}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a> instead of disclosing it publicly, so that we can fix
          it first. We do not run a paid bug bounty program but will acknowledge good-faith reports.
        </p>
      </section>

      <section id="site-disclaimer">
        <h3>A8. Disclaimer and limit of liability</h3>
        <p>
          THE WEBSITE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE,&quot; WITHOUT WARRANTIES OF ANY KIND.
          TO THE FULLEST EXTENT PERMITTED BY LAW, TECHNOWIZ SOLUTIONS WILL NOT BE LIABLE FOR ANY INDIRECT,
          INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE WEBSITE. THIS DOES NOT
          LIMIT LIABILITY THAT CANNOT BE LIMITED OR EXCLUDED UNDER APPLICABLE LAW. Liability for the software is
          governed by Part B (the Software License Agreement).
        </p>
      </section>

      <section id="site-governing-law">
        <h3>A9. Governing law</h3>
        <p>
          These terms are governed by the laws of India, without regard to conflict-of-law principles. Any dispute
          arising from these terms or the Website will be subject to the exclusive jurisdiction of the courts located
          in Mumbai, Maharashtra, India, except where applicable law requires otherwise. If you are a consumer
          resident in a jurisdiction that grants you mandatory consumer protections, a right to bring proceedings in
          your local courts, or the application of your local law that cannot be waived by contract (such as an EU
          Member State, the United Kingdom, or Australia), this Section applies only to the extent permitted by that
          law, and nothing in it limits those mandatory rights.
        </p>
      </section>

      <section id="site-changes">
        <h3>A10. Changes to these terms</h3>
        <p>
          We may update these terms from time to time. The updated terms apply from the &quot;Last updated&quot; date
          above, and we will highlight material changes on this page. Continuing to use the Website after an update
          means you accept it.
        </p>
      </section>

      <section id="site-contact">
        <h3>A11. Contact us</h3>
        <p>If you have questions about these terms, contact us at:</p>
        <p>
          {legalEntityName}
          <br />
          {companyLocation}, India
          <br />
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
        </p>
      </section>
    </>
  );
}
