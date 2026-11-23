# Legal review memorandum: privacy, terms and trial registration

**To:** Technowiz Solutions LLP (owner)
**Date:** 2026-11-21
**Re:** Privacy Policy, Terms of Service, PinchPDF Free Trial Terms and Privacy Notice, measured against the data the website and apps actually collect
**Supersedes where they differ:** `docs/legal/PRIVACY_LEGAL_REVIEW.md` (the engineering gap analysis). Where this memo corrects that review, it says so.

> **Status of this document.** This is a counsel-style analysis prepared by an AI model, not by a licensed advocate or solicitor, and it creates no attorney-client relationship or privilege. It is built from the repository code and plans and from secondary sources found on the web on 2026-11-21 (listed at the end); I did not read the gazette or statute text for every point. Points marked **[VERIFY]** are ones where a licensed Indian advocate, and for EU/UK exposure a qualified EU or UK privacy lawyer, must confirm before you rely on them. Decision D6 in your plan already requires that review; this memo is meant to make that review shorter and better aimed, not to replace it.

---

## 1. Executive opinion

**Overall.** The documents are a reasonable starting set for a local-first desktop product that processes no customer content on its servers. They are **not yet fit to publish alongside the PinchPDF trial registration**. The core problem is not drafting quality. It is that the legal position was written for a product that sends nothing to the company, and the trial service changes that for unlicensed PinchPDF users: it adds a persistent device identifier, a name and email, and ongoing usage reporting.

**Residual risk if published as drafted today:** medium to high on regulatory and misrepresentation grounds for the EU/UK and India; low to medium for US exposure; and high that the Terms would be partly unenforceable against consumers in the EU, UK and similar jurisdictions. **After the remediation in section 9: low to medium**, which is a normal level for a small software vendor.

The ten points that matter most, in priority order:

| # | Issue | Why it matters | Section |
|---|---|---|---|
| 1 | **No valid consent design for the device check.** One bundled tick covers terms, notice and hardware identifiers. India's DPDP Act has **no general "legitimate interest" ground**, so device hashes of Indian users need specific consent; the EU/UK ePrivacy rules separately require consent for reading device identifiers unless "strictly necessary". | Core processing could be unlawful in two regimes at once. | 5.1 |
| 2 | **Published statements that become false:** "no device identifiers sent", "trial counters stay on your device", "Lemon Squeezy is the payment partner". | Misleading statements are an independent violation (FTC Act s.5 and state laws, EU unfair commercial practices, India's Consumer Protection Act 2019). Easier to prove than a data-protection breach. | 4.2 |
| 3 | **Promised retention not implemented** (24-month erasure, 90-day export ageing). | A privacy notice promise is a representation. Failure to honour it is a breach of the notice and of storage-limitation duties. | 4.3 |
| 4 | **Log retention conflicts with Indian rules.** Cloudflare Workers Logs keep about 7 days; the CERT-In Directions (2022) require ICT-system logs for a rolling 180 days (a copy within India, per reported FAQs). There is also a 6-hour incident-reporting duty that the policy does not reflect. | A current legal obligation in India, not a future one. **[VERIFY]** whether and how it applies to you. | 5.3 |
| 5 | **EU/UK targeting without a representative.** Seven app languages, localised prices. | GDPR Art. 27 representative (and UK equivalent) likely required. | 5.2 |
| 6 | **Terms contain consumer-hostile clauses that will not hold** in the EU/UK/India as consumer contracts: refund exclusion, "as is" disclaimer, unilateral change by continued use, consumer indemnity, suspension without notice or refund, privacy policy incorporated into the contract. | Unenforceable clauses weaken the whole document and invite regulator attention. | 6 |
| 7 | **English-only legal text for a 7-language product.** | EU transparency and local-language consumer rules, and DPDP's language requirement for the consent notice. | 5.4 |
| 8 | **Controller identity and grievance officer.** City-only address, a consumer Gmail address, no named officer. | India's e-commerce and SPDI rules expect a named officer **[VERIFY]**; GDPR Art. 13 requires the controller's identity and contact details. | 5.5 |
| 9 | **No compliance records exist:** no processing register, balancing test, DPIA, processor agreements on file, incident runbook. | These are what a regulator or a diligence reviewer asks for first. | 8 |
| 10 | **Vendor facts unverified.** Dodo Payments' legal entity is not stated in the sources I found; Lemon Squeezy is now part of Stripe and sources describe migration to Stripe's own merchant-of-record product. | Naming the wrong entity in a policy is itself a defect; provider change is a business risk. | 8 (item 3) |

---

## 2. Scope, materials, and facts relied on

**Documents reviewed:** `/privacy` and `/terms` (as redrafted on this branch), the draft trial terms and trial privacy notice (`app/pinchpdf/legal/versions.ts`), the website's forms and API routes, the trial service code and D1 schema, `wrangler.json`, the three trial-registration plans, the PinchPDF and NoDupe source and READMEs (outbound URLs and licensing), and the LicenseHub (Licensing Server) repository.

**Facts I rely on (observed in code or documents):**
- Apps do not upload file content. No upload endpoint exists in either app.
- PinchPDF activation sends the licence key and the fixed name "PinchPDF" to Dodo Payments first, then Lemon Squeezy. NoDupe uses Lemon Squeezy first, Dodo secondary. NoDupe has a Tauri updater pointing at GitHub releases.
- PinchPDF reads prices from Dodo's public checkout page whenever the Upgrade window opens.
- The trial service stores: encrypted name and email, a keyed blind index of the email, three **peppered HMACs** of device-signal hashes, a per-install public key, usage count and limit, consent versions and times (client claimed and server received), app and OS version, a support reference. It logs only result codes, key id and the first 8 characters of the trial id. Operator actions are audited.
- The server receives from the client an **unkeyed SHA-256** of each signal and applies the secret-keyed HMAC before storing (`lib/trial/signals.ts`). So the server briefly holds a hash that, for short values such as a motherboard serial, could in principle be brute-forced by someone with that value in memory. It stores only the keyed form.
- Workers observability is enabled in `wrangler.json`. There is no scheduled purge job in the repository and no export routine.
- The contact and Get Support forms show no notice and no link to the policy.
- The contact email is a Gmail address, and all support mail (with attachments) is copied there.

**Facts I did not and could not verify:** the live site (cookies, headers, third-party requests), signed processor agreements, whether NoDupe's updater is active in release builds, the legal entity and registration of any vendor, whether the LLP is registered under GST, whether any EU/UK customers exist today, and the final consent screen (the app UI is not built).

---

## 3. Applicable law: what applies to you, and how confident I am

| Regime | Applies? | Basis | Confidence |
|---|---|---|---|
| **India, IT Act 2000 s.43A and SPDI Rules 2011** | Yes, **until the DPDP Act's commencement tranche (reported as 13 May 2027)**; sources conflict on whether repeal was immediate, and the better-supported reading is 2027. | You are a "body corporate" handling personal data. The Rules' strict duties attach to *sensitive* personal data (passwords, financial details, health, etc.). Name, email and device hashes are probably not SPDI; payment data is collected by the merchant of record, not you. Rule 4's privacy-policy duty and Rule 5(9)'s grievance officer duty are the ones to check. | Medium **[VERIFY]** |
| **India, DPDP Act 2023 and Rules 2025** | Yes. Notified 13 Nov 2025; most obligations (notice, consent, security, breach, rights, retention) start **18 months later, reported as 13 May 2027**. A January 2026 proposal to shorten some periods (mainly for significant data fiduciaries) was reported; I found no notification. | You decide the purpose and means of processing personal data of people in India. | High on applicability; **[VERIFY]** current dates in the gazette |
| **India, CERT-In Directions (28 Apr 2022)** | Yes, on the reported reading that they apply to service providers, intermediaries, data centres and "body corporate". | Duties: report specified cyber incidents within **6 hours**; keep ICT-system logs for a rolling **180 days** within India (FAQs reportedly allow a copy kept in India). | Medium **[VERIFY]** whether a small vendor's Cloudflare logs are in scope |
| **India, Consumer Protection Act 2019 and E-Commerce Rules 2020** | Likely. The Rules reportedly cover digital products and every e-commerce entity must name a grievance officer, acknowledge within 48 hours and resolve within one month. | You sell software online. Marketplace/inventory classification is not clear, since a merchant of record sits between you and the buyer. | Medium **[VERIFY]** |
| **India, Contract Act 1872** | Yes. | Governs enforceability of the Terms; exclusive Mumbai jurisdiction is generally respected between parties. | High |
| **EU GDPR** | **Probably yes (Art. 3(2)(a))**. | Seven interface languages (including de, fr, es, it) and prices shown in the visitor's currency are strong "offering to people in the EU" indicators. | Medium-high |
| **EU ePrivacy Directive Art. 5(3)** | **Probably yes**, wherever GDPR does. | Reading identifiers from a user's device and sending them out is "gaining access" to terminal-equipment information; the EDPB's final Guidelines 2/2023 (Oct 2024) read this broadly, including fingerprinting. I found no source treating a hash as outside it. | Medium **[VERIFY]** |
| **EU consumer law** (Consumer Rights Directive, Unfair Terms Directive 93/13, Digital Content Directive 2019/770) | Probably, for EU consumers. | The Terms are standard-form consumer terms. | Medium |
| **UK GDPR, PECR, Consumer Rights Act 2015** | If UK users are targeted (English product, GBP pricing likely). | Parallel to the EU. | Medium |
| **US: FTC Act s.5, state UDAP laws, CCPA/CPRA** | FTC and state deception law: yes for US customers. CCPA: probably **below** its thresholds, but disclosure habits are cheap. | Misstatements to consumers are actionable regardless of size. | Medium |
| **Microsoft Store policies** | Yes while listed. | A privacy policy URL that accurately describes data use is required for apps that handle personal data or use the network. | Medium **[VERIFY]** |

---

## 4. Findings on the Privacy Policy (as now drafted)

### 4.1 Roles and structure
- **Technowiz Solutions LLP is the controller / data fiduciary** for the trial registration, support mail, and website logs it controls. **Cloudflare** (hosting, Workers, D1, rate limiting, logs) and **Resend** (outbound email) act as processors. **Google** receives the support mailbox, so a **processor** if the account is Google Workspace under a data processing agreement. A free consumer Gmail account is not a safe place for customer personal data and attachments **[VERIFY account type]**. **Dodo Payments**, **Lemon Squeezy** and **GitHub** are independent controllers for the data they collect (as merchants of record and as a release host), which the policy correctly handles by pointing to their own policies.
- Under DPDP s.8(2) a fiduciary may engage a processor only under a valid contract. Under GDPR Art. 28 a written processing agreement is mandatory. **Gap: no signed agreements are evidenced in the repository.**
- The "Licensed users send nothing to the trial service" statement is a strong design property. Keep it, and make sure the app enforces it (licence check before any network call).

### 4.2 Accuracy of statements (highest-value fix)
- Misstatements are separately actionable. Statements that are or will be inaccurate at release: PinchPDF README ("No telemetry... no device identifiers are sent to a service"), product pages' privacy-first framing, Terms 9, the old policy 2.5. The redraft fixes `/privacy`; **the apps' READMEs, store listings and in-app text have not been touched.**
- **"We never receive the original identifiers" and "hashing makes the identifiers hard to read back"** need care. The server receives an unkeyed SHA-256 of the identifier before it applies its own keyed HMAC. For short or guessable values (a board serial), an unkeyed hash is weak protection. Say plainly that the values are **pseudonymised, not anonymised**, and drop language implying they cannot be reversed. The notice already concedes they are persistent identifiers; keep that.
- Marketing claims such as "private", "no upload", "local-first" remain true for **file content**. Keep claims scoped to that ("your PDFs never leave your computer"). Do not use "no data collected" or "no tracking" for PinchPDF trial users.

### 4.3 Retention and deletion
- 24-month contact erasure and the weekly-export ageing (90 days) are promised in the trial notice and **not implemented**. Either build and test them or state only what happens. A policy that promises an automated deletion that does not occur is the clearest breach-of-notice scenario in the file.
- **Device-hash retention of 5 years** is the hardest number to defend. The purpose (blocking a repeat of a five-use free trial) is real, but proportionality (GDPR Art. 5(1)(c),(e); DPDP s.8(7)) points to a shorter period. A reasoned position would be 12 to 24 months from last contact, written down in a balancing test. If you keep 5 years, record why.
- `erase-contact` keeps hashes, public key, support reference and counts. That is defensible if disclosed and justified, and is disclosed. Under GDPR Art. 17 the exception must be a documented balancing outcome, not a blanket rule.
- Backups: "7 days" is correct only on the D1 Free plan. State it as a maximum that you will keep true, or reword to "a short period".

### 4.4 Lawful basis and the consent design (see also 5.1)
- **India has no general legitimate-interest ground.** Under DPDP s.4, personal data can be processed for a lawful purpose with consent or for "certain legitimate uses" (s.7). The s.7 uses most relevant to you are data the person **voluntarily provides** for a specified purpose without indicating non-consent (such as a support message), compliance with law, and responding to emergencies. **Computing and sending a device identifier is not data the person voluntarily provides**, so it needs consent (s.6): free, specific, informed, unconditional, unambiguous, clear affirmative action, limited to the specified purpose, with a notice that is understandable independently of other information. The redraft's Indian-law sentence ("consent or the legitimate uses the Act permits") is acceptable but should say that **for the device check the basis is consent**.
- **EU/UK:** legitimate interest (anti-abuse) can be the GDPR basis, **but** the ePrivacy access rule is separate and consent is the default route unless an exemption applies. A trial limit serves your interest, not a service the user requested, so the "strictly necessary" exemption is a weak fit. **[VERIFY]**
- **Practical recommendation (one design for all regions):** a separate, unticked, specific consent line on the registration screen for the device check, with the plain alternative ("or buy a licence"). A trial is a discretionary free benefit, so conditioning it on consent to the anti-abuse check is far easier to defend than conditioning a core paid service. Withdrawal must be as easy as giving: add an in-app way to withdraw (and to see the support reference), not only "contact us".
- The app must **not read or compute any identifier before the user ticks consent and presses Start.** State that in the app design; it is what makes the consent meaningful.
- Maintain a consent log: you already store notice versions and both timestamps, which is good evidence (GDPR Art. 7(1)).

### 4.5 Rights, grievance and breach handling
- Policy 10.1 correctly now separates local data from server-held data. Add expected response times: GDPR one month (extendable); DPDP grievance redressal within a period not exceeding **90 days** (Rule 14(3), reported); E-Commerce Rules: acknowledge in 48 hours, resolve in one month **[VERIFY]**. A commitment you can keep is better than "within the timeframe required by law".
- **Breach notification statement is incomplete.** There are three clocks: CERT-In **6 hours** for specified incidents; GDPR **72 hours** to the supervisory authority; DPDP (from commencement) intimation to the Board and each affected person without delay, with a detailed report to the Board within 72 hours (reported). The policy says "without undue delay". That is acceptable as public text, but you need an internal runbook that meets the shortest clock.
- **Identity checks on unverified email.** You cannot reliably tie an access or erasure request to a record from an unverified email. GDPR Art. 11 helps: you need not collect more data to identify someone. The documented approach (support reference plus a message from the same address, or the in-app reference) is sound; write it down.
- The `already_used` answer reveals the **support reference of the blocking record to anyone whose device signals match**. Low risk, but the operator procedure correctly requires verifying the requester before any reset. Keep that procedure mandatory.

### 4.6 Smaller policy points
- Section 12's "continued use equals acceptance" is acceptable for ordinary changes but is not a valid way to obtain consent to **new** processing. The redraft ties consent-dependent changes to in-app re-consent. Good.
- Transfers: the redraft softened "we require SCCs". The EU-US Data Privacy Framework stands but is under appeal to the CJEU (Case C-703/25 P, reported); do not rest EU-to-US safeguards on it alone. Have SCCs or the provider's standard transfer terms on file.
- Children: DPDP s.9 requires verifiable parental consent for under-18s and prohibits tracking and behavioural monitoring of children. The 18+ confirmation on registration is a reasonable control; it is not age verification. Acceptable for a business-oriented desktop tool.
- CCPA section: low value but harmless; the per-category list is present.

---

## 5. Cross-cutting issues

### 5.1 The consent and basis matrix (recommended)

| Processing | EU/UK basis | India basis | Mechanism |
|---|---|---|---|
| Name, email, usage count for the trial | Contract (trial requested) | Consent (registration) | Registration form and Start button |
| Device hashes, one-trial-per-computer | Legitimate interest **plus** consent for ePrivacy access | **Consent** | **Separate unticked consent line** |
| IP and request logs | Legitimate interest (security) | Legitimate use / security safeguards | Notice only |
| Support mail | Legitimate interest / pre-contract | Voluntarily provided (s.7(a)) | Notice link on the form |
| Licence and purchase | Contract | Contract / consent | Provider checkout |

### 5.2 EU/UK representative
If GDPR Art. 3(2) applies, Art. 27 generally requires a written EU representative, unless the processing is occasional, low-risk, and without large-scale special-category data. Continuous registration of device identifiers is hard to call occasional. The UK has a parallel representative duty. Options: (a) appoint a representative service (modest annual cost); (b) geo-limit the product and stop localised marketing to the EU (not realistic given the product's seven languages); (c) document a reasoned conclusion that you are not targeting the EU (not credible on the current facts). **[VERIFY with an EU privacy lawyer.]**

### 5.3 Indian operational rules (CERT-In, SPDI, DPDP security)
- **Logs:** Cloudflare Workers Logs retain about 7 days on the Free plan; the CERT-In 180-day rolling retention would require exporting logs somewhere you control (an India-region copy, per reported FAQs). Options: restrict log content (you already log very little), export to a bucket, or take a documented position that the Directions do not reach a service of this size. **[VERIFY]**
- **Incident reporting:** adopt a 6-hour-capable internal process.
- **DPDP "reasonable security safeguards"** (Rule 6) include logs and monitoring; some summaries cite a one-year retention for logs and traffic data (sources disagree on the rule number). Whatever the number, one week of logs is likely too short. Decide on a figure with counsel and align policy section 2.2/7 and the trial notice.
- **SPDI Rules** apply until repeal; confirm whether you hold any "sensitive personal data" (probably not) and whether Rule 4 (published policy) and Rule 5(9) (named grievance officer) bind you.

### 5.4 Language
The product ships in seven languages; the trial notice and terms exist only in English. For EU consumers, the legal text must be intelligible in the language the contract is concluded in, and several member states expect local-language consumer terms. DPDP s.5(3) requires the notice be available in English or any language in the Eighth Schedule (Japanese and Korean are not on it, but English suffices there). **Practical fix:** provide the trial notice and trial terms in all seven app languages, with English as the controlling text, and show the user's language at consent. Machine translation of a legal notice should be reviewed by a native-speaker lawyer or at least a careful human editor.

### 5.5 Controller identity, grievance officer, contact
- Use the registered office address and **LLPIN**, not city only.
- Appoint and **name** a Grievance Officer with a role mailbox on your domain (for example `privacy@technowizsolutions.com`) rather than a Gmail account. A named officer with contact details is expected under the E-Commerce Rules and the SPDI Rules and is good practice under DPDP **[VERIFY each]**.
- State a DPO or equivalent contact. A DPO is not mandatory at your scale under GDPR; a named person who answers is enough.

### 5.6 Misleading-advertising exposure
India's misleading-advertisement guidelines (2022) and ASCI, the EU Unfair Commercial Practices Directive and the FTC all treat privacy claims as advertising when used to sell. Review: homepage and product-page copy, store listings, screenshots, and in-app text. The only safe claims are those that remain true after the trial service ships.

---

## 6. Findings on the Terms of Service

The Terms are written well for a business-to-consumer licence and have many protective carve-outs ("to the extent permitted by applicable law"). The following clauses carry risk, in descending order.

| Clause | Issue | Recommendation |
|---|---|---|
| **1. Acceptance; Privacy Policy "incorporated by reference"** | Incorporating a privacy policy into the contract turns notices into contractual promises and risks conflating consent with contract acceptance (consent must be separable and not bundled). Acceptance "by accessing" the website or using the software is browse-wrap, enforceable in India more readily than in the EU/UK. | Remove the incorporation. Say the Privacy Policy explains data use and is not part of the contract. Add click-through acceptance in the app at first run (the registration step is the natural place) and at checkout. |
| **7.3 No refunds** | For EU/UK consumers, statutory remedies for digital content that does not conform cannot be excluded; withdrawal rights for digital content can be waived only with prior express consent and acknowledgement, confirmed in a durable medium. A flat "all purchases are final" is an unfair term in those markets. In India, refusal to remedy defective service can be a deficiency in service or unfair trade practice. The **merchant of record's own buyer terms** (Dodo, Lemon Squeezy) may grant refund rights that override yours. | Redraft: no refund for change of mind after delivery **where permitted**, with an explicit carve-out for non-conformity and statutory rights. Align with each provider's refund terms. |
| **7.4 Withdrawal waiver** | The waiver is captured **at checkout**, by whoever acts as trader. Statement "by completing a purchase you expressly request" is not enough unless the checkout screen has the specific consent and acknowledgement. | Confirm what the Dodo and Lemon Squeezy checkouts record. **[VERIFY]** |
| **16. "As is" disclaimer** | Statutory conformity and quality guarantees apply to consumers regardless. The text already preserves rights that cannot be excluded; the shouted "AS IS" disclaimer still reads as an attempt to exclude them. | Keep the carve-out, soften the tone, and state that nothing affects statutory consumer rights. |
| **17. Limitation of liability, including "loss of data, files"** | NoDupe **deletes files**. Excluding liability for data loss in a file-deletion tool is the clause most likely to be tested. For consumers, caps are unenforceable for death or personal injury, fraud, and in several systems for gross negligence. A cap of "amount paid" means zero for the free trial. | Keep as is for business users; for consumers, add a specific carve-out and rely on in-app safeguards (Recycle Bin default, previews, undo) as the primary risk control, and document them. |
| **18. Indemnification by the user** | Standard for business users; unfair in a consumer contract (EU, UK, Australia and India's unfair-contract concept). | Limit to business licences. |
| **20. Changes by continued use** | Unilateral changes to terms by continued use is a classic unfair term for consumers; digital content modifications have their own rules (valid reason, no extra cost, notice). | Provide notice (30 days for material changes), an affirmative right to refuse and stop, and state that a purchased perpetual licence keeps its core functionality. |
| **6 / 15. Suspension "without notice and without refund"** for suspected piracy | Unfair for consumers; also risks wrongly cutting off honest users (cloned VMs, hardware changes). | Say "notice where practicable", a way to contest it, and a refund where the key was legitimately bought. |
| **19. Governing law, Mumbai courts** | Enforceable between commercial parties. Against consumers in the EU/UK/Australia, local mandatory protections and local-court rights override; the clause already carves this out. | Keep. Consider arbitration for business customers (Indian seat). |
| **3. Eligibility** | 18+ and sanctions language are fine. Make sure the checkout providers block embargoed countries so you are not relying on the user's representation alone. | Confirm provider settings. |
| **4. Licence; "personal or internal business purposes"** | Individual and Business plans exist; the Terms do not distinguish consumer from business use. | Add a short plan-based licence scope ("Individual: one user; Business: as described at purchase"). |
| **13. Open-source components** | Fine. Confirm every bundled licence (PDFium, others) is honoured in `THIRD-PARTY-NOTICES.md` and in the installer. | Run the licence audit before release. |
| **Cross-references** | Section 11 cited "Section 13" and "Section 14" for the disclaimer and limitation of liability; the correct sections are 16 and 17. **Fixed in this branch.** | Have a lawyer re-read every cross-reference after edits. |
| **Missing clauses** | Notices (how you and the user communicate), language/translation precedence, force majeure, consumer-rights savings clause stated once at the top, order of precedence between Terms, trial terms and order forms. | Add. |

**Assessment.** As a business-to-business licence the Terms are fine. As a consumer contract in the EU/UK, expect parts to be struck down if challenged. The practical risk is regulator or consumer-organisation attention, not litigation, but the fixes are small.

---

## 7. Findings on the trial terms and trial privacy notice

1. **Draft status.** `reviewed: false` shows a "Draft" banner. You cannot ask users to consent to a draft, and the immutable-version rule means the text must be right the first time a user accepts it.
2. **Consent text.** The notice and the app screen must say identical things about the device check, the legal basis, and how to withdraw. Today the app screen does not exist. Build it from the notice, not the other way round.
3. **Automated refusal.** The "already used" result is an automated decision with human review on request. Low risk (a free trial is not a significant effect), but you have disclosed it, which is right.
4. **Reset and goodwill.** "We may reset a trial at our discretion" is fine. Say that you will review in good faith and aim to respond within a stated number of days (the rights section gives the statutory floor).
5. **Email not verified.** You describe it clearly. Add one line promising that trial emails are used for support only and not marketing, if that is true. This is a trust point and reduces third-party-email complaints.
6. **Consent evidence.** You store notice versions and two timestamps. Also store a content hash of the exact text shown, so you can prove what was accepted if text is ever changed in place.
7. **Name-only trials.** The name field has no legal purpose except support greeting. Consider making it optional (data minimisation).
8. **Retention figures** repeat the issues in 4.3. Make the notice's numbers match the software before publishing.

---

## 8. Compliance records and operational controls you need

None of these exists in the repository today. They are the first things a regulator, an enterprise customer's procurement team, or an acquirer asks for.

1. **Record of processing activities** (GDPR Art. 30 does not exempt systematic processing for small firms). One table covering the website, trial service, support, and licensing.
2. **Legitimate-interest assessment** for the device-hash check, and a short **data protection impact assessment** (device fingerprinting is on regulators' radar). Two to four pages each.
3. **Processor and vendor file:** signed DPAs and transfer terms for Cloudflare, Resend and Google; for Dodo Payments and Lemon Squeezy, their merchant-of-record terms and privacy policies, with their **legal entity names and countries** recorded. I could not confirm Dodo Payments' legal entity. Lemon Squeezy is part of Stripe, and sources describe migration towards Stripe's own merchant-of-record product, so plan for a provider change (the Terms and policy would need updating, and activation of existing keys must keep working).
4. **Retention schedule** matching what the software actually does, with the purge job and its test.
5. **Incident response runbook** with a 6-hour, 72-hour, and DPDP timeline matrix, an on-call owner, regulator contact points, and a template notice.
6. **Operator access policy:** who can run `trial-admin`, how the secrets (`PEPPER`, `PII_KEY`) are stored and backed up, how access is revoked. Losing `PEPPER` or `PII_KEY` is a data-loss event; keep an offline backup, as the operations note says.
7. **Rights-request log** (date, request, identity check, outcome, deadline).
8. **Pre-release site audit:** cookies, third-party requests, fonts, headers, security headers, and the Microsoft Store listing fields.

---

## 9. Remediation roadmap

**Before the trial registration ships (blockers)**
1. Decide and build the consent design in 4.4 (separate device-check consent, in-app withdrawal, no identifier read before consent).
2. Make the retention promises true (purge job, export routine) or reduce the promises; set the device-hash period you can defend.
3. Correct every public statement that becomes false: READMEs, product pages, store listings, in-app text, user guide (all 7 languages).
4. Add processor agreements and fill the missing controller details (address, LLPIN, named officer, role mailbox).
5. Translate and review the notice and trial terms; remove the "Draft" flag only after counsel signs off.
6. Decide on the EU/UK representative.
7. Add the policy notice link and a short privacy line to both website forms; move support mail off a consumer Gmail account if it is one.

**Within 30 days of release**
8. Redraft the Terms clauses in section 6 and add the missing clauses; align refunds with each provider's terms.
9. Write the register, balancing test, DPIA and incident runbook (section 8).
10. Fix log retention against CERT-In and the DPDP security rule.
11. Verify the live site (cookies, requests) and the NoDupe updater.

**Before 13 May 2027 (DPDP main commencement; verify date)**
12. Re-read the notice against the final Rules text; set up the grievance process with the 90-day ceiling; finish a rights-request workflow.
13. Decide between the Cloudflare trial service and LicenseHub's `/trials/*` as the single trial authority, and document only the one that is live. Two parallel trial systems would double the disclosures and the risk.

---

## 10. Information I need to firm up this opinion

1. Is the support mailbox a Google Workspace account or a consumer Gmail account?
2. Which countries have your paying customers and trial users been in? (This decides EU/UK exposure.)
3. Are the processor DPAs (Cloudflare, Resend, Google, Dodo Payments, Lemon Squeezy) signed or accepted online?
4. Is the NoDupe updater active in release builds, and what does it send?
5. What do the Dodo and Lemon Squeezy checkouts say about refunds and the digital-content withdrawal waiver?
6. Who is the named Grievance Officer, and what is the registered office address and LLPIN?
7. Do you expect any B2B customers to sign order forms or enterprise terms (affects the Terms structure)?
8. Is the LLP GST-registered and does it hold other regulatory registrations that affect disclosures?

---

## 11. Sources and limits

- India DPDP Rules 2025: notification 13 Nov 2025, phased commencement (rules 1, 2, 17 to 21 immediate; rule 4 after 12 months; rules 3, 5 to 16, 22, 23 after 18 months), grievance ceiling of 90 days (Rule 14(3)): Mondaq, Baker Botts, Storyboard18, SCC Online summaries. A January 2026 proposal to shorten some periods was reported by Chambers, Mondaq and others; no notification found.
- SPDI Rules and s.43A: Taxmann, KSK, Linklaters, Nishith Desai summaries (repeal reported from 13 May 2027, one source says immediate).
- CERT-In Directions 28 Apr 2022: Linklaters, Khaitan & Co, Mondaq and others (6 hours; 180 days logs; FAQs reportedly allow a copy in India). Primary text not read.
- Consumer Protection (E-Commerce) Rules 2020: PRS India, Khaitan, LiveLaw, Mondaq summaries.
- EDPB Guidelines 2/2023 on the technical scope of ePrivacy Art. 5(3) (version 2, Oct 2024); EDPB Guidelines 3/2018 on territorial scope; GDPR Art. 27 summaries.
- EU-US Data Privacy Framework: General Court dismissed Latombe on 3 Sep 2025; appeal C-703/25 P to the CJEU reported pending (WilmerHale, IAPP, King & Spalding).
- Cloudflare Workers Logs retention: Cloudflare docs (Free plan reported 7 days).
- Vendors: sources are mostly competitor comparison articles; legal entities not confirmed.

I did not review: GST and tax treatment of sales; trademark clearance for "NoDupe" and "PinchPDF"; open-source licence compliance of bundled components; app-store listing terms; employment or contractor privacy; and any contract with a customer.
