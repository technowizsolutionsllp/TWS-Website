// Serialise structured data for an inline <script type="application/ld+json">.
// Escaping "<" prevents a value containing "</script>" from closing the tag.
export function jsonLd(data: unknown) {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
