import { useNavigate } from 'react-router-dom'

type Card = {
  title: string
  desc: string
  to: string
  cta: string
  accent: string
  badge: string
  icon: JSX.Element
}

const CARDS: Card[] = [
  {
    title: 'Enrol',
    desc: 'First-time registration of a student — capture identity, face, voice and cognitive baseline.',
    to: '/enroll',
    cta: 'Start enrolment →',
    accent: 'rgba(59,130,246,0.45)',
    badge: 'badge badge-cyan',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
      </svg>
    ),
  },
  {
    title: 'Verify for payment',
    desc: 'Quick identity check before releasing a student grant or scholarship payment.',
    to: '/auth-payment',
    cta: 'Authenticate payment →',
    accent: 'rgba(34,197,94,0.45)',
    badge: 'badge badge-green',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M3 10h18" />
        <path d="M7 15h4" />
      </svg>
    ),
  },
  {
    title: 'Exam session',
    desc: 'Verify the learner and open a continuously supervised exam session.',
    to: '/verify',
    cta: 'Open exam check →',
    accent: 'rgba(245,158,11,0.45)',
    badge: 'badge badge-amber',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 5h11l5 5v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
        <path d="M14 5v5h6" />
        <path d="M8 14h8M8 17h5" />
      </svg>
    ),
  },
]

export function Home() {
  const nav = useNavigate()

  return (
    <div className="app-shell">
      <div className="shell-inner" style={{ maxWidth: 760 }}>
        <div className="hero-panel" style={{ padding: '28px 24px' }}>
          <div className="eyebrow">EdGuard — Academic identity shield</div>
          <div className="hero-mark">
            <svg width="36" height="36" viewBox="0 0 28 28" aria-hidden="true">
              <polygon points="14,2 26,8 26,20 14,26 2,20 2,8" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="14" cy="14" r="4" fill="currentColor" opacity="0.38" />
            </svg>
            <span>EDGUARD</span>
          </div>
          <h1 className="headline-xl" style={{ fontSize: '1.9rem' }}>
            Pick a flow
            <br />
            <span>to get started.</span>
          </h1>
        </div>

        <div style={{ display: 'grid', gap: 14, marginTop: 16 }}>
          {CARDS.map((c) => (
            <button
              key={c.to}
              onClick={() => nav(c.to)}
              className="card"
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                background: 'rgba(3,7,18,0.62)',
                border: `1px solid ${c.accent}`,
                padding: '20px 22px',
                display: 'grid',
                gap: 12,
                color: 'inherit',
                font: 'inherit',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    border: `1px solid ${c.accent}`,
                    background: 'rgba(255,255,255,0.04)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    flexShrink: 0,
                  }}
                >
                  {c.icon}
                </div>
                <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                  <div className={c.badge} style={{ width: 'fit-content' }}>{c.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--grey)', lineHeight: 1.6 }}>
                    {c.desc}
                  </div>
                </div>
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#fff',
                  opacity: 0.82,
                }}
              >
                {c.cta}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
