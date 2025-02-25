/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PONDER_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}