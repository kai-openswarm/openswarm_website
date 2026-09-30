/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** Development only: "1" serves fixture data and skips sign-in. */
  readonly VITE_ADMIN_MOCK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
