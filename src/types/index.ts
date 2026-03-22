export interface WorkerProfile {
  workerId: string
  firstName: string
  lastName: string
  employeeId: string
  jobRole: string
  employerSite: string
  tenantId: string
  rekognitionFaceId?: string
  cognitiveBaseline?: CognitiveBaseline
  enrolledAt?: string
}

export interface CognitiveBaseline {
  stroopScore: number
  reflexVelocityMs: number
  // Legacy numeric score kept for UI compatibility (0-100)
  vocalAccuracy: number
  // New: lightweight speaker embedding (192-dim)
  vocalEmbedding?: number[]
  // New: enrollment quality (0-1)
  vocalQuality?: number
  // New: similarity threshold used for verification
  vocalSimilarityThreshold?: number
  reactionTimeMs: number
}

// Legacy types from the original starter are intentionally removed.
// EDGUARD v2 pages are routed with React Router.
