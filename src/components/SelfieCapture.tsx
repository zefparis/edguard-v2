import { useCamera } from '../hooks/useCamera'
import { CameraInitLoader } from './CameraInitLoader'
import { useState } from 'react'

interface Props {
  onCapture: (b64: string) => void
  loading?: boolean
}

export function SelfieCapture({ onCapture, loading }: Props) {
  const { videoRef, ready, error, capture, isInitializing } = useCamera()
  const [captured, setCaptured] = useState<string | null>(null)

  function handleCapture() {
    const b64 = capture()
    if (b64) { setCaptured(b64); onCapture(b64) }
  }

  if (error) return (
    <div className="info-card" style={{ color: 'var(--red)', textAlign: 'center' }}>
      {error}
    </div>
  )

  return (
    <div style={{ width: '100%' }}>
      <CameraInitLoader isLoading={isInitializing} />
      <div style={{
        position: 'relative', width: '100%', maxWidth: 420, margin: '0 auto 20px',
        borderRadius: 20, overflow: 'hidden',
        border: `1px solid ${captured ? 'rgba(34,197,94,0.4)' : 'rgba(59,130,246,0.4)'}`,
        boxShadow: captured ? '0 0 0 1px rgba(34,197,94,0.16) inset' : '0 0 0 1px rgba(59,130,246,0.12) inset',
        aspectRatio: '4/3', background: 'rgba(3,7,18,0.78)'
      }}>
        <div style={{
          position: 'absolute',
          inset: 12,
          borderRadius: 16,
          border: `1px solid ${captured ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.12)'}`,
          pointerEvents: 'none',
          zIndex: 1,
        }} />
        <video
          ref={videoRef}
          autoPlay playsInline muted
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: captured ? 'none' : 'block' }}
        />
        {captured && (
          <img src={captured} alt="captured"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        {!ready && !captured && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center', color: 'var(--grey)'
          }}>
            Starting camera...
          </div>
        )}
        <div style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(3,7,18,0.72)', borderRadius: 999, padding: '6px 12px',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
          color: captured ? 'var(--green)' : 'var(--accent)',
          border: `1px solid ${captured ? 'rgba(34,197,94,0.28)' : 'rgba(59,130,246,0.28)'}`,
          zIndex: 2,
        }}>
          {captured ? '✓ CAPTURED' : 'LIVE'}
        </div>
      </div>

      <div style={{ textAlign: 'center', color: 'var(--grey)', fontSize: 13, lineHeight: 1.7, marginBottom: 16 }}>
        {captured
          ? 'Review the captured frame, then confirm or retake it.'
          : ready
            ? 'Center the face in the frame, then capture when the image is clear.'
            : 'Preparing secure camera access...'}
      </div>

      {!captured ? (
        <button
          className="btn btn-primary"
          onClick={handleCapture}
          disabled={!ready || loading}
        >
          {loading ? 'Processing...' : 'Capture'}
        </button>
      ) : (
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <button className="btn btn-outline" onClick={() => setCaptured(null)}>
            Retake
          </button>
          <button className="btn btn-primary" disabled={loading}>
            {loading ? 'Verifying...' : 'Confirmed'}
          </button>
        </div>
      )}
    </div>
  )
}
