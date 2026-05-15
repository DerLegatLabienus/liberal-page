import styles from './JoinSection.module.css';

const JOIN_FORMS = {
  newIndividual:   'https://effective-soft.co.il/XZone/pfo?uid=licudliberal',
  newCouple:       'https://effective-soft.co.il/XZone/pfo?uid=licudliberal2',
  groupIndividual: 'https://effective-soft.co.il/XZone/pfo?uid=licudliberal3',
  groupCouple:     'https://effective-soft.co.il/XZone/pfo?uid=licudliberal4',
} as const;

export default function JoinSection() {
  return (
    <section id="join" className={styles.section}>
      <h2 className={styles.heading}>הצטרפו לתא</h2>
      <p className={styles.subtitle}>רוצים להיות חלק מהמהלך?</p>

      <div className={styles.ctaGroup}>
        <div className={styles.ctaBlock}>
          <a
            href={JOIN_FORMS.newIndividual}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.ctaPrimary}
          >
            התפקד לליכוד ולתא ←
          </a>
          <a
            href={JOIN_FORMS.newCouple}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.ctaSecondary}
          >
            הצטרפות זוגית
          </a>
        </div>

        <div className={styles.ctaBlock}>
          <a
            href={JOIN_FORMS.groupIndividual}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.ctaOutlined}
          >
            כבר חבר ליכוד? הצטרף לקבוצה ←
          </a>
          <a
            href={JOIN_FORMS.groupCouple}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.ctaSecondary}
          >
            הצטרפות זוגית
          </a>
        </div>
      </div>
    </section>
  );
}
