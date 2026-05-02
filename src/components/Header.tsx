import { useState } from 'react';
import siteData from '../data/site.json';
import type { SiteConfig } from '../types';

const site = siteData as SiteConfig;

const navItems = [
  { label: 'חקיקה', href: '#bills' },
  { label: 'עדכונים', href: '#updates' },
  { label: 'פריימריז', href: '#primaries' },
  { label: 'פרוטוקולים', href: '#protocols' },
  { label: 'הצטרפו', href: '#join', isAccent: true },
];

export default function Header() {
  const [logoError, setLogoError] = useState(false);

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        width: '100%',
        height: 'var(--header-height)',
        background: 'var(--color-navy)',
        borderBottom: '2px solid var(--color-gold)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 1.5rem',
        boxSizing: 'border-box',
      }}
    >
      {/* Right side: Logo + Party name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
        {logoError ? (
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'var(--color-gold)',
              flexShrink: 0,
            }}
            aria-hidden="true"
          />
        ) : (
          <img
            src={site.logoPath}
            alt={site.partyName}
            width={36}
            height={36}
            style={{ borderRadius: '50%', objectFit: 'contain', flexShrink: 0 }}
            onError={() => setLogoError(true)}
          />
        )}
        <span
          style={{
            color: '#ffffff',
            fontWeight: 700,
            fontFamily: "'David Libre', Georgia, serif",
            fontSize: '1.05rem',
            whiteSpace: 'nowrap',
          }}
        >
          {site.partyName}
        </span>
      </div>

      {/* Left side: Nav links */}
      <nav>
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '1.25rem',
          }}
        >
          {navItems.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                style={{
                  color: item.isAccent ? 'var(--color-gold)' : '#c0c8d8',
                  textDecoration: 'none',
                  fontSize: '0.9rem',
                  fontWeight: item.isAccent ? 700 : 400,
                  transition: 'color 0.15s',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.color = 'var(--color-gold)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.color = item.isAccent
                    ? 'var(--color-gold)'
                    : '#c0c8d8';
                }}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
