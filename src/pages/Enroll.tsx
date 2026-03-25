import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { SelfieCapture } from '../components/SelfieCapture'
import { StroopTest } from '../components/StroopTest'
import { NeuralReflex } from '../components/NeuralReflex'
import { VocalImprint } from '../components/VocalImprint'
import { ReactionTime } from '../components/ReactionTime'
import { BehavioralCapture } from '../components/BehavioralCapture'
import type { BehavioralController, BehavioralProfile } from '../hooks/useBehavioral'
import { useEdguardStore } from '../store/edguardStore'
import { enrollWorker } from '../services/api'
import { generateSessionKeypair, PQ_ALGORITHM, signProfile } from '../services/postQuantum'
import { behavioralCollector, faceCollector, signalBus } from '../signal-engine'
import type { CognitiveBaseline } from '../types'

type Step = 'identity' | 'selfie' | 'stroop' | 'reflex' | 'vocal' | 'reaction' | 'submitting' | 'success' | 'error'

const PROGRESS: Record<Step, number> = {
  identity:10, selfie:25, stroop:45, reflex:60, vocal:75, reaction:88, submitting:95, success:100, error:0
}

type IdentityFormState = {
  firstName: string
  lastName: string
  studentId: string
  institution: string
  email: string
  program: string
}

type IdentityFormProps = {
  form: IdentityFormState
  onSubmit: (e: FormEvent) => void
  onFirstNameChange: (e: ChangeEvent<HTMLInputElement>) => void
  onLastNameChange: (e: ChangeEvent<HTMLInputElement>) => void
  onStudentIdChange: (e: ChangeEvent<HTMLInputElement>) => void
  onInstitutionChange: (e: ChangeEvent<HTMLInputElement>) => void
  onEmailChange: (e: ChangeEvent<HTMLInputElement>) => void
  onProgramChange: (e: ChangeEvent<HTMLInputElement>) => void
}

const IdentityForm = memo(function IdentityForm({
  form,
  onSubmit,
  onFirstNameChange,
  onLastNameChange,
  onStudentIdChange,
  onInstitutionChange,
  onEmailChange,
  onProgramChange,
}: IdentityFormProps) {
  return (
    <>
      <div className="badge badge-cyan">Step 1 of 6 — Identity</div>
      <h1 className="step-title">Student Registration</h1>
      <p className="step-sub">Fill in your academic identity. This will protect your exams.</p>
      <form onSubmit={onSubmit} style={{ width: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <div className="field">
            <label>First Name *</label>
            <input value={form.firstName} onChange={onFirstNameChange} required placeholder="John" />
          </div>
          <div className="field">
            <label>Last Name *</label>
            <input value={form.lastName} onChange={onLastNameChange} required placeholder="Smith" />
          </div>
        </div>
        <div className="field">
          <label>Student ID (optional)</label>
          <input value={form.studentId} onChange={onStudentIdChange} placeholder="STU-001" />
        </div>
        <div className="field">
          <label>Institution *</label>
          <input value={form.institution} onChange={onInstitutionChange} required placeholder="University of Cape Town" />
        </div>
        <div className="field">
          <label>Program / Course *</label>
          <input value={form.program} onChange={onProgramChange} required placeholder="Computer Science — CS101" />
        </div>
        <div className="field">
          <label>Email (optional)</label>
          <input value={form.email} onChange={onEmailChange} placeholder="your email (optional)" type="email" />
        </div>
        <button className="btn btn-primary" type="submit">
          Continue →
        </button>
      </form>
    </>
  )
})

export function Enroll() {
  const nav = useNavigate()
  const { setWorker, setSelfie, setCognitive } = useEdguardStore()

  useEffect(() => {
    behavioralCollector.start()

    return () => {
      behavioralCollector.stop()
    }
  }, [])

  const [step, setStep] = useState<Step>('identity')
  const [selfieB64, setSelfieB64] = useState('')
  const [cognitive, setCog] = useState<Partial<CognitiveBaseline>>({})
  const [errorMsg, setErrorMsg] = useState('')
  const [workerId, setWorkerId] = useState('')
  const [confidence, setConf] = useState(0)

  useEffect(() => {
    if (step === 'selfie') {
      signalBus.pause()

      return () => {
        signalBus.resume()
      }
    }

    signalBus.resume()
  }, [step])

  const behavioralCtrlRef = useRef<BehavioralController | null>(null)
  const [behavioralProfile, setBehavioralProfile] = useState<BehavioralProfile | null>(null)
  const [pqPublicKey, setPqPublicKey] = useState<string | null>(null)
  const [pqSignature, setPqSignature] = useState<string | null>(null)

  const deviceType = useMemo(() => behavioralProfile?.device.device_type ?? 'unknown', [behavioralProfile])

  const behavioralCaptured = useMemo(() => Boolean(behavioralProfile), [behavioralProfile])
  const pqCaptured = useMemo(() => Boolean(pqPublicKey && pqSignature), [pqPublicKey, pqSignature])

  const stats = [
    { value: '6 steps', label: 'Identity baseline' },
    { value: step === 'success' ? 'Ready' : step === 'submitting' ? 'Syncing' : 'In progress', label: 'Enrollment status' },
    { value: behavioralCaptured ? 'Captured' : 'Pending', label: 'Behavioral layer' },
    { value: pqCaptured ? 'Signed' : 'Pending', label: 'Post-quantum proof' },
  ]

  const sideCards = [
    {
      title: 'Identity record',
      body: 'Collect the learner identity, institution, and program metadata before any biometric capture begins.',
    },
    {
      title: 'Biometric baseline',
      body: 'Face, vocal, reflex, and reaction checkpoints create the baseline used later during exam verification and monitoring.',
    },
    {
      title: 'Trust packaging',
      body: 'Behavioral telemetry and post-quantum signing strengthen the stored EdGuard profile before the first session.',
    },
  ]

  const [form, setForm] = useState<IdentityFormState>({
    firstName: '',
    lastName: '',
    studentId: '',
    institution: '',
    email: '',
    program: '',
  })

  const handleFirstNameChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setForm(f => ({ ...f, firstName: e.target.value }))
  }, [])

  const handleLastNameChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setForm(f => ({ ...f, lastName: e.target.value }))
  }, [])

  const handleStudentIdChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setForm(f => ({ ...f, studentId: e.target.value }))
  }, [])

  const handleInstitutionChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setForm(f => ({ ...f, institution: e.target.value }))
  }, [])

  const handleEmailChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setForm(f => ({ ...f, email: e.target.value }))
  }, [])

  const handleProgramChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setForm(f => ({ ...f, program: e.target.value }))
  }, [])

  const handleIdentity = useCallback((e: FormEvent) => {
    e.preventDefault()
    if (!form.firstName || !form.lastName || !form.institution || !form.program) return
    setStep('selfie')
  }, [form.firstName, form.institution, form.lastName, form.program])

  function handleSelfie(b64: string) {
    faceCollector.capture(b64)
    setSelfieB64(b64)
    setTimeout(() => setStep('stroop'), 600)
  }

  function handleStroop(score: number) {
    setCog(c => ({ ...c, stroopScore: score }))
    setStep('reflex')
  }

  function handleReflex(ms: number) {
    setCog(c => ({ ...c, reflexVelocityMs: ms }))
    setStep('vocal')
  }

  function handleVocal(result: { embedding: number[]; quality: number; threshold: number }) {
    // Store voice biometrics locally
    setCog(c => ({
      ...c,
      vocalAccuracy: Math.round(result.quality * 100),
      vocalEmbedding: result.embedding,
      vocalQuality: result.quality,
      vocalSimilarityThreshold: result.threshold,
    }))
    setStep('reaction')
  }

  const onBehavioralController = useCallback((controller: BehavioralController) => {
    behavioralCtrlRef.current = controller
  }, [])

  async function handleReaction(ms: number) {
    const final: CognitiveBaseline = {
      stroopScore: cognitive.stroopScore ?? 0,
      reflexVelocityMs: cognitive.reflexVelocityMs ?? 0,
      vocalAccuracy: cognitive.vocalAccuracy ?? 0,
      vocalEmbedding: cognitive.vocalEmbedding,
      vocalQuality: cognitive.vocalQuality,
      vocalSimilarityThreshold: cognitive.vocalSimilarityThreshold ?? 0.75,
      reactionTimeMs: ms,
    }
    setCog(final)
    setStep('submitting')

    try {
      // Stop behavioral capture and finalize profile right before submit
      const behavioral = behavioralCtrlRef.current?.stop()
      if (behavioral) setBehavioralProfile(behavioral)

      const cognitiveBaseline = {
        stroop_score: final.stroopScore / 100,
        reflex_velocity_ms: final.reflexVelocityMs,
        vocal_accuracy: final.vocalAccuracy / 100,
        reaction_time_ms: final.reactionTimeMs,
        // New voice biometrics payload (stored in Supabase)
        // -- ALTER TABLE edguard_enrollments
        // -- ADD COLUMN IF NOT EXISTS vocal_embedding JSONB;
        // -- ADD COLUMN IF NOT EXISTS vocal_quality FLOAT;
        vocal_embedding: final.vocalEmbedding,
        vocal_quality: final.vocalQuality,
        vocal_similarity_threshold: final.vocalSimilarityThreshold,
        // New behavioral + post-quantum layers
        // -- ALTER TABLE edguard_enrollments
        // -- ADD COLUMN IF NOT EXISTS behavioral_profile JSONB;
        // -- ADD COLUMN IF NOT EXISTS pq_public_key TEXT;
        // -- ADD COLUMN IF NOT EXISTS pq_signature TEXT;
        behavioral,
      }

      const { publicKey: pq_public_key, privateKey } = generateSessionKeypair()
      const pq_signature = signProfile(cognitiveBaseline, privateKey)
      setPqPublicKey(pq_public_key)
      setPqSignature(pq_signature)

      const payloadBaseline = {
        ...cognitiveBaseline,
        pq_public_key,
        pq_signature,
        pq_algorithm: PQ_ALGORITHM,
      }

      const res = await enrollWorker({
        selfie_b64: selfieB64,
        first_name: form.firstName,
        last_name: form.lastName,
        email: form.email || `${form.firstName}.${form.lastName}@edguard.local`,
        tenant_id: import.meta.env.VITE_TENANT_ID,
        cognitive_baseline: payloadBaseline,
      })
      setWorkerId(res.student_id)
      setConf(Math.round(res.confidence))
      setWorker({
        workerId: res.student_id,
        firstName: form.firstName,
        lastName: form.lastName,
        employeeId: form.studentId,
        jobRole: form.program,
        employerSite: form.institution,
        tenantId: import.meta.env.VITE_TENANT_ID,
        cognitiveBaseline: final,
      })
      setSelfie(selfieB64)
      setCognitive(final)
      setStep('success')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Enrollment failed')
      setStep('error')
    }
  }

  return (
    <BehavioralCapture enabled={step !== 'identity'} onController={onBehavioralController}>
      <div className="app-shell">
        <div className="shell-inner">
          <div className="hero-panel">
            <div className="eyebrow">Enrollment baseline</div>

            <div className="hero-mark">
              <svg width="42" height="42" viewBox="0 0 28 28" aria-hidden="true">
                <polygon points="14,2 26,8 26,20 14,26 2,20 2,8" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="14" cy="14" r="4" fill="currentColor" opacity="0.38" />
              </svg>
              <span>EDGUARD ENROLL</span>
            </div>

            <h1 className="headline-xl">
              Register the learner
              <br />
              <span>before the exam session.</span>
            </h1>

            <p className="hero-copy">
              Build the EdGuard identity baseline with academic details, live face capture, cognitive signals, behavioral telemetry, and post-quantum signing.
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
                  <div className="info-kicker">Enrollment flow</div>
                  <div style={{ marginTop: 6, fontSize: '1.5rem', fontWeight: 800, lineHeight: 1.1 }}>
                    {step === 'identity' ? 'Student identity' : step === 'selfie' ? 'Face registration' : step === 'stroop' ? 'Stroop baseline' : step === 'reflex' ? 'Neural reflex baseline' : step === 'vocal' ? 'Vocal imprint' : step === 'reaction' ? 'Reaction timing' : step === 'submitting' ? 'Submitting profile' : step === 'success' ? 'Enrollment complete' : 'Enrollment issue'}
                  </div>
                </div>
                <button className="btn btn-outline" style={{ width: 'auto', minWidth: 120 }} onClick={() => nav('/')}>
                  Back
                </button>
              </div>

              <div className="section-rule" />

              <div className="progress-bar" style={{ width: '100%', marginBottom: 24 }}>
                <div className="progress-fill" style={{ width: `${PROGRESS[step]}%` }} />
              </div>

              {step === 'identity' && (
                <IdentityForm
                  form={form}
                  onSubmit={handleIdentity}
                  onFirstNameChange={handleFirstNameChange}
                  onLastNameChange={handleLastNameChange}
                  onStudentIdChange={handleStudentIdChange}
                  onInstitutionChange={handleInstitutionChange}
                  onEmailChange={handleEmailChange}
                  onProgramChange={handleProgramChange}
                />
              )}

              {step === 'selfie' && (
              <>
                <div className="badge badge-cyan">Step 2 of 6 — Biometric</div>
                <h1 className="step-title">Face Registration</h1>
                <p className="step-sub">Look directly at the camera and capture the learner reference selfie.</p>
                <SelfieCapture onCapture={handleSelfie} />
              </>
              )}

              {step === 'stroop' && (
              <>
                <div className="badge badge-amber">Step 3 of 6 — Cognitive</div>
                <h1 className="step-title">Stroop Test</h1>
                <StroopTest onComplete={handleStroop} />
              </>
              )}

              {step === 'reflex' && (
              <>
                <div className="badge badge-amber">Step 4 of 6 — Cognitive</div>
                <h1 className="step-title">Neural Reflex</h1>
                <NeuralReflex onComplete={handleReflex} />
              </>
              )}

              {step === 'vocal' && (
              <>
                <div className="badge badge-amber">Step 5 of 6 — Cognitive</div>
                <h1 className="step-title">Vocal Imprint</h1>
                <VocalImprint onComplete={handleVocal} />
              </>
              )}

              {step === 'reaction' && (
              <>
                <div className="badge badge-amber">Step 6 of 6 — Cognitive</div>
                <h1 className="step-title">Reaction Time</h1>
                <ReactionTime onComplete={handleReaction} />
              </>
              )}

              {step === 'submitting' && (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <h1 className="step-title">Registering...</h1>
                <p className="step-sub">Creating the biometric profile and packaging the trust layers.</p>
                <div style={{ marginTop: 40, color: 'var(--cyan)', fontSize: 48 }}>⬡</div>
              </div>
              )}

              {step === 'success' && (
              <>
                <div className="badge badge-green" style={{ margin: '0 auto 20px' }}>✓ Registered</div>
                <h1 className="step-title">Identity Registered</h1>
                <p className="step-sub">Welcome, {form.firstName}. The academic identity profile is now active.</p>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
                  <div className="badge badge-cyan" style={{ marginBottom: 0 }}>device: {deviceType}</div>
                  <div className="badge badge-green" style={{ marginBottom: 0 }}>{behavioralCaptured ? 'behavioral captured' : 'behavioral pending'}</div>
                </div>

                <div className="card" style={{ width: '100%', marginTop: 8, background: 'rgba(3,7,18,0.52)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="metric-row">
                    <span className="metric-label">Student ID</span>
                    <span className="metric-value" style={{ fontSize: 11 }}>{workerId.slice(0,12)}...</span>
                  </div>
                  <div className="metric-row">
                    <span className="metric-label">Institution</span>
                    <span className="metric-value">{form.institution}</span>
                  </div>
                  <div className="metric-row">
                    <span className="metric-label">Program / Course</span>
                    <span className="metric-value">{form.program}</span>
                  </div>
                  <div className="metric-row">
                    <span className="metric-label">Name</span>
                    <span className="metric-value">{form.firstName} {form.lastName}</span>
                  </div>
                  <div className="metric-row">
                    <span className="metric-label">Facial confidence</span>
                    <span className="metric-value">{confidence}%</span>
                  </div>
                  <div className="metric-row">
                    <span className="metric-label">Stroop score</span>
                    <span className="metric-value">{cognitive.stroopScore}%</span>
                  </div>
                  <div className="metric-row">
                    <span className="metric-label">Reflex velocity</span>
                    <span className="metric-value">{cognitive.reflexVelocityMs}ms</span>
                  </div>
                  <div className="metric-row">
                    <span className="metric-label">Reaction time</span>
                    <span className="metric-value">{cognitive.reactionTimeMs}ms</span>
                  </div>
                  <div className="metric-row">
                    <span className="metric-label">Vocal quality</span>
                    <span className="metric-value">{typeof cognitive.vocalQuality === 'number' ? `${Math.round(cognitive.vocalQuality * 100)}%` : '—'}</span>
                  </div>
                  <div className="metric-row">
                    <span className="metric-label">Behavioral profile</span>
                    <span className="metric-value">{behavioralCaptured ? 'captured ✓' : 'not captured'}</span>
                  </div>
                  <div className="metric-row">
                    <span className="metric-label">Post-quantum signature</span>
                    <span className="metric-value">{pqCaptured ? `${PQ_ALGORITHM} ✓` : 'not captured'}</span>
                  </div>
                </div>
                <button className="btn btn-success" style={{ marginTop: 20 }} onClick={() => nav('/session')}>
                  Start Exam Session →
                </button>
              </>
            )}

              {step === 'error' && (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <div className="badge" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.25)', margin: '0 auto 20px' }}>
                  Error
                </div>
                <h1 className="step-title">Registration Failed</h1>
                <p className="step-sub">{errorMsg}</p>
                <button className="btn btn-outline" onClick={() => setStep('identity')}>Try Again</button>
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

              <div className="info-card">
                <div className="info-kicker">Live status</div>
                <div className="info-body">
                  Device: {deviceType}
                  <br />
                  Behavioral profile: {behavioralCaptured ? 'captured' : 'pending'}
                  <br />
                  PQ signature: {pqCaptured ? 'ready' : 'pending'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </BehavioralCapture>
  )
}
