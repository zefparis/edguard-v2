import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { SelfieCapture } from '../components/SelfieCapture'
import { verifyWorker } from '../services/api'
import { BehavioralCapture } from '../components/BehavioralCapture'
import type { BehavioralController, BehavioralProfile } from '../hooks/useBehavioral'
import { openPrintableReport } from '../services/reportGenerator'
import { sendSessionCheckpoint } from '../services/sessionApi'
import { useEdguardStore } from '../store/edguardStore'
import { behavioralCollector, cognitiveCollector, faceCollector, signalBus } from '../signal-engine'

type EventType = 'VERIFIED' | 'WARNING' | 'PRESENT' | 'SUSPICIOUS'

type SessionEvent = {
  at: number
  type: EventType
  message: string
  similarity?: number
}

type Step = 'active' | 'modal-check' | 'suspended'

const CHECK_INTERVAL_MS = 5 * 60 * 1000
const MAX_FAILURES = 3

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`
}

function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${mm}:${String(ss).padStart(2, '0')}`
}

type IdentityCheckModalProps = {
  firstName: string
  lastName: string
  onFirstNameChange: (e: ChangeEvent<HTMLInputElement>) => void
  onLastNameChange: (e: ChangeEvent<HTMLInputElement>) => void
  onCapture: (b64: string) => void
  onSkip: () => void
}

const IdentityCheckModal = memo(function IdentityCheckModal({
  firstName,
  lastName,
  onFirstNameChange,
  onLastNameChange,
  onCapture,
  onSkip,
}: IdentityCheckModalProps) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.78)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
      <div className="surface-card" style={{ width: '100%', maxWidth: 560 }}>
        <div className="badge badge-cyan" style={{ margin: '0 auto 14px' }}>Identity Check</div>
        <h2 style={{ textAlign: 'center', marginBottom: 8 }}>Quick selfie required</h2>
        <p style={{ textAlign: 'center', color: 'var(--grey)', fontSize: 13, marginBottom: 16, lineHeight: 1.7 }}>
          Please take a selfie to continue the exam.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>First Name</label>
            <input value={firstName} onChange={onFirstNameChange} placeholder="Jane" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Last Name</label>
            <input value={lastName} onChange={onLastNameChange} placeholder="Doe" />
          </div>
        </div>
        <SelfieCapture onCapture={onCapture} />
        <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={onSkip}>
          Skip (counts as failure)
        </button>
      </div>
    </div>
  )
})

export function ExamSession() {
  const nav = useNavigate()
  const { worker } = useEdguardStore()

  useEffect(() => {
    behavioralCollector.start()

    return () => {
      behavioralCollector.stop()
    }
  }, [])

  const [step, setStep] = useState<Step>('active')
  const [startedAt] = useState(() => performance.now())
  const [now, setNow] = useState(() => performance.now())

  useEffect(() => {
    if (step === 'modal-check') {
      signalBus.pause()

      return () => {
        signalBus.resume()
      }
    }

    signalBus.resume()
  }, [step])

  const [statusOk, setStatusOk] = useState(true)
  const [failures, setFailures] = useState(0)
  const [checksTotal, setChecksTotal] = useState(0)
  const [checksPassed, setChecksPassed] = useState(0)

  const [events, setEvents] = useState<SessionEvent[]>([])
  const [lastSimilarity, setLastSimilarity] = useState<number | null>(null)

  const [identity, setIdentity] = useState({
    firstName: worker?.firstName ?? '',
    lastName: worker?.lastName ?? '',
  })

  const nextCheckAtRef = useRef<number>(performance.now() + CHECK_INTERVAL_MS)
  const checkpointNumberRef = useRef(1)
  const sessionIdRef = useRef<string>(
    // lightweight session id
    `sess_${Math.random().toString(16).slice(2)}_${Date.now()}`
  )

  const behavioralCtrlRef = useRef<BehavioralController | null>(null)
  const [behavioralProfile, setBehavioralProfile] = useState<BehavioralProfile | null>(null)

  const suspiciousCountRef = useRef(0)

  const elapsedMs = now - startedAt
  const nextCheckInMs = nextCheckAtRef.current - now

  const behavioralScore = useMemo(() => {
    // Simple heuristic: score decreases with suspicious events.
    const base = 1
    const penalty = Math.min(0.8, suspiciousCountRef.current * 0.15)
    return Math.max(0, base - penalty)
  }, [now])

  const behavioralLevel = useMemo<'normal' | 'suspicious'>(() => {
    return behavioralScore >= 0.7 ? 'normal' : 'suspicious'
  }, [behavioralScore])

  const summaryCards = [
    { value: formatElapsed(elapsedMs), label: 'Elapsed' },
    { value: formatCountdown(nextCheckInMs), label: 'Next check' },
    { value: `${checksPassed}/${checksTotal}`, label: 'Checks passed' },
    { value: `${Math.round(behavioralScore * 100)}%`, label: 'Behavioral score' },
  ]

  const sideCards = [
    {
      title: 'Continuous supervision',
      body: 'EdGuard pauses the session at intervals to request a fresh selfie and confirm the active learner remains present.',
    },
    {
      title: 'Behavioral telemetry',
      body: 'Focus changes, visibility loss, and suspicious shortcuts contribute to the behavioral trust score during the session.',
    },
    {
      title: 'Session evidence',
      body: 'Every checkpoint can be reported with timing, result, and final printable output for review or escalation.',
    },
  ]

  const addEvent = useCallback((e: Omit<SessionEvent, 'at'>) => {
    setEvents(prev => [{ ...e, at: Date.now() }, ...prev].slice(0, 5))
  }, [])

  const onBehavioralController = useCallback((ctrl: BehavioralController) => {
    behavioralCtrlRef.current = ctrl
  }, [])

  const handleIdentityFirstNameChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setIdentity(v => ({ ...v, firstName: e.target.value }))
  }, [])

  const handleIdentityLastNameChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setIdentity(v => ({ ...v, lastName: e.target.value }))
  }, [])

  const handleSkipModalCheck = useCallback(() => {
    setFailures(f => f + 1)
    nextCheckAtRef.current = performance.now() + 60_000
    setStep('active')
  }, [])

  // tick clock
  useEffect(() => {
    if (step === 'modal-check') return

    const t = window.setInterval(() => setNow(performance.now()), 250)
    return () => window.clearInterval(t)
  }, [step])

  // suspicious monitoring
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') {
        suspiciousCountRef.current += 1
        addEvent({ type: 'SUSPICIOUS', message: 'Tab switched / window hidden' })
        setStatusOk(false)
      }
    }
    const onBlur = () => {
      suspiciousCountRef.current += 1
      addEvent({ type: 'SUSPICIOUS', message: 'Window lost focus' })
      setStatusOk(false)
    }
    const onKeydown = (e: KeyboardEvent) => {
      // Detect common shortcut attempts (copy/paste, devtools)
      const key = e.key.toLowerCase()
      const isCtrl = e.ctrlKey || e.metaKey
      const suspicious =
        (isCtrl && ['c', 'v', 'x', 'p', 's', 'u'].includes(key)) ||
        (e.key === 'F12')
      if (suspicious) {
        suspiciousCountRef.current += 1
        addEvent({ type: 'SUSPICIOUS', message: `Shortcut attempt: ${e.key}` })
        setStatusOk(false)
      }
    }

    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKeydown)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onKeydown)
    }
  }, [addEvent])

  // periodic checks
  useEffect(() => {
    if (step !== 'active') return
    if (now >= nextCheckAtRef.current) {
      setStep('modal-check')
    }
  }, [now, step])

  async function persistCheckpoint(eventType: EventType, face_b64: string) {
    try {
      await sendSessionCheckpoint({
        student_id: worker?.workerId ?? 'unknown',
        session_id: sessionIdRef.current,
        checkpoint_number: checkpointNumberRef.current,
        face_b64,
        event_type: eventType,
        behavioral_score: behavioralScore,
      })
    } catch {
      // best-effort
    } finally {
      checkpointNumberRef.current += 1
    }
  }

  const handlePresence = useCallback(() => {
    addEvent({ type: 'PRESENT', message: "Manual presence confirmation (I'm here)" })
    setStatusOk(true)
  }, [addEvent])

  async function handleCheckSelfie(b64: string) {
    faceCollector.capture(b64)
    setChecksTotal(n => n + 1)
    const startedAt = performance.now()

    try {
      const res = await verifyWorker({ selfie_b64: b64, first_name: identity.firstName, last_name: identity.lastName })
      const sim = Math.round(res.similarity)
      const durationMs = Math.round(performance.now() - startedAt)

      cognitiveCollector.record({
        testId: 'exam',
        score: sim,
        durationMs,
      })

      setLastSimilarity(sim)

      if (res.verified) {
        setChecksPassed(n => n + 1)
        addEvent({ type: 'VERIFIED', message: `Verified at ${new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}`, similarity: sim })
        setStatusOk(true)
        setFailures(0)
        await persistCheckpoint('VERIFIED', b64)
      } else {
        addEvent({ type: 'WARNING', message: `WARNING: verification failed (${sim}%)`, similarity: sim })
        setStatusOk(false)
        setFailures(f => f + 1)
        await persistCheckpoint('WARNING', b64)
      }
    } catch (e) {
      addEvent({ type: 'WARNING', message: e instanceof Error ? e.message : 'Verification error' })
      setStatusOk(false)
      setFailures(f => f + 1)
    } finally {
      // schedule next check
      nextCheckAtRef.current = performance.now() + CHECK_INTERVAL_MS
      setStep('active')
    }
  }

  useEffect(() => {
    if (failures >= MAX_FAILURES) {
      setStep('suspended')
      addEvent({ type: 'WARNING', message: 'Session Suspended (3 failed checks)' })
    }
  }, [failures, addEvent])

  const endSession = useCallback(() => {
    const behavioral = behavioralCtrlRef.current?.stop() ?? behavioralProfile
    if (behavioral && !behavioralProfile) setBehavioralProfile(behavioral)

    const started = new Date(Date.now() - Math.round(elapsedMs)).toISOString()
    const ended = new Date().toISOString()

    openPrintableReport({
      student: {
        first_name: identity.firstName || 'Unknown',
        last_name: identity.lastName || 'Unknown',
        student_id: worker?.workerId ?? 'unknown',
        institution: worker?.employerSite || 'Unknown institution',
        program: worker?.jobRole || 'Unknown program',
        email: 'unknown',
      },
      exam: {
        started_at: started,
        ended_at: ended,
        duration_ms: Math.max(0, Math.round(elapsedMs)),
      },
      verification: {
        checks_total: checksTotal,
        checks_passed: checksPassed,
        warnings: events.filter(e => e.type === 'WARNING' || e.type === 'SUSPICIOUS').length,
        suspended: step === 'suspended',
      },
      behavioral: {
        score: behavioralScore,
        level: behavioralLevel,
      },
      post_quantum: {
        algorithm: 'ML-KEM-768',
      },
    })
  }, [behavioralLevel, behavioralProfile, behavioralScore, checksPassed, checksTotal, elapsedMs, events, identity.firstName, identity.lastName, step, worker?.employerSite, worker?.jobRole, worker?.workerId])

  return (
    <BehavioralCapture onController={onBehavioralController}>
      <div className="app-shell">
        <div className="shell-inner">
          <div className="hero-panel">
            <div className="eyebrow">Protected exam session</div>

            <div className="hero-mark">
              <svg width="42" height="42" viewBox="0 0 28 28" aria-hidden="true">
                <polygon points="14,2 26,8 26,20 14,26 2,20 2,8" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="14" cy="14" r="4" fill="currentColor" opacity="0.38" />
              </svg>
              <span>EDGUARD SESSION</span>
            </div>

            <h1 className="headline-xl">
              Monitor presence
              <br />
              <span>through the full exam.</span>
            </h1>

            <p className="hero-copy">
              The active session tracks elapsed time, behavioral trust, and periodic selfie checkpoints so the exam remains bound to the verified learner.
            </p>

            <div className="stats-grid">
              {summaryCards.map((item) => (
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
                  <div className="info-kicker">Session control</div>
                  <div style={{ marginTop: 6, fontSize: '1.5rem', fontWeight: 800, lineHeight: 1.1 }}>
                    {step === 'suspended' ? 'Session suspended' : step === 'modal-check' ? 'Identity checkpoint in progress' : 'Exam actively monitored'}
                  </div>
                </div>
                <div className={statusOk ? 'badge badge-green' : 'badge'} style={!statusOk ? { background:'rgba(239,68,68,0.12)', color:'var(--red)', border:'1px solid rgba(239,68,68,0.25)' } : undefined}>
                  {statusOk ? 'Verified' : 'Check required'}
                </div>
              </div>

              <div className="section-rule" />

              <div className="card" style={{ width: '100%', padding: 16, marginTop: 0, background: 'rgba(3,7,18,0.52)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="metric-row">
                  <span className="metric-label">Status</span>
                  <span className="metric-value" style={{ color: statusOk ? 'var(--green)' : 'var(--red)' }}>
                    {statusOk ? 'VERIFIED' : 'CHECK REQUIRED'}
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Failures</span>
                  <span className="metric-value" style={{ color: failures > 0 ? 'var(--amber)' : 'var(--green)' }}>{failures}/{MAX_FAILURES}</span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Last similarity</span>
                  <span className="metric-value">{lastSimilarity !== null ? `${lastSimilarity}%` : '—'}</span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Behavioral</span>
                  <span className="metric-value">{behavioralLevel} ({Math.round(behavioralScore * 100)}%)</span>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginTop: 16 }}>
                <button className="btn btn-primary" onClick={handlePresence}>
                  I'm here
                </button>
                <button className="btn btn-outline" onClick={endSession}>End Session</button>
                <button className="btn btn-outline" onClick={() => nav('/')}>Exit</button>
              </div>

              <div className="card" style={{ width: '100%', marginTop: 16, padding: 16, background: 'rgba(3,7,18,0.52)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ fontSize: 12, color: 'var(--grey)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Session log</div>
                {events.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--grey)' }}>No events yet.</div>
                ) : (
                  events.map((e, idx) => (
                    <div key={idx} style={{ padding: '10px 0', borderBottom: idx === events.length - 1 ? 'none' : '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <div style={{ fontWeight: 700, color: e.type === 'VERIFIED' ? 'var(--green)' : e.type === 'WARNING' ? 'var(--amber)' : e.type === 'SUSPICIOUS' ? 'var(--red)' : 'var(--accent)' }}>
                          {e.type}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--grey)' }}>{new Date(e.at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}</div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--grey)', marginTop: 4, lineHeight: 1.6 }}>
                        {e.message}{typeof e.similarity === 'number' ? ` — ${e.similarity}%` : ''}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="side-stack">
              {sideCards.map((card) => (
                <div key={card.title} className="info-card">
                  <div className="info-kicker">{card.title}</div>
                  <div className="info-body">{card.body}</div>
                </div>
              ))}

              <div className="info-card">
                <div className="info-kicker">Current learner</div>
                <div className="info-body">
                  {identity.firstName || 'Unknown'} {identity.lastName || ''}
                  <br />
                  Student ID: {worker?.workerId ?? 'unknown'}
                  <br />
                  Institution: {worker?.employerSite ?? 'unknown'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {step === 'modal-check' && (
          <IdentityCheckModal
            firstName={identity.firstName}
            lastName={identity.lastName}
            onFirstNameChange={handleIdentityFirstNameChange}
            onLastNameChange={handleIdentityLastNameChange}
            onCapture={handleCheckSelfie}
            onSkip={handleSkipModalCheck}
          />
        )}

        {step === 'suspended' && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.82)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 60 }}>
            <div className="surface-card" style={{ width: '100%', maxWidth: 520, textAlign: 'center' }}>
              <div className="badge" style={{ margin: '0 auto 14px', background:'rgba(239,68,68,0.12)', color:'var(--red)', border:'1px solid rgba(239,68,68,0.25)' }}>
                Session Suspended
              </div>
              <h2 style={{ marginBottom: 8 }}>Verification failed</h2>
              <p style={{ color: 'var(--grey)', fontSize: 13, lineHeight: 1.7 }}>Please contact the proctor. This session is suspended.</p>
              <div style={{ display: 'grid', gap: 12, marginTop: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                <button className="btn btn-outline" onClick={endSession}>Download Report</button>
                <button className="btn btn-outline" onClick={() => nav('/')}>Exit</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </BehavioralCapture>
  )
}
