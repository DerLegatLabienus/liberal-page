import aboutData from '../../data/about.json';
import type { AboutData } from '../../types';
import styles from './AboutTab.module.css';

const about = aboutData as AboutData;

export default function AboutTab() {
  return (
    <div className={styles.container}>
      <h3 className={styles.sectionHeading}>מי אנחנו</h3>
      {about.paragraphs.map((para, i) => (
        <p key={i} className={styles.paragraph}>{para}</p>
      ))}

      <h3 className={styles.sectionHeading}>הערכים שלנו</h3>
      <ul className={styles.valuesList}>
        {about.values.map((value, i) => (
          <li key={i} className={styles.valueItem}>{value}</li>
        ))}
      </ul>
    </div>
  );
}
