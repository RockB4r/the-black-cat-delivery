type MemberPromotion = {
  id: string
  code: string
  discount_percent: number
  minimum_subtotal: number
  expires_at: string
  campaign_type: 'welcome' | 'vip'
  email_notification_status: 'pending' | 'sent' | 'failed'
}

type MemberRecipient = { id: string; full_name: string; email: string | null }

const server = () => {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase server environment is incomplete.')
  return { url, key }
}

const headers = (key: string, extra: Record<string, string> = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra })

export const sendMemberPromotionEmail = async (memberId: string, campaignType: 'welcome' | 'vip') => {
  const { url, key } = server()
  const memberResponse = await fetch(`${url}/rest/v1/members?id=eq.${encodeURIComponent(memberId)}&select=id,full_name,email&limit=1`, { headers: headers(key) })
  const members = await memberResponse.json().catch(() => null) as MemberRecipient[] | null
  const member = Array.isArray(members) ? members[0] : null
  if (!memberResponse.ok || !member?.email) throw new Error('The member does not have a valid email address.')
  const promotionResponse = await fetch(`${url}/rest/v1/promotion_codes?member_id=eq.${encodeURIComponent(memberId)}&campaign_type=eq.${campaignType}&status=eq.active&select=id,code,discount_percent,minimum_subtotal,expires_at,campaign_type,email_notification_status&order=created_at.desc&limit=1`, { headers: headers(key) })
  const promotions = await promotionResponse.json().catch(() => null) as MemberPromotion[] | null
  const promotion = Array.isArray(promotions) ? promotions[0] : null
  if (!promotionResponse.ok || !promotion) throw new Error('No active member promotion was found.')
  if (promotion.email_notification_status === 'sent') return 'sent' as const

  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.ORDER_NOTIFICATION_FROM_EMAIL
  if (!apiKey || !from) throw new Error('Email notification environment is incomplete.')

  const isVip = promotion.campaign_type === 'vip'
  const title = isVip ? 'Tu beneficio VIP' : 'Tu beneficio de bienvenida'
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [member.email],
      subject: `${title} · The Black Cat`,
      text: [
        `Hola, ${member.full_name}.`,
        '',
        isVip ? 'Tienes un beneficio exclusivo de The Black Cat.' : '¡Bienvenido a Black Cat Member!',
        `Tu código personal es: ${promotion.code}`,
        `Descuento: ${promotion.discount_percent}% en productos.`,
        `Compra mínima: S/ ${Number(promotion.minimum_subtotal).toFixed(2)}.`,
        'Válido para un solo uso. No acumulable con otros códigos.',
        `Vence: ${new Intl.DateTimeFormat('es-PE', { dateStyle: 'long', timeZone: 'America/Lima' }).format(new Date(promotion.expires_at))}.`,
        '',
        'Úsalo al finalizar tu pedido en theblackcatrockbar.com.',
      ].join('\n'),
    }),
  })
  const status = response.ok ? 'sent' : 'failed'
  await fetch(`${url}/rest/v1/promotion_codes?id=eq.${encodeURIComponent(promotion.id)}`, {
    method: 'PATCH', headers: headers(key, { Prefer: 'return=minimal' }),
    body: JSON.stringify({ email_notification_status: status, ...(response.ok ? { email_sent_at: new Date().toISOString() } : {}) }),
  })
  if (!response.ok) throw new Error(`Resend returned ${response.status}.`)
  return status as const
}
