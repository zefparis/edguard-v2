/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_HV_API_KEY: string
  readonly VITE_TENANT_ID: string
  readonly VITE_PAYMENT_THRESHOLD?: string
  readonly VITE_MODE?: 'payment' | string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
