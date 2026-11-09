import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {getCulqiEnvironment} from '../netlify/lib/culqi-verification.ts'
import {verifyPrechargeZeroCharges} from '../netlify/lib/precharge-resolution.ts'
const ids={order:'22222222-2222-4222-8222-222222222222',checkout:'11111111-1111-4111-8111-111111111111',actor:'33333333-3333-4333-8333-333333333333'}
const source=readFileSync(new URL('../netlify/functions/gift-card-precharge-resolve.ts',import.meta.url),'utf8')
const executable=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import .* from .*;?\r?\n/gm,'').replace('export default','return')
async function fixture(run,change=()=>{}) {
 const priorFetch=globalThis.fetch,priorEnv={...process.env}
 process.env.SUPABASE_URL='https://kqfphrukxdvlrbjipjnx.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';process.env.CULQI_SECRET_KEY='sk_test_fixture'
 const s={role:'admin',active:true,state:'deleted',charges:[],rpc:0,audits:0,released:false,cache:0,calls:[],orderHttp:200,listHttp:200,rpcFails:false,checkout:ids.checkout}
 change(s)
 globalThis.fetch=async(url,init={})=>{
  const p=String(url);s.calls.push({path:p,method:init.method??'GET'})
  if(p.includes('/auth/v1/user'))return Response.json({id:ids.actor})
  if(p.includes('/staff_profiles?'))return Response.json(s.role==='none'?[]:[{role:s.role,active:s.active}])
  if(p.includes('/rest/v1/orders?'))return Response.json([{id:ids.order,checkout_id:s.checkout,order_number:'STG-PRECHARGE',culqi_order_id:'ord_test_fixture',other_payment_amount:10}])
  if(p.includes('/v2/orders/'))return Response.json({id:'ord_test_fixture',order_number:'STG-PRECHARGE',amount:1000,currency_code:'PEN',state:s.state,metadata:{checkout_id:ids.checkout}}, {status:s.orderHttp})
  if(p.includes('/v2/charges?'))return Response.json({data:s.charges,has_more:s.hasMore??false},{status:s.listHttp})
  if(p.includes('/rpc/resolve_precharge_gift_card_order')){
   s.rpc++; const body=JSON.parse(init.body);assert.equal(body.p_actor,ids.actor);assert.equal(body.p_checkout_id,ids.checkout);assert.equal(body.p_evidence.associated_charges,0)
   if(s.rpcFails)return Response.json({message:'synthetic concurrent attempt/local precondition failed'},{status:409})
   const duplicate=s.released;if(!duplicate){s.released=true;s.audits++}return Response.json({resolved:true,idempotent:duplicate,resolution:'precharge_no_charge'})
  }
  throw Error('Unexpected request')
 }
 const deps={json:(status,b)=>Response.json(b,{status}),getCulqiEnvironment,verifyPrechargeZeroCharges,getOrder:async()=>({checkoutId:ids.checkout,paymentStatus:'pending'}),saveOrder:async()=>{s.cache++}}
 const handler=new Function(...Object.keys(deps),executable)(...Object.values(deps))
 const req=(extra={},auth=true)=>new Request('https://staging.invalid/resolve',{method:'POST',headers:auth?{authorization:'Bearer synthetic'}:{},body:JSON.stringify({orderId:ids.order,checkoutId:ids.checkout,note:'Synthetic authorized test resolution',...extra})})
 try{await run({s,handler,req})}finally{globalThis.fetch=priorFetch;for(const k of Object.keys(process.env))if(!(k in priorEnv))delete process.env[k];Object.assign(process.env,priorEnv)}
}
test('actual backend: zero-charge deleted order resolves with audited human, stable repeat',async()=>fixture(async({s,handler,req})=>{
 assert.equal((await handler(req())).status,200);assert.equal(s.audits,1);assert.equal((await(await handler(req())).json()).idempotent,true);assert.equal(s.audits,1)
 assert.ok(s.calls.filter(c=>c.path.includes('api.culqi.com')).every(c=>c.method==='GET'))
}))
test('two concurrent backend calls share one logical resolution/audit (RPC serialized model)',async()=>fixture(async({s,handler,req})=>{
 const r=await Promise.all([handler(req()),handler(req())]);assert.ok(r.every(r=>r.status===200));assert.equal(s.audits,1)
}))
for(const role of ['staff','kitchen','none'])test(`denies ${role} before provider/RPC`,async()=>fixture(async({s,handler,req})=>{assert.equal((await handler(req())).status,403);assert.equal(s.rpc,0);assert.ok(!s.calls.some(c=>c.path.includes('api.culqi.com')))},s=>s.role=role))
test('inactive admin denied',async()=>fixture(async({handler,req})=>assert.equal((await handler(req())).status,403),s=>s.active=false))
test('manager allowed',async()=>fixture(async({handler,req})=>assert.equal((await handler(req())).status,200),s=>s.role='manager'))
test('anonymous denied',async()=>fixture(async({handler,req})=>assert.equal((await handler(req({},false))).status,403)))
test('client cannot supply actor, evidence or financial data',async()=>fixture(async({s,handler,req})=>{for(const extra of [{actor:ids.actor},{evidence:{}},{amount:1000}])assert.equal((await handler(req(extra))).status,400);assert.equal(s.rpc,0)}))
for(const state of ['pending','expired','paid'])test(`external ${state} rejected`,async()=>fixture(async({s,handler,req})=>{assert.equal((await handler(req())).status,409);assert.equal(s.rpc,0)},s=>s.state=state))
for(const approved of [false,true])test(`any associated charge blocks, approved=${approved}`,async()=>fixture(async({s,handler,req})=>{assert.equal((await handler(req())).status,409);assert.equal(s.rpc,0)},s=>s.charges=[{id:'chr_test_fixture',description:'Pedido STG-PRECHARGE',paid:approved,amount:999}]))
test('wrong checkout blocked',async()=>fixture(async({s,handler,req})=>{assert.equal((await handler(req({checkoutId:ids.actor}))).status,409);assert.equal(s.rpc,0)}))
for(const link of [{metadata:{order_number:'STG-PRECHARGE'}},{order:{id:'ord_test_fixture'}}])test(`associated charge alternate reference blocks ${JSON.stringify(link)}`,async()=>fixture(async({s,handler,req})=>{assert.equal((await handler(req())).status,409);assert.equal(s.rpc,0)},s=>s.charges=[{id:'chr_test_fixture',description:'Other description',amount:999,...link}]))
test('incomplete scan fails closed',async()=>fixture(async({s,handler,req})=>{assert.equal((await handler(req())).status,409);assert.equal(s.rpc,0)},s=>s.hasMore=true))
test('provider error fails closed',async()=>fixture(async({s,handler,req})=>{assert.equal((await handler(req())).status,409);assert.equal(s.rpc,0)},s=>s.listHttp=500))
test('concurrent local attempt/refund/state change rejected by RPC, no retry',async()=>fixture(async({s,handler,req})=>{assert.equal((await handler(req())).status,409);assert.equal(s.rpc,1);assert.equal(s.audits,0)},s=>s.rpcFails=true))
test('LIVE and production fail before requests',async()=>fixture(async({s,handler,req})=>{process.env.CULQI_SECRET_KEY='sk_live_fixture';assert.equal((await handler(req())).status,503);assert.equal(s.calls.length,0)}))
