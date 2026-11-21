# Legal documents: structure, status and open decisions

Follows the general-counsel brief the owner approved: one company-wide privacy policy, short website terms, one software license agreement with a schedule per product, and a link to the payment providers' own purchase terms. Peers use the same pattern (Adobe, JetBrains, Malwarebytes). The wording is an AI-prepared **draft** for counsel to review; this is not legal advice.

**Decision (owner): keep the existing paths.** `/privacy` and `/terms` stay the addresses where the documents live. Other documents and pages link to them; nothing moves to a new path.

## What is built

| Address | Holds | Accepted how |
|---|---|---|
| `/privacy` | The Privacy Policy, with a section per product (2.6 PinchPDF trial registration, 2.10 PinchPDF license and purchase events) and **Annex A**, the PinchPDF Free Trial Privacy Notice (`#pinchpdf-trial`) | A notice, not a contract. Device-identifier consent is separate and unticked in the app |
| `/terms` | **Part A** Website Terms of Use (`#website-terms`, new and short) and **Part B** Software License Agreement (`#software-license`: the former 22 sections with their old anchors, plus **Schedule A** PinchPDF and **Schedule B** NoDupe). The PinchPDF Free Trial Terms are Schedule A, Part 2 (`#schedule-a-trial`) | Part A by using the site. Part B by installing or activating, with a link in the installer |
| `/legal` | Index of the documents with last-updated dates, linking to the two above | n/a |
| `/pinchpdf/legal/privacy`, `/pinchpdf/legal/trial-terms` (and the old `/…/<version>` forms) | Redirect (307) to Annex A and Schedule A, Part 2. The app keeps linking to these | n/a |
| `/license` | Redirect to `/terms#software-license` (an early draft address) | n/a |

Precedence: a product schedule controls over the rest of Part B for that App. The privacy policy is a notice and is not part of the agreement.

The trial notice and trial terms keep one source, `app/pinchpdf/legal/versions.ts`, rendered inside the pages above, so there is no second copy to drift. The version key is the text's effective date and is what the server records as consent evidence.

## What changed in the text

- **Privacy:** removed "that notice controls if it differs" (it is now part of the policy); 2.6 is a short summary pointing at Annex A; new 2.10 for license and purchase events; the retention list names the license events; the statement that licensed users do not contact our service is gone.
- **Terms:** the old `/terms` became Part B, with the website-only parts (IP and trademarks for the site, complaints, security) copied into the new Part A. Section 1 no longer folds the privacy policy into the agreement; section 20 now promises notice of material changes and that adverse changes apply going forward; the trial paragraph in 7.1 points at Schedule A.
- **Schedules:** A (PinchPDF editions and device moves, the trial terms, license events) and B (NoDupe).

## Open decisions (a test fails until the one marked OWNER TO CONFIRM is resolved)

`test/legal-pages.test.ts` fails while the text contains `OWNER TO CONFIRM`, so this cannot ship by accident. Remaining (one):

1. ~~Seats, devices and who may use a Business license~~ Settled by the owner: **one key per computer (or server), always, for every license**; a Business license may be used by the organization's employees, contractors and affiliates, as long as they use it on the same computer or server where it is installed. Written into Schedule A, Part 1 and the anti-piracy section.
2. ~~NoDupe editions and seats~~ Settled by the owner: one key per computer, the same as PinchPDF. Written into Schedule B.
3. Consent for license events. Settled by the owner: consents are shown in the installer and again when the trial is accepted, and consent is **required for the trial** (the computer check; buy a license instead). Still open (privacy 2.10): whether consent to license events is **optional** for licensed users, whether declining stops installation or activation, and how to withdraw it later in the app. A consent that is required to install or activate is not freely given for analytics-type events (GDPR Art. 7(4)); either make it optional or rely on legitimate interest with notice and a right to object.
4. ~~Retention period for license events~~ Settled by the owner: follow the GDPR. It sets no fixed number, so the policy states **24 months**, with deletion by `scripts/telemetry-purge.mjs`, erasure on request, and a Health check that warns when the purge is overdue. Counsel to confirm the period.

Also for counsel: the lawful basis for license events and for the device identifiers (see the TODO comments in `app/privacy/page.tsx`), the 18+ statement, processor terms for Business customers, and whether Dodo Payments and Lemon Squeezy terms need to be linked from Part B section 7.2. The store listings and in-app text must also stop saying licensed users send nothing.

## Rules

- `/privacy` and `/terms` always show the latest text. Each shows "last updated"; list material changes on the page.
- Keep a private dated archive of every published text outside the site. The server records the effective date a user accepted; the archive proves what it said.
- Notify existing users of material changes (email or in the app). Adverse changes apply going forward.
- When a document or anchor changes, update `/legal`, the sitemap, the Health check probes, the redirects in `next.config.ts` and this file together.
