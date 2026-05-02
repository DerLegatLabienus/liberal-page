import type { PrimariesCandidate } from '../types';
import styles from './CandidateCard.module.css';

interface CandidateCardProps {
  candidate: PrimariesCandidate;
}

function deriveInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0]?.charAt(0) ?? '';
  const second = words[1]?.charAt(0) ?? '';
  return first + second;
}

export default function CandidateCard({ candidate }: CandidateCardProps) {
  const initials = deriveInitials(candidate.name);

  return (
    <div className={`card ${styles.card}`}>
      <div className={styles.star} aria-hidden="true">★</div>
      <div className={styles.avatar} aria-label={`תמונת ${candidate.name}`}>
        {initials}
      </div>
      <div className={styles.name}>{candidate.name}</div>
      <div className={styles.role}>{candidate.role}</div>
      {candidate.reason && (
        <div className={styles.reason}>{candidate.reason}</div>
      )}
    </div>
  );
}
