/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DESKTOP_AD_FRAME_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
