'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { broadcastMenuOpen, subscribeMenuOpen } from './navMenuBus';

export type MoreMenuItem = {
  label: string;
  path: string;
};

const items: MoreMenuItem[] = [
  { label: 'About', path: '/about' },
  { label: 'Privacy Policy', path: '/privacy' },
  { label: 'Terms of Service', path: '/terms' },
];

const MENU_ID = 'more';

type MoreMenuProps = {
  activePath?: string;
};

export default function MoreMenu({ activePath }: MoreMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  function openMenu() {
    broadcastMenuOpen(MENU_ID);
    setIsOpen(true);
  }

  function closeMenu() {
    setIsOpen(false);
  }

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    const unsubscribe = subscribeMenuOpen((id) => {
      if (id !== MENU_ID) {
        setIsOpen(false);
      }
    });

    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleEscape);

    return () => {
      unsubscribe();
      document.removeEventListener('click', handleDocumentClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return (
    <div
      className={`nav-product-menu ${isOpen ? 'is-open' : ''}`}
      ref={menuRef}
      onMouseEnter={openMenu}
      onMouseLeave={closeMenu}
      onFocus={openMenu}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          closeMenu();
        }
      }}
    >
      <button
        className="nav-menu-button"
        type="button"
        aria-haspopup="true"
        aria-expanded={isOpen}
        onClick={() => {
          setIsOpen((current) => {
            const next = !current;
            if (next) {
              broadcastMenuOpen(MENU_ID);
            }
            return next;
          });
        }}
      >
        More
      </button>
      <div className="nav-submenu" role="menu" aria-label="More">
        {items.map((item) => (
          <Link
            href={item.path}
            key={item.path}
            role="menuitem"
            aria-current={activePath === item.path ? 'page' : undefined}
            onClick={closeMenu}
          >
            <span>{item.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
