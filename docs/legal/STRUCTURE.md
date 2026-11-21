# Legal document structure (target) and how today's pages map to it

A plan for the owner and counsel, not legal advice and not final wording. It follows the general-counsel brief: one company-wide privacy policy, short website terms, one software license agreement with a schedule per product, and a link to the payment providers' own purchase terms. Peers use the same pattern (Adobe, JetBrains, Malwarebytes). Wording is for counsel; this file only says what goes where.

## Target set

| Document | Address (stable, always the latest text) | Accepted how | Covers |
|---|---|---|---|
| Privacy Policy | `/privacy` | Notice, not a contract. Device-identifier consent is a separate, unticked choice in the app | Website, NoDupe, PinchPDF (trial registration, license activation, telemetry), one section per product |
| Website Terms of Use | `/terms` (after the split) | By using the site | Site use, contact and support forms, IP and links, disclaimers |
| Software License Agreement | `/license` | Clickwrap in the installer, with a link to the privacy policy | Grant, restrictions, anti-piracy, updates, warranty and liability, termination, governing law. Schedule per product: PinchPDF (Individual and Business seats, device moves, free trial, telemetry), NoDupe |
| Purchase and refund terms | A short section or page that links to Dodo Payments' and Lemon Squeezy's buyer terms | At checkout, with the provider | Who sells, refunds, statutory consumer rights |
| Index | `/legal` | n/a | Lists every document with its last-updated date |

Precedence: product schedule over master license agreement over website terms. The privacy policy stands alone.

## Where today's text goes

Today `/terms` (22 sections) mixes website terms, the license, purchase terms and the trial. Section numbers are those of the current page.

| Current `/terms` section | Goes to |
|---|---|
| 1 Acceptance, 2 Definitions | Split: each document gets its own short acceptance and definitions |
| 3 Eligibility and export compliance | License agreement (and a line in the website terms) |
| 4 License grant, 5 Restrictions, 6 Anti-piracy | License agreement |
| 7.1 Free trial | PinchPDF schedule, together with the trial terms (`app/pinchpdf/legal/versions.ts`) |
| 7.2 Purchases through Dodo Payments and Lemon Squeezy, 7.3 No refunds, 7.4 Statutory consumer rights | Purchase and refund terms |
| 8 Updates, 9 Your files and data, 10.3 Your files and content | License agreement |
| 10.1 to 10.2, 10.4 IP, trademarks, complaints | Website terms (complaints channel also referenced from the license agreement) |
| 10.5 Enforcement | License agreement |
| 11 Security (vulnerability disclosure) | Website terms |
| 12 Feedback, 13 Third-party components, 14 App store terms | License agreement |
| 15 Termination, 16 Disclaimer, 17 Liability, 18 Indemnification | License agreement (a shorter disclaimer and liability clause in the website terms) |
| 19 Governing law, 20 Changes, 21 General, 22 Contact | Each document keeps its own |

Privacy: the PinchPDF trial notice (`/pinchpdf/legal/privacy`) folds into section 2.6 of `/privacy`. Until it does, the two documents say which controls.

## Needs new wording (counsel)

- Website Terms of Use (short).
- Software License Agreement schedules: PinchPDF Individual and Business seats and device moves; NoDupe.
- A telemetry paragraph for the privacy policy and the app's consent text. The current text says licensed users send nothing to a server; telemetry from licensed installs makes that untrue.
- A retention period and purge for telemetry, and server-side consent evidence (see the README, "Privacy and legal status").
- A decision on the 18+ age statement, the consent model for device identifiers, and processor terms for Business customers.

## Rules once it is in place

- Stable addresses always show the latest text. Each page shows "last updated" and a short summary of material changes.
- Keep a private dated archive of every published text outside the site. The server records which effective date a user accepted; the archive is what proves what that text said.
- Notify existing users of material changes (email or in the app). Adverse changes apply going forward.
- Update `/legal`, the sitemap, the Health check probes and `docs/legal/STRUCTURE.md` together when a document is added or renamed.
