# Legal documents: structure, status and open decisions

Follows the general-counsel brief the owner approved: one company-wide privacy policy, short website terms, one software license agreement with a schedule per product, and a link to the payment providers' own purchase terms. Peers use the same pattern (Adobe, JetBrains, Malwarebytes). The wording is an AI-prepared **draft** for counsel to review; this is not legal advice.

**Decision (owner): keep the existing paths.** `/privacy` and `/terms` stay the addresses where the documents live. Other documents and pages link to them; nothing moves to a new path.

## What is built

| Address | Holds | Accepted how |
|---|---|---|
| `/privacy` | The Privacy Policy, with a section per product (2.6 free-trial registration for both Apps, 2.10 PinchPDF license and purchase events `#pinchpdf-license-events`, 2.11 NoDupe license and purchase events `#nodupe-license-events`, 2.12 install and uninstall events for both `#install-events`), **Annex A**, the PinchPDF Free Trial Privacy Notice (`#pinchpdf-trial`), and **Annex B**, the NoDupe Free Trial Privacy Notice (`#nodupe-trial`) | A notice, not a contract. Device-identifier consent is separate and unticked in the app |
| `/terms` | **Part A** Website Terms of Use (`#website-terms`, new and short) and **Part B** Software License Agreement (`#software-license`: the former 22 sections with their old anchors, plus **Schedule A** PinchPDF and **Schedule B** NoDupe). The PinchPDF Free Trial Terms are Schedule A, Part 2 (`#schedule-a-trial`) and the NoDupe Free Trial Terms are Schedule B, Part 2 (`#schedule-b-trial`) | Part A by using the site. Part B by installing or activating, with a link in the installer |
| `/legal` | Index of the documents with last-updated dates, linking to the two above | n/a |
| `/license` | Redirect to `/terms#software-license` (an early draft address) | n/a |

Precedence: a product schedule controls over the rest of Part B for that App. The privacy policy is a notice and is not part of the agreement.

The trial notices and trial terms keep one source each, `app/pinchpdf/legal/versions.ts` and `app/nodupe/legal/versions.ts` (NoDupe's mirrors PinchPDF's section for section; only the product name and what the trial counts differ), rendered inside the pages above, so there is no second copy to drift. The version key is the text's effective date and is what the server records as consent evidence.

## Page structure

```
/privacy  Privacy Policy (a notice, not a contract)
  1 Scope
  2 Information we collect: 2.1 forms, 2.2 automatic data, 2.3 files, 2.4 local data, 2.5 trials,
    2.6 free-trial registration (summary, points to Annexes A and B), 2.7 licenses and payment
    providers, 2.8 price display and update checks, 2.9 support, 2.10 PinchPDF license and purchase events,
    2.11 NoDupe license and purchase events, 2.12 install and uninstall events (both Apps)
  3 How we use information      4 Legal bases      5 Sharing      6 App stores      7 Retention
  8 International transfers     9 Security         10 Your rights (EEA/UK, India, California, other, how to exercise)
  11 Children    12 Changes    13 Contact
  Annex A  PinchPDF Free Trial Privacy Notice (#pinchpdf-trial): what we collect, why, legal basis,
           protection, who sees it, how long, your choices, contact
  Annex B  NoDupe Free Trial Privacy Notice (#nodupe-trial): the same sections

/terms  Terms of Service
  Part A  Website Terms of Use (#website-terms): A1 about, A2 using the site, A3 forms, A4 our content and
          trademarks, A5 complaints, A6 links, A7 security, A8 disclaimer and liability, A9 governing law,
          A10 changes, A11 contact
  Part B  Software License Agreement (#software-license), sections 1 to 22 with their original anchors
          (acceptance, definitions, eligibility, license grant, restrictions, anti-piracy, fees/trials/
          purchases/refunds, updates, your files, IP, security, feedback, third-party, app stores,
          termination, disclaimer, liability, indemnification, governing law, changes, general, contact)
          Schedule A  PinchPDF: Part 1 editions and one key per computer, Part 2 PinchPDF Free Trial Terms
                      (#schedule-a-trial), Part 3 license and purchase events
          Schedule B  NoDupe: Part 1 editions (NoDupe Individual, NoDupe Business) and one key per computer, Part 2 NoDupe Free Trial Terms
                      (#schedule-b-trial), Part 3 license, purchase, install and uninstall events

/legal  Index linking to /privacy, /terms, the two trial notices (/privacy#pinchpdf-trial, /privacy#nodupe-trial) and the two trial terms (/terms#schedule-a-trial, /terms#schedule-b-trial)
```

The footer and the More menu link to `/privacy` and `/terms`. `/legal` is in the sitemap only.

## What changed in the text

- **Privacy:** removed "that notice controls if it differs" (it is now part of the policy); 2.6 is a short summary pointing at Annex A; new 2.10 for license and purchase events; the retention list names the license events; the statement that licensed users do not contact our service is gone.
- **Terms:** the old `/terms` became Part B, with the website-only parts (IP and trademarks for the site, complaints, security) copied into the new Part A. Section 1 no longer folds the privacy policy into the agreement; section 20 now promises notice of material changes and that adverse changes apply going forward; the trial paragraph in 7.1 points at Schedule A.
- **Schedules:** A (PinchPDF editions and device moves, the trial terms, license events) and B (NoDupe).

## Owner decisions and what is left for counsel

`test/legal-pages.test.ts` fails while the text contains `OWNER TO CONFIRM`, so this cannot ship by accident. All of them are now settled and written in; none is left marked, so the test passes. If a new open decision comes up, mark it `OWNER TO CONFIRM` in the text and the test will hold the page back. Settled:

1. ~~Seats, devices and who may use a Business license~~ Settled by the owner: **one key per computer (or server), always, for every license**; a Business license may be used by the organization's employees, contractors and affiliates, as long as they use it on the same computer or server where it is installed. Written into Schedule A, Part 1 and the anti-piracy section.
2. ~~NoDupe editions and seats~~ Settled by the owner: one key per computer, the same as PinchPDF; the NoDupe licenses are NoDupe Individual and NoDupe Business. Written into Schedule B, Part 1.
2a. ~~NoDupe trial~~ Settled by the owner on 2026-11-24: **NoDupe mirrors PinchPDF in every way**, registration (name, email, 18+, three device hashes, one trial per computer), usage reports, license and install events, Insights, legal text and endpoints, and only the free-trial variables differ: 5 Basic, 3 Similar and 1 Deep scan, each counted when the scan completes (confirmed in the NoDupe app, `usage_guard.rs`). Earlier drafts of this folder described NoDupe as anonymous and without registration; that text is gone.
3. Consent for license events. Settled by the owner: consents are shown in the installer and again when the trial is accepted, and consent is **required for the trial** (the computer check; buy a license instead). Settled by the owner: **buy clicks are optional (consent, declining blocks nothing); activation, deactivation and key-change events rely on legitimate interest** with a right to object. Written into privacy 2.10 and section 4. App requirements that follow: the installer offers the buy-click choice (not required to proceed); the app does not send `buy_clicked` without it; the app lets the user withdraw it in settings.
4. ~~Retention period for license events~~ Settled by the owner: follow the GDPR. It sets no fixed number, so the policy states **24 months**, with deletion by `scripts/telemetry-purge.mjs` (run daily by the `tws-retention` Worker, see docs/RETENTION.md, which also applies the trial periods of 24 months for name and email and 5 years for the record), erasure on request, and a Health check that warns when the purge is overdue. Counsel to confirm the period.

Also for counsel: the lawful basis for license events and for the device identifiers (see the TODO comments in `app/privacy/page.tsx`; in particular India's DPDP Act has no general legitimate-interest basis, so check how activation events fit), the 18+ statement, processor terms for Business customers, and whether Dodo Payments and Lemon Squeezy terms need to be linked from Part B section 7.2. The store listings and in-app text must also stop saying licensed users send nothing.

## Rules

- `/privacy` and `/terms` always show the latest text. Each shows "last updated"; list material changes on the page.
- Keep a private dated archive of every published text outside the site. The server records the effective date a user accepted; the archive proves what it said.
- Notify existing users of material changes (email or in the app). Adverse changes apply going forward.
- When a document or anchor changes, update `/legal`, the sitemap, the Health check probes, the redirects in `next.config.ts` and this file together.
