import siteData from '../data/site.json';
import type { SiteConfig } from '../types';

const site = siteData as SiteConfig;

export default function Hero() {
  return (
    <section
      style={{
        width: '100%',
        background: 'linear-gradient(135deg, var(--color-navy) 0%, #253660 100%)',
        borderBottom: '1px solid rgba(200, 168, 75, 0.3)',
        padding: '3rem 2rem',
        textAlign: 'center',
      }}
    >
      {/* Subtitle label */}
      <p
        style={{
          color: 'var(--color-gold)',
          fontSize: '0.8rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          marginBottom: '0.75rem',
        }}
      >
        {site.cellSubtitle}
      </p>

      {/* Main headline */}
      <h1
        style={{
          color: '#ffffff',
          fontFamily: "'David Libre', Georgia, serif",
          fontSize: 'clamp(1.8rem, 4vw, 2.75rem)',
          fontWeight: 700,
          lineHeight: 1.2,
          marginBottom: '0.75rem',
        }}
      >
        {site.heroHeadline}
      </h1>

      {/* Tagline */}
      <p
        style={{
          color: '#99aacc',
          fontSize: '1rem',
          lineHeight: 1.6,
          maxWidth: '540px',
          margin: '0 auto 2rem',
        }}
      >
        {site.heroTagline}
      </p>

      {/* CTA button */}
      <button
        onClick={() => document.querySelector('#join')?.scrollIntoView({ behavior: 'smooth' })}
        style={{
          background: 'var(--color-navy)',
          color: 'var(--color-gold)',
          border: '1px solid var(--color-gold)',
          borderRadius: '4px',
          padding: '0.6rem 1.75rem',
          fontSize: '1rem',
          fontWeight: 700,
          cursor: 'pointer',
          transition: 'background 0.15s, color 0.15s',
        }}
        onMouseEnter={(e) => {
          const btn = e.currentTarget as HTMLButtonElement;
          btn.style.background = 'var(--color-gold)';
          btn.style.color = 'var(--color-navy)';
        }}
        onMouseLeave={(e) => {
          const btn = e.currentTarget as HTMLButtonElement;
          btn.style.background = 'var(--color-navy)';
          btn.style.color = 'var(--color-gold)';
        }}
      >
        הצטרפו לתא
      </button>
    </section>
  );
}
