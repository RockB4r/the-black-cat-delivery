import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {getCulqiEnvironment,validateCulqiChargeId} from '../netlify/lib/culqi-verification.ts'
import {inspectCulqiRefunds,postCulqiRefundOnce,uncertainRefund,verifiedRefundCharge,refundObservation} from '../netlify/lib/culqi-refunds.ts'
import {claimExternalRefundPost,prepareExternalRefund,recordExternalRefund} from '../netlify/lib/external-refunds.ts'

const ids={order:'22222222-2222-4222-8222-222222222222',checkout:'11111111-1111-4111-8111-111111111111',attempt:'33333333-3333-4333-8333-333333333333',actor:'44444444-4444-4444-8444-444444444444',intent:'55555555-5555-4555-8555-555555555555'}
const intent=()=>({id:ids.intent,order_id:ids.order,checkout_id:ids.checkout,order_number:'STG-REFUND-1',attempt_id:ids.attempt,culqi_order_id:'ord_test_REFUNDfixture',
  charge_id:'chr_test_REFUNDfixture',amount_cents:1000,currency:'PEN',charge_since:'2026-01-01T00:00:00Z',state:'processing',refund_id:null,post_started_at:null})
const charge=()=>({id:intent().charge_id,amount:1000,currency_code:'PEN',paid:false,capture:true,outcome:{type:'venta_exitosa',code:'AUT0000'},
  description:'Pedido STG-REFUND-1',metadata:{checkout_id:ids.checkout,attempt_id:ids.attempt}})
const refund=(status='Completa')=>({object:'refund',id:'ref_test_REFUNDfixture',charge_id:intent().charge_id,amount:1000,status})
const source=readFileSync(new URL('../netlify/functions/gift-card-external-refund.ts',import.meta.url),'utf8')
const executable=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText
  .replace(/^import .* from .*;?\r?\n/gm,'').replace('export default','return')
const deps={json:(s,b)=>Response.json(b,{status:s}),getCulqiEnvironment,validateCulqiChargeId,inspectCulqiRefunds,postCulqiRefundOnce,uncertainRefund,verifiedRefundCharge,claimExternalRefundPost,prepareExternalRefund,recordExternalRefund}

async function setup(run,mutate=()=>{}){
  const oldFetch=globalThis.fetch,oldEnv={...process.env}
  process.env.SUPABASE_URL='https://kqfphrukxdvlrbjipjnx.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-backend-only'
  process.env.CULQI_SECRET_KEY='sk_test_SYNTHETIC'
  const f={role:'admin',active:true,charge:charge(),chargeHttp:200,refunds:[],refundGet:null,post:refund(),postHttp:201,cacheSyncs:0,cacheFails:false,
    persisted:null,postCount:0,claimCount:0,notes:[],calls:[],eligible:true,timeout:false,postPersistFails:false,listHttp:200}
  mutate(f)
  globalThis.fetch=async(url,init={})=>{
    const path=String(url),body=init.body?JSON.parse(init.body):{}
    f.calls.push({path,method:init.method??'GET'})
    if(path.includes('/auth/v1/user'))return Response.json({id:ids.actor})
    if(path.includes('/staff_profiles?'))return Response.json(f.role==='none'?[]:[{role:f.role,active:f.active}])
    if(path.includes('/rpc/prepare_external_refund')){
      if(!f.eligible)return Response.json({message:'ineligible'},{status:400})
      if(f.persisted)return Response.json({intent:f.persisted,may_submit:false})
      if(!body.p_create)return Response.json(null)
      f.persisted=intent()
      return Response.json({intent:f.persisted,may_submit:true,claim_token:ids.actor})
    }
    if(path.includes('/rpc/claim_external_refund_post')){
      if(f.persisted.post_started_at || f.persisted.state!=='processing')return Response.json(false)
      f.persisted.post_started_at=new Date().toISOString();f.claimCount++
      return Response.json(true)
    }
    if(path.includes('/rpc/record_external_refund')){
      if(f.postPersistFails && f.postCount)return Response.json({},{status:500})
      if(f.persisted.state!=='completed')Object.assign(f.persisted,{state:body.p_state,refund_id:body.p_refund_id})
      f.notes.push(body.p_safe_error)
      return Response.json(f.persisted)
    }
    if(path.includes('/v2/charges/'))return Response.json(f.charge,{status:f.chargeHttp})
    if(path.includes('/v2/refunds?'))return Response.json({data:f.refunds},{status:f.listHttp})
    if(path.includes('/v2/refunds/'))return Response.json(f.refundGet??f.refunds.find(x=>path.endsWith(x.id))??f.post)
    if(path.endsWith('/v2/refunds')&&init.method==='POST'){
      f.postCount++
      assert.deepEqual(body,{amount:1000,charge_id:intent().charge_id,reason:'solicitud_comprador'})
      if(f.timeout)throw new Error('NETWORK simulated with sk_live_NOTREAL fake@example.invalid')
      if(f.postHttp<300&&f.post)f.refunds=[f.post]
      return Response.json(f.post,{status:f.postHttp})
    }
    assert.fail('unexpected I/O')
  }
  const io={...deps,getOrder:async()=>({checkoutId:ids.checkout,culqiChargeId:intent().charge_id,paymentStatus:'refund_pending'}),saveOrder:async()=>{if(f.cacheFails)throw new Error('cache down');f.cacheSyncs++}}
  const handler=new Function(...Object.keys(io),executable)(...Object.values(io))
  const call=(extra={},action='create')=>handler(new Request('https://staging.example.invalid/.netlify/functions/gift-card-external-refund',{
    method:'POST',headers:{Authorization:'Bearer SYNTHETIC','content-type':'application/json'},body:JSON.stringify({orderId:ids.order,action,note:'Synthetic operational stock rejection refund.',...extra})}))
  try{await run(f,call,handler)}finally{globalThis.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in oldEnv))delete process.env[k];Object.assign(process.env,oldEnv)}
}

test('actual handler: complete synthetic 50 = 40 restored + 10 refund; one POST, stable repeat',()=>setup(async(f,call)=>{
  const r=await call();assert.equal(r.status,200);assert.equal((await r.json()).state,'completed')
  assert.equal(f.postCount,1);assert.equal(f.claimCount,1)
  const again=await call();assert.equal(again.status,200);assert.equal(f.postCount,1)
  assert.equal(f.calls.filter(c=>c.path.includes('/rpc/')&&!/prepare|claim|record/.test(c.path)).length,0)
}))
for(const role of ['staff','kitchen','none'])test(`denies ${role} before intent/provider`,()=>setup(async(f,call)=>{
  assert.equal((await call()).status,403);assert.equal(f.postCount,0);assert.equal(f.persisted,null)
},f=>{f.role=role}))
test('inactive Admin denied',()=>setup(async(f,call)=>{assert.equal((await call()).status,403);assert.equal(f.persisted,null)},f=>{f.active=false}))
test('active Manager permitted',()=>setup(async(f,call)=>{assert.equal((await call()).status,200);assert.equal(f.postCount,1)},f=>{f.role='manager'}))
test('missing Authorization denied',()=>setup(async(f,call,handler)=>{
  assert.equal((await handler(new Request('https://staging.invalid',{method:'POST'}))).status,403);assert.equal(f.persisted,null)
}))
for(const change of [{amount:1001},{currency_code:'USD'},{metadata:{checkout_id:'other',attempt_id:ids.attempt}},
  {metadata:{checkout_id:ids.checkout,attempt_id:'other'}},{capture:false},{outcome:{type:'operacion_denegada',code:'DNGE0003'}},
  {description:'Pedido OTHER'},{id:'chr_live_OTHER'},{state:'Rechazada'},
  {order_id:'ord_test_OTHER'},{order_number:'OTHER'},{metadata:{checkout_id:ids.checkout,attempt_id:ids.attempt,order_id:'other'}}])test(`charge mismatch ${JSON.stringify(change)} never POSTs`,()=>setup(async(f,call)=>{
    assert.equal((await call()).status,202);assert.equal(f.postCount,0);assert.equal(f.persisted.state,'reconciliation_required')
  },f=>{Object.assign(f.charge,change)}))
test('nonexistent charge never POSTs',()=>setup(async(f,call)=>{assert.equal((await call()).status,202);assert.equal(f.postCount,0)},f=>{f.chargeHttp=404}))
for(const extra of [{chargeId:'chr_test_ARBITRARY'},{amount:1001},{amount:1000},{currency:'USD'}])test(`rejects client-supplied financial fields ${JSON.stringify(extra)}`,()=>setup(async(f,call)=>{
  assert.equal((await call(extra)).status,400);assert.equal(f.persisted,null);assert.equal(f.postCount,0)
}))
test('DB eligibility failure (not rejected / Gift Card refund not complete) never calls provider',()=>setup(async(f,call)=>{
  assert.equal((await call()).status,409);assert.equal(f.postCount,0)
},f=>{f.eligible=false}))
test('prior complete provider refund reconciles without POST',()=>setup(async(f,call)=>{
  assert.equal((await call()).status,200);assert.equal(f.postCount,0);assert.equal(f.persisted.state,'completed')
},f=>{f.refunds=[refund()]}))
test('prior partial refund requires review, no top-up/full second refund',()=>setup(async(f,call)=>{
  assert.equal((await call()).status,202);assert.equal(f.postCount,0)
},f=>{f.refunds=[{...refund(),amount:500}]}))
test('two existing refunds block',()=>setup(async(f,call)=>{assert.equal((await call()).status,202);assert.equal(f.postCount,0)},f=>{
  f.refunds=[refund(),{...refund(),id:'ref_test_SECOND'}]
}))
test('concurrent actual handlers cannot make two refund POSTs',()=>setup(async(f,call)=>{
  await Promise.all([call(),call()]);assert.ok(f.postCount<=1);assert.ok(f.claimCount<=1)
}))
test('201 Pendiente stays pending; later explicit verify completes without new POST',()=>setup(async(f,call)=>{
  assert.equal((await call()).status,202);assert.equal(f.persisted.state,'pending');assert.equal(f.postCount,1)
  f.refundGet=refund('Completa')
  assert.equal((await call({},'verify')).status,200);assert.equal(f.persisted.state,'completed');assert.equal(f.postCount,1)
},f=>{f.post=refund('Pendiente')}))
test('provider rejected refund cannot complete and is not resubmitted',()=>setup(async(f,call)=>{
  assert.equal((await call()).status,409);assert.equal(f.persisted.state,'rejected')
  assert.equal((await call()).status,409);assert.equal(f.postCount,1)
},f=>{f.post=refund('Rechazado')}))
test('timeout preserved and a repeat with no refund does not POST again',()=>setup(async(f,call)=>{
  assert.equal((await call()).status,202);assert.equal(f.persisted.state,'reconciliation_required')
  await call();assert.equal(f.postCount,1)
  assert.ok(f.notes.every(x=>!x||(!x.includes('sk_live')&&!x.includes('@'))))
},f=>{f.timeout=true}))
test('refund discovered after timeout closes via GET only',()=>setup(async(f,call)=>{
  await call();assert.equal(f.postCount,1)
  f.refunds=[refund()]
  assert.equal((await call({},'verify')).status,200);assert.equal(f.postCount,1)
},f=>{f.timeout=true}))
for(const post of [null,{...refund(),status:'Unknown'},{...refund(),amount:2000},{...refund(),charge_id:'chr_test_OTHER'}])test(`incomplete/invalid POST body ${JSON.stringify(post)} stays uncertain`,()=>setup(async(f,call)=>{
  assert.equal((await call()).status,202);assert.equal(f.persisted.state,'reconciliation_required');assert.equal(f.postCount,1)
},f=>{f.post=post}))
for(const status of [400,500,503])test(`HTTP ${status} records rejection/uncertainty, no repeat POST`,()=>setup(async(f,call)=>{
  await call();await call();assert.equal(f.postCount,1)
},f=>{f.postHttp=status;f.post={object:'error',user_message:'sk_live_NOTREAL fake@example.invalid'}}))
test('DB failure after successful POST cannot cause a second POST',()=>setup(async(f,call)=>{
  assert.equal((await call()).status,409);assert.equal(f.postCount,1)
  f.postPersistFails=false;assert.equal((await call({},'verify')).status,200);assert.equal(f.postCount,1)
},f=>{f.postPersistFails=true}))
test('provider list unavailable fails closed before POST',()=>setup(async(f,call)=>{
  assert.equal((await call()).status,202);assert.equal(f.postCount,0)
},f=>{f.listHttp=500}))
test('LIVE key or production Supabase are blocked before Auth/DB/provider',()=>setup(async(f,call)=>{
  process.env.CULQI_SECRET_KEY='sk_live_SYNTHETIC';assert.equal((await call()).status,503)
  process.env.CULQI_SECRET_KEY='sk_test_SYNTHETIC';process.env.SUPABASE_URL='https://production.example.invalid'
  assert.equal((await call()).status,503);assert.equal(f.calls.length,0)
}))
test('unknown status and TEST/LIVE refund mismatch rejected by parser',()=>setup(async()=>{
  for(const bad of [{...refund(),status:'success'},{...refund(),id:'ref_live_OTHER'},{...refund(),currency_code:'USD'}])assert.equal(refundObservation(bad,intent(),201),null)
}))
test('verify cannot create an intent or POST',()=>setup(async(f,call)=>{assert.equal((await call({},'verify')).status,404);assert.equal(f.postCount,0);assert.equal(f.persisted,null)}))
test('completed refund cache failure is a warning, not another provider POST',()=>setup(async(f,call)=>{
  const r=await call();assert.equal(r.status,200);assert.equal((await r.json()).warning,'refund_completed_order_cache_sync_pending')
  f.cacheFails=false;assert.equal((await call({},'verify')).status,200);assert.equal(f.postCount,1);assert.equal(f.cacheSyncs,1)
},f=>{f.cacheFails=true}))
for(const secondPageFails of [false,true])test(`refund on page two is inspected; later page fails=${secondPageFails}`,()=>setup(async(f,call)=>{
  const original=globalThis.fetch;let pages=0
  globalThis.fetch=async(url,init)=>{
    if(!String(url).includes('/v2/refunds?'))return original(url,init)
    pages++
    if(pages===1)return Response.json({data:Array.from({length:100},(_,i)=>({...refund(),id:`ref_test_other${i}`,charge_id:'chr_test_UNRELATED'}))})
    assert.match(String(url),/after=ref_test_other99/)
    return secondPageFails?Response.json({object:'error'},{status:503}):Response.json({data:[refund()]})
  }
  assert.equal((await call()).status,secondPageFails?202:200);assert.equal(f.postCount,0);assert.equal(pages,2)
}))
test('pagination cap never becomes evidence of zero refunds',()=>setup(async(f,call)=>{
  const original=globalThis.fetch;let pages=0
  globalThis.fetch=async(url,init)=>{
    if(!String(url).includes('/v2/refunds?'))return original(url,init)
    pages++
    return Response.json({data:Array.from({length:100},(_,i)=>({...refund(),id:`ref_test_page${pages}row${i}`,charge_id:'chr_test_UNRELATED'}))})
  }
  assert.equal((await call()).status,202);assert.equal(f.postCount,0);assert.equal(pages,10)
}))
test('stored refund ID conflicting with list requires review',()=>setup(async(f,call)=>{
  assert.equal((await call({},'verify')).status,202);assert.equal(f.postCount,0)
},f=>{f.persisted={...intent(),state:'pending',refund_id:'ref_test_STORED'};f.refunds=[refund()]}))
