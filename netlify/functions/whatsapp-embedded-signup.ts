import { json } from '../lib/request'

const getGraphApiVersion = () => process.env.META_GRAPH_API_VERSION || 'v25.0'
const whatsappEmbeddedSignupRedirectUri = 'https://theblackcatrockbar.com/meta-whatsapp-callback'

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return json(405, { ok: false, message: 'Método no permitido.' })
  }

  try {
    const body: unknown = await request.json().catch(() => null)
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof (body as Record<string, unknown>).code === 'string' ? (body as Record<string, unknown>).code.trim() : ''
    const featureType = typeof body === 'object' && body !== null && 'featureType' in body && typeof (body as Record<string, unknown>).featureType === 'string' ? (body as Record<string, unknown>).featureType.trim() : ''
    const redirectUri = typeof body === 'object' && body !== null && 'redirectUri' in body && typeof (body as Record<string, unknown>).redirectUri === 'string' ? (body as Record<string, unknown>).redirectUri.trim() : ''

    if (!code) {
      return json(400, { ok: false, message: 'Falta el authorization code de Meta.' })
    }

    if (featureType && featureType !== 'whatsapp_business_app_onboarding') {
      return json(400, { ok: false, message: 'Tipo de feature no soportado para este onboarding.' })
    }

    if (redirectUri !== whatsappEmbeddedSignupRedirectUri) {
      return json(400, { ok: false, message: 'redirectUri no permitido para este onboarding.' })
    }

    const appId = process.env.META_APP_ID
    const appSecret = process.env.META_APP_SECRET
    const graphApiVersion = getGraphApiVersion()

    if (!appId || !appSecret) {
      return json(500, {
        ok: false,
        message: 'Faltan META_APP_ID o META_APP_SECRET en Netlify Environment Variables.',
      })
    }

    const appAccessToken = `${appId}|${appSecret}`

    const exchangeUrl = new URL(`https://graph.facebook.com/${graphApiVersion}/oauth/access_token`)
    exchangeUrl.searchParams.set('client_id', appId)
    exchangeUrl.searchParams.set('client_secret', appSecret)
    exchangeUrl.searchParams.set('code', code)
    exchangeUrl.searchParams.set('redirect_uri', whatsappEmbeddedSignupRedirectUri)

    const exchangeResponse = await fetch(exchangeUrl, {
      method: 'GET',
      headers: { accept: 'application/json' },
    })

    const exchangeData = await exchangeResponse.json() as {
      access_token?: string
      token_type?: string
      expires_in?: number
      error?: { message?: string; type?: string; code?: number }
    }

    if (!exchangeResponse.ok || !exchangeData.access_token) {
      console.error('Meta embedded signup code exchange failed:', exchangeData)
      return json(400, {
        ok: false,
        message: exchangeData.error?.message || 'No se pudo intercambiar el code de Meta.',
      })
    }

    const validationUrl = new URL(`https://graph.facebook.com/${graphApiVersion}/debug_token`)
    validationUrl.searchParams.set('input_token', exchangeData.access_token)
    validationUrl.searchParams.set('access_token', appAccessToken)

    const validationResponse = await fetch(validationUrl, {
      method: 'GET',
      headers: { accept: 'application/json' },
    })

    const validationData = await validationResponse.json() as {
      data?: {
        is_valid?: boolean
        app_id?: string
        type?: string
      }
      error?: { message?: string }
    }

    if (!validationResponse.ok || !validationData.data?.is_valid || validationData.data.app_id !== appId) {
      console.error('Meta access token validation failed: app_id mismatch or invalid token.')
      return json(400, {
        ok: false,
        message: validationData.error?.message || 'El token devuelto por Meta no pudo validarse para esta App.',
      })
    }

    return json(200, {
      ok: true,
      message: 'Embedded Signup autorizado correctamente para WhatsApp Business App + Cloud API Coexistence.',
      status: 'embedded_signup_ready',
      featureType: featureType || 'whatsapp_business_app_onboarding',
      appId,
      graphApiVersion,
      tokenType: exchangeData.token_type || 'bearer',
      expiresIn: exchangeData.expires_in ?? null,
      wabaId: null,
      phoneNumberId: null,
      businessId: null,
    })
  } catch (error) {
    console.error('WhatsApp embedded signup function failed:', error)
    return json(500, { ok: false, message: 'No se pudo completar el onboarding de WhatsApp Business.' })
  }
}
