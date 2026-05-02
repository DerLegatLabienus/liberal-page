import siteData from '../data/site.json';
import type { SiteConfig } from '../types';
import styles from './Footer.module.css';

const site = siteData as SiteConfig;

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.right}>
        <img
          src={site.logoPath}
          alt={site.partyName}
          className={styles.logo}
        />
        <span className={styles.partyName}>{site.partyName}</span>
      </div>

      <div className={styles.center}>
        <span className={styles.copyright}>© הליברלים בליכוד</span>
      </div>

      <div className={styles.left}>
        {site.contactEmail && (
          <a
            href={`mailto:${site.contactEmail}`}
            className={styles.email}
          >
            {site.contactEmail}
          </a>
        )}
      </div>
    </footer>
  );
}
