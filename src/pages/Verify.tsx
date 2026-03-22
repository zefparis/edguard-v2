import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SelfieCapture } from '../components/SelfieCapture'
import { verifyWorker } from '../services/api'
import { useEdguardStore } from '../store/edguardStore'

type Step = 'identity' | 'selfie' | 'verifying' | 'success' | 'failed'

export function Verify() {
  const nav = useNavigate()
  const { worker, setWorker } = useEdguardStore()
  const [step, setStep] = useState<Step>('identity')
  const [firstName, setFirstName] = useState(worker?.firstName ?? '')
  const [lastName, setLastName] = useState(worker?.lastName ?? '')
  const [result, setResult] = useState<{ similarity: number; firstName: string } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  function handleIdentity(e: React.FormEvent) {
    e.preventDefault()
    if (!firstName || !lastName) return
    setStep('selfie')
  }

  async function handleSelfie(b64: string) {
    setStep('verifying')
    try {
      const res = await verifyWorker({ selfie_b64: b64, first_name: firstName, last_name: lastName })
      if (res.verified) {
        setResult({ similarity: Math.round(res.similarity), firstName: res.first_name })

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
        setResult({ similarity: Math.round(res.similarity), firstName })
        setStep('failed')
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Verification failed')
      setStep('failed')
    }
  }

  return (
    <div className="page">
      <div className="logo" style={{ cursor: 'pointer' }} onClick={() => nav('/')}>← EDGUARD</div>

      {step === 'identity' && (
        <>
          <div className="badge badge-cyan">Start Exam</div>
          <h1 className="step-title">Identity Verification</h1>
          <p className="step-sub">Enter your name and take a quick selfie.</p>
          <form onSubmit={handleIdentity} style={{ width: '100%' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="field">
                <label>First Name</label>
                <input value={firstName} onChange={e => setFirstName(e.target.value)} required placeholder="Jane" />
              </div>
              <div className="field">
                <label>Last Name</label>
                <input value={lastName} onChange={e => setLastName(e.target.value)} required placeholder="Doe" />
              </div>
            </div>
            <button className="btn btn-primary" type="submit">Continue →</button>
          </form>
        </>
      )}

      {step === 'selfie' && (
        <>
          <div className="badge badge-cyan">Step 2 — Selfie</div>
          <h1 className="step-title">Face Check</h1>
          <p className="step-sub">Look at the camera. This takes 2 seconds.</p>
          <SelfieCapture onCapture={handleSelfie} />
        </>
      )}

      {step === 'verifying' && (
        <>
          <h1 className="step-title">Verifying...</h1>
          <p className="step-sub">Matching your face against registered profile</p>
          <div style={{ marginTop: 40, color: 'var(--accent)', fontSize: 48 }}>⬡</div>
        </>
      )}

      {step === 'success' && (
        <>
          <div className="badge badge-green" style={{ margin: '0 auto 16px' }}>✓ Verified</div>
          <h1 className="step-title">Welcome, {result?.firstName}</h1>
          <p className="step-sub">Starting exam session...</p>
          <div className="card" style={{ width: '100%', marginTop: 16 }}>
            <div className="metric-row">
              <span className="metric-label">Similarity</span>
              <span className="metric-value">{result?.similarity}%</span>
            </div>
          </div>
        </>
      )}

      {step === 'failed' && (
        <>
          <div className="badge" style={{ background:'rgba(239,68,68,0.12)', color:'var(--red)', border:'1px solid rgba(239,68,68,0.25)', margin:'0 auto 16px' }}>
            Not Verified
          </div>
          <h1 className="step-title">Identity Not Verified</h1>
          <p className="step-sub">{errorMsg || `Similarity: ${result?.similarity ?? 0}%`}</p>
          <div style={{ display: 'flex', gap: 12, width: '100%', marginTop: 20 }}>
            <button className="btn btn-outline" onClick={() => setStep('selfie')}>Try Again</button>
            <button className="btn btn-outline" onClick={() => nav('/')}>Cancel</button>
          </div>
        </>
      )}
    </div>
  )
}
