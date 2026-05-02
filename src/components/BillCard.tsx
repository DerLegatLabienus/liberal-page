import type { Bill } from '../types';
import styles from './BillCard.module.css';

const statusClass: Record<Bill['status'], string> = {
  'בוועדה': 'badge-committee',
  'הצבעה קרובה': 'badge-vote',
  'עבר': 'badge-passed',
  'נדחה': 'badge-rejected',
};

const positionClass: Record<Bill['position'], string> = {
  'תומכים': 'badge-support',
  'מתנגדים': 'badge-oppose',
  'עוקבים': 'badge-monitor',
};

const accentClass: Record<Bill['position'], string> = {
  'תומכים': styles.accentGold,
  'מתנגדים': styles.accentRed,
  'עוקבים': styles.accentGray,
};

interface BillCardProps {
  bill: Bill;
}

export default function BillCard({ bill }: BillCardProps) {
  return (
    <div className={`card ${styles.card} ${accentClass[bill.position]}`}>
      <div className={styles.number}>{bill.number}</div>
      <div className={styles.title}>{bill.title}</div>
      <div className={styles.badges}>
        <span className={`badge ${statusClass[bill.status]}`}>{bill.status}</span>
        <span className={`badge ${positionClass[bill.position]}`}>{bill.position}</span>
      </div>
      <div className={styles.notes}>{bill.notes}</div>
    </div>
  );
}
