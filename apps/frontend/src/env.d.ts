/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PROTOCOL_SNAPSHOT_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
