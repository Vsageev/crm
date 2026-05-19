/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEVTOOLS_WIDGET_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
