import siteData from '../../data/site.json';
import type { SiteConfig } from '../../types';
import styles from './ConstitutionTab.module.css';

const site = siteData as SiteConfig;

export default function ConstitutionTab() {
  const url = site.constitutionUrl?.trim();

  if (!url) {
    return (
      <p className={styles.placeholder}>קישור לתקנון לא הוגדר עדיין</p>
    );
  }

  return (
    <iframe
      src={url}
      title="תקנון המפלגה"
      className={styles.iframe}
    />
  );
}
