import { useCallback, useMemo, useState } from 'react'
import { SelfieCapture } from '../components/SelfieCapture'
import { ReactionTime } from '../components/ReactionTime'
import { verifyWorker } from '../services/api'

// Configurable composite score threshold (default 0.75)
const PAYMENT_THRESHOLD = Number(import.meta.env.VITE_PAYMENT_THRESHOLD ?? 0.75)
const REVIEW_THRESHOLD = 0.6
const MAX_ATTEMPTS = 3

type Step = 'identity' | 'selfie' | 'reaction' | 'computing' | 'decision'
type Decision = 'APPROVED' | 'REVIEW' | 'REJECTED' | 'MANUAL_REVIEW'

interface Composite {
  faceScore: number
  cognitiveScore: number
  composite: number
  similarity: number
  reactionMs: number
}

// Reaction time → cognitive score normalisation:
// 250 ms → ~1.0 ; 800 ms → ~0.0
function reactionToScore(ms: number): number {
  const score = (800 - ms) / 500
  return Math.max(0, Math.min(1, score))
}

const COPY: Record<Decision, { en: string; zu: string; xh: string; sub: string }> = {
  APPROVED: {
    en: 'Payment approved',
    zu: 'Inkokhelo igunyaziwe',
    xh: 'Intlawulo iphunyeziwe',
    sub: 'You may proceed with disbursement.',
  },
  REVIEW: {
    en: 'Pending human review',
    zu: 'Kulindwe ukubuyekezwa umuntu',
    xh: 'Kulindwe uphononongo lomntu',
    sub: 'An agent will validate this request shortly.',
  },
  REJECTED: {
    en: 'Verification failed — please try again',
    zu: 'Ukuqinisekiswa kuhlulekile — sicela uzame futhi',
    xh: 'Uqinisekiso aluphumelelanga — nceda uzame kwakhona',
    sub: 'Make sure your face is well lit and clearly visible.',
  },
  MANUAL_REVIEW: {
    en: 'Sent for manual review',
    zu: 'Kuthunyelwe ukuze kubuyekezwe ngesandla',
    xh: 'Kuthunyelwe kuphononongo lwesandla',
    sub: 'A human agent will contact you to complete authentication.',
  },
}

const TONE: Record<Decision, { color: string; bg: string; border: string; glyph: string }> = {
  APPROVED:      { color: '#16a34a', bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.45)',  glyph: '✓' },
  REVIEW:        { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.45)', glyph: '!' },
  REJECTED:      { color: '#ef4444', bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.45)',  glyph: '×' },
  MANUAL_REVIEW: { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.45)', glyph: '⌛' },
}

export function AuthPayment() {
  const [step, setStep] = useState<Step>('identity')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [selfie, setSelfie] = useState<string | null>(null)
  const [similarity, setSimilarity] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [attempts, setAttempts] = useState(0)
  const [decision, setDecision] = useState<Decision | null>(null)

  const decide = useCallback((c: Composite): Decision => {
    if (c.composite >= PAYMENT_THRESHOLD) return 'APPROVED'
    if (c.composite >= REVIEW_THRESHOLD) return 'REVIEW'
    return 'REJECTED'
  }, [])

  const handleIdentity = (e: React.FormEvent) => {
    e.preventDefault()
    if (!firstName.trim() || !lastName.trim()) return
    setStep('selfie')
  }

  const handleSelfie = useCallback(async (b64: string) => {
    setSelfie(b64)
    setErrorMsg('')
    try {
      const res = await verifyWorker({ selfie_b64: b64, first_name: firstName, last_name: lastName })
      setSimilarity(res.similarity)
      setStep('reaction')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Face check failed')
      setStep('identity')
    }
  }, [firstName, lastName])

  const handleReactionDone = useCallback((avgMs: number) => {
    setStep('computing')
    const faceScore = (similarity ?? 0) / 100
    const cognitiveScore = reactionToScore(avgMs)
    // Weighted composite: face is the primary identity signal (70%),
    // cognitive presence is a liveness cue (30%).
    const compositeScore = 0.7 * faceScore + 0.3 * cognitiveScore
    const c: Composite = {
      faceScore,
      cognitiveScore,
      composite: compositeScore,
      similarity: similarity ?? 0,
      reactionMs: avgMs,
    }
    const nextAttempts = attempts + 1
    setAttempts(nextAttempts)

    let d = decide(c)
    if (d === 'REJECTED' && nextAttempts >= MAX_ATTEMPTS) {
      d = 'MANUAL_REVIEW'
    }
    setDecision(d)
    setStep('decision')
  }, [similarity, attempts, decide])

  const retry = useCallback(() => {
    setSelfie(null)
    setSimilarity(null)
    setDecision(null)
    setErrorMsg('')
    setStep('selfie')
  }, [])

  const restart = useCallback(() => {
    setSelfie(null)
    setSimilarity(null)
    setDecision(null)
    setErrorMsg('')
    setAttempts(0)
    setStep('identity')
  }, [])

  const progressPct = useMemo(() => {
    switch (step) {
      case 'identity':  return 0
      case 'selfie':    return 33
      case 'reaction':  return 66
      case 'computing': return 90
      case 'decision':  return 100
    }
  }, [step])

  return (
    <div className="app-shell">
      <div className="shell-inner" style={{ maxWidth: 560 }}>
        <div className="hero-panel" style={{ padding: '28px 24px' }}>
          <div className="eyebrow">Grant disbursement authentication</div>
          <div className="hero-mark">
            <svg width="34" height="34" viewBox="0 0 28 28" aria-hidden="true">
              <polygon points="14,2 26,8 26,20 14,26 2,20 2,8" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="14" cy="14" r="4" fill="currentColor" opacity="0.38" />
            </svg>
            <span>AUTH&nbsp;PAY</span>
          </div>
          <h1 className="headline-xl" style={{ fontSize: '1.85rem' }}>
            Confirm your identity
            <br />
            <span>before payment release.</span>
          </h1>
          <p className="hero-copy" style={{ fontSize: 14 }}>
            Two quick checks — a live photo and a short reaction tap. Takes under
            30 seconds.
          </p>

          <div style={{
            marginTop: 18, height: 6, borderRadius: 999,
            background: 'rgba(255,255,255,0.06)', overflow: 'hidden',
          }}>
            <div style={{
              width: `${progressPct}%`, height: '100%',
              background: 'linear-gradient(90deg, var(--accent), #22d3ee)',
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>

        <div className="surface-card" style={{ marginTop: 16 }}>
          {step === 'identity' && (
            <form onSubmit={handleIdentity} style={{ display: 'grid', gap: 14 }}>
              <div className="info-kicker">Step 1 of 2 — Identity</div>
              <p style={{ fontSize: 13, color: 'var(--grey)', lineHeight: 1.7 }}>
                Enter your first and last name as registered with the disbursement
                programme.
              </p>
              {errorMsg && (
                <div className="info-card" style={{ color: 'var(--red)', fontSize: 13 }}>
                  {errorMsg}
                </div>
              )}
              <input
                placeholder="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                style={inputStyle}
                autoComplete="given-name"
              />
              <input
                placeholder="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                style={inputStyle}
                autoComplete="family-name"
              />
              <button className="btn btn-primary" type="submit"
                disabled={!firstName.trim() || !lastName.trim()}>
                Continue →
              </button>
            </form>
          )}

          {step === 'selfie' && (
            <div style={{ display: 'grid', gap: 14 }}>
              <div className="info-kicker">Step 1 of 2 — Live photo</div>
              <p style={{ fontSize: 13, color: 'var(--grey)', lineHeight: 1.7 }}>
                Center your face in the frame and capture. We compare it to your
                registered profile.
              </p>
              <SelfieCapture onCapture={handleSelfie} loading={!!selfie && similarity === null} />
            </div>
          )}

          {step === 'reaction' && (
            <div style={{ display: 'grid', gap: 14 }}>
              <div className="info-kicker">Step 2 of 2 — Quick tap test</div>
              <p style={{ fontSize: 13, color: 'var(--grey)', lineHeight: 1.7 }}>
                Tap the button as fast as you can when it turns yellow. 5 short
                rounds.
              </p>
              <ReactionTime onComplete={handleReactionDone} />
            </div>
          )}

          {step === 'computing' && (
            <div style={{ textAlign: 'center', padding: '28px 8px' }}>
              <div className="info-kicker" style={{ marginBottom: 10 }}>Computing decision…</div>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                border: '3px solid rgba(59,130,246,0.2)',
                borderTopColor: 'var(--accent)',
                animation: 'spin 0.9s linear infinite',
                margin: '0 auto',
              }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {step === 'decision' && decision && (
            <DecisionCard
              decision={decision}
              attempts={attempts}
              onRetry={retry}
              onRestart={restart}
            />
          )}
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '14px 16px',
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'rgba(3,7,18,0.6)',
  color: 'var(--ink)',
  fontSize: 15,
  outline: 'none',
}

interface DecisionCardProps {
  decision: Decision
  attempts: number
  onRetry: () => void
  onRestart: () => void
}

function DecisionCard({ decision, attempts, onRetry, onRestart }: DecisionCardProps) {
  const tone = TONE[decision]
  const copy = COPY[decision]
  const canRetry = decision === 'REJECTED' && attempts < MAX_ATTEMPTS

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{
        borderRadius: 16,
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        padding: '24px 20px',
        textAlign: 'center',
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: tone.color, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 36, fontWeight: 800, margin: '0 auto 12px',
        }}>
          {tone.glyph}
        </div>
        <div style={{
          fontSize: 11, fontWeight: 800, letterSpacing: '0.18em',
          textTransform: 'uppercase', color: tone.color, marginBottom: 8,
        }}>
          {decision.replace('_', ' ')}
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 4 }}>
          {copy.en}
        </div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.78)', marginBottom: 2 }}>
          {copy.zu}
        </div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.78)', marginBottom: 12 }}>
          {copy.xh}
        </div>
        <div style={{ fontSize: 13, color: 'var(--grey)', lineHeight: 1.6 }}>
          {copy.sub}
        </div>
      </div>

      {canRetry && (
        <button className="btn btn-primary" onClick={onRetry}>
          Try again
        </button>
      )}
      <button className="btn btn-outline" onClick={onRestart}>
        Start a new request
      </button>
    </div>
  )
}
