import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { getCulqiEnvironment, validateCulqiChargeId } from '../netlify/lib/culqi-verification.ts'
import { verifyExternallyAuthorizedCharge } from '../netlify/lib/external-authorized-reconciliation.ts'
const ids={order:'22222222-2222-4222-8222-222222222222',checkout:'11111111-1111-4111-8111-111111111111',actor:'33333333-3333-4333-8333-333333333333',attempt:'44444444-4444-4444-8444-444444444444',charge:'chr_test_fixture',culqi:'ord_test_fixture'}
const source=readFileSync(new URL('../netlify/functions/gift-card-reconcile-authorized.ts',import.meta.url),'utf8')
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import .* from .*;?\r?\n/gm,'').replace('export default','return')
async function fixture(run,change=()=>{}) {
 const previousFetch=globalThis.fetch, previousEnv={...process.env}
 process.env.SUPABASE_URL='https://kqfphrukxdvlrbjipjnx.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';process.env.CULQI_SECRET_KEY='sk_test_fixture'
 const charge={id:ids.charge,amount:1000,currency_code:'PEN',capture:true,paid:false,outcome:{type:'venta_exitosa',code:'AUT0000'},authorization_code:'SYNTHETIC_AUTH',decline_code:null,description:'Pedido STG-AUTH',metadata:{checkout_id:ids.checkout,attempt_id:ids.attempt}}
 const s={role:'admin',active:true,charge,charges:[structuredClone(charge)],refunds:[],status:'rejected',source:'culqi_body_rejected',rpc:0,calls:[],cache:0,rpcFails:false,cacheFails:false,providerHttp:200,hasMore:false,authHttp:200}
 change(s)
 globalThis.fetch=async(url,init={})=>{
  const p=String(url);s.calls.push({url:p,method:init.method??'GET'})
  if(p.includes('/auth/v1/user'))return Response.json({id:ids.actor},{status:s.authHttp})
  if(p.includes('/staff_profiles?'))return Response.json(s.role==='none'?[]:[{role:s.role,active:s.active}])
  if(p.includes('/gift_card_culqi_attempts?'))return Response.json([{id:ids.attempt,checkout_id:ids.checkout,order_id:ids.order,culqi_order_id:ids.culqi,status:s.status,resolution_source:s.source}])
  if(p.includes('/rest/v1/orders?'))return Response.json([{id:ids.order,checkout_id:ids.checkout,order_number:'STG-AUTH',culqi_order_id:ids.culqi,total:50,gift_card_amount:40,other_payment_amount:10}])
  if(p.includes('/v2/charges/'))return Response.json(s.charge,{status:s.providerHttp})
  if(p.includes('/v2/orders/'))return Response.json({id:ids.culqi,order_number:'STG-AUTH',amount:1000,currency_code:'PEN',state:'pending'})
  if(p.includes('/v2/charges?'))return Response.json({data:s.charges,has_more:s.hasMore})
  if(p.includes('/v2/refunds?'))return Response.json({data:s.refunds,has_more:false})
  if(p.includes('/rpc/reconcile_externally_authorized_mixed_attempt')){
   s.rpc++;const body=JSON.parse(init.body);assert.equal(body.p_actor,ids.actor);assert.equal(body.p_attempt_id,ids.attempt);assert.equal(body.p_charge_id,ids.charge)
   assert.equal(body.p_evidence.classification,'approved');assert.equal(body.p_evidence.approved_charges,1);assert.equal(body.p_evidence.refunds,0)
   assert.ok(!JSON.stringify(body.p_evidence).includes('SYNTHETIC_AUTH'))
   if(s.rpcFails)return Response.json({message:'synthetic SQL precondition failed'},{status:409})
   return Response.json({resolved:true,idempotent:s.rpc>1,resolution:'external_authorized_reconciliation'})
  }
  throw Error('Unexpected request')
 }
 const deps={json:(status,b)=>Response.json(b,{status}),getCulqiEnvironment,validateCulqiChargeId,verifyExternallyAuthorizedCharge,
  getOrder:async()=>({checkoutId:ids.checkout,total:50,culqiOrderId:ids.culqi}),saveOrder:async()=>{if(s.cacheFails)throw Error('Synthetic cache failure');s.cache++}}
 const handler=new Function(...Object.keys(deps),code)(...Object.values(deps))
 const req=(extra={},auth=true)=>new Request('https://staging.invalid/reconcile',{method:'POST',headers:auth?{authorization:'Bearer synthetic'}:{},body:JSON.stringify({attempt_id:ids.attempt,checkout_id:ids.checkout,charge_id:ids.charge,...extra})})
 try{await run({s,handler,req})}finally{globalThis.fetch=previousFetch;for(const k of Object.keys(process.env))if(!(k in previousEnv))delete process.env[k];Object.assign(process.env,previousEnv)}
}
test('actual handler verifies canonical paid=false authorization; only provider GETs; audited RPC once',async()=>fixture(async({s,handler,req})=>{
 const r=await handler(req());assert.equal(r.status,200);assert.equal((await r.json()).resolved,true);assert.equal(s.rpc,1);assert.equal(s.cache,1)
 assert.ok(s.calls.filter(c=>c.url.includes('api.culqi.com')).every(c=>c.method==='GET'))
}))
for(const [name,change] of [
 ['amount',s=>s.charge.amount=999],['currency',s=>s.charge.currency_code='USD'],['capture',s=>s.charge.capture=false],
 ['checkout',s=>s.charge.metadata.checkout_id=ids.actor],['attempt',s=>s.charge.metadata.attempt_id=ids.actor],
 ['authorization absent',s=>delete s.charge.authorization_code],['contradictory decline',s=>s.charge.decline_code='denied'],
 ['zero approved',s=>s.charge.outcome={type:'operacion_denegada',code:'DNGE0003'}],
 ['two associated charges',s=>s.charges.push({...structuredClone(s.charge),id:'chr_test_second'})],
 ['mismatched second amount',s=>s.charges.push({...structuredClone(s.charge),id:'chr_test_second',amount:999})],
 ['refund',s=>s.refunds=[{id:'ref_test_fixture',charge_id:ids.charge}]],
 ['incomplete pagination',s=>s.hasMore=true],['provider error',s=>s.providerHttp=500],
 ['wrong local rejection source',s=>s.source='culqi_http_4xx'],['wrong local attempt state',s=>s.status='processing'],
])test(`${name} denies without RPC`,async()=>fixture(async({s,handler,req})=>{assert.equal((await handler(req())).status,409);assert.equal(s.rpc,0)},change))
for(const role of ['staff','kitchen','none'])test(`${role} denied before provider`,async()=>fixture(async({s,handler,req})=>{assert.equal((await handler(req())).status,403);assert.equal(s.rpc,0);assert.ok(!s.calls.some(c=>c.url.includes('api.culqi.com')))},s=>s.role=role))
test('inactive admin denied',async()=>fixture(async({handler,req})=>assert.equal((await handler(req())).status,403),s=>s.active=false))
test('manager allowed',async()=>fixture(async({handler,req})=>assert.equal((await handler(req())).status,200),s=>s.role='manager'))
test('anonymous denied',async()=>fixture(async({handler,req})=>assert.equal((await handler(req({},false))).status,403)))
test('client cannot assert actor, financial state, evidence or note',async()=>fixture(async({s,handler,req})=>{for(const x of [{actor:ids.actor},{amount:1000},{evidence:{}},{note:'client note'}])assert.equal((await handler(req(x))).status,400);assert.equal(s.rpc,0)}))
test('SQL denial/uncertain response never retries',async()=>fixture(async({s,handler,req})=>{assert.equal((await handler(req())).status,409);assert.equal(s.rpc,1);assert.equal(s.cache,0)},s=>s.rpcFails=true))
test('cache sync failure preserves successful authoritative transaction, never retries',async()=>fixture(async({s,handler,req})=>{const r=await handler(req());assert.equal(r.status,200);assert.equal((await r.json()).cacheSyncPending,true);assert.equal(s.rpc,1)},s=>s.cacheFails=true))
test('idempotent path still verifies provider and same existing attempt',async()=>fixture(async({s,handler,req})=>{await handler(req());s.status='approved';s.source='external_authorized_reconciliation';const r=await handler(req());assert.equal((await r.json()).idempotent,true);assert.equal(s.calls.filter(c=>c.url.includes('/v2/charges/')).length,2)}))
test('LIVE and production fail closed without any request',async()=>fixture(async({s,handler,req})=>{
 process.env.CULQI_SECRET_KEY='sk_live_fixture';assert.equal((await handler(req())).status,503)
 process.env.CULQI_SECRET_KEY='sk_test_fixture';process.env.SUPABASE_URL='https://production.invalid';assert.equal((await handler(req())).status,503);assert.equal(s.calls.length,0)
}))
test('GET denied without provider access',async()=>fixture(async({s,handler})=>{assert.equal((await handler(new Request('https://staging.invalid'))).status,405);assert.equal(s.calls.length,0)}))
