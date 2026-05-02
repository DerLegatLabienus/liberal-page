import siteData from '../data/site.json';
import type { SiteConfig } from '../types';
import styles from './JoinSection.module.css';

const site = siteData as SiteConfig;

export default function JoinSection() {
  return (
    <section id="join" className={styles.section}>
      <h2 className={styles.heading}>הצטרפו לתא</h2>
      <p className={styles.subtitle}>רוצים להיות חלק מהמהלך? מלאו את הטופס</p>

      {site.joinFormUrl ? (
        <iframe
          src={site.joinFormUrl}
          title="טופס הצטרפות"
          className={styles.iframe}
          allow="*"
          loading="lazy"
        />
      ) : (
        <div className={styles.placeholder}>
          קישור לטופס ההצטרפות לא הוגדר עדיין
        </div>
      )}
    </section>
  );
}
