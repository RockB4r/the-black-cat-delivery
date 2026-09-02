import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Consumption, ConsumptionAudit, Member, PointMovement, ReceiptType, RewardCategory, StaffProfile } from './types'

const memberFields = 'id, document_type, document_number, dni, full_name, phone, email, birth_date, joined_at, points_balance, status, marketing_consent'
const consumptionFields = 'id, member_id, amount, points_earned, receipt_type, receipt_series, receipt_number, status, registered_by, consumed_at'
const rewards: { value: RewardCategory; label: string }[] = [{ value: 'craft_beer', label: 'Cerveza artesanal' }, { value: 'cocktail', label: 'Cóctel' }, { value: 'burger', label: 'Burger' }, { value: 'sandwich', label: 'Sandwich' }, { value: 'wings', label: 'Wings' }, { value: 'wrap', label: 'Wrap' }]
const hideDocument = (documentNumber: string) => `${'*'.repeat(Math.max(0, documentNumber.length - 2))}${documentNumber.slice(-2)}`
const formatDate = (value?: string) => value ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'
const money = (value: number) => `S/ ${Number(value).toFixed(2)}`
const earned = (value: number) => Math.floor(Math.max(0, value) / 30) * 2
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const readableError = (message?: string) => {
  const value = message?.toLowerCase() ?? ''
  if (value.includes('revert')) return 'Este consumo ya fue revertido.'
  if (value.includes('receipt') || value.includes('comprobante')) return 'Ese comprobante ya está asociado a otro consumo activo.'
  return message || 'No se pudo completar la operación. Intenta nuevamente.'
}

type KitchenStatusSetting = {
  value: {
    manual_closed?: boolean
    force_open?: boolean
    reason?: string | null
  }
  updated_at: string
  updated_by: string | null
}

type MetaWindow = Window & {
  FB?: {
    init: (config: Record<string, unknown>) => void
    login: (callback: (response: Record<string, unknown>) => void, options: Record<string, unknown>) => void
  }
  fbAsyncInit?: () => void
}

const kitchenClosureReasons = ['Alta demanda', 'Falta de personal', 'Problema técnico', 'Cierre anticipado', 'Otro']
const whatsappEmbeddedSignupRedirectUri = 'https://theblackcatrockbar.com/staff'

export function StaffDashboard({ profile, userId, onSignOut }: { profile: StaffProfile; userId: string; onSignOut: () => Promise<void> }) {
  const [documentNumber, setDocumentNumber] = useState(''); const [phone, setPhone] = useState(''); const [member, setMember] = useState<Member | null>(null)
  const [movements, setMovements] = useState<PointMovement[]>([]); const [consumptions, setConsumptions] = useState<Consumption[]>([]); const [staffNames, setStaffNames] = useState<Record<string, string>>({})
  const [message, setMessage] = useState(''); const [searching, setSearching] = useState(false); const [showCreate, setShowCreate] = useState(false); const [savingMember, setSavingMember] = useState(false)
  const [newName, setNewName] = useState(''); const [newDocumentType, setNewDocumentType] = useState<'DNI' | 'CE'>('DNI'); const [newDocumentNumber, setNewDocumentNumber] = useState(''); const [newPhone, setNewPhone] = useState(''); const [newEmail, setNewEmail] = useState(''); const [newBirthDate, setNewBirthDate] = useState(''); const [marketingConsent, setMarketingConsent] = useState(false)
  const [amount, setAmount] = useState(''); const [receiptType, setReceiptType] = useState<ReceiptType>('boleta'); const [receiptSeries, setReceiptSeries] = useState(''); const [receiptNumber, setReceiptNumber] = useState(''); const [consumptionNotes, setConsumptionNotes] = useState(''); const [savingConsumption, setSavingConsumption] = useState(false)
  const [savingRedemption, setSavingRedemption] = useState(false); const [rewardCategory, setRewardCategory] = useState<RewardCategory>('craft_beer'); const [rewardProductName, setRewardProductName] = useState('')
  const [correcting, setCorrecting] = useState<Consumption | null>(null); const [correctionAmount, setCorrectionAmount] = useState(''); const [correctionType, setCorrectionType] = useState<ReceiptType>('boleta'); const [correctionSeries, setCorrectionSeries] = useState(''); const [correctionNumber, setCorrectionNumber] = useState(''); const [correctionReason, setCorrectionReason] = useState(''); const [savingCorrection, setSavingCorrection] = useState(false)
  const [reverting, setReverting] = useState<Consumption | null>(null); const [reversalReason, setReversalReason] = useState(''); const [savingReversal, setSavingReversal] = useState(false)
  const [auditFor, setAuditFor] = useState<string | null>(null); const [audits, setAudits] = useState<ConsumptionAudit[]>([]); const [loadingAudit, setLoadingAudit] = useState(false)
  const [editingMember, setEditingMember] = useState(false); const [editName, setEditName] = useState(''); const [editPhone, setEditPhone] = useState(''); const [editEmail, setEditEmail] = useState(''); const [savingMemberUpdate, setSavingMemberUpdate] = useState(false)
  const [kitchenStatus, setKitchenStatus] = useState<KitchenStatusSetting | null>(null); const [loadingKitchenStatus, setLoadingKitchenStatus] = useState(false); const [savingKitchenStatus, setSavingKitchenStatus] = useState(false); const [showKitchenCloseForm, setShowKitchenCloseForm] = useState(false); const [kitchenClosureReason, setKitchenClosureReason] = useState('')
  const [whatsappOnboardingMessage, setWhatsappOnboardingMessage] = useState(''); const [whatsappOnboardingBusy, setWhatsappOnboardingBusy] = useState(false); const [whatsappConnection, setWhatsappConnection] = useState<{ wabaId?: string; phoneNumberId?: string; businessId?: string; status?: string; message?: string } | null>(null)
  const role = profile.role
  const isStaff = role === 'staff'
  const isManager = role === 'manager'
  const isAdmin = role === 'admin'
  const canUseBasicFeatures = isStaff || isManager || isAdmin
  const canManageConsumptions = isManager || isAdmin
  const canManageMembers = isAdmin
  const canManageStaff = isAdmin
  const canManageKitchen = isManager || isAdmin

  const loadKitchenStatus = useCallback(async () => {
    if (!canManageKitchen) return
    setLoadingKitchenStatus(true)
    const { data, error } = await supabase.from('app_settings').select('value, updated_at, updated_by').eq('key', 'kitchen_status').maybeSingle<KitchenStatusSetting>()
    if (error) setMessage('No se pudo cargar el estado de cocina. Verifica tus permisos.')
    else setKitchenStatus(data)
    setLoadingKitchenStatus(false)
  }, [canManageKitchen])

  useEffect(() => {
    if (!canManageKitchen) return
    const existingScript = document.querySelector('script[data-whatsapp-sdk]')
    if (existingScript) return
    const script = document.createElement('script')
    script.src = 'https://connect.facebook.net/en_US/sdk.js'
    script.async = true
    script.defer = true
    script.crossOrigin = 'anonymous'
    script.dataset.whatsappSdk = 'true'
    script.onload = () => {
      const metaWindow = window as MetaWindow
      metaWindow.fbAsyncInit = () => {
        if (!metaWindow.FB) return
        metaWindow.FB.init({
          appId: import.meta.env.VITE_META_APP_ID || '',
          autoLogAppEvents: true,
          xfbml: true,
          version: 'v25.0',
        })
      }
    }
    document.head.appendChild(script)
  }, [canManageKitchen])

  useEffect(() => {
    if (!canManageKitchen) return
    const handleEmbeddedSignupMessage = (event: MessageEvent) => {
      const origin = event.origin || ''
      if (!origin.endsWith('facebook.com') && !origin.endsWith('facebook.net')) return
      const raw = typeof event.data === 'string' ? event.data : JSON.stringify(event.data ?? {})
      let payload: Record<string, unknown> | null = null
      try { payload = JSON.parse(raw) as Record<string, unknown> } catch { return }
      if (!payload || payload.type !== 'WA_EMBEDDED_SIGNUP') return
      const eventName = typeof payload.event === 'string' ? payload.event : 'UNKNOWN'
      const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {}
      if (eventName.includes('MIGRATION')) {
        setWhatsappOnboardingMessage('Meta devolvió un flujo de migración. Se detuvo el onboarding para preservar WhatsApp Business App y evitar una migración tradicional.')
        setWhatsappOnboardingBusy(false)
        return
      }
      if (eventName !== 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
        setWhatsappOnboardingMessage(`Evento de WhatsApp Business App Coexistence recibido: ${eventName}. Se espera el evento final de éxito para completar el onboarding.`)
        return
      }
      const nextConnection = {
        wabaId: typeof data.waba_id === 'string' ? data.waba_id : undefined,
        phoneNumberId: typeof data.phone_number_id === 'string' ? data.phone_number_id : undefined,
        businessId: typeof data.business_id === 'string' ? data.business_id : undefined,
        status: eventName,
      }
      if (!nextConnection.wabaId && !nextConnection.phoneNumberId && !nextConnection.businessId) {
        setWhatsappOnboardingMessage('El evento final de Coexistence llegó sin los IDs esperados. Este onboarding no se considera completado.')
        setWhatsappOnboardingBusy(false)
        return
      }
      setWhatsappConnection((current) => ({ ...current, ...nextConnection }))
      setWhatsappOnboardingMessage('WhatsApp Business App + Cloud API Coexistence completado correctamente.')
      setWhatsappOnboardingBusy(false)
    }
    window.addEventListener('message', handleEmbeddedSignupMessage)
    return () => window.removeEventListener('message', handleEmbeddedSignupMessage)
  }, [canManageKitchen])

  useEffect(() => { void loadKitchenStatus() }, [loadKitchenStatus])

  const startWhatsAppBusinessCoexistence = () => {
    const metaWindow = window as MetaWindow
    const appId = import.meta.env.VITE_META_APP_ID
    if (!appId) {
      setWhatsappOnboardingMessage('Falta VITE_META_APP_ID en la app para iniciar Embedded Signup.')
      return
    }
    if (!metaWindow.FB || typeof metaWindow.FB.login !== 'function') {
      setWhatsappOnboardingMessage('El SDK de Meta aún no está listo. Inténtalo de nuevo en unos segundos.')
      return
    }
    setWhatsappOnboardingBusy(true)
    setWhatsappOnboardingMessage('Abriendo Embedded Signup de Meta para WhatsApp Business App + Cloud API Coexistence...')
    metaWindow.FB.login((response: Record<string, unknown>) => {
      const authResponse = response && typeof response === 'object' && 'authResponse' in response ? response.authResponse as { code?: string } : null
      if (!authResponse || !authResponse.code) {
        setWhatsappOnboardingMessage('El flujo de Meta fue cancelado o no devolvió un authorization code válido.')
        setWhatsappOnboardingBusy(false)
        return
      }
      fetch('/.netlify/functions/whatsapp-embedded-signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: authResponse.code, featureType: 'whatsapp_business_app_onboarding', redirectUri: whatsappEmbeddedSignupRedirectUri }),
      }).then(async (response) => {
        const result = await response.json() as { ok?: boolean; message?: string; wabaId?: string; phoneNumberId?: string; businessId?: string; status?: string }
        if (!response.ok || !result.ok) {
          setWhatsappOnboardingMessage(result.message || 'No se pudo completar el onboarding de WhatsApp Business.')
          return
        }
        setWhatsappConnection({
          wabaId: result.wabaId,
          phoneNumberId: result.phoneNumberId,
          businessId: result.businessId,
          status: result.status || 'authorization_received',
          message: result.message,
        })
        setWhatsappOnboardingMessage('Autorización recibida. Esperando confirmación final de WhatsApp Coexistence…')
      }).catch(() => {
        setWhatsappOnboardingMessage('No se pudo conectar con el backend de Meta. Revisa la configuración de Netlify y vuelve a intentarlo.')
      }).finally(() => {
        setWhatsappOnboardingBusy(false)
      })
    }, {
      config_id: '2125405738379676',
      response_type: 'code',
      override_default_response_type: true,
      redirect_uri: whatsappEmbeddedSignupRedirectUri,
      extras: {
        setup: {},
        featureType: 'whatsapp_business_app_onboarding',
        sessionInfoVersion: '3',
      },
    })
  }

  const updateKitchenStatus = async (manualClosed: boolean) => {
    if (!canManageKitchen) return
    setSavingKitchenStatus(true); setMessage('')
    const { data, error } = await supabase.from('app_settings').update({
      value: { manual_closed: manualClosed, force_open: false, reason: manualClosed ? kitchenClosureReason || null : null },
      updated_by: userId,
    }).eq('key', 'kitchen_status').select('value, updated_at, updated_by').single<KitchenStatusSetting>()
    if (error || !data) setMessage('No se pudo actualizar el estado de cocina. Intenta nuevamente.')
    else {
      setKitchenStatus(data)
      setShowKitchenCloseForm(false)
      setKitchenClosureReason('')
      setMessage(manualClosed ? 'Cocina cerrada temporalmente.' : 'Cocina reabierta para pedidos web.')
    }
    setSavingKitchenStatus(false)
  }

  const resolveStaffNames = async (ids: string[]) => {
    const uniqueIds = [...new Set(ids.filter(Boolean))]
    if (!uniqueIds.length) return
    const { data } = await supabase.from('staff_profiles').select('user_id, display_name').in('user_id', uniqueIds)
    if (data) setStaffNames((current) => ({ ...current, ...Object.fromEntries(data.map((item) => [item.user_id, item.display_name])) }))
  }
  const loadMemberDetails = async (memberId: string) => {
    const [{ data: currentMember, error: memberError }, { data: history }, { data: recent }] = await Promise.all([
      supabase.from('members').select(memberFields).eq('id', memberId).maybeSingle<Member>(),
      supabase.from('point_movements').select('id, member_id, points, movement_type, source_type, source_id, description, registered_by, created_at').eq('member_id', memberId).order('created_at', { ascending: false }).limit(10),
      supabase.from('consumptions').select(consumptionFields).eq('member_id', memberId).order('consumed_at', { ascending: false }).limit(10),
    ])
    if (memberError || !currentMember) throw new Error('No se pudo actualizar el socio.')
    const loadedConsumptions = (recent as Consumption[] ?? [])
    setMember(currentMember); setMovements(history as PointMovement[] ?? []); setConsumptions(loadedConsumptions)
    await resolveStaffNames(loadedConsumptions.map((item) => item.registered_by))
  }
  const searchMember = async (event: FormEvent) => {
    event.preventDefault(); const safeDocumentNumber = documentNumber.replace(/\D/g, ''); const safePhone = phone.trim()
    if (!safeDocumentNumber && !safePhone) { setMessage('Ingresa el número de documento o teléfono del socio.'); return }
    setSearching(true); setMessage(''); setMember(null); setMovements([]); setConsumptions([])
    try { const query = supabase.from('members').select(memberFields).limit(1); const { data, error } = safeDocumentNumber ? await query.eq('document_number', safeDocumentNumber).maybeSingle<Member>() : await query.eq('phone', safePhone).maybeSingle<Member>(); if (error) setMessage('No se pudo buscar al socio. Intenta nuevamente.'); else if (!data) setMessage('No encontramos un socio con esos datos.'); else await loadMemberDetails(data.id) } catch { setMessage('No se pudo cargar la información del socio. Verifica tus permisos.') } finally { setSearching(false) }
  }
  const createMember = async (event: FormEvent) => {
    event.preventDefault(); const cleanDocumentNumber = newDocumentNumber.replace(/\D/g, ''); const cleanPhone = newPhone.trim(); const cleanEmail = newEmail.trim()
    const validDocument = newDocumentType === 'DNI' ? cleanDocumentNumber.length === 8 : cleanDocumentNumber.length >= 9 && cleanDocumentNumber.length <= 11
    if (!newName.trim() || !validDocument || !cleanPhone) { setMessage(newDocumentType === 'DNI' ? 'Completa nombre, DNI de 8 dígitos y teléfono.' : 'Completa nombre, Carné de Extranjería de 9 a 11 dígitos y teléfono.'); return }; if (cleanEmail && !validEmail(cleanEmail)) { setMessage('Ingresa un correo electrónico válido.'); return }
    setSavingMember(true); setMessage('')
    try { const [{ data: documentMatch }, { data: phoneMatch }] = await Promise.all([supabase.from('members').select('id').eq('document_type', newDocumentType).eq('document_number', cleanDocumentNumber).maybeSingle(), supabase.from('members').select('id').eq('phone', cleanPhone).maybeSingle()]); if (documentMatch) { setMessage('Ya existe un socio con ese tipo y número de documento.'); return }; if (phoneMatch) { setMessage('Ya existe un socio con ese teléfono.'); return }; const { data, error } = await supabase.from('members').insert({ full_name: newName.trim(), document_type: newDocumentType, document_number: cleanDocumentNumber, phone: cleanPhone, email: cleanEmail || null, birth_date: newBirthDate || null, marketing_consent: marketingConsent, status: 'active' }).select(memberFields).single<Member>(); if (error || !data) { setMessage(error?.code === '23505' ? 'Ya existe un socio con ese documento o teléfono.' : 'No se pudo crear el socio.'); return }; await loadMemberDetails(data.id); setDocumentNumber(cleanDocumentNumber); setNewName(''); setNewDocumentType('DNI'); setNewDocumentNumber(''); setNewPhone(''); setNewEmail(''); setNewBirthDate(''); setMarketingConsent(false); setShowCreate(false); setMessage('Socio creado y seleccionado correctamente.') } catch { setMessage('El socio se creó, pero no se pudo cargar su información. Búscalo por documento.') } finally { setSavingMember(false) }
  }
  const registerConsumption = async (event: FormEvent) => {
    event.preventDefault(); if (!member || member.status !== 'active') return; const value = Number(amount); const series = receiptSeries.trim().toUpperCase(); const number = receiptNumber.trim()
    if (!Number.isFinite(value) || value <= 0) { setMessage('Ingresa un monto válido mayor a S/ 0.'); return }; if (!series || !number) { setMessage('Indica el tipo, serie y número del comprobante.'); return }
    setSavingConsumption(true); setMessage('')
    try { const { data: used } = await supabase.from('consumptions').select('id').eq('receipt_type', receiptType).eq('receipt_series', series).eq('receipt_number', number).maybeSingle(); if (used) { setMessage('Este comprobante ya fue utilizado para acreditar puntos.'); return }; const { error } = await supabase.from('consumptions').insert({ member_id: member.id, amount: value, source: 'bar', registered_by: userId, notes: consumptionNotes.trim() || null, receipt_type: receiptType, receipt_series: series, receipt_number: number }); if (error) { setMessage(error.code === '23505' ? 'Este comprobante ya fue utilizado para acreditar puntos.' : 'No se pudo registrar el consumo.'); return }; await loadMemberDetails(member.id); setAmount(''); setReceiptSeries(''); setReceiptNumber(''); setConsumptionNotes(''); setMessage(`Consumo registrado correctamente. +${earned(value)} puntos.`) } catch { setMessage('El consumo se registró, pero no se pudo refrescar el saldo. Vuelve a buscar al socio.') } finally { setSavingConsumption(false) }
  }
  const redeemReward = async (event: FormEvent) => {
    event.preventDefault(); if (!member || member.status !== 'active' || member.points_balance < 20) return; if (!window.confirm(`Se descontarán 20 puntos de ${member.full_name}. ¿Confirmar canje?`)) return
    setSavingRedemption(true); setMessage(''); try { const { error } = await supabase.from('redemptions').insert({ member_id: member.id, points_spent: 20, reward_category: rewardCategory, reward_product_name: rewardProductName.trim() || null, registered_by: userId, notes: null }); if (error) setMessage('No se pudo registrar el canje. El saldo pudo haber cambiado.'); else { await loadMemberDetails(member.id); setRewardProductName(''); setMessage('Canje registrado correctamente.') } } catch { setMessage('El canje se registró, pero no se pudo refrescar el saldo.') } finally { setSavingRedemption(false) }
  }
  const openCorrection = (item: Consumption) => { setCorrecting(item); setCorrectionAmount(String(item.amount)); setCorrectionType(item.receipt_type); setCorrectionSeries(item.receipt_series); setCorrectionNumber(item.receipt_number); setCorrectionReason(''); setReverting(null) }
  const submitCorrection = async (event: FormEvent) => {
    event.preventDefault(); if (!canManageConsumptions || !correcting || !member) return; const value = Number(correctionAmount); const series = correctionSeries.trim().toUpperCase(); const number = correctionNumber.trim(); if (!Number.isFinite(value) || value <= 0 || !series || !number) { setMessage('Completa el nuevo monto y comprobante.'); return }; if (correctionReason.trim().length < 3) { setMessage('El motivo debe tener al menos 3 caracteres.'); return }
    setSavingCorrection(true); setMessage(''); const oldPoints = earned(correcting.amount); const newPoints = earned(value)
    const { error } = await supabase.rpc('correct_consumption', { p_consumption_id: correcting.id, p_amount: value, p_receipt_type: correctionType, p_receipt_series: series, p_receipt_number: number, p_reason: correctionReason.trim() })
    if (error) setMessage(readableError(error.message)); else { await loadMemberDetails(member.id); setCorrecting(null); setMessage(`Consumo corregido. Ajuste aplicado: ${newPoints - oldPoints >= 0 ? '+' : ''}${newPoints - oldPoints} puntos.`) }; setSavingCorrection(false)
  }
  const submitReversal = async (event: FormEvent) => {
    event.preventDefault(); if (!canManageConsumptions || !reverting || !member) return; if (reversalReason.trim().length < 3) { setMessage('El motivo debe tener al menos 3 caracteres.'); return }; if (!window.confirm(`Esta acción revertirá el consumo y retirará ${reverting.points_earned} puntos. El registro permanecerá en el historial. ¿Confirmar reversión?`)) return
    setSavingReversal(true); setMessage(''); const { error } = await supabase.rpc('reverse_consumption', { p_consumption_id: reverting.id, p_reason: reversalReason.trim() }); if (error) setMessage(readableError(error.message)); else { await loadMemberDetails(member.id); setReverting(null); setReversalReason(''); setMessage('Consumo revertido correctamente.') }; setSavingReversal(false)
  }
  const loadAudit = async (consumptionId: string) => { if (!canManageConsumptions) return; if (auditFor === consumptionId) { setAuditFor(null); return }; setLoadingAudit(true); setAuditFor(consumptionId); const { data } = await supabase.from('consumption_audit').select('id, consumption_id, action, old_amount, new_amount, points_adjusted, reason, performed_by, created_at').eq('consumption_id', consumptionId).order('created_at', { ascending: false }); const result = data as ConsumptionAudit[] ?? []; setAudits(result); await resolveStaffNames(result.map((item) => item.performed_by)); setLoadingAudit(false) }
  const openMemberEditor = () => { if (!canManageMembers || !member) return; setEditName(member.full_name); setEditPhone(member.phone ?? ''); setEditEmail(member.email ?? ''); setEditingMember(true) }
  const saveMember = async (event: FormEvent) => {
    event.preventDefault(); if (!canManageMembers || !member || !editName.trim()) return; if (editEmail.trim() && !validEmail(editEmail.trim())) { setMessage('Ingresa un correo electrónico válido.'); return }
    setSavingMemberUpdate(true); setMessage(''); const { error } = await supabase.from('members').update({ full_name: editName.trim(), phone: editPhone.trim() || null, email: editEmail.trim() || null }).eq('id', member.id)
    if (error) setMessage('No se pudo editar el socio. Verifica tus permisos.'); else { await loadMemberDetails(member.id); setEditingMember(false); setMessage('Socio actualizado correctamente.') }; setSavingMemberUpdate(false)
  }
  const updateMemberStatus = async (status: 'active' | 'blocked') => {
    if (!canManageMembers || !member) return; const action = status === 'blocked' ? 'bloquear' : 'reactivar'; if (!window.confirm(`¿Confirmar ${action} a ${member.full_name}?`)) return
    setMessage(''); const { error } = await supabase.from('members').update({ status }).eq('id', member.id); if (error) setMessage(`No se pudo ${action} al socio. Verifica tus permisos.`); else { await loadMemberDetails(member.id); setMessage(status === 'blocked' ? 'Socio bloqueado correctamente.' : 'Socio reactivado correctamente.') }
  }
  const canOperate = member?.status === 'active'; const previewPoints = earned(Number(amount) || 0); const remaining = member ? Math.max(0, 20 - member.points_balance) : 20; const correctionPoints = earned(Number(correctionAmount) || 0); const correctionDelta = correcting ? correctionPoints - earned(correcting.amount) : 0
  const displayedDocumentType = member?.document_type ?? 'DNI'; const displayedDocumentNumber = member?.document_number ?? member?.dni ?? '—'
  return <main className="staff-page"><section className="staff-card staff-dashboard"><header className="staff-header"><div><p className="eyebrow">THE BLACK CAT · STAFF</p><h1>Hola, {profile.display_name}</h1><p className="staff-role">Rol detectado: {profile.role}</p></div><button className="back-button staff-signout" type="button" onClick={() => void onSignOut()}>Cerrar sesión</button></header>
    {canManageKitchen && <section className="staff-section kitchen-status-section"><div className="staff-section-title"><div><h2>Estado de Cocina</h2><p>{loadingKitchenStatus ? 'Cargando estado…' : kitchenStatus?.value.manual_closed ? 'Cocina cerrada manualmente' : 'Cocina abierta'}</p></div>{!kitchenStatus?.value.manual_closed && !showKitchenCloseForm && <button type="button" className="staff-danger" disabled={loadingKitchenStatus || savingKitchenStatus} onClick={() => setShowKitchenCloseForm(true)}>Cerrar cocina</button>}{kitchenStatus?.value.manual_closed && <button type="button" className="staff-primary" disabled={savingKitchenStatus} onClick={() => void updateKitchenStatus(false)}>{savingKitchenStatus ? 'Actualizando…' : 'Reabrir cocina'}</button>}</div>{showKitchenCloseForm && <div className="kitchen-close-form"><label>Motivo del cierre <small>Opcional</small><select value={kitchenClosureReason} onChange={(event) => setKitchenClosureReason(event.target.value)}><option value="">Sin motivo público</option>{kitchenClosureReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}</select></label><div className="management-actions"><button type="button" className="staff-secondary" disabled={savingKitchenStatus} onClick={() => { setShowKitchenCloseForm(false); setKitchenClosureReason('') }}>Cancelar</button><button type="button" className="staff-danger" disabled={savingKitchenStatus} onClick={() => void updateKitchenStatus(true)}>{savingKitchenStatus ? 'Cerrando…' : 'Confirmar cierre'}</button></div></div>}</section>}
    {canManageKitchen && <section className="staff-section"><div className="staff-section-title"><div><h2>WhatsApp Business</h2><p>Onboarding administrativo para WhatsApp Business App + Cloud API Coexistence.</p></div></div><div className="management-actions"><button type="button" className="staff-primary" disabled={whatsappOnboardingBusy} onClick={startWhatsAppBusinessCoexistence}>{whatsappOnboardingBusy ? 'Abriendo Meta…' : 'Conectar WhatsApp Business'}</button></div>{whatsappOnboardingMessage && <p className="staff-message" role="status">{whatsappOnboardingMessage}</p>}{whatsappConnection && <div className="staff-summary-card"><strong>WhatsApp Business conectado mediante Coexistence</strong>{whatsappConnection.wabaId && <p>WABA ID: {whatsappConnection.wabaId}</p>}{whatsappConnection.phoneNumberId && <p>Phone Number ID: {whatsappConnection.phoneNumberId}</p>}{whatsappConnection.businessId && <p>Business ID: {whatsappConnection.businessId}</p>}{whatsappConnection.status && <p>Estado: {whatsappConnection.status}</p>}</div>}</section>}
    {canUseBasicFeatures && <section className="staff-section"><div className="staff-section-title"><div><h2>Buscar socio</h2><p>Buscar por DNI/CE o teléfono</p></div><button type="button" className="staff-secondary" onClick={() => setShowCreate(!showCreate)}>{showCreate ? 'Cancelar' : 'Crear socio'}</button></div><form className="staff-form staff-search-form" onSubmit={searchMember}><label>Número de documento<input inputMode="numeric" maxLength={11} value={documentNumber} onChange={(e) => { setDocumentNumber(e.target.value.replace(/\D/g, '')); setPhone('') }} /></label><span className="staff-or">o</span><label>Teléfono<input inputMode="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setDocumentNumber('') }} /></label><button className="staff-primary" disabled={searching}>{searching ? 'Buscando…' : 'Buscar socio'}</button></form>{showCreate && <form className="staff-form staff-create-form" onSubmit={createMember}><h3>Nuevo socio</h3><label>Nombre completo<input value={newName} onChange={(e) => setNewName(e.target.value)} required /></label><label>Tipo de documento<select value={newDocumentType} onChange={(e) => { setNewDocumentType(e.target.value as 'DNI' | 'CE'); setNewDocumentNumber('') }}><option value="DNI">DNI</option><option value="CE">Carné de Extranjería (CE)</option></select></label><label>Número de documento<input inputMode="numeric" maxLength={newDocumentType === 'DNI' ? 8 : 11} value={newDocumentNumber} onChange={(e) => setNewDocumentNumber(e.target.value.replace(/\D/g, ''))} placeholder={newDocumentType === 'DNI' ? '8 dígitos' : '9 a 11 dígitos'} required /></label><label>Teléfono<input inputMode="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} required /></label><label>Email <small>Opcional</small><input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} /></label><label>Fecha de nacimiento <small>Opcional</small><input type="date" value={newBirthDate} onChange={(e) => setNewBirthDate(e.target.value)} /></label><label className="staff-checkbox"><input type="checkbox" checked={marketingConsent} onChange={(e) => setMarketingConsent(e.target.checked)} /> Acepta recibir comunicaciones</label><button className="staff-primary" disabled={savingMember}>{savingMember ? 'Creando…' : 'Crear socio'}</button></form>}</section>}
    {canManageStaff && <section className="staff-section"><h2>Administrar staff</h2><p>Acceso administrativo confirmado. La gestión de cuentas está restringida al rol Admin.</p></section>}{message && <p className="staff-message" role="status">{message}</p>}{member && <div className="member-workspace"><section className="staff-section member-summary"><div><p className="eyebrow">SOCIO ENCONTRADO</p><h2>{member.full_name}</h2><p>Documento: {displayedDocumentType} {hideDocument(displayedDocumentNumber)} · {member.phone || 'Sin teléfono'}</p><p>Ingreso: {formatDate(member.joined_at)}</p></div><div className="points-panel"><strong>{member.points_balance} / 20</strong><span>puntos</span>{member.points_balance >= 20 ? <b>¡Beneficio disponible!</b> : <small>Te faltan {remaining} puntos para tu beneficio</small>}</div></section>{canManageMembers && <section className="staff-section"><h2>Administración de socio</h2><div className="management-actions"><button type="button" className="staff-secondary" onClick={openMemberEditor}>Editar socio</button>{member.status === 'active' ? <button type="button" className="staff-danger" onClick={() => void updateMemberStatus('blocked')}>Bloquear socio</button> : <button type="button" className="staff-primary" onClick={() => void updateMemberStatus('active')}>Reactivar socio</button>}</div></section>}{editingMember && canManageMembers && <form className="staff-section staff-form staff-management-form" onSubmit={saveMember}><h2>Editar socio</h2><label>Nombre completo<input value={editName} onChange={(event) => setEditName(event.target.value)} required /></label><label>Teléfono<input value={editPhone} onChange={(event) => setEditPhone(event.target.value)} /></label><label>Email<input type="email" value={editEmail} onChange={(event) => setEditEmail(event.target.value)} /></label><div className="management-actions"><button type="button" className="staff-secondary" onClick={() => setEditingMember(false)}>Cancelar</button><button className="staff-primary" disabled={savingMemberUpdate}>{savingMemberUpdate ? 'Guardando…' : 'Guardar cambios'}</button></div></form>}{!canOperate && <p className="staff-warning">Este socio está {member.status}. No se pueden registrar operaciones.</p>}
      <div className="staff-operation-grid"><form className="staff-section staff-form" onSubmit={registerConsumption}><h2>Registrar consumo</h2><label>Monto consumido (S/)<input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!canOperate || savingConsumption} required /></label><div className="staff-receipt-fields"><span>Tipo de comprobante</span><div className="staff-receipt-options"><label><input type="radio" checked={receiptType === 'boleta'} onChange={() => setReceiptType('boleta')} /> Boleta</label><label><input type="radio" checked={receiptType === 'factura'} onChange={() => setReceiptType('factura')} /> Factura</label></div><label>Serie<input value={receiptSeries} onChange={(e) => setReceiptSeries(e.target.value.toUpperCase())} placeholder={receiptType === 'boleta' ? 'B001' : 'F001'} required /></label><label>Número<input inputMode="numeric" value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value.replace(/\D/g, ''))} required /></label></div><label>Observación <textarea value={consumptionNotes} onChange={(e) => setConsumptionNotes(e.target.value)} /></label><div className="consumption-summary"><span>Socio <strong>{member.full_name}</strong></span><span>Comprobante <strong>{receiptType === 'boleta' ? 'Boleta' : 'Factura'} {receiptSeries || '—'}-{receiptNumber || '—'}</strong></span><span>Monto <strong>{money(Number(amount) || 0)}</strong></span><span>Puntos <strong>{previewPoints}</strong></span></div><p className="staff-preview">Este consumo generará <strong>{previewPoints} puntos</strong>.</p>{Number(amount) >= 300 && <p className="staff-warning">Consumo de monto elevado. Verifique el comprobante antes de continuar.</p>}<button className="staff-primary" disabled={!canOperate || savingConsumption}>{savingConsumption ? 'Registrando…' : 'Confirmar consumo'}</button></form>
      <form className="staff-section staff-form" onSubmit={redeemReward}><h2>Canjear beneficio</h2><label>Beneficio<select value={rewardCategory} onChange={(e) => setRewardCategory(e.target.value as RewardCategory)} disabled={!canOperate || member.points_balance < 20 || savingRedemption}>{rewards.map((reward) => <option key={reward.value} value={reward.value}>{reward.label}</option>)}</select></label><label>Producto entregado<input value={rewardProductName} onChange={(e) => setRewardProductName(e.target.value)} placeholder="Opcional" /></label><p className="staff-preview">Se descontarán <strong>20 puntos</strong> de {member.full_name}.</p><button className="staff-primary" disabled={!canOperate || member.points_balance < 20 || savingRedemption}>{savingRedemption ? 'Registrando…' : 'Canjear beneficio'}</button></form></div>
      <section className="staff-section staff-consumptions"><h2>Consumos recientes</h2>{consumptions.length === 0 ? <p>Aún no hay consumos para mostrar.</p> : <ul>{consumptions.map((item) => <li key={item.id} className={item.status === 'reversed' ? 'is-reversed' : ''}><div><time>{formatDate(item.consumed_at)}</time><strong>{item.receipt_type === 'boleta' ? 'Boleta' : 'Factura'} {item.receipt_series}-{item.receipt_number}</strong><span>{money(item.amount)} · +{item.points_earned} puntos</span><small>Registrado por: {staffNames[item.registered_by] || '—'} · Estado: {item.status === 'reversed' ? 'Revertido' : 'Activo'}</small></div><div className="consumption-actions">{item.status === 'active' && canManageConsumptions && <><button type="button" className="staff-secondary" onClick={() => openCorrection(item)}>Corregir</button><button type="button" className="staff-danger" onClick={() => { setReverting(item); setReversalReason(''); setCorrecting(null) }}>Revertir</button></>}{canManageConsumptions && <button type="button" className="staff-link" onClick={() => void loadAudit(item.id)}>Auditoría</button>}</div>{auditFor === item.id && canManageConsumptions && <div className="audit-list">{loadingAudit ? 'Cargando auditoría…' : audits.length ? audits.map((audit) => <p key={audit.id ?? `${audit.created_at}-${audit.action}`}><strong>{audit.action === 'correction' ? 'Corrección' : 'Reversión'}</strong> · {money(audit.old_amount ?? 0)} → {audit.new_amount === null ? 'Revertido' : money(audit.new_amount)} · ajuste {audit.points_adjusted && audit.points_adjusted > 0 ? '+' : ''}{audit.points_adjusted ?? 0} puntos<br />{audit.reason} · {staffNames[audit.performed_by] || '—'} · {formatDate(audit.created_at)}</p>) : 'No hay registros de auditoría.'}</div>}</li>)}</ul>}</section>
      {correcting && <form className="staff-section staff-form staff-management-form" onSubmit={submitCorrection}><h2>Corregir consumo</h2><p>Consumo actual: {money(correcting.amount)} → {earned(correcting.amount)} puntos</p><label>Nuevo monto<input type="number" min="0.01" step="0.01" value={correctionAmount} onChange={(e) => setCorrectionAmount(e.target.value)} required /></label><div className="staff-receipt-options"><label><input type="radio" checked={correctionType === 'boleta'} onChange={() => setCorrectionType('boleta')} /> Boleta</label><label><input type="radio" checked={correctionType === 'factura'} onChange={() => setCorrectionType('factura')} /> Factura</label></div><label>Serie<input value={correctionSeries} onChange={(e) => setCorrectionSeries(e.target.value.toUpperCase())} required /></label><label>Número<input inputMode="numeric" value={correctionNumber} onChange={(e) => setCorrectionNumber(e.target.value.replace(/\D/g, ''))} required /></label><label>Motivo<textarea value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} minLength={3} required /></label><div className="consumption-summary"><span>Nuevo consumo <strong>{money(Number(correctionAmount) || 0)} → {correctionPoints} puntos</strong></span><span>Ajuste resultante <strong>{correctionDelta >= 0 ? '+' : ''}{correctionDelta} puntos</strong></span></div><div className="management-actions"><button type="button" className="staff-secondary" onClick={() => setCorrecting(null)}>Cancelar</button><button className="staff-primary" disabled={savingCorrection}>{savingCorrection ? 'Corrigiendo…' : 'Confirmar corrección'}</button></div></form>}
      {reverting && <form className="staff-section staff-form staff-management-form" onSubmit={submitReversal}><h2>Revertir consumo</h2><p className="staff-warning">Esta acción revertirá el consumo y retirará los puntos generados. El registro permanecerá en el historial.</p><p>Comprobante: <strong>{reverting.receipt_series}-{reverting.receipt_number}</strong><br />Monto: <strong>{money(reverting.amount)}</strong><br />Puntos a retirar: <strong>{reverting.points_earned}</strong></p><label>Motivo<textarea value={reversalReason} onChange={(e) => setReversalReason(e.target.value)} minLength={3} required /></label><div className="management-actions"><button type="button" className="staff-secondary" onClick={() => setReverting(null)}>Cancelar</button><button className="staff-danger" disabled={savingReversal}>{savingReversal ? 'Revirtiendo…' : 'Confirmar reversión'}</button></div></form>}
      <section className="staff-section staff-history"><h2>Historial reciente</h2>{movements.length === 0 ? <p>Aún no hay movimientos para mostrar.</p> : <ul>{movements.map((item) => <li key={item.id}><time>{formatDate(item.created_at)}</time><div><strong>{item.movement_type}</strong><span>{item.description}</span></div><b className={item.points > 0 ? 'points-positive' : 'points-negative'}>{item.points > 0 ? '+' : ''}{item.points} pts</b></li>)}</ul>}</section></div>}</section></main>
}
