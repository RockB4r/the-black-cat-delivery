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

const welcomeHeroUrl = 'https://theblackcatrockbar.com/branding/member-welcome-email-hero.png'

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;',
})[character] ?? character)

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
  const greeting = isVip ? 'Tienes un beneficio exclusivo de The Black Cat.' : '¡Bienvenido a Black Cat Member!'
  const expiration = new Intl.DateTimeFormat('es-PE', { dateStyle: 'long', timeZone: 'America/Lima' }).format(new Date(promotion.expires_at))
  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px 12px;background:#11100f;color:#f7f0df;font-family:Arial,Helvetica,sans-serif;">
    <main style="max-width:600px;margin:0 auto;overflow:hidden;border:1px solid #4c4131;border-radius:16px;background:#211f1c;">
      <img src="${welcomeHeroUrl}" alt="The Black Cat Rock Bar" width="600" style="display:block;width:100%;height:auto;border:0;" />
      <section style="padding:28px 28px 32px;">
        <p style="margin:0 0 8px;color:#e74b32;font-size:12px;font-weight:700;letter-spacing:1.5px;">THE BLACK CAT · MEMBER</p>
        <h1 style="margin:0 0 16px;color:#fff7e7;font-size:28px;line-height:1.2;">${escapeHtml(title)}</h1>
        <p style="margin:0 0 18px;color:#e5dccd;font-size:16px;line-height:1.55;">Hola, ${escapeHtml(member.full_name)}.<br />${greeting}</p>
        <div style="margin:0 0 20px;padding:18px;border:1px solid #d99d29;border-radius:12px;background:#171513;text-align:center;">
          <p style="margin:0 0 7px;color:#d7cdbd;font-size:13px;">TU CÓDIGO PERSONAL</p>
          <strong style="display:block;color:#ffc33d;font-size:25px;letter-spacing:1px;">${escapeHtml(promotion.code)}</strong>
        </div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px;border-collapse:collapse;color:#f7f0df;font-size:15px;line-height:1.65;">
          <tr><td style="padding:5px 0;color:#bfb4a1;">Descuento</td><td style="padding:5px 0;text-align:right;font-weight:700;">${promotion.discount_percent}% en productos</td></tr>
          <tr><td style="padding:5px 0;color:#bfb4a1;">Compra mínima</td><td style="padding:5px 0;text-align:right;font-weight:700;">S/ ${Number(promotion.minimum_subtotal).toFixed(2)}</td></tr>
          <tr><td style="padding:5px 0;color:#bfb4a1;">Vigencia</td><td style="padding:5px 0;text-align:right;font-weight:700;">Hasta el ${escapeHtml(expiration)}</td></tr>
        </table>
        <p style="margin:0 0 24px;color:#d7cdbd;font-size:14px;line-height:1.55;">Válido para un solo uso. No acumulable con otros códigos.</p>
        <a href="https://theblackcatrockbar.com" style="display:inline-block;padding:13px 20px;border-radius:8px;background:#ffc33d;color:#19140c;font-size:15px;font-weight:700;text-decoration:none;">Usar mi beneficio</a>
      </section>
    </main>
  </body>
</html>`
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [member.email],
      subject: `${title} · The Black Cat`,
      html,
      text: [
        `Hola, ${member.full_name}.`,
        '',
        greeting,
        `Tu código personal es: ${promotion.code}`,
        `Descuento: ${promotion.discount_percent}% en productos.`,
        `Compra mínima: S/ ${Number(promotion.minimum_subtotal).toFixed(2)}.`,
        'Válido para un solo uso. No acumulable con otros códigos.',
        `Vence: ${expiration}.`,
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
