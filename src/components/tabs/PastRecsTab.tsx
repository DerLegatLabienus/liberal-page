import primariesData from '../../data/primaries.json';
import type { PrimariesCycle } from '../../types';
import styles from './PastRecsTab.module.css';

const allCycles = primariesData as PrimariesCycle[];
const pastCycles = allCycles.filter((c) => c.current === false);

export default function PastRecsTab() {
  if (pastCycles.length === 0) {
    return <p className={styles.empty}>אין המלצות עבר להציג</p>;
  }

  return (
    <div className={styles.container}>
      {pastCycles.map((cycle, idx) => (
        <div key={cycle.cycle} className={styles.cycle}>
          <h3 className={styles.cycleHeading}>{cycle.cycle}</h3>
          <ul className={styles.candidateList}>
            {cycle.candidates.map((candidate, ci) => (
              <li key={ci} className={styles.candidateItem}>
                <span className={styles.candidateName}>{candidate.name}</span>
                <span className={styles.candidateRole}>{candidate.role}</span>
              </li>
            ))}
          </ul>
          {idx < pastCycles.length - 1 && <hr className={styles.divider} />}
        </div>
      ))}
    </div>
  );
}
