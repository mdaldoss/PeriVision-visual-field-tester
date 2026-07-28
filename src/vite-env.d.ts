/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MP_WASM?: string;
  readonly VITE_MP_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
