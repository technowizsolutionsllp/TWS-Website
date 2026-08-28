'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export type ProductNavItem = {
  slug: string;
  path: string;
  name: string;
  category: string;
};

type ProductMenuProps = {
  items: ProductNavItem[];
  activePath?: string;
};

export default function ProductMenu({ items = [], activePath }: ProductMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  function clearCloseTimer() {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function openMenu() {
    clearCloseTimer();
    setIsOpen(true);
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setIsOpen(false);
      closeTimerRef.current = null;
    }, 2800);
  }

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        clearCloseTimer();
        setIsOpen(false);
      }
    }

    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleEscape);

    return () => {
      clearCloseTimer();
      document.removeEventListener('click', handleDocumentClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return (
    <div
      className={`nav-product-menu ${isOpen ? 'is-open' : ''}`}
      ref={menuRef}
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
      onFocus={openMenu}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          scheduleClose();
        }
      }}
    >
      <button
        className="nav-menu-button"
        type="button"
        aria-haspopup="true"
        aria-expanded={isOpen}
        onClick={() => {
          clearCloseTimer();
          setIsOpen((current) => !current);
        }}
      >
        Products
      </button>
      <div className="nav-submenu" role="menu" aria-label="Products">
        {items.map((product) => (
          <Link
            href={product.path}
            key={product.slug}
            role="menuitem"
            aria-current={activePath === product.path ? 'page' : undefined}
            onClick={() => {
              clearCloseTimer();
              setIsOpen(false);
            }}
          >
            <span>{product.name}</span>
            <small>{product.category}</small>
          </Link>
        ))}
      </div>
    </div>
  );
}
