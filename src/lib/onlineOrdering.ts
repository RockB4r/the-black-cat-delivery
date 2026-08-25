export const onlineOrderingHours = {
  timeZone: 'America/Lima',
  startMinutes: 18 * 60,
  endMinutes: 1 * 60,
  display: '6:00 PM - 1:00 AM',
} as const

const localMinutes = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: onlineOrderingHours.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

export const isOnlineOrderingOpen = (date = new Date()) => {
  const now = localMinutes(date)
  const { startMinutes, endMinutes } = onlineOrderingHours
  return startMinutes < endMinutes
    ? now >= startMinutes && now < endMinutes
    : now >= startMinutes || now < endMinutes
}
