export const ensureCulqiEnvironment = async (publicKey: string | undefined): Promise<void> => {
  const frontend = /^pk_(test|live)_[A-Za-z0-9]+$/.exec(publicKey ?? '')?.[1]
  if (!frontend) throw new Error('La configuración de pago no es válida para este entorno.')
  const response = await fetch('/.netlify/functions/culqi-config', { cache: 'no-store' })
  const result: unknown = await response.json().catch(() => null)
  const backend = result && typeof result === 'object' && 'environment' in result ? result.environment : null
  if (!response.ok || backend !== frontend) throw new Error('La configuración de pago no coincide con este entorno. Inténtalo más tarde.')
}
