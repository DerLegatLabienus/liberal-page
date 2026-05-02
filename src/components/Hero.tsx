import siteData from '../data/site.json';
import type { SiteConfig } from '../types';
import styles from './Hero.module.css';

const site = siteData as SiteConfig;

export default function Hero() {
  return (
    <section className={styles.section}>
      {/* Subtitle label */}
      <p className={styles.subtitle}>{site.cellSubtitle}</p>

      {/* Main headline */}
      <h1 className={styles.headline}>{site.heroHeadline}</h1>

      {/* Tagline */}
      <p className={styles.tagline}>{site.heroTagline}</p>

      {/* CTA button */}
      <button
        className={styles.ctaButton}
        aria-label="הצטרפו לתא"
        onClick={() => document.querySelector('#join')?.scrollIntoView({ behavior: 'smooth' })}
      >
        הצטרפו לתא
      </button>
    </section>
  );
}
