'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export type LegalSection = {
  id: string;
  label: string;
};

type LegalTocProps = {
  sections: LegalSection[];
};

export default function LegalToc({ sections }: LegalTocProps) {
  const [activeId, setActiveId] = useState(sections[0]?.id);

  useEffect(() => {
    const elements = sections
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement => Boolean(element));

    if (elements.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) {
          return;
        }
        const topMost = visible.reduce((closest, entry) =>
          entry.boundingClientRect.top < closest.boundingClientRect.top ? entry : closest,
        );
        setActiveId(topMost.target.id);
      },
      { rootMargin: '-96px 0px -70% 0px', threshold: 0 },
    );

    elements.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav className="legal-toc" aria-label="Table of contents">
      {sections.map((section) => (
        <Link
          key={section.id}
          href={`#${section.id}`}
          className={activeId === section.id ? 'is-active' : undefined}
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}
