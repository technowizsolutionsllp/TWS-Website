# Privacy policy legal review: gap analysis against actual data practices

> **Superseded** by [LEGAL_COUNSEL_MEMO.md](LEGAL_COUNSEL_MEMO.md) where the two differ. Kept because the code comments and the drafting notes refer to its section numbers. Both are AI-prepared analyses, not legal advice.

Date: 2026-11-20. Branch: `pinchpdf-trial-registration-service`.
Reviewed: `/privacy` (`app/privacy/page.tsx`, "Last updated September 9, 2026"), `/terms`, the draft versioned trial notice and trial terms (`app/pinchpdf/legal/versions.ts`, version 2026-11-20), the website code (forms, API routes, trial service, `wrangler.json`, D1 schema), the PinchPDF app (source, README, the three trial-registration plans), the NoDupe app (source and README) and the Licensing Server (LicenseHub) repo.

**What this is, and is not.** This is an engineering-side gap analysis: it compares what the policy says with what the code and plans actually do, and flags the legal risk each gap creates. It is not legal advice and does not replace the qualified review the project already requires (decision D6). Statements about law are my reading and are marked "verify" where they need counsel. I did not test the live site (headers, cookies, network calls); items that depend on that are marked.

## 1. Bottom line

The `/privacy` policy is a sound generic base for a local-first app, but it is **not accurate for the PinchPDF free-trial registration**, and it has gaps that exist today, independent of the trial.

Release blockers for the trial feature:

1. Section 2.5 says trial counters stay on the device. After the trial feature ships, unlicensed PinchPDF users send name, email and three hashed hardware identifiers to a server. The policy, the app README ("no device identifiers are sent to a service") and the product pages must change in the same release.
2. The trial notice promises retention that no code performs (24-month contact erasure, weekly exports aged out at 90 days). A promise you do not keep is worse than a longer honest period.
3. Hardware-identifier collection is bundled into one consent tick with the terms, and the lawful basis is not stated. For users in the EEA and UK this is the single biggest legal exposure (section 4, finding B2).
4. The policy names Lemon Squeezy as the payment partner. **PinchPDF uses Dodo Payments first** and Lemon Squeezy only as a fallback; NoDupe is the reverse. Dodo is not mentioned anywhere in the policy or terms.
5. The trial notice is still marked `reviewed: false` (visible "Draft" banner). Users cannot be asked to consent to a draft.

## 2. What data is actually collected and processed

| # | Data | Where it goes | Trigger | Retention (actual) | In `/privacy` today? |
|---|---|---|---|---|---|
| 1 | Name, email, optional service interest, message (contact form) | Website, Resend (email API, US), then the company Gmail mailbox | Contact form | No limit in code; policy says "reasonable period" | Yes, but Resend and Google are not named |
| 2 | Name, email, product, subject, description, up to several screenshots/files (support form) | Same as row 1, copied to a second mailbox address | Get Support form | No limit | Partly (attachments mentioned; recipients generic) |
| 3 | IP address, user agent, timestamps, request metadata | Cloudflare (hosting, CDN, Workers logs: `observability.enabled = true`) | Every request | Workers Logs: 7 days per Cloudflare docs (third-party sources say 3); verify in dashboard | Yes, in one sentence ("hosting provider logs IP") |
| 4 | IP address as rate-limit key | Cloudflare rate-limit bindings (contact, support, trial endpoints) | Form posts and trial calls | Held by Cloudflare, not by us | No |
| 5 | **Trial registration:** name, email (encrypted at rest), email blind index (HMAC) | Trial service: Cloudflare Worker + D1 | PinchPDF first run, unlicensed | Erase after 24 months of no contact (promised, **not implemented**) | **No** |
| 6 | **Trial registration:** up to 3 hashed device identifiers (MachineGuid, SMBIOS UUID, board serial; keyed HMAC on server) | D1 | Same | Up to 5 years (policy default D10) | **No** |
| 7 | Trial usage count and limit, per-install public key, trial id, support reference, consent versions and timestamps (client and server), app version, Windows build | D1 | Registration and each counted compression | Same as row 6 | **No** |
| 8 | Trial service log lines: endpoint, result code, key id, first 8 characters of trial id | Cloudflare Workers Logs | Every trial call | 7 days (verify) | **No** |
| 9 | Operator audit rows (action, trial id, reason, operator, details with no personal data) | D1 `trial_audit` | Operator actions | Not stated | No |
| 10 | License key and fixed instance name ("PinchPDF" / "NoDupe") | Dodo Payments and/or Lemon Squeezy (they see the IP address) | User activates or deactivates a license | Provider's own | Only Lemon Squeezy, and described inaccurately (see B6) |
| 11 | Purchase data: payment details, billing, email, order, key | Dodo Payments / Lemon Squeezy as merchant of record; we receive limited order and license data | Purchase | Provider's own; ours not stated | Lemon Squeezy only |
| 12 | IP address and country (price lookup; checkout reachability probe) | PinchPDF reads the price from Dodo's public checkout page whenever the Upgrade window opens; Dodo creates a checkout session per request | Opening Upgrade | Dodo's own | **No** |
| 13 | IP address, app version, OS and architecture (update check) | GitHub Releases (`latest.json`), NoDupe only | NoDupe update check | GitHub's own | **No** |
| 14 | Local data: scan results, thumbnails, logs, undo history, license cache, trial record | User's PC only | Normal use | Until user deletes | Yes (accurate) |
| 15 | Diagnostic log (file names, error codes) shared by the user on request | Email to support | User chooses | See rows 1 and 2 | Yes |

Not live yet but relevant: the Licensing Server (LicenseHub) has its own `/trials/*` endpoints, stores `customer_email` in plain text, an IP hash, admin emails, Google SSO and a mailer. Its README says no client calls it yet. It duplicates the Cloudflare trial service, so a decision is needed on which one is the trial authority before either is documented as live.

What I did not find: no document upload endpoint in either app, and no analytics, advertising or tracking script in the website code. The "files are not uploaded" claim is consistent with the outbound URLs in both apps' Rust sources.

## 3. What holds up

- The local-first statements (files, thumbnails, logs stay on the device) match the code.
- The trial design is privacy-conscious: raw hardware identifiers never leave the PC, name and email are encrypted at rest, signals are stored as keyed hashes, secrets are outside the database, operator actions are audited, and the notice versions are immutable with consent versions stored.
- The trial notice is honest that the hashes are persistent device identifiers and that contact erasure does not reset the trial.
- No advertising or analytics cookies; the policy's Do Not Track statement is consistent with that (live site not tested).

## 4. Findings

Severity: **Blocker** (fix before the trial ships), **High**, **Medium**, **Low**.

### A. Accuracy of the published statements

**A1. Blocker. Section 2.5 is false once the trial service ships.** It says an App "may track basic trial usage counters on your own device". Also affected: the PinchPDF README ("No telemetry", "no ... device identifiers are sent to a service", "License activation sends only the license key ..."), the product page copy that stresses privacy, and Terms 7.1 and 9. The app plan (section 9) and `docs/PINCHPDF_TRIAL_SERVICE.md` (gap 10) already say these must change in the same release. Fix: rewrite 2.5 and add a PinchPDF trial section (draft wording in section 6). State that NoDupe does not currently register and that licensed users send nothing to the trial service.

**A2. Blocker. Retention promised but not built.**
- "Name and email erased 24 months after the last contact": no Cron Trigger in `wrangler.json`, no purge in `lib/trial`, and `scripts/trial-admin.mjs` only has a manual `erase-contact`.
- "Weekly exports kept at most 90 days": no export process exists in the repo.
- "Deleted data can remain in backups for up to 7 days": matches D1 Time Travel on the Free plan, but only if the plan stays Free.
Fix: build the scheduled purge (Cron Triggers are available on Free per the website plan) and the export routine, or write the notice to match what actually happens. Add a test that proves rows past the cutoff lose `name_enc`, `email_enc` and `email_bidx`.

**A3. Blocker. Dodo Payments is missing.** Privacy 2.5, 5, 8 and Terms 4, 6, 7.2 describe Lemon Squeezy as *the* merchant of record. PinchPDF opens Dodo checkout first and activates against Dodo first; NoDupe uses Lemon Squeezy first with Dodo secondary. Fix: name both as payment and licensing providers, say which app uses which first, link both providers' privacy policies, and confirm each provider's legal entity name and country (the policy says "Lemon Squeezy, Inc."; Lemon Squeezy is now part of Stripe, verify the entity). Note that "Dodo Payments" as merchant of record for a key means the customer's contract and refund terms may differ by provider; Terms 7.2/7.3 need the same edit.

**A4. Medium. Section 2.5 says we receive "a device or hardware identifier used to bind the license".** The activation request carries only the key and the fixed instance name. Per the app README the license cache is bound locally to the machine and is not transmitted. Overstating what you collect is also a notice defect. Fix: describe what the provider returns (an activation/instance record) and say binding is done locally.

**A5. Medium. Undisclosed outbound calls.** (a) PinchPDF's price lookup and checkout reachability probe contact Dodo and expose the user's IP address, creating a Dodo checkout session each time (row 12). (b) NoDupe's updater contacts GitHub (row 13); its README says it "never phones home afterward", which the updater contradicts. Verify the updater is enabled in release builds. Fix: disclose both in "Information collected automatically" and in the sharing section.

**A6. Medium. The trial notice omits data it processes.** Missing: IP address and request metadata (rows 3, 4, 8), Cloudflare rate limiting, the log lines, and that the email is unverified so someone can register with another person's address (tell such a person how to ask for erasure).

### B. Lawful basis and consent

**B1. High. The general policy names the wrong basis for the forms.** Section 4 says consent "when you submit the contact form". Neither form has a consent control, and consent cannot be inferred from sending a message you asked us to answer. Use legitimate interests, or steps taken at your request before a contract, for enquiries and support, and keep consent for optional marketing only. Add a short notice and a link to the policy on both forms (no notice is shown at the point of collection today).

**B2. Blocker (EEA/UK users). Hardware identifiers and consent.**
- *Data protection law:* hashed hardware identifiers that persist and single out a computer are personal data (pseudonymous), as the trial notice itself concedes.
- *ePrivacy:* reading identifiers from the user's device and sending them out is "gaining access to information stored in terminal equipment". The EDPB's final Guidelines 2/2023 (version 2, October 2024) read Art. 5(3) of the ePrivacy Directive to cover fingerprinting-type access, not only cookies. I found no source on whether hashing takes an identifier out of scope; my working assumption is that it does not. Exemption for "strictly necessary" access is narrow: a trial limit protects the vendor's interest, not a service the user asked for. **Verify with counsel.**
- *Consent design:* today one tick covers terms and privacy notice together. If consent is the basis for the device read, it should be a separate, specific, unticked choice, with the plain alternative of buying a license; bundling with the terms weakens it. If legitimate interest is chosen for the matching, write down the balancing test, and still resolve the ePrivacy question. Counsel should pick the model; the app popup and the notice must then say the same thing.
- *India:* the DPDP Act requires consent to be free, specific, informed and unambiguous, with an itemised notice. Per secondary sources the substantive Rules (including the notice rule) start on 13 May 2027 (18 months after the 13 November 2025 notification; verify against G.S.R. 846(E)). Designing the notice to that standard now avoids a rewrite.

**B3. High. Age.** The policy and terms say 18+, but registration has no age confirmation. DPDP Act s.9 requires verifiable parental consent for under-18s and bans tracking of children. Add an "I am 18 or older" confirmation to the consent step.

**B4. Medium. "Continued use means acceptance" (Privacy 12).** Acceptable for ordinary policy edits, but not a valid way to obtain consent to new processing. State that material changes to trial processing will use the in-app re-consent flow (the `terms_outdated` mechanism already does this) and tie the two documents together.

### C. Retention, minimisation and rights

**C1. High. Five years for device hashes.** The purpose is stopping a repeat of a five-compression trial. Five years looks hard to justify against storage limitation. Consider 12 to 24 months from last contact, with the reasoning recorded; if you keep five years, the balancing test must justify it. The same retention applies to `trial_audit` and support references; state it.

**C2. High. Rights process for server-held data.** Privacy 10.1 says rights can be met "directly by using the Apps' own ... uninstall functions". That is true for local data only. Add: how to request access, correction, erasure or objection for trial data (via support reference and the trial email), the identity check you will use (the email is unverified, so proof means writing from that address), and the response period. DPDP Rule 14(3) caps grievance response at 90 days (verify). State what is refused and why: `erase-contact` keeps hashes, public key, support reference and counts; GDPR Art. 17 may require you to justify that case by case.

**C3. Medium. Vague periods elsewhere.** "Reasonable period" for contact/support mail is not a period. Give one (for example 24 months after the last message) and apply it to the mailbox. Add retention for payment-related records you hold (tax and accounting law may require several years; verify for India).

**C4. Medium. Logs.** Workers Logs hold request metadata including IP for about seven days. Disclose this. Separately, some summaries of the DPDP Rules require data fiduciaries to keep personal data, traffic data and logs for one year (sources conflict on the rule number); a one-week log window may conflict. Counsel to confirm and set the log retention.

**C5. Low. CCPA section (10.4).** If CCPA applies at all (thresholds likely not met), the notice should list categories collected (identifiers, device identifiers) and retention per category. A per-category table (section 6) covers both CCPA and GDPR Art. 13.

### D. Controller identity, recipients, transfers

**D1. High. EU/UK targeting and representatives.** PinchPDF ships German, French, Spanish and Italian interfaces and shows prices in the visitor's currency. That is strong evidence of offering to people in the EU, so the GDPR likely applies (Art. 3(2)). A non-EU controller in that position generally must appoint an EU representative (Art. 27), unless occasional processing with low risk applies, which continuous device-identifier processing probably does not; the UK has a parallel requirement. The policy names no representative. **Verify with counsel; decide between appointing representatives and a documented position.**

**D2. High. Controller details.** The policy gives "Mumbai, Maharashtra, India" and a Gmail address. Give the registered office address and LLP identification number, a named grievance officer (India's e-commerce and IT rules generally expect a named individual; verify which applies), and the person or role who answers for data protection.

**D3. High. Recipients are generic.** "Email delivery provider" is Resend (US); mail lands in Google's systems; hosting, database, rate limiting and logs are Cloudflare; payments and licensing are Dodo and Lemon Squeezy; updates for NoDupe come from GitHub. Name them or list them in a processors table, with purpose and location.

**D4. Medium. Transfer safeguards must be true.** Section 8 says "we require" the EU Standard Contractual Clauses. Confirm signed DPAs and transfer terms exist with Cloudflare, Resend, Google, Dodo and Lemon Squeezy, or soften the sentence. Consider whether D1's jurisdiction (an EU option exists) is worth setting for EU trials; verify availability and cost.

**D5. Medium. Automated decision.** `already_used` and `unsupported_device` are automatic refusals. A trial refusal is unlikely to be a "significant" automated decision, but say it is automatic, that a person reviews it through the support reference, and what the user can do.

### E. Documents and process

**E1. Blocker.** Trial notice and trial terms are `reviewed: false` (visible "Draft" notice, kept out of search). Flip only after the qualified review; a published version is immutable, so fix the text before the first release.

**E2. Medium. Conflicts between documents.** The trial notice "adds to" the general policy, which says the opposite about trial data. Add a precedence sentence ("for the PinchPDF trial, the trial notice controls") and update the Terms to mention registration, device matching and reporting of usage. Also bump `legalUpdatedDate`.

**E3. Low. Confirm on the live site:** no cookies are set (Cloudflare bot features can set `__cf_bm`), fonts are self-hosted (`next/font` normally downloads at build time), and no third-party request occurs on page load. The Swagger docs page loads jsDelivr scripts but sits behind operator authentication, so it is not a visitor-facing issue.

## 5. Decisions the owner needs to make

1. Consent model for device reading (separate consent versus legitimate interest plus documented balancing), after counsel's view on ePrivacy.
2. Retention of device hashes: 5 years (current default) or shorter; and the log retention period.
3. EU/UK representatives: appoint or document why not.
4. Which trial authority is real: the Cloudflare trial service or LicenseHub's `/trials/*`. Document only one.
5. Whether to publish a named grievance officer and a dedicated privacy mailbox instead of the shared Gmail address.
6. Whether NoDupe's updater and the PinchPDF price lookup stay as they are (and are disclosed) or are changed.

## 6. Draft wording for the main policy (for counsel to edit)

Replace Privacy 2.5 and add a section:

> **2.5 Free trials and licenses.** NoDupe and PinchPDF are offered with a free trial.
> *NoDupe:* trial usage is counted on your device only. NoDupe does not currently ask you to register.
> *PinchPDF:* to start the free trial you register with your name and email address. PinchPDF also reads up to three identifiers of your computer (the Windows machine identifier, the firmware identifier and the motherboard serial number), converts each into a one-way hash on your computer, and sends only the hashes. We use them to allow one trial per computer. We also record your trial usage count, the versions of the documents you accepted, the PinchPDF and Windows versions, a support reference and a public key created for your installation. The trial is not an account and your email is not verified. The details, including retention, are in the [PinchPDF Free Trial Privacy Notice](/pinchpdf/legal/privacy/2026-11-20). If you hold a license, PinchPDF does not contact the trial service.
> *Licenses and payments:* purchases and license activations are handled by our payment and licensing providers, **Dodo Payments** and **Lemon Squeezy**, each acting as merchant of record under its own privacy policy. PinchPDF contacts Dodo first and Lemon Squeezy as a fallback; NoDupe contacts Lemon Squeezy first. Activation sends your license key and the fixed name of the app; the provider sees your IP address. When the Upgrade window opens, PinchPDF reads the current price from the provider's public checkout page, which also exposes your IP address to that provider.
> *Updates:* NoDupe checks for updates on GitHub, which receives your IP address and the app version.

Add a processors table (Cloudflare, Resend, Google, Dodo, Lemon Squeezy, GitHub: purpose, data, location), a retention table by data category, a statement of the lawful basis per purpose, and the representative and grievance-officer details.

## 7. Release checklist for the privacy documents

- [ ] Trial retention jobs built and tested (A2), or text changed.
- [ ] Counsel review done; `reviewed: true` set (E1); version key unchanged only if text is final.
- [ ] `/privacy` section 2.5, 2.2, 4, 5, 7, 8, 10 and 12 updated; `legalUpdatedDate` bumped.
- [ ] Terms updated for Dodo, trial registration and precedence.
- [ ] Consent screen: separate device-check consent (if chosen), 18+ confirmation, links to the exact versions.
- [ ] Notice links and short privacy line on both website forms.
- [ ] PinchPDF README, ARCHITECTURE, user guide (7 languages), product pages: remove "no device identifiers sent".
- [ ] DPAs and transfer terms on file for each processor.
- [ ] Live-site check for cookies and third-party requests.
- [ ] Decision recorded on LicenseHub versus the Cloudflare trial service.

## 8. Sources used for the legal points

- DPDP Rules 2025 commencement and rule numbers: secondary summaries (Mondaq, Baker Botts, Storyboard18, SCC Online). Check the gazette text G.S.R. 846(E) before relying on rule numbers.
- ePrivacy scope: EDPB Guidelines 2/2023, version 2 (October 2024).
- Representatives: GDPR Art. 27 and EDPB Guidelines 3/2018.
- Cloudflare Workers Logs retention: Cloudflare developer documentation (7 days on Free; one third-party source says 3).
