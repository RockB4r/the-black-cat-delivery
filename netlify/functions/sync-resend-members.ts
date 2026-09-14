type MemberForMarketing = {
  id: string
  full_name: string | null
  email: string | null
}

type ResendContact = { id?: string; email?: string }
type ResendList<T> = { data?: T[]; has_more?: boolean }
type ResendTopic = { id?: string; subscription?: 'opt_in' | 'opt_out' }
type ResendNamedResource = { id?: string; name?: string }

const memberFields = 'id,full_name,email'
const emailPattern = /^[^\s@,()]+@[^\s@,()]+\.[^\s@,()]+$/
const membersSegmentName = 'Black Cat Members'
const promotionsTopicName = 'Promociones & Descuentos'

const resendHeaders = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  'content-type': 'application/json',
  // Required by Resend for direct REST API requests.
  'user-agent': 'the-black-cat-members-sync/1.0',
})

const asEmail = (value: string | null | undefined) => {
  const email = value?.trim().toLowerCase() ?? ''
  return emailPattern.test(email) ? email : ''
}

const nameParts = (fullName: string | null) => {
  const words = fullName?.trim().split(/\s+/).filter(Boolean) ?? []
  return { first_name: words[0] ?? 'Socio', last_name: words.slice(1).join(' ') || undefined }
}

const forEachInBatches = async <T>(values: T[], action: (value: T) => Promise<void>, batchSize = 5) => {
  for (let index = 0; index < values.length; index += batchSize) {
    await Promise.all(values.slice(index, index + batchSize).map(action))
  }
}

const listResendContacts = async (apiKey: string, path: '/contacts' | `/segments/${string}/contacts`) => {
  const contacts = new Set<string>()
  let after = ''
  while (true) {
    const url = new URL(`https://api.resend.com${path}`)
    url.searchParams.set('limit', '100')
    if (after) url.searchParams.set('after', after)
    const response = await fetch(url, { headers: resendHeaders(apiKey) })
    if (!response.ok) throw new Error(`Resend contacts request failed with ${response.status}.`)
    const body = await response.json() as ResendList<ResendContact>
    const page = Array.isArray(body.data) ? body.data : []
    for (const contact of page) {
      const email = asEmail(contact.email)
      if (email) contacts.add(email)
    }
    if (!body.has_more || !page.length) break
    const next = page[page.length - 1]?.id
    if (!next || next === after) throw new Error('Resend contact pagination did not advance.')
    after = next
  }
  return contacts
}

const listNamedResendResources = async (apiKey: string, path: '/segments' | '/topics') => {
  const resources: ResendNamedResource[] = []
  let after = ''
  while (true) {
    const url = new URL(`https://api.resend.com${path}`)
    url.searchParams.set('limit', '100')
    if (after) url.searchParams.set('after', after)
    const response = await fetch(url, { headers: resendHeaders(apiKey) })
    if (!response.ok) throw new Error(`Resend ${path} request failed with ${response.status}.`)
    const body = await response.json() as ResendList<ResendNamedResource>
    const page = Array.isArray(body.data) ? body.data : []
    resources.push(...page)
    if (!body.has_more || !page.length) break
    const next = page[page.length - 1]?.id
    if (!next || next === after) throw new Error(`Resend ${path} pagination did not advance.`)
    after = next
  }
  return resources
}

const getMembersSegmentId = async (apiKey: string) => {
  const segments = await listNamedResendResources(apiKey, '/segments')
  const existing = segments.find((segment) => segment.name === membersSegmentName)?.id
  if (existing) return existing
  const response = await fetch('https://api.resend.com/segments', {
    method: 'POST',
    headers: resendHeaders(apiKey),
    body: JSON.stringify({ name: membersSegmentName }),
  })
  const created = await response.json().catch(() => null) as ResendNamedResource | null
  if (!response.ok || !created?.id) throw new Error(`Resend segment creation failed with ${response.status}.`)
  return created.id
}

const getPromotionsTopicId = async (apiKey: string) => {
  const topics = await listNamedResendResources(apiKey, '/topics')
  const id = topics.find((topic) => topic.name === promotionsTopicName)?.id
  if (!id) throw new Error(`Resend topic "${promotionsTopicName}" was not found.`)
  return id
}

const listEligibleMembers = async (url: string, key: string) => {
  const members = new Map<string, MemberForMarketing>()
  let lastId = ''
  while (true) {
    const query = new URLSearchParams({
      select: memberFields,
      status: 'eq.active',
      marketing_consent: 'is.true',
      email: 'not.is.null',
      order: 'id.asc',
      limit: '1000',
    })
    if (lastId) query.set('id', `gt.${lastId}`)
    const response = await fetch(`${url}/rest/v1/members?${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (!response.ok) throw new Error(`Supabase member query failed with ${response.status}.`)
    const page = await response.json() as MemberForMarketing[]
    if (!page.length) break
    for (const member of page) {
      const email = asEmail(member.email)
      if (email) members.set(email, member)
    }
    const nextId = page[page.length - 1]?.id
    if (!nextId || nextId === lastId) throw new Error('Supabase member pagination did not advance.')
    lastId = nextId
  }
  return members
}

const createContact = async (apiKey: string, segmentId: string, topicId: string, member: MemberForMarketing) => {
  const email = asEmail(member.email)
  if (!email) throw new Error('Cannot create a contact without a valid email.')
  const response = await fetch('https://api.resend.com/contacts', {
    method: 'POST',
    headers: resendHeaders(apiKey),
    body: JSON.stringify({
      email,
      ...nameParts(member.full_name),
      unsubscribed: false,
      segments: [{ id: segmentId }],
      topics: [{ id: topicId, subscription: 'opt_in' }],
    }),
  })
  if (!response.ok) throw new Error(`Resend contact creation failed with ${response.status}.`)
}

const getTopicSubscription = async (apiKey: string, email: string, topicId: string) => {
  const response = await fetch(`https://api.resend.com/contacts/${encodeURIComponent(email)}/topics?limit=100`, {
    headers: resendHeaders(apiKey),
  })
  if (!response.ok) throw new Error(`Resend topic query failed with ${response.status}.`)
  const body = await response.json() as ResendList<ResendTopic>
  return (Array.isArray(body.data) ? body.data : []).find((topic) => topic.id === topicId)?.subscription
}

const updateTopicSubscription = async (apiKey: string, email: string, topicId: string, subscription: 'opt_in' | 'opt_out') => {
  const response = await fetch(`https://api.resend.com/contacts/${encodeURIComponent(email)}/topics`, {
    method: 'PATCH',
    headers: resendHeaders(apiKey),
    body: JSON.stringify({ topics: [{ id: topicId, subscription }] }),
  })
  if (!response.ok) throw new Error(`Resend topic update failed with ${response.status}.`)
}

const addToSegment = async (apiKey: string, email: string, segmentId: string) => {
  const response = await fetch(`https://api.resend.com/contacts/${encodeURIComponent(email)}/segments/${encodeURIComponent(segmentId)}`, {
    method: 'POST', headers: resendHeaders(apiKey),
  })
  if (!response.ok) throw new Error(`Resend segment addition failed with ${response.status}.`)
}

const removeFromSegment = async (apiKey: string, email: string, segmentId: string) => {
  const response = await fetch(`https://api.resend.com/contacts/${encodeURIComponent(email)}/segments/${encodeURIComponent(segmentId)}`, {
    method: 'DELETE', headers: resendHeaders(apiKey),
  })
  if (!response.ok) throw new Error(`Resend segment removal failed with ${response.status}.`)
}

// Mondays at 13:00 UTC are Mondays at 08:00 in America/Lima (Peru has no DST).
export const config = { schedule: '0 13 * * 1' }

export default async (_request: Request): Promise<void> => {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const resendApiKey = process.env.RESEND_API_KEY
  if (!supabaseUrl || !supabaseKey || !resendApiKey) {
    throw new Error('Member marketing sync configuration is incomplete.')
  }

  const members = await listEligibleMembers(supabaseUrl, supabaseKey)
  const [segmentId, topicId] = await Promise.all([
    getMembersSegmentId(resendApiKey),
    getPromotionsTopicId(resendApiKey),
  ])
  const [resendContacts, segmentContacts] = await Promise.all([
    listResendContacts(resendApiKey, '/contacts'),
    listResendContacts(resendApiKey, `/segments/${segmentId}/contacts`),
  ])
  const eligibleEmails = new Set(members.keys())
  const missingContacts = [...members.entries()].filter(([email]) => !resendContacts.has(email))
  const membersOutsideSegment = [...members.keys()].filter((email) => resendContacts.has(email) && !segmentContacts.has(email))
  const noLongerEligible = [...segmentContacts].filter((email) => !eligibleEmails.has(email))

  let created = 0
  let addedToSegment = 0
  let subscribedToTopic = 0
  let removedFromSegment = 0
  let failed = 0

  await forEachInBatches(missingContacts, async ([, member]) => {
    try {
      await createContact(resendApiKey, segmentId, topicId, member)
      created += 1
    } catch {
      failed += 1
    }
  })
  await forEachInBatches([...members.keys()].filter((email) => resendContacts.has(email)), async (email) => {
    try {
      // A manual Resend opt-out must always win over the member's prior consent.
      if (await getTopicSubscription(resendApiKey, email, topicId) === undefined) {
        await updateTopicSubscription(resendApiKey, email, topicId, 'opt_in')
        subscribedToTopic += 1
      }
    } catch {
      failed += 1
    }
  })
  await forEachInBatches(membersOutsideSegment, async (email) => {
    try {
      await addToSegment(resendApiKey, email, segmentId)
      addedToSegment += 1
    } catch {
      failed += 1
    }
  })
  await forEachInBatches(noLongerEligible, async (email) => {
    try {
      await removeFromSegment(resendApiKey, email, segmentId)
      removedFromSegment += 1
    } catch {
      failed += 1
    }
  })

  // Keep logs operational and aggregate-only: never write emails or member data.
  console.log('Resend member sync completed.', {
    eligible: eligibleEmails.size,
    created,
    addedToSegment,
    subscribedToTopic,
    removedFromSegment,
    failed,
  })
  if (failed) throw new Error(`Resend member sync completed with ${failed} failed operation(s).`)
}
