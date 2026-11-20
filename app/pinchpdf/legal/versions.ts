// Immutable, versioned legal documents for the PinchPDF free-trial registration
// (website plan section 7). RULES:
//   * A published version is NEVER edited. A change is a NEW version key and a new page;
//     old pages stay readable at their own URL.
//   * The version keys must match TRIAL_TERMS_VERSION / TRIAL_PRIVACY_VERSION in wrangler.json
//     (the server rejects consent for any other version with `terms_outdated`).
//   * `reviewed: false` shows a visible "draft" notice and keeps the page out of search.
//     Set it to true only after someone qualified has reviewed the text (decision D6;
//     India's DPDP Act 2023, and GDPR for EU users).

export type LegalSection = { id: string; heading: string; body: string[] };

export type LegalVersion = {
  title: string;
  intro: string;
  effective: string;
  reviewed: boolean;
  sections: LegalSection[];
};

export type LegalKind = 'terms' | 'privacy';

const trialTerms20261120: LegalVersion = {
  title: 'PinchPDF Free Trial Terms',
  intro:
    'These terms apply to the free trial of PinchPDF. They add to the Technowiz Solutions Terms of Service, which still apply. If the two conflict on the trial, these terms control.',
  effective: '2026-11-20',
  reviewed: false,
  sections: [
    {
      id: 'what-the-trial-is',
      heading: 'What the free trial is',
      body: [
        'The trial lets you compress a limited number of PDF files with PinchPDF before you decide to buy a license. The number is shown in the app and may be changed by us for new trials.',
        'The trial is a registration, not an account. There is no password, and we do not verify your email address.',
      ],
    },
    {
      id: 'registration',
      heading: 'Registration',
      body: [
        'To start the trial you enter your name and email address and accept these terms and the matching privacy notice. Please give correct details, because we may use the email address to answer support requests about your trial.',
        'The trial needs an internet connection once, when you register. After that PinchPDF works offline and reports your usage count to us when it can.',
      ],
    },
    {
      id: 'one-trial-per-computer',
      heading: 'One trial per computer',
      body: [
        'The trial is limited to one per computer, whatever name or email address is used. To enforce this, PinchPDF reads up to three identifiers of your computer, turns each into a one-way cryptographic hash on your computer, and sends only the hashes. We never receive the original identifiers. See the privacy notice for details.',
        'If a trial was already used on your computer, PinchPDF shows a support reference. If you believe this is a mistake, for example after a Windows reinstall or a hardware change, contact support with that reference and we will review it.',
      ],
    },
    {
      id: 'usage-counting',
      heading: 'How uses are counted',
      body: [
        'A use is counted when a file is successfully compressed or saved, as described in the app. Failed or cancelled compressions are not counted. The count is stored on your computer and also reported to us.',
        'Editing, copying or bypassing the trial counter, or using another computer identity to obtain another trial, is not allowed.',
      ],
    },
    {
      id: 'revocation',
      heading: 'Changes, revocation and reset',
      body: [
        'We may end or limit a trial that is abused. We may also reset a trial for a genuine owner at our discretion, normally granting only the unused remainder.',
        'We may change or end the free trial at any time for new registrations.',
      ],
    },
    {
      id: 'no-warranty',
      heading: 'No warranty',
      body: [
        'The free trial is provided as is, subject to the disclaimers and limits in the Technowiz Solutions Terms of Service.',
      ],
    },
    {
      id: 'contact',
      heading: 'Contact',
      body: ['Questions about the trial: use the Contact button on this site or the support page.'],
    },
  ],
};

const privacy20261120: LegalVersion = {
  title: 'PinchPDF Free Trial Privacy Notice',
  intro:
    'This notice explains what we collect when you register for the PinchPDF free trial, why, for how long, and how you can ask us to delete it. It adds to the Technowiz Solutions Privacy Policy.',
  effective: '2026-11-20',
  reviewed: false,
  sections: [
    {
      id: 'what-we-collect',
      heading: 'What we collect',
      body: [
        'Name and email address that you type in. We do not verify the email address.',
        'Up to three hashed device identifiers: a hash of your Windows machine identifier, a hash of your computer firmware (SMBIOS) identifier, and a hash of your motherboard serial number, when your computer provides usable values. The original values never leave your computer.',
        'Your trial usage count and limit, the versions of the terms and privacy notice you accepted, the time you accepted them (as reported by the app and as recorded by our server), and the PinchPDF and Windows versions.',
        'A support reference (8 characters), an anonymous trial identifier, and a public key that the app creates for this installation.',
        'Licensed users are not asked to register and send none of this.',
      ],
    },
    {
      id: 'why',
      heading: 'Why we collect it',
      body: [
        'Device identifiers are collected to decide trial eligibility, that is, to allow one trial per computer. The email address and name are a contact record so that support can help you. The usage count lets us show and enforce the trial limit.',
        'Hashing makes the identifiers hard to read back, but the hashes are still persistent identifiers of your computer, and we treat them as such.',
      ],
    },
    {
      id: 'how-it-is-protected',
      heading: 'How it is protected',
      body: [
        'Requests are sent over TLS and additionally sealed with an application-level encryption layer. Name and email are stored encrypted. Device hashes are stored only as keyed hashes. Secrets are kept outside the database.',
        'The data is processed on Cloudflare infrastructure, which may be outside your country.',
      ],
    },
    {
      id: 'who-can-see-it',
      heading: 'Who can see it',
      body: [
        'Only authorised Technowiz Solutions staff handling support, through audited operator tools. We do not sell this data or use it for advertising.',
      ],
    },
    {
      id: 'retention',
      heading: 'How long we keep it',
      body: [
        'Name and email: erased 24 months after the last time the app contacted our server.',
        'Device hashes, usage counts and the support reference: kept for up to 5 years so that the one-trial-per-computer rule keeps working.',
        'Deleted data can remain in database backups for up to 7 days and in weekly exports for up to 90 days before it ages out.',
      ],
    },
    {
      id: 'your-choices',
      heading: 'Your choices and deletion',
      body: [
        'You can ask us to erase your name and email. We keep the device hashes, support reference and counts, because deleting them would let the same computer start another trial.',
        'You can also ask for full deletion. This removes the whole record, including the device hashes. After full deletion that computer can register a new trial.',
        'To ask, contact us and include your support reference. You can also ask for a copy of the contact data we hold about you.',
      ],
    },
    {
      id: 'contact',
      heading: 'Contact',
      body: ['Use the Contact button on this site or the support page, and include your support reference.'],
    },
  ],
};

export const legalVersions: Record<LegalKind, Record<string, LegalVersion>> = {
  terms: { '2026-11-20': trialTerms20261120 },
  privacy: { '2026-11-20': privacy20261120 },
};

export function getLegalVersion(kind: LegalKind, version: string): LegalVersion | undefined {
  return Object.prototype.hasOwnProperty.call(legalVersions[kind], version) ? legalVersions[kind][version] : undefined;
}
