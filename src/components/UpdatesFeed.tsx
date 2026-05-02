import updatesData from '../data/updates.json';
import type { Update } from '../types';
import styles from './UpdatesFeed.module.css';

const updates = updatesData as Update[];

function formatDate(isoDate: string): string {
  const [, month, day] = isoDate.split('-');
  return `${day}/${month}`;
}

export default function UpdatesFeed() {
  return (
    <section id="updates" className="section">
      <h2 className="section-title">עדכונים פנימיים</h2>
      <p className="section-subtitle">מה קורה בתוך המפלגה ואיך זה משפיע עלינו</p>
      <ul className={styles.list}>
        {updates.map((update, index) => (
          <li
            key={update.id}
            className={`${styles.item} ${index < updates.length - 1 ? styles.itemBorder : ''}`}
          >
            <span className={styles.date}>{formatDate(update.date)}</span>
            <div className={styles.textBlock}>
              <p className={styles.title}>{update.title}</p>
              <p className={styles.description}>{update.description}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
