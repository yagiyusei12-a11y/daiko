/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
  readonly VITE_STRIPE_PRICE_MONTHLY?: string;
  readonly VITE_STRIPE_PRICE_YEARLY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
