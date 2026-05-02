import billsData from '../data/bills.json';
import type { Bill } from '../types';
import styles from './BillsTracker.module.css';
import BillCard from './BillCard';

const bills = billsData as Bill[];

export default function BillsTracker() {
  return (
    <section id="bills" className="section">
      <h2 className="section-title">מעקב חקיקה</h2>
      <p className="section-subtitle">הצעות חוק שהתא קשור אליהן</p>
      <div className={styles.grid}>
        {bills.map((bill) => (
          <BillCard key={bill.id} bill={bill} />
        ))}
      </div>
    </section>
  );
}
