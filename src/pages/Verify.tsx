import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SelfieCapture } from '../components/SelfieCapture'
import { verifyWorker } from '../services/api'
import { useEdguardStore } from '../store/edguardStore'
import { behavioralCollector, cognitiveCollector, faceCollector } from '../signal-engine'

type Step = 'identity' | 'selfie' | 'verifying' | 'success' | 'failed'

export function Verify() {
  const nav = useNavigate()
  const { worker, setWorker } = useEdguardStore()

  useEffect(() => {
    behavioralCollector.start()

    return () => {
      behavioralCollector.stop()
    }
  }, [])

  const [step, setStep] = useState<Step>('identity')
  const [firstName, setFirstName] = useState(worker?.firstName ?? '')
  const [lastName, setLastName] = useState(worker?.lastName ?? '')
  const [result, setResult] = useState<{ similarity: number; firstName: string } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const statusCards = [
    { value: '2 steps', label: 'Identity + selfie' },
    { value: 'Live', label: 'Face match check' },
    { value: step === 'success' && result ? `${result.similarity}%` : '--', label: 'Latest similarity' },
    { value: step === 'success' ? 'Granted' : step === 'failed' ? 'Review' : 'Pending', label: 'Access decision' },
  ]

  const sideCards = [
    {
      title: 'Fast gate',
      body: 'The learner verifies identity with a short live selfie before entering the monitored exam session.',
    },
    {
      title: 'Trusted continuity',
      body: 'Once verified, the session uses the same identity context for checkpoints and reporting.',
    },
    {
      title: 'Clear outcome',
      body: 'Similarity score, success state, and next action stay readable on desktop and mobile.',
    },
  ]

  const handleFirstNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFirstName(e.target.value)
  }, [])

  const handleLastNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLastName(e.target.value)
  }, [])

  function handleIdentity(e: React.FormEvent) {
    e.preventDefault()
    if (!firstName || !lastName) return
    setStep('selfie')
  }

  async function handleSelfie(b64: string) {
    faceCollector.capture(b64)
    setStep('verifying')
    const startedAt = performance.now()

    try {
      const res = await verifyWorker({ selfie_b64: b64, first_name: firstName, last_name: lastName })
      const score = Math.round(res.similarity)
      const durationMs = Math.round(performance.now() - startedAt)

      cognitiveCollector.record({
        testId: 'verify',
        score,
        durationMs,
      })

      if (res.verified) {
        setResult({ similarity: score, firstName: res.first_name })

        // Hydrate store with verified student_id (used by /session checkpoints + report)
        setWorker({
          workerId: res.student_id,
          firstName,
          lastName,
          employeeId: worker?.employeeId ?? '',
          employerSite: worker?.employerSite ?? '',
          jobRole: worker?.jobRole ?? '',
          tenantId: worker?.tenantId ?? (import.meta.env.VITE_TENANT_ID as string),
          cognitiveBaseline: worker?.cognitiveBaseline,
          enrolledAt: worker?.enrolledAt,
        })

        setStep('success')
        setTimeout(() => nav('/session'), 600)
      } else {
        setResult({ similarity: score, firstName })
        setStep('failed')
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Verification failed')
      setStep('failed')
    }
  }

  return (
    <div className="app-shell">
      <div className="shell-inner">
        <div className="hero-panel">
          <div className="eyebrow">Verification gateway</div>

          <div className="hero-mark">
            <svg width="42" height="42" viewBox="0 0 28 28" aria-hidden="true">
              <polygon points="14,2 26,8 26,20 14,26 2,20 2,8" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="14" cy="14" r="4" fill="currentColor" opacity="0.38" />
            </svg>
            <span>EDGUARD VERIFY</span>
          </div>

          <h1 className="headline-xl">
            Confirm identity
            <br />
            <span>before exam access.</span>
          </h1>

          <p className="hero-copy">
            Use a quick identity form and a live selfie to match the registered EdGuard profile before the learner enters the active monitored session.
          </p>

          <div className="stats-grid">
            {statusCards.map((item) => (
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
                <div className="info-kicker">Verification flow</div>
                <div style={{ marginTop: 6, fontSize: '1.5rem', fontWeight: 800, lineHeight: 1.1 }}>
                  {step === 'identity' ? 'Identity details' : step === 'selfie' ? 'Live selfie check' : step === 'verifying' ? 'Matching profile' : step === 'success' ? 'Verification complete' : 'Verification issue'}
                </div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--grey)' }}>
                {step === 'identity' ? 'Step 1 / 2' : step === 'selfie' ? 'Step 2 / 2' : 'Result'}
              </div>
            </div>

            <div className="section-rule" />

            {step === 'identity' && (
              <div>
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                  <div className="badge badge-cyan">Start exam</div>
                  <h2 className="step-title">Identity Verification</h2>
                  <p className="step-sub">Enter your name, then continue to the live selfie check.</p>
                </div>

                <form onSubmit={handleIdentity} style={{ width: '100%' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                    <div className="field">
                      <label>First Name</label>
                      <input value={firstName} onChange={handleFirstNameChange} required placeholder="Jane" />
                    </div>
                    <div className="field">
                      <label>Last Name</label>
                      <input value={lastName} onChange={handleLastNameChange} required placeholder="Doe" />
                    </div>
                  </div>
                  <button className="btn btn-primary" type="submit">Continue →</button>
                </form>
              </div>
            )}

            {step === 'selfie' && (
              <div>
                <div style={{ textAlign: 'center', marginBottom: 20 }}>
                  <div className="badge badge-cyan">Step 2 — Selfie</div>
                  <h2 className="step-title">Face Check</h2>
                  <p className="step-sub">Look at the camera and hold steady for the quick identity match.</p>
                </div>
                <SelfieCapture onCapture={handleSelfie} />
              </div>
            )}

            {step === 'verifying' && (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <h2 className="step-title">Verifying...</h2>
                <p className="step-sub">Matching the live selfie against the registered profile.</p>
                <div style={{ marginTop: 32, color: 'var(--accent)', fontSize: 48 }}>⬡</div>
              </div>
            )}

            {step === 'success' && (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <div className="badge badge-green" style={{ margin: '0 auto 16px' }}>✓ Verified</div>
                <h2 className="step-title">Welcome, {result?.firstName}</h2>
                <p className="step-sub">Starting the monitored exam session...</p>
                <div className="card" style={{ width: '100%', marginTop: 16, background: 'rgba(3,7,18,0.52)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="metric-row">
                    <span className="metric-label">Similarity</span>
                    <span className="metric-value">{result?.similarity}%</span>
                  </div>
                </div>
              </div>
            )}

            {step === 'failed' && (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <div className="badge" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.25)', margin: '0 auto 16px' }}>
                  Not Verified
                </div>
                <h2 className="step-title">Identity Not Verified</h2>
                <p className="step-sub">{errorMsg || `Similarity: ${result?.similarity ?? 0}%`}</p>
                <div style={{ display: 'grid', gap: 12, width: '100%', marginTop: 20, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                  <button className="btn btn-outline" onClick={() => setStep('selfie')}>Try Again</button>
                  <button className="btn btn-outline" onClick={() => nav('/')}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          <div className="side-stack">
            {sideCards.map((card) => (
              <div key={card.title} className="info-card">
                <div className="info-kicker">{card.title}</div>
                <div className="info-body">{card.body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
