import representativesData from '../data/representatives.json';
import type { Representative } from '../types';
import styles from './Representatives.module.css';

const representatives = representativesData as Representative[];

export default function Representatives() {
  return (
    <section id="representatives" className="section">
      <h2 className="section-title">הנציגים שלנו</h2>
      <div className={styles.grid}>
        {representatives.map((rep) => (
          <div key={rep.id} className={`card ${styles.card}`}>
            <div className={styles.avatar}>{rep.initials}</div>
            <p className={styles.name}>{rep.name}</p>
            <p className={styles.role}>{rep.role}</p>
            <p className={styles.committee}>{rep.committee}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
