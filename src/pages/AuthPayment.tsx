import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SelfieCapture } from '../components/SelfieCapture'
import { ReactionTime } from '../components/ReactionTime'
import {
  lookupEnrollment,
  sendAuthPaymentSignals,
  verifyWorker,
  vocalVerify,
} from '../services/api'
import { useVoiceBiometrics } from '../hooks/useVoiceBiometrics'
import {
  useBehavioral,
  requestMotionPermission,
  type BehavioralProfile,
} from '../hooks/useBehavioral'

// Configurable composite score threshold (default 0.75)
const PAYMENT_THRESHOLD = Number(import.meta.env.VITE_PAYMENT_THRESHOLD ?? 0.75)
const REVIEW_THRESHOLD = 0.6
const MAX_ATTEMPTS = 3

type Step = 'identity' | 'not-enrolled' | 'selfie' | 'vocal' | 'reaction' | 'computing' | 'decision'
type Decision = 'APPROVED' | 'REVIEW' | 'REJECTED' | 'MANUAL_REVIEW'

const VOCAL_RECORD_MS = 3000

/**
 * Behavioral score — mean of every signal that returned a usable measurement.
 *
 * - Gyroscope std (rad/s) — humans micro-tremor > 0.05, bots ≈ 0.
 * - Accelerometer magnitude std (m/s²) — humans hand variation > 0.1.
 * - Inter-tap CV (std/mean) — humans 0.15+, bots near-zero.
 * - Touch pressure variance — humans variable, emulators fixed.
 *
 * If no sensor produced data (desktop without taps, locked-down browser),
 * fall back to a low “prior” that distinguishes a touch device from a
 * vanilla desktop / headless.
 */
function behavioralScoreFromProfile(p: BehavioralProfile): number {
  const scores: number[] = []

  if (p.motion.gyro_std !== undefined) {
    scores.push(Math.min(1, p.motion.gyro_std * 20))
  }
  if (p.motion.accel_variation !== undefined) {
    scores.push(Math.min(1, p.motion.accel_variation * 10))
  }
  if (p.touch.tap_cv !== undefined) {
    scores.push(Math.min(1, p.touch.tap_cv * 6))
  }
  if (p.touch.pressure_variance !== undefined) {
    scores.push(Math.min(1, p.touch.pressure_variance * 10))
  }

  // Strong human cue: hand micro-tremor inside the ±100ms window of every tap.
  // Synthetic / emulator taps fire with the device perfectly still → ~0.
  if (p.motion.gyro_during_tap !== undefined) {
    scores.push(Math.min(1, p.motion.gyro_during_tap * 15))
  }

  // Variable tap velocity is a human signature; bots tap with constant speed.
  if (p.touch.tap_velocity_cv !== undefined) {
    scores.push(Math.min(1, p.touch.tap_velocity_cv * 5))
  }

  if (scores.length === 0) {
    return p.device.touch_capable ? 0.4 : 0.2
  }

  return scores.reduce((a, b) => a + b, 0) / scores.length
}

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
  const nav = useNavigate()
  const [step, setStep] = useState<Step>('identity')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [selfie, setSelfie] = useState<string | null>(null)
  const [similarity, setSimilarity] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [attempts, setAttempts] = useState(0)
  const [decision, setDecision] = useState<Decision | null>(null)
  const [studentId, setStudentId] = useState<string | null>(null)
  const [vocalQuality, setVocalQuality] = useState<number | null>(null)
  const [vocalError, setVocalError] = useState<string>('')
  // Forensic field — surfaces the exact failure reason on the decision screen
  // so we can debug the APK voice flow without remote logcat access.
  // Possible values: 'ok' | 'mic_<errName>' | 'mic_no_samples' |
  //   'verify_http_<status>' | 'verify_<reason>' | 'verify_zero' | 'pending'
  const [vocalDebug, setVocalDebug] = useState<string>('pending')
  const [lookupBusy, setLookupBusy] = useState(false)

  const voice = useVoiceBiometrics()
  const behavioral = useBehavioral()
  const vocalEmbeddingRef = useRef<Float32Array | null>(null)

  // We DO NOT auto-start at mount: iOS Safari requires the motion permission
  // prompt to fire from a user gesture. behavioral.start() is invoked from
  // the “Continue” button on the identity step, after requestMotionPermission().
  // Mount-time effect only registers the unmount cleanup.
  useEffect(() => {
    return () => {
      try { behavioral.stop() } catch { /* already stopped */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const decide = useCallback((c: Composite): Decision => {
    if (c.composite >= PAYMENT_THRESHOLD) return 'APPROVED'
    if (c.composite >= REVIEW_THRESHOLD) return 'REVIEW'
    return 'REJECTED'
  }, [])

  const handleIdentity = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!firstName.trim() || !lastName.trim()) return
    if (lookupBusy) return

    // First user gesture of the flow — request iOS motion permission here so
    // that the prompt actually appears (it cannot be requested from useEffect).
    // We don't gate progression on the result: behavioral scoring degrades
    // gracefully when motion is denied (the score uses pressure / tap_cv too).
    try { await requestMotionPermission() } catch { /* user denied or unsupported */ }

    // Block the flow if no enrollment exists for this (first, last). Without
    // an enrolled face/voice profile every downstream score would be 0 and
    // the user would always be REJECTED — that's a confusing dead-end.
    setLookupBusy(true)
    setErrorMsg('')
    try {
      const lookup = await lookupEnrollment({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      })
      if (!lookup.found) {
        setStep('not-enrolled')
        return
      }
    } catch (err) {
      // On lookup failure we surface an error and stay on the identity step
      // — we do NOT silently proceed because that would degrade to a fake
      // verification with all-zero scores.
      setErrorMsg(err instanceof Error ? err.message : 'Profile lookup failed')
      return
    } finally {
      setLookupBusy(false)
    }

    void behavioral.start()
    setStep('selfie')
  }, [firstName, lastName, behavioral, lookupBusy])

  const handleSelfie = useCallback(async (b64: string) => {
    setSelfie(b64)
    setErrorMsg('')
    try {
      const res = await verifyWorker({ selfie_b64: b64, first_name: firstName, last_name: lastName })
      setSimilarity(res.similarity)
      setStudentId(res.student_id ?? null)
      setStep('vocal')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Face check failed')
      setStep('identity')
    }
  }, [firstName, lastName])

  const handleVocal = useCallback(async () => {
    setVocalError('')
    setVocalDebug('pending')
    let samples: Float32Array
    try {
      samples = await voice.recordAudio(VOCAL_RECORD_MS)
    } catch (err) {
      const errName = err instanceof Error ? err.name || 'Error' : 'Unknown'
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error('[vocal] recordAudio failed', { errName, errMsg })
      setVocalError(`${errName}: ${errMsg}`)
      setVocalDebug(`mic_${errName}`)
      setVocalQuality(0)
      setStep('reaction')
      return
    }

    if (!samples || samples.length === 0) {
      console.error('[vocal] recordAudio returned empty buffer')
      setVocalError('Microphone returned empty audio')
      setVocalDebug('mic_no_samples')
      setVocalQuality(0)
      setStep('reaction')
      return
    }

    const embedding = voice.extractMFCC(samples, 16000)
    vocalEmbeddingRef.current = embedding

    // Real biometric check: compare against the enrolled embedding via the
    // backend (cosine similarity). Backend may return HTTP 200 with
    // vocal_score=0 + reason ('no_enrollment' | 'dim_mismatch') — surface it.
    try {
      const resp = await vocalVerify({
        first_name: firstName,
        last_name: lastName,
        vocal_embedding: Array.from(embedding),
      })
      const score = Math.max(0, Math.min(1, resp.vocal_score))
      setVocalQuality(score)
      if (score > 0) {
        setVocalDebug('ok')
      } else if (resp.reason) {
        setVocalDebug(`verify_${resp.reason}`)
      } else {
        setVocalDebug('verify_zero')
      }
      console.log('[vocal] verify result', { score, reason: resp.reason, samples: samples.length })
    } catch (verifyErr) {
      const errMsg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr)
      console.warn('[vocal-verify] failed', errMsg)
      // Try to extract HTTP status if message has it ("vocal-verify failed: 502")
      const httpMatch = /:\s*(\d{3})/.exec(errMsg)
      setVocalDebug(httpMatch ? `verify_http_${httpMatch[1]}` : 'verify_network')
      setVocalQuality(0)
    }

    setStep('reaction')
  }, [voice, firstName, lastName])

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

    // Fire-and-forget: ship vocal + behavioral + reflex signals to the backend
    // so it can update edguard_sessions and re-emit an enriched HCS-U7 event.
    if (studentId) {
      let behavioralScore = 0
      try {
        const profile = behavioral.stop()
        behavioralScore = behavioralScoreFromProfile(profile)
      } catch {
        behavioralScore = 0
      }
      void sendAuthPaymentSignals({
        student_id: studentId,
        vocal_score: vocalQuality ?? 0,
        behavioral_score: behavioralScore,
        reaction_ms: avgMs,
      }).catch((err) => {
        // Errors are intentionally swallowed at the UI level — enrichment
        // is best-effort and never gates the decision.
        console.warn('[auth-payment-signals] failed', err)
      })
    }
  }, [similarity, attempts, decide, studentId, vocalQuality, behavioral])

  const retry = useCallback(() => {
    setSelfie(null)
    setSimilarity(null)
    setDecision(null)
    setErrorMsg('')
    setVocalQuality(null)
    setVocalError('')
    setVocalDebug('pending')
    vocalEmbeddingRef.current = null
    setStudentId(null)
    // Retry triggered by a button click — we are still inside a gesture.
    void behavioral.start()
    setStep('selfie')
  }, [behavioral])

  const restart = useCallback(() => {
    setSelfie(null)
    setSimilarity(null)
    setDecision(null)
    setErrorMsg('')
    setAttempts(0)
    setVocalQuality(null)
    setVocalError('')
    setVocalDebug('pending')
    vocalEmbeddingRef.current = null
    setStudentId(null)
    // Don't auto-start here — the user will click Continue on identity which
    // re-triggers requestMotionPermission() from a fresh gesture.
    setStep('identity')
  }, [])

  const progressPct = useMemo(() => {
    switch (step) {
      case 'identity':     return 0
      case 'not-enrolled': return 0
      case 'selfie':       return 20
      case 'vocal':        return 45
      case 'reaction':     return 70
      case 'computing':    return 90
      case 'decision':     return 100
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
            Three quick checks — a live photo, a short voice sample and a tap
            test. Under 45 seconds.
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
                disabled={!firstName.trim() || !lastName.trim() || lookupBusy}>
                {lookupBusy ? 'Looking up…' : 'Continue →'}
              </button>
            </form>
          )}

          {step === 'not-enrolled' && (
            <div style={{ display: 'grid', gap: 16 }}>
              <div className="info-kicker" style={{ color: 'var(--red, #ef4444)' }}>
                No profile found
              </div>
              <h2 style={{ fontSize: '1.4rem', margin: 0 }}>
                {firstName.trim()} {lastName.trim()} is not enrolled yet.
              </h2>
              <p style={{ fontSize: 13, color: 'var(--grey)', lineHeight: 1.7, margin: 0 }}>
                Please complete enrolment first — we need a registered face and
                voice profile to verify identity before releasing payment.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => nav('/enroll')}
              >
                Go to enrolment →
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setStep('identity')}
                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.12)' }}
              >
                Try a different name
              </button>
            </div>
          )}

          {step === 'selfie' && (
            <div style={{ display: 'grid', gap: 14 }}>
              <div className="info-kicker">Step 1 of 3 — Live photo</div>
              <p style={{ fontSize: 13, color: 'var(--grey)', lineHeight: 1.7 }}>
                Center your face in the frame and capture. We compare it to your
                registered profile.
              </p>
              <SelfieCapture onCapture={handleSelfie} loading={!!selfie && similarity === null} />
            </div>
          )}

          {step === 'vocal' && (
            <div style={{ display: 'grid', gap: 14 }}>
              <div className="info-kicker">Step 2 of 3 — Voice sample</div>
              <p style={{ fontSize: 13, color: 'var(--grey)', lineHeight: 1.7 }}>
                Hold the button and read this short sentence aloud for 3 seconds:
                <br />
                <em style={{ color: 'var(--ink)' }}>“I confirm this payment release.”</em>
              </p>
              {vocalError && (
                <div className="info-card" style={{ color: 'var(--red)', fontSize: 13 }}>
                  {vocalError} — continuing without voice.
                </div>
              )}
              {voice.isRecording ? (
                <div className="info-card" style={{ textAlign: 'center', padding: '20px 12px' }}>
                  <div style={{ fontSize: 12, color: 'var(--grey)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
                    Recording…
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent)' }}>
                    {(voice.countdownMs / 1000).toFixed(1)}s
                  </div>
                </div>
              ) : (
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={handleVocal}
                  disabled={voice.isRecording}
                >
                  Start voice sample →
                </button>
              )}
            </div>
          )}

          {step === 'reaction' && (
            <div style={{ display: 'grid', gap: 14 }}>
              <div className="info-kicker">Step 3 of 3 — Quick tap test</div>
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
            <>
              <DecisionCard
                decision={decision}
                attempts={attempts}
                onRetry={retry}
                onRestart={restart}
              />
              <div
                className="info-card"
                style={{
                  marginTop: 12,
                  fontSize: 11,
                  fontFamily: 'monospace',
                  color: 'var(--grey)',
                  lineHeight: 1.6,
                }}
              >
                <div><b>DBG vocal</b>: {vocalDebug} (score={vocalQuality ?? 'null'})</div>
                {vocalError && <div>err: {vocalError}</div>}
              </div>
            </>
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
