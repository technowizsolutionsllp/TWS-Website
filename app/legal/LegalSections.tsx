import { contactEmail } from '../company-data';
import type { LegalVersion } from '../pinchpdf/legal/versions';

// Renders a text from app/pinchpdf/legal/versions.ts inside a larger page, so the trial notice and
// trial terms have one source and one place on the site. Section ids are prefixed to stay unique.

export default function LegalSections({ document, idPrefix, level = 3 }: { document: LegalVersion; idPrefix: string; level?: 3 | 4 }) {
  const Heading = `h${level}` as 'h3' | 'h4';
  return (
    <>
      {document.sections.map((section, index) => (
        <div key={section.id} id={`${idPrefix}-${section.id}`}>
          <Heading>
            {index + 1}. {section.heading}
          </Heading>
          {section.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {section.id === 'contact' ? (
            <p>
              <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
            </p>
          ) : null}
        </div>
      ))}
    </>
  );
}
