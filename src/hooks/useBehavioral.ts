import { useCallback, useMemo, useRef, useState } from 'react'

export type DeviceType = 'mobile' | 'desktop' | 'unknown'

export type BehavioralProfile = {
  device: {
    device_type: DeviceType
    user_agent: string
    language: string
    languages: string[]
    timezone_offset_min: number
    touch_capable: boolean
    hardware_concurrency?: number
    screen: {
      width: number
      height: number
      device_pixel_ratio: number
    }
  }
  permissions: {
    motion: 'granted' | 'denied' | 'prompt' | 'unsupported'
    orientation: 'granted' | 'denied' | 'prompt' | 'unsupported'
  }
  session: {
    started_at_ms: number
    ended_at_ms: number
    duration_ms: number
  }
  motion: {
    samples: number
    interval_ms_mean: number
    accel_gravity: VecStats
    rotation_rate: VecStats
    /** Std deviation of |rotationRate| over the last 10 samples (rad/s).
     *  Humans ≈ micro-tremor > 0.05 ; bots/emulators ≈ 0. */
    gyro_std?: number
    /** Std deviation of |accelerationIncludingGravity| over the session (m/s²). */
    accel_variation?: number
    /** Mean |rotationRate| within ±100 ms of every tap (rad/s).
     *  Strong human cue — hand always trembles slightly when finger lands;
     *  emulators / synthetic taps yield ~0. */
    gyro_during_tap?: number
  }
  orientation: {
    samples: number
    alpha_beta_gamma: VecStats
  }
  touch: {
    pointer_down: number
    pointer_move: number
    pointer_up: number
    taps: number
    tap_duration_ms_mean: number
    inter_tap_ms_mean: number
    move_speed_px_per_ms_mean: number
    move_path_len_px_mean: number
    /** Coefficient of variation (std/mean) of inter-tap intervals.
     *  Humans ≈ 0.15+ ; bots ≈ 0 (perfectly regular). */
    tap_cv?: number
    /** 1 - tap_cv — high regularity is suspicious (bot signal). Provided
     *  raw for downstream scoring policies; not used by the default scorer. */
    inter_tap_regularity?: number
    /** Variance of PointerEvent.pressure values across pointerdown events. */
    pressure_variance?: number
    pressure_samples?: number[]
    tap_intervals_ms?: number[]
    /** Per-tap straight-line velocity (px/ms) = |up - down| / duration. */
    tap_velocity_mean?: number
    /** Std/mean of tap velocities. Humans vary, bots don't. */
    tap_velocity_cv?: number
    tap_velocities?: number[]
  }
}

export type BehavioralController = {
  start: () => Promise<void>
  stop: () => BehavioralProfile
  isCapturing: boolean
}

type VecStats = {
  mean: [number, number, number]
  std: [number, number, number]
  mag_mean: number
  mag_std: number
}

function isTouchCapable(): boolean {
  // navigator.maxTouchPoints is the most reliable modern signal
  const nav = navigator as Navigator & { maxTouchPoints?: number }
  return (nav.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window
}

function inferDeviceType(): DeviceType {
  const touch = isTouchCapable()
  const smallScreen = Math.min(window.screen.width, window.screen.height) <= 820
  if (touch && smallScreen) return 'mobile'
  if (!touch && !smallScreen) return 'desktop'
  return touch ? 'mobile' : 'unknown'
}

type RunningVec = {
  n: number
  mean: [number, number, number]
  m2: [number, number, number]
  mag_mean: number
  mag_m2: number
}

function createRunningVec(): RunningVec {
  return {
    n: 0,
    mean: [0, 0, 0],
    m2: [0, 0, 0],
    mag_mean: 0,
    mag_m2: 0,
  }
}

function updateRunningVec(stats: RunningVec, x: number, y: number, z: number) {
  stats.n += 1
  const v: [number, number, number] = [x, y, z]
  for (let i = 0; i < 3; i += 1) {
    const delta = v[i] - stats.mean[i]
    stats.mean[i] += delta / stats.n
    const delta2 = v[i] - stats.mean[i]
    stats.m2[i] += delta * delta2
  }
  const mag = Math.sqrt(x * x + y * y + z * z)
  const dMag = mag - stats.mag_mean
  stats.mag_mean += dMag / stats.n
  const dMag2 = mag - stats.mag_mean
  stats.mag_m2 += dMag * dMag2
}

function finalizeRunningVec(stats: RunningVec): VecStats {
  const denom = Math.max(1, stats.n - 1)
  const std: [number, number, number] = [
    Math.sqrt(stats.m2[0] / denom),
    Math.sqrt(stats.m2[1] / denom),
    Math.sqrt(stats.m2[2] / denom),
  ]
  return {
    mean: stats.mean,
    std,
    mag_mean: stats.mag_mean,
    mag_std: Math.sqrt(stats.mag_m2 / denom),
  }
}

/**
 * iOS 13+: DeviceMotionEvent.requestPermission MUST be called from a user gesture
 * (click/touch handler), otherwise it throws / resolves to 'denied'. Call this
 * helper from the first button click of the flow, then start the hook.
 *
 * - iOS Safari: returns true if user accepts, false if denied/throws.
 * - Android Chrome / desktop: returns true (no permission gate).
 */
export async function requestMotionPermission(): Promise<boolean> {
  if (typeof DeviceMotionEvent === 'undefined') return false
  const dm = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> }
  if (typeof dm.requestPermission !== 'function') return true // Android / desktop
  try {
    const result = await dm.requestPermission()
    return result === 'granted'
  } catch {
    return false
  }
}

/**
 * Same gate but for DeviceOrientationEvent. Some iOS versions request the two
 * separately; granting motion implicitly grants orientation on most builds,
 * but we expose this for completeness.
 */
export async function requestOrientationPermission(): Promise<boolean> {
  if (typeof DeviceOrientationEvent === 'undefined') return false
  const dm = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> }
  if (typeof dm.requestPermission !== 'function') return true
  try {
    const result = await dm.requestPermission()
    return result === 'granted'
  } catch {
    return false
  }
}

function permissionSupportLabel(
  kind: 'motion' | 'orientation'
): 'granted' | 'denied' | 'prompt' | 'unsupported' {
  // Best-effort label — we no longer call requestPermission() outside a gesture.
  // Detect platform support; the actual gesture-time grant is tracked separately
  // by the consumer via requestMotionPermission().
  const Ev = kind === 'motion' ? DeviceMotionEvent : DeviceOrientationEvent
  if (typeof Ev === 'undefined') return 'unsupported'
  const anyEv = Ev as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> }
  if (typeof anyEv.requestPermission !== 'function') return 'unsupported'
  return 'prompt'
}

export function useBehavioral(): BehavioralController {
  const [isCapturing, setIsCapturing] = useState(false)

  const startedAtRef = useRef<number | null>(null)
  const endedAtRef = useRef<number | null>(null)
  const stoppedProfileRef = useRef<BehavioralProfile | null>(null)

  const motionVecRef = useRef<RunningVec>(createRunningVec())
  const gyroVecRef = useRef<RunningVec>(createRunningVec())
  const orientVecRef = useRef<RunningVec>(createRunningVec())

  const motionSamplesRef = useRef(0)
  const orientSamplesRef = useRef(0)

  const motionLastTsRef = useRef<number | null>(null)
  const motionIntervalSumRef = useRef(0)

  const touchRef = useRef({
    pointerDown: 0,
    pointerMove: 0,
    pointerUp: 0,
    taps: 0,
    tapDurSum: 0,
    interTapSum: 0,
    interTapN: 0,
    moveSpeedSum: 0,
    moveSpeedN: 0,
    movePathSum: 0,
    movePathN: 0,

    active: new Map<number, {
      x: number
      y: number
      t: number
      path: number
      downX: number
      downY: number
      downT: number
    }>(),
    lastTapUpTs: null as number | null,

    // New — raw signals for behavioral scoring.
    pressureSamples: [] as number[],
    tapIntervalsMs: [] as number[],
    tapVelocities: [] as number[],
    tapTimes: [] as number[],
  })

  // Ring buffer of the last 10 |rotationRate| magnitudes for gyro_std.
  const gyroMagsRef = useRef<number[]>([])
  const GYRO_WINDOW = 10

  // Timestamped gyro magnitudes for tap-windowed analysis (gyro_during_tap).
  // We cap the buffer to avoid unbounded growth on long sessions.
  const gyroTimedRef = useRef<{ t: number; mag: number }[]>([])
  const GYRO_TIMED_CAP = 3000
  const TAP_GYRO_WINDOW_MS = 100

  const permissionsRef = useRef<BehavioralProfile['permissions']>({
    motion: 'unsupported',
    orientation: 'unsupported',
  })

  const cleanupRef = useRef<(() => void) | null>(null)

  const isTextInputFocused = useCallback((): boolean => {
    const active = document.activeElement
    return active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA'
  }, [])

  const stop = useCallback((): BehavioralProfile => {
    if (stoppedProfileRef.current) return stoppedProfileRef.current

    if (cleanupRef.current) cleanupRef.current()
    cleanupRef.current = null

    endedAtRef.current = performance.now()
    setIsCapturing(false)

    const startedAt = startedAtRef.current ?? endedAtRef.current
    const endedAt = endedAtRef.current ?? startedAt
    const duration = Math.max(0, endedAt - startedAt)

    const motionSamples = motionSamplesRef.current
    const orientSamples = orientSamplesRef.current
    const intervalMean = motionSamples > 1
      ? motionIntervalSumRef.current / Math.max(1, motionSamples - 1)
      : 0

    const t = touchRef.current
    const tapDurMean = t.taps ? t.tapDurSum / t.taps : 0
    const interTapMean = t.interTapN ? t.interTapSum / t.interTapN : 0
    const moveSpeedMean = t.moveSpeedN ? t.moveSpeedSum / t.moveSpeedN : 0
    const movePathMean = t.movePathN ? t.movePathSum / t.movePathN : 0

    // --- New behavioral metrics ---

    // Inter-tap CV = std / mean. Requires at least 2 intervals (3+ taps).
    let tapCv: number | undefined
    if (t.tapIntervalsMs.length >= 2 && interTapMean > 0) {
      let sq = 0
      for (let i = 0; i < t.tapIntervalsMs.length; i += 1) {
        const d = t.tapIntervalsMs[i] - interTapMean
        sq += d * d
      }
      const std = Math.sqrt(sq / Math.max(1, t.tapIntervalsMs.length - 1))
      tapCv = std / interTapMean
    }

    // Pressure variance across all pointerdown samples that reported a value.
    let pressureVariance: number | undefined
    if (t.pressureSamples.length >= 2) {
      let mean = 0
      for (let i = 0; i < t.pressureSamples.length; i += 1) mean += t.pressureSamples[i]
      mean /= t.pressureSamples.length
      let sq = 0
      for (let i = 0; i < t.pressureSamples.length; i += 1) {
        const d = t.pressureSamples[i] - mean
        sq += d * d
      }
      pressureVariance = sq / Math.max(1, t.pressureSamples.length - 1)
    }

    // gyro_std — std of |rotationRate| over the last 10 samples.
    let gyroStd: number | undefined
    if (gyroMagsRef.current.length >= 2) {
      const arr = gyroMagsRef.current
      let mean = 0
      for (let i = 0; i < arr.length; i += 1) mean += arr[i]
      mean /= arr.length
      let sq = 0
      for (let i = 0; i < arr.length; i += 1) {
        const d = arr[i] - mean
        sq += d * d
      }
      gyroStd = Math.sqrt(sq / Math.max(1, arr.length - 1))
    }

    const accelStats = finalizeRunningVec(motionVecRef.current)
    const accelVariation = motionSamples >= 2 ? accelStats.mag_std : undefined

    // tap_velocity_mean / tap_velocity_cv
    let tapVelocityMean: number | undefined
    let tapVelocityCv: number | undefined
    if (t.tapVelocities.length >= 1) {
      let sum = 0
      for (let i = 0; i < t.tapVelocities.length; i += 1) sum += t.tapVelocities[i]
      tapVelocityMean = sum / t.tapVelocities.length
      if (t.tapVelocities.length >= 2 && tapVelocityMean > 0) {
        let sq = 0
        for (let i = 0; i < t.tapVelocities.length; i += 1) {
          const d = t.tapVelocities[i] - tapVelocityMean
          sq += d * d
        }
        const std = Math.sqrt(sq / Math.max(1, t.tapVelocities.length - 1))
        tapVelocityCv = std / tapVelocityMean
      }
    }

    // gyro_during_tap — for every tap time, mean |rotationRate| in the
    // ±100 ms window from the timestamped gyro buffer.
    let gyroDuringTap: number | undefined
    if (t.tapTimes.length > 0 && gyroTimedRef.current.length > 0) {
      const samples = gyroTimedRef.current
      const perTapMeans: number[] = []
      for (let i = 0; i < t.tapTimes.length; i += 1) {
        const tapT = t.tapTimes[i]
        let sum = 0
        let n = 0
        for (let j = 0; j < samples.length; j += 1) {
          const dt = samples[j].t - tapT
          if (dt < -TAP_GYRO_WINDOW_MS) continue
          if (dt > TAP_GYRO_WINDOW_MS) break
          sum += samples[j].mag
          n += 1
        }
        if (n > 0) perTapMeans.push(sum / n)
      }
      if (perTapMeans.length > 0) {
        let s = 0
        for (let i = 0; i < perTapMeans.length; i += 1) s += perTapMeans[i]
        gyroDuringTap = s / perTapMeans.length
      }
    }

    const interTapRegularity = tapCv !== undefined ? Math.max(0, 1 - tapCv) : undefined

    const profile: BehavioralProfile = {
      device: {
        device_type: inferDeviceType(),
        user_agent: navigator.userAgent,
        language: navigator.language,
        languages: Array.from(navigator.languages ?? []),
        timezone_offset_min: new Date().getTimezoneOffset(),
        touch_capable: isTouchCapable(),
        hardware_concurrency: navigator.hardwareConcurrency,
        screen: {
          width: window.screen.width,
          height: window.screen.height,
          device_pixel_ratio: window.devicePixelRatio || 1,
        },
      },
      permissions: permissionsRef.current,
      session: {
        started_at_ms: startedAt,
        ended_at_ms: endedAt,
        duration_ms: duration,
      },
      motion: {
        samples: motionSamples,
        interval_ms_mean: intervalMean,
        accel_gravity: accelStats,
        rotation_rate: finalizeRunningVec(gyroVecRef.current),
        gyro_std: gyroStd,
        accel_variation: accelVariation,
        gyro_during_tap: gyroDuringTap,
      },
      orientation: {
        samples: orientSamples,
        alpha_beta_gamma: finalizeRunningVec(orientVecRef.current),
      },
      touch: {
        pointer_down: t.pointerDown,
        pointer_move: t.pointerMove,
        pointer_up: t.pointerUp,
        taps: t.taps,
        tap_duration_ms_mean: tapDurMean,
        inter_tap_ms_mean: interTapMean,
        move_speed_px_per_ms_mean: moveSpeedMean,
        move_path_len_px_mean: movePathMean,
        tap_cv: tapCv,
        inter_tap_regularity: interTapRegularity,
        pressure_variance: pressureVariance,
        pressure_samples: t.pressureSamples.slice(),
        tap_intervals_ms: t.tapIntervalsMs.slice(),
        tap_velocity_mean: tapVelocityMean,
        tap_velocity_cv: tapVelocityCv,
        tap_velocities: t.tapVelocities.slice(),
      },
    }

    stoppedProfileRef.current = profile
    return profile
  }, [])

  const start = useCallback(async () => {
    if (isCapturing) return
    stoppedProfileRef.current = null

    // reset accumulators
    startedAtRef.current = performance.now()
    endedAtRef.current = null
    motionVecRef.current = createRunningVec()
    gyroVecRef.current = createRunningVec()
    orientVecRef.current = createRunningVec()
    motionSamplesRef.current = 0
    orientSamplesRef.current = 0
    motionLastTsRef.current = null
    motionIntervalSumRef.current = 0
    touchRef.current.pointerDown = 0
    touchRef.current.pointerMove = 0
    touchRef.current.pointerUp = 0
    touchRef.current.taps = 0
    touchRef.current.tapDurSum = 0
    touchRef.current.interTapSum = 0
    touchRef.current.interTapN = 0
    touchRef.current.moveSpeedSum = 0
    touchRef.current.moveSpeedN = 0
    touchRef.current.movePathSum = 0
    touchRef.current.movePathN = 0
    touchRef.current.active.clear()
    touchRef.current.lastTapUpTs = null
    touchRef.current.pressureSamples = []
    touchRef.current.tapIntervalsMs = []
    touchRef.current.tapVelocities = []
    touchRef.current.tapTimes = []
    gyroMagsRef.current = []
    gyroTimedRef.current = []

    setIsCapturing(true)

    // We do NOT request iOS motion/orientation permissions here — doing so
    // outside a user gesture is broken on iOS Safari (silently rejected).
    // The consumer must call requestMotionPermission() from a click/touch
    // handler before invoking start(). Here we just record platform support.
    permissionsRef.current = {
      motion: permissionSupportLabel('motion'),
      orientation: permissionSupportLabel('orientation'),
    }

    const onMotion = (e: DeviceMotionEvent) => {
      // accelerationIncludingGravity is more widely supported
      const a = e.accelerationIncludingGravity
      const r = e.rotationRate
      if (a) updateRunningVec(motionVecRef.current, a.x ?? 0, a.y ?? 0, a.z ?? 0)
      if (r) {
        const ra = r.alpha ?? 0
        const rb = r.beta ?? 0
        const rg = r.gamma ?? 0
        updateRunningVec(gyroVecRef.current, ra, rb, rg)
        // Push |rotationRate| into the short ring buffer (last GYRO_WINDOW samples).
        const mag = Math.sqrt(ra * ra + rb * rb + rg * rg)
        const buf = gyroMagsRef.current
        buf.push(mag)
        if (buf.length > GYRO_WINDOW) buf.shift()
        // Timestamped buffer for tap-windowed analysis.
        const timed = gyroTimedRef.current
        timed.push({ t: performance.now(), mag })
        if (timed.length > GYRO_TIMED_CAP) timed.shift()
      }

      const now = performance.now()
      if (motionLastTsRef.current !== null) motionIntervalSumRef.current += (now - motionLastTsRef.current)
      motionLastTsRef.current = now
      motionSamplesRef.current += 1
    }

    const onOrientation = (e: DeviceOrientationEvent) => {
      updateRunningVec(orientVecRef.current, e.alpha ?? 0, e.beta ?? 0, e.gamma ?? 0)
      orientSamplesRef.current += 1
    }

    const onPointerDown = (e: PointerEvent) => {
      const t = touchRef.current
      t.pointerDown += 1
      const downT = performance.now()
      t.active.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        t: downT,
        path: 0,
        downX: e.clientX,
        downY: e.clientY,
        downT,
      })

      // Pressure: meaningful only for touch/stylus inputs; mouse reports 0/0.5.
      // We accept any non-default value (PointerEvent default is 0 for no-button
      // pointer, 0.5 for active mouse, varies on touch screens).
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        if (typeof e.pressure === 'number') t.pressureSamples.push(e.pressure)
      }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (isTextInputFocused()) return

      const t = touchRef.current
      t.pointerMove += 1
      const cur = t.active.get(e.pointerId)
      if (!cur) return
      const now = performance.now()
      const dx = e.clientX - cur.x
      const dy = e.clientY - cur.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      const dt = Math.max(1, now - cur.t)
      cur.path += dist

      t.moveSpeedSum += dist / dt
      t.moveSpeedN += 1

      cur.x = e.clientX
      cur.y = e.clientY
      cur.t = now
      t.active.set(e.pointerId, cur)
    }
    const onPointerUpOrCancel = (e: PointerEvent) => {
      const t = touchRef.current
      t.pointerUp += 1

      const cur = t.active.get(e.pointerId)
      if (!cur) return
      t.active.delete(e.pointerId)

      const now = performance.now()
      const dur = Math.max(0, now - cur.t)
      // consider as tap if short and small travel
      const isTap = cur.path <= 12
      if (isTap) {
        t.taps += 1
        t.tapDurSum += dur
        if (t.lastTapUpTs !== null) {
          const interval = now - t.lastTapUpTs
          t.interTapSum += interval
          t.interTapN += 1
          t.tapIntervalsMs.push(interval)
        }
        t.lastTapUpTs = now

        // Straight-line tap velocity: |up - down| / total duration (px/ms).
        const dx = e.clientX - cur.downX
        const dy = e.clientY - cur.downY
        const straight = Math.sqrt(dx * dx + dy * dy)
        const tapDur = Math.max(1, now - cur.downT)
        t.tapVelocities.push(straight / tapDur)

        // Record tap timestamp for gyro-during-tap window matching at stop().
        t.tapTimes.push(now)
      }

      t.movePathSum += cur.path
      t.movePathN += 1
    }

    window.addEventListener('devicemotion', onMotion, { passive: true })
    window.addEventListener('deviceorientation', onOrientation, { passive: true })

    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerup', onPointerUpOrCancel, { passive: true })
    window.addEventListener('pointercancel', onPointerUpOrCancel, { passive: true })

    cleanupRef.current = () => {
      window.removeEventListener('devicemotion', onMotion)
      window.removeEventListener('deviceorientation', onOrientation)

      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUpOrCancel)
      window.removeEventListener('pointercancel', onPointerUpOrCancel)
    }
  }, [isCapturing, isTextInputFocused])

  return useMemo(() => ({ start, stop, isCapturing }), [isCapturing, start, stop])
}
