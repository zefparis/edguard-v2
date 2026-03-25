import { useNavigate } from 'react-router-dom'
import { InstallAppCard } from '../components/InstallAppCard'

export function Home() {
  const nav = useNavigate()

  const stats = [
    { value: '2 entry flows', label: 'Enroll or verify' },
    { value: 'Live', label: 'Selfie-led access checks' },
    { value: '6 layers', label: 'Identity + cognitive stack' },
    { value: 'Secure', label: 'Post-quantum signed output' },
  ]

  const sideCards = [
    {
      title: 'Enrollment baseline',
      body: 'Create the academic identity profile with student details, facial reference, cognitive baseline, vocal imprint, and behavioral capture.',
    },
    {
      title: 'Exam entry',
      body: 'Run a quick verification before session access so the learner enters the exam with a trusted live identity check.',
    },
    {
      title: 'Continuous trust',
      body: 'After verification, the exam session keeps monitoring trust through periodic identity and behavior checkpoints.',
    },
  ]

  return (
    <div className="app-shell">
      <div className="shell-inner">
        <div className="hero-panel">
          <div className="eyebrow">Academic identity protection</div>

          <div className="hero-mark">
            <svg width="42" height="42" viewBox="0 0 28 28" aria-hidden="true">
              <polygon points="14,2 26,8 26,20 14,26 2,20 2,8" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="14" cy="14" r="4" fill="currentColor" opacity="0.38" />
            </svg>
            <span>EDGUARD</span>
          </div>

          <h1 className="headline-xl">
            Protect exam identity
            <br />
            <span>from entry to session.</span>
          </h1>

          <p className="hero-copy">
            EdGuard secures online exams with identity enrollment, live verification, cognitive baselines, behavioral telemetry, and post-quantum signed trust signals.
          </p>

          <div className="stats-grid">
            {stats.map((item) => (
              <div key={item.label} className="stat-card">
                <div className="stat-value">{item.value}</div>
                <div className="stat-label">{item.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="content-grid">
          <div className="surface-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div className="info-kicker">Main flows</div>
                <div style={{ marginTop: 6, fontSize: '1.5rem', fontWeight: 800, lineHeight: 1.1 }}>Choose how the learner enters EdGuard</div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--grey)' }}>
                Real module
              </div>
            </div>

            <div className="section-rule" />

            <div style={{ display: 'grid', gap: 16 }}>
              <div className="card" style={{ background: 'rgba(3,7,18,0.52)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' }} onClick={() => nav('/enroll')}>
                <div className="badge badge-cyan">First time</div>
                <h2 style={{ fontSize: 22, marginBottom: 8 }}>Enroll a student profile</h2>
                <p style={{ fontSize: 14, color: 'var(--grey)', lineHeight: 1.7 }}>
                  Capture identity details, face reference, vocal imprint, reflex checks, and behavioral signals before the exam day.
                </p>
                <button className="btn btn-primary" style={{ marginTop: 20 }}>
                  Start enrollment →
                </button>
              </div>

              <div className="card" style={{ background: 'rgba(3,7,18,0.52)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' }} onClick={() => nav('/verify')}>
                <div className="badge badge-green">Exam access</div>
                <h2 style={{ fontSize: 22, marginBottom: 8 }}>Verify before session</h2>
                <p style={{ fontSize: 14, color: 'var(--grey)', lineHeight: 1.7 }}>
                  Ask the learner for a live selfie and confirm the enrolled identity before opening the monitored exam session.
                </p>
                <button className="btn btn-success" style={{ marginTop: 20 }}>
                  Start verification →
                </button>
              </div>
            </div>
          </div>

          <div className="side-stack">
            {sideCards.map((card) => (
              <div key={card.title} className="info-card">
                <div className="info-kicker">{card.title}</div>
                <div className="info-body">{card.body}</div>
              </div>
            ))}

            <InstallAppCard appName="EdGuard" badgeClassName="badge badge-cyan" />
          </div>
        </div>
      </div>
    </div>
  )
}
