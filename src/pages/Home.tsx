import { useNavigate } from 'react-router-dom'

export function Home() {
  const nav = useNavigate()
  return (
    <div className="page">
      <div className="logo">⬡ EDGUARD</div>
      <h1 className="step-title" style={{ fontSize: 30, marginBottom: 8 }}>Academic Identity Shield</h1>
      <p className="step-sub">
        Biometric verification for online exams.<br />
        Powered by Hybrid Vector — 3 French patents.
      </p>

      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
        <div className="card" style={{ cursor: 'pointer' }} onClick={() => nav('/enroll')}>
          <div className="badge badge-cyan">First time?</div>
          <h2 style={{ fontSize: 18, marginBottom: 6 }}>Register</h2>
          <p style={{ fontSize: 13, color: 'var(--grey)', lineHeight: 1.6 }}>
            Identity + facial + cognitive + vocal baseline.<br />
            Behavioral capture + post-quantum signature.
          </p>
          <button className="btn btn-primary" style={{ marginTop: 20 }}>
            First time? Register →
          </button>
        </div>

        <div className="card" style={{ cursor: 'pointer' }} onClick={() => nav('/verify')}>
          <div className="badge badge-green">Exam</div>
          <h2 style={{ fontSize: 18, marginBottom: 6 }}>Start Exam</h2>
          <p style={{ fontSize: 13, color: 'var(--grey)', lineHeight: 1.6 }}>
            Already registered? Verify with a selfie.<br />
            Start a continuous exam session.
          </p>
          <button className="btn btn-success" style={{ marginTop: 20 }}>
            Already registered? Start Exam →
          </button>
        </div>
      </div>

      <div style={{ marginTop: 40, display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        {['Facial + Cognitive + Vocal', 'Post-Quantum FIPS 203', '3 French Patents'].map(t => (
          <span key={t} className="badge badge-cyan">{t}</span>
        ))}
      </div>
    </div>
  )
}
