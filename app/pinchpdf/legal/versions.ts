// Legal texts for the PinchPDF free-trial registration (website plan section 7). The public pages
// always show the LATEST text (see latest.ts); the version key is the text's effective date. RULES:
//   * Once any user has accepted a text, do not edit it in place: add a NEW key (its effective date),
//     update wrangler.json, and keep the superseded text in git history and a private dated archive
//     (the server records the accepted key as consent evidence).
//   * The version keys must match TRIAL_TERMS_VERSION / TRIAL_PRIVACY_VERSION in wrangler.json
//     (the server rejects consent for any other version with `terms_outdated`).
//   * `reviewed` records whether someone qualified has reviewed the text. The pages show no draft notice.
//     Set it to true only after someone qualified has reviewed the text (decision D6;
//     India's DPDP Act 2023, and GDPR for EU users).

// DRAFTING NOTE (docs/legal/PRIVACY_LEGAL_REVIEW.md): the 2026-11-20 text below was aligned with the
// revised /privacy and /terms pages while still UNPUBLISHED, so it was edited in place. Once any
// user has accepted it, never edit it again: add a new version key and update wrangler.json.
// Open items before release: owner decision on the retention periods (the 5-year device-hash
// period in particular), counsel's choice of consent model for the device check (the "legal-basis"
// section and the app's consent screen must match), the app's 18+ confirmation, and confirmation
// that the retention jobs described here run (built: workers/retention, docs/RETENTION.md; deploy it before publishing).

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
        'To start the trial you enter your name and email address, confirm that you are 18 years old or older, and accept these terms and the matching privacy notice. Please give correct details, because we may use the email address to answer support requests about your trial.',
        'The trial needs an internet connection once, when you register. After that PinchPDF works offline and reports your usage count to us when it can.',
      ],
    },
    {
      id: 'one-trial-per-computer',
      heading: 'One trial per computer',
      body: [
        'The trial is limited to one per computer, whatever name or email address is used. To enforce this, PinchPDF reads up to three identifiers of your computer, turns each into a one-way cryptographic hash on your computer, and sends only the hashes. We never receive the original identifiers. See the privacy notice for details.',
        'If a trial was already used on your computer, PinchPDF shows a support reference. This decision is made automatically. If you believe it is a mistake, for example after a Windows reinstall or a hardware change, contact support with that reference and a person will review it.',
        'If you do not want your computer identifiers checked, you can buy a license instead of using the free trial.',
      ],
    },
    {
      id: 'usage-counting',
      heading: 'How uses are counted',
      body: [
        'A use is counted when a file is successfully compressed or saved, as described in the app. Failed or cancelled compressions are not counted. The count is stored on your computer and also reported to us.',
        'Editing, copying or bypassing the trial counter, or using another computer identity to obtain another trial, is not allowed. This matches the restrictions in the Terms of Service.',
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
    'This notice explains what we collect when you register for the PinchPDF free trial, why, for how long, and how you can use your rights, including asking us to delete it. It is part of the Technowiz Solutions Privacy Policy and is read together with it.',
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
        'Your confirmation that you are 18 years old or older. We do not store your age.',
        'Your IP address and technical request details (such as the time and the type of request), which our hosting provider processes whenever the app contacts the service. We use them for security and rate limiting. Request logs are kept for a short period, currently about seven days, and the logs we write ourselves contain only a result code, a key identifier and the first 8 characters of the trial identifier.',
        'Licensed users are not asked to register and do not send the registration data above. A licensed install reports the license events described in the Privacy Policy (section 2.10).',
      ],
    },
    {
      id: 'why',
      heading: 'Why we collect it',
      body: [
        'Device identifiers are collected to decide trial eligibility, that is, to allow one trial per computer. The email address and name are a contact record so that support can help you. The usage count lets us show and enforce the trial limit.',
        'Hashing makes the identifiers hard to read back, but the hashes are still persistent identifiers of your computer, and we treat them as such. We do not use them for advertising or to follow what you do on your computer.',
        'You need to give us this information to use the free trial. If you prefer not to, you can buy a license instead.',
        'The decision that a trial was already used on your computer is made automatically by comparing the hashes. If you think it is wrong, contact support with your support reference and a person will review it.',
      ],
    },
    {
      id: 'legal-basis',
      heading: 'Our legal basis',
      body: [
        'Name, email address and usage count: we need them to provide the free trial you ask for and to help you through support.',
        'Device hashes and the one-trial-per-computer decision: our legitimate interest in preventing repeated use of a free trial. Where the law requires your consent for reading identifiers from your computer, you give it on the registration screen, and you can withdraw it by contacting us, which ends the trial.',
        'IP address and request details: our legitimate interest in keeping the service secure and available.',
        'If India\'s Digital Personal Data Protection Act, 2023 applies to you, we process this data on your consent given at registration and for the legitimate uses that Act permits.',
      ],
    },
    {
      id: 'how-it-is-protected',
      heading: 'How it is protected',
      body: [
        'Requests are sent over TLS and additionally sealed with an application-level encryption layer. Name and email are stored encrypted. Device hashes are stored only as keyed hashes. Secrets are kept outside the database.',
        'The data is processed on Cloudflare infrastructure, which may be outside your country, including in the United States. Where the law restricts such transfers, we rely on appropriate safeguards, such as the EU Standard Contractual Clauses.',
      ],
    },
    {
      id: 'who-can-see-it',
      heading: 'Who can see it',
      body: [
        'Only authorised Technowiz Solutions staff handling support, through audited operator tools. Cloudflare processes the data for us as our hosting and database provider. We do not sell this data, share it with other users, or use it for advertising.',
      ],
    },
    {
      id: 'retention',
      heading: 'How long we keep it',
      body: [
        'Name and email: erased 24 months after the last time the app contacted our server.',
        'Device hashes, usage counts and the support reference: kept for up to 5 years so that the one-trial-per-computer rule keeps working.',
        'Request logs kept by our hosting provider: a short period, currently about seven days.',
        'Deleted data can remain in database backups for up to 7 days and in weekly exports for up to 90 days before it ages out.',
      ],
    },
    {
      id: 'your-choices',
      heading: 'Your choices and deletion',
      body: [
        'You can ask us to erase your name and email. We keep the device hashes, support reference and counts, because deleting them would let the same computer start another trial.',
        'You can also ask for full deletion. This removes the whole record, including the device hashes. After full deletion that computer can register a new trial.',
        'You can also ask for a copy of the contact data we hold about you, ask us to correct it, or object to us keeping the device hashes. We will consider an objection against our reasons for keeping them.',
        'To ask, contact us and include your support reference. Because we do not verify the email address on a trial, we may ask you to write to us from that address or to give us the support reference before we act. If someone used your email address without your knowledge, tell us and we will erase it.',
        'If data protection law applies to you, you can also complain to your local supervisory authority, and in India to the Data Protection Board. The Technowiz Solutions Privacy Policy gives the details.',
      ],
    },
    {
      id: 'contact',
      heading: 'Contact',
      body: ['Use the Contact button on this site or the support page, and include your support reference.'],
    },
  ],
};

// ------------------------------------------------------------------ 2026-11-28: continuing a trial
//
// Protocol revision 5: a computer that already has a trial continues it (after a reinstall, for example) instead
// of being refused, and the app shows the registration date and a masked email or name. The changes are made with
// `revise`, so the earlier texts above stay exactly as accepted. NoDupe's notice uses the same wording (with its
// own name and "scans"), through `recognisedComputerText`.

/** A new version of a text: the same sections in the same order, with the bodies named in `changes` replaced. */
export function revise(base: LegalVersion, effective: string, changes: Record<string, string[]>): LegalVersion {
  for (const id of Object.keys(changes)) {
    if (!base.sections.some((section) => section.id === id)) throw new Error(`${base.title} has no section ${id}`);
  }
  return { ...base, effective, sections: base.sections.map((section) => (changes[section.id] ? { ...section, body: changes[section.id] } : section)) };
}

/** The paragraphs on recognising a computer, for an app (`PinchPDF`) and what its trial counts (`uses`). */
export function recognisedComputerText(app: string, units: string) {
  return {
    terms: [
      `If ${app} is reinstalled, or its data on your computer is removed, the trial on that computer continues where it was. It does not start again. Before it asks you to register, ${app} checks with our service whether your computer already has a trial. If it has, ${app} shows when that trial was registered, how many ${units} are left and the email address it was registered with, partly hidden (for example j•••@example.com), and offers to continue it. If you continue it, you accept the current terms again, and a name or email address you enter replaces the one we held. Registering again with the same email address also continues it. A trial that was used up stays used up.`,
      `If you do not continue that trial and register with a different email address instead, the registration is refused, whatever name is used. ${app} then shows when that computer's trial was registered, the name it was registered under, partly hidden (for example J••• D•••), and a support reference. A trial that we ended shows only the support reference.`,
      'These decisions are made automatically. If you believe one is a mistake, for example after a hardware change, contact support with the support reference and a person will review it.',
    ],
    check: `When ${app} checks whether your computer already has a trial, it sends the same hashed device identifiers and nothing else. We do not keep a record of the check, apart from a daily count of how many checks were made.`,
    decision:
      'The decisions whether your computer already has a trial, and whether a new registration on it continues that trial or is refused, are made automatically: by comparing the hashes and, to continue a trial, the support reference the app received from that check (when you choose to continue) or the email address. If you think a decision is wrong, contact support with your support reference and a person will review it.',
    shown: `Anyone who uses the computer a trial was registered on can see in ${app} when the trial was registered and how much of it is left, the email address partly hidden (for example j•••@example.com) and, if a registration with another email address is refused, the name partly hidden (for example J••• D•••). The app never shows the full name or email address.`,
    replaced: 'If you continue a trial and enter a name or email address, it replaces the one we held.',
  };
}

const recognised = recognisedComputerText('PinchPDF', 'uses');
const section = (doc: LegalVersion, id: string) => doc.sections.find((s) => s.id === id)!.body;

const trialTerms20261128 = revise(trialTerms20261120, '2026-11-28', {
  'one-trial-per-computer': [
    section(trialTerms20261120, 'one-trial-per-computer')[0],
    ...recognised.terms,
    section(trialTerms20261120, 'one-trial-per-computer')[2],
  ],
});

const privacy20261128 = revise(privacy20261120, '2026-11-28', {
  'what-we-collect': section(privacy20261120, 'what-we-collect').flatMap((p, i) => (i === 1 ? [p, recognised.check] : [p])),
  why: [...section(privacy20261120, 'why').slice(0, 3), recognised.decision],
  'who-can-see-it': [...section(privacy20261120, 'who-can-see-it'), recognised.shown],
  'your-choices': [recognised.replaced, ...section(privacy20261120, 'your-choices')],
});

export const legalVersions: Record<LegalKind, Record<string, LegalVersion>> = {
  terms: { '2026-11-20': trialTerms20261120, '2026-11-28': trialTerms20261128 },
  privacy: { '2026-11-20': privacy20261120, '2026-11-28': privacy20261128 },
};

export function getLegalVersion(kind: LegalKind, version: string): LegalVersion | undefined {
  return Object.prototype.hasOwnProperty.call(legalVersions[kind], version) ? legalVersions[kind][version] : undefined;
}
