import type { PrimariesCycle } from '../types';
import primariesData from '../data/primaries.json';
import CandidateCard from './CandidateCard';
import styles from './PrimariesSection.module.css';

const cycles = primariesData as PrimariesCycle[];
const currentCycle = cycles.find((c) => c.current) ?? null;

export default function PrimariesSection() {
  return (
    <section id="primaries" className="section">
      <h2 className="section-title">המלצות לפריימריז</h2>
      <p className="section-subtitle">המועמדים שאנו ממליצים לתמוך בהם</p>

      {currentCycle === null ? (
        <p className={styles.empty}>אין פריימריז פעילים כרגע</p>
      ) : (
        <>
          <h3 className={styles.cycleName}>{currentCycle.cycle}</h3>
          <div className={styles.grid}>
            {currentCycle.candidates.map((candidate) => (
              <CandidateCard key={candidate.name} candidate={candidate} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
