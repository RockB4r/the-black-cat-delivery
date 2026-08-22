/// <reference types="vite/client" />

interface CulqiCheckoutSettings {
  title: string
  currency: 'PEN'
  amount: number
  order?: string
}

interface CulqiCheckoutConfig {
  settings: CulqiCheckoutSettings
  client: {
    email: string
  }
  options: {
    lang: 'es'
    modal: boolean
    paymentMethods: Record<string, boolean>
    paymentMethodsSort: string[]
  }
  appearance: {
    theme: 'default'
    menuType: 'sliderTop'
  }
}

interface CulqiCheckoutInstance {
  token?: { id: string }
  order?: unknown
  error?: unknown
  culqi?: () => void
  open: () => void
  close: () => void
}

interface CulqiCheckoutConstructor {
  new (publicKey: string, config: CulqiCheckoutConfig): CulqiCheckoutInstance
}

interface Window {
  CulqiCheckout?: CulqiCheckoutConstructor
}

interface ImportMetaEnv {
  readonly VITE_CULQI_PUBLIC_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
