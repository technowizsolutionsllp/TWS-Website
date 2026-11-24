// Legal texts for the NoDupe free-trial registration. They mirror PinchPDF's (app/pinchpdf/legal/versions.ts)
// section for section; only what differs for NoDupe is different: the product name, and that the trial counts
// scans in three modes (Basic, Similar and Deep) instead of one counter. The public pages always show the LATEST
// text (see latest.ts); the version key is the text's effective date. RULES (the same as PinchPDF's):
//   * Once any user has accepted a text, do not edit it in place: add a NEW key (its effective date),
//     update wrangler.json (NODUPE_TRIAL_TERMS_VERSION / NODUPE_TRIAL_PRIVACY_VERSION), and keep the
//     superseded text in git history and a private dated archive (the server records the accepted key
//     as consent evidence).
//   * The version keys must match NODUPE_TRIAL_TERMS_VERSION / NODUPE_TRIAL_PRIVACY_VERSION in wrangler.json
//     (the server rejects consent for any other version with `terms_outdated`).
//   * `reviewed: false` shows a visible "draft" notice and keeps the page out of search. Set it to true only
//     after someone qualified has reviewed the text (India's DPDP Act 2023, and GDPR for EU users).

// DRAFTING NOTE: written on 2026-11-24 to match the PinchPDF 2026-11-20 text while still UNPUBLISHED, so it may
// still be edited in place. Once any user has accepted it, never edit it again: add a new version key.
// Open items before release are the same as PinchPDF's (docs/legal/PRIVACY_LEGAL_REVIEW.md): the owner's decision
// on the retention periods (the 5-year device-hash period in particular), counsel's choice of consent model for
// the device check, the app's 18+ confirmation, and confirmation that the retention jobs described here are built.

import type { LegalKind, LegalVersion } from '../../pinchpdf/legal/versions';

const trialTerms20261124: LegalVersion = {
  title: 'NoDupe Free Trial Terms',
  intro:
    'These terms apply to the free trial of NoDupe. They add to the Technowiz Solutions Terms of Service, which still apply. If the two conflict on the trial, these terms control.',
  effective: '2026-11-24',
  reviewed: false,
  sections: [
    {
      id: 'what-the-trial-is',
      heading: 'What the free trial is',
      body: [
        "The trial lets you run a limited number of scans with NoDupe before you decide to buy a license: 5 Basic scans, 3 Similar scans and 1 Deep scan. Each mode has its own limit, and a scan in one mode does not use up another mode's limit. The numbers are shown in the app and may be changed by us for new trials.",
        'The trial is a registration, not an account. There is no password, and we do not verify your email address.',
      ],
    },
    {
      id: 'registration',
      heading: 'Registration',
      body: [
        'To start the trial you enter your name and email address, confirm that you are 18 years old or older, and accept these terms and the matching privacy notice. Please give correct details, because we may use the email address to answer support requests about your trial.',
        'The trial needs an internet connection once, when you register. After that NoDupe works offline and reports your usage counts to us when it can.',
      ],
    },
    {
      id: 'one-trial-per-computer',
      heading: 'One trial per computer',
      body: [
        'The trial is limited to one per computer, whatever name or email address is used. To enforce this, NoDupe reads up to three identifiers of your computer, turns each into a one-way cryptographic hash on your computer, and sends only the hashes. We never receive the original identifiers. See the privacy notice for details.',
        'If a trial was already used on your computer, NoDupe shows a support reference. This decision is made automatically. If you believe it is a mistake, for example after a Windows reinstall or a hardware change, contact support with that reference and a person will review it.',
        'If you do not want your computer identifiers checked, you can buy a license instead of using the free trial.',
      ],
    },
    {
      id: 'usage-counting',
      heading: 'How scans are counted',
      body: [
        'A scan is counted when it completes in the mode you chose (Basic, Similar or Deep), as described in the app. Failed or cancelled scans are not counted. The counts are stored on your computer and also reported to us. If you used some of the free scans before you registered, those are counted too: registering does not give you a fresh trial.',
        'Editing, copying or bypassing the trial counters, or using another computer identity to obtain another trial, is not allowed. This matches the restrictions in the Terms of Service.',
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

const privacy20261124: LegalVersion = {
  title: 'NoDupe Free Trial Privacy Notice',
  intro:
    'This notice explains what we collect when you register for the NoDupe free trial, why, for how long, and how you can use your rights, including asking us to delete it. It is part of the Technowiz Solutions Privacy Policy and is read together with it.',
  effective: '2026-11-24',
  reviewed: false,
  sections: [
    {
      id: 'what-we-collect',
      heading: 'What we collect',
      body: [
        'Name and email address that you type in. We do not verify the email address.',
        'Up to three hashed device identifiers: a hash of your Windows machine identifier, a hash of your computer firmware (SMBIOS) identifier, and a hash of your motherboard serial number, when your computer provides usable values. The original values never leave your computer.',
        'Your trial usage counts and limits (the number of Basic, Similar and Deep scans used, and the limit for each), the versions of the terms and privacy notice you accepted, the time you accepted them (as reported by the app and as recorded by our server), and the NoDupe and Windows versions.',
        'A support reference (8 characters), an anonymous trial identifier, and a public key that the app creates for this installation.',
        'Your confirmation that you are 18 years old or older. We do not store your age.',
        'Your IP address and technical request details (such as the time and the type of request), which our hosting provider processes whenever the app contacts the service. We use them for security and rate limiting. Request logs are kept for a short period, currently about seven days, and the logs we write ourselves contain only a result code, a key identifier and the first 8 characters of the trial identifier.',
        'Licensed users are not asked to register and do not send the registration data above. A licensed install reports the license events described in the Privacy Policy (section 2.11).',
      ],
    },
    {
      id: 'why',
      heading: 'Why we collect it',
      body: [
        'Device identifiers are collected to decide trial eligibility, that is, to allow one trial per computer. The email address and name are a contact record so that support can help you. The usage counts let us show and enforce the trial limit for each scan mode.',
        'Hashing makes the identifiers hard to read back, but the hashes are still persistent identifiers of your computer, and we treat them as such. We do not use them for advertising or to follow what you do on your computer.',
        'You need to give us this information to use the free trial. If you prefer not to, you can buy a license instead.',
        'The decision that a trial was already used on your computer is made automatically by comparing the hashes. If you think it is wrong, contact support with your support reference and a person will review it.',
      ],
    },
    {
      id: 'legal-basis',
      heading: 'Our legal basis',
      body: [
        'Name, email address and usage counts: we need them to provide the free trial you ask for and to help you through support.',
        'Device hashes and the one-trial-per-computer decision: our legitimate interest in preventing repeated use of a free trial. Where the law requires your consent for reading identifiers from your computer, you give it on the registration screen, and you can withdraw it by contacting us, which ends the trial.',
        'IP address and request details: our legitimate interest in keeping the service secure and available.',
        "If India's Digital Personal Data Protection Act, 2023 applies to you, we process this data on your consent given at registration and for the legitimate uses that Act permits.",
      ],
    },
    {
      id: 'how-it-is-protected',
      heading: 'How it is protected',
      body: [
        "Requests are sent over TLS and additionally sealed with an application-level encryption layer. Name and email are stored encrypted. Device hashes are stored only as keyed hashes. Secrets are kept outside the database. NoDupe's data is kept in a database separate from PinchPDF's.",
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

export const nodupeLegalVersions: Record<LegalKind, Record<string, LegalVersion>> = {
  terms: { '2026-11-24': trialTerms20261124 },
  privacy: { '2026-11-24': privacy20261124 },
};

export function getNodupeLegalVersion(kind: LegalKind, version: string): LegalVersion | undefined {
  return Object.prototype.hasOwnProperty.call(nodupeLegalVersions[kind], version) ? nodupeLegalVersions[kind][version] : undefined;
}
