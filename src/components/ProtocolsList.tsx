import protocolsData from '../data/protocols.json';
import type { Protocol } from '../types';
import styles from './ProtocolsList.module.css';

const protocols = protocolsData as Protocol[];

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

export default function ProtocolsList() {
  return (
    <section id="protocols" className="section">
      <h2 className="section-title">פרוטוקולים</h2>
      <p className="section-subtitle">תיעוד דיונים ופעילות נציגינו</p>
      <ul className={styles.list}>
        {protocols.map((protocol, index) => (
          <li
            key={protocol.id}
            className={`${styles.row} ${index < protocols.length - 1 ? styles.rowBorder : ''}`}
          >
            <div className={styles.rowMain}>
              <span className={styles.docBadge}>DOC</span>
              <span className={styles.date}>{formatDate(protocol.date)}</span>
              <span className={styles.title}>{protocol.title}</span>
              <span className={styles.attendees}>{protocol.attendees.join(' · ')}</span>
            </div>
            <a href={protocol.fileUrl} download className={styles.downloadLink}>
              ↓ הורדה
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
