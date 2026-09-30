export const normalizeGiftPaymentCode = (value: string): string | null => {
  const normalized = value.trim().toLowerCase().replace(/[-\s]/g, '')
  return /^[a-f0-9]{32}$/.test(normalized) ? normalized : null
}
