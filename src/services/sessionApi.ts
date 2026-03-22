const API = import.meta.env.VITE_API_URL || 'https://hybrid-vector-api.onrender.com'
const TENANT = import.meta.env.VITE_TENANT_ID
const API_KEY = import.meta.env.VITE_HV_API_KEY

const headers = () => {
  if (!API_KEY) throw new Error('Missing VITE_HV_API_KEY')
  if (!TENANT) throw new Error('Missing VITE_TENANT_ID')
  return {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
  }
}

export type SessionCheckpointPayload = {
  student_id: string
  session_id: string
  checkpoint_number: number
  face_b64: string
  // The backend expects cognitive_score currently; we keep it optional.
  cognitive_score?: number
  // EDGUARD session extensions (Supabase columns already exist)
  // -- ALTER TABLE edguard_checkpoints
  // -- ADD COLUMN IF NOT EXISTS session_id TEXT;
  // -- ADD COLUMN IF NOT EXISTS event_type TEXT;
  // -- ADD COLUMN IF NOT EXISTS behavioral_score FLOAT;
  event_type?: string
  behavioral_score?: number
}

export async function sendSessionCheckpoint(payload: SessionCheckpointPayload): Promise<unknown> {
  const res = await fetch(`${API}/edguard/session/checkpoint`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ ...payload, tenant_id: TENANT }),
  })
  if (!res.ok) throw new Error(`Checkpoint failed: ${res.status}`)
  return res.json()
}
