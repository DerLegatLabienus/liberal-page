import { useState } from 'react';
import siteData from '../data/site.json';
import type { SiteConfig } from '../types';
import styles from './Header.module.css';

const site = siteData as SiteConfig;

const navItems = [
  { label: 'חקיקה', href: '#bills' },
  { label: 'נציגים', href: '#representatives' },
  { label: 'עדכונים', href: '#updates' },
  { label: 'פריימריז', href: '#primaries' },
  { label: 'פרוטוקולים', href: '#protocols' },
  { label: 'הצטרפו', href: '#join', isAccent: true },
];

export default function Header() {
  const [logoError, setLogoError] = useState(false);

  return (
    <header className={styles.header}>
      {/* Right side: Logo + Party name */}
      <div className={styles.logoArea}>
        {logoError ? (
          <div className={styles.logoFallback} aria-hidden="true" />
        ) : (
          <img
            src={site.logoPath}
            alt={site.partyName}
            width={36}
            height={36}
            className={styles.logoImg}
            onError={() => setLogoError(true)}
          />
        )}
        <span className={styles.partyName}>{site.partyName}</span>
      </div>

      {/* Left side: Nav links */}
      <nav>
        <ul className={styles.navList}>
          {navItems.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                className={item.isAccent ? styles.navLinkAccent : styles.navLink}
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
