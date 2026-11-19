'use strict';
const {timingSafeEqual}=require('node:crypto');
const {send}=require('./_auth');
const {createModels,PRIMARY,FALLBACK}=require('./_chat_models');
const {createChatEvidence}=require('./_chat_evidence');
const {makeAnswer}=require('./_chat_answer');
const {createReport}=require('./_chat_report');

const probeSchema={type:'object',properties:{count:{type:'integer'}},required:['count'],additionalProperties:false};
function authorized(req,env,now){
  const [secret,until,...extra]=(env.CHAT_TEST_PROBE||'').split(':');
  const supplied=req.headers['x-chat-test-probe'];
  const end=Number(until);
  return req.method==='POST'&&extra.length===0&&/^[0-9a-f]{64}$/.test(secret)&&
    typeof supplied==='string'&&/^[0-9a-f]{64}$/.test(supplied)&&
    end>now&&end<=now+60*60*1000&&timingSafeEqual(Buffer.from(secret),Buffer.from(supplied));
}
async function runChatProbe(req,res,env=process.env,services={}){
  if(!authorized(req,env,Date.now()))return send(res,404,{error:'Chat unavailable'});
  const models=(services.modelsFor||createModels)({env,signal:AbortSignal.timeout(90000)});
  const checks={};
  async function check(name,run){
    try{checks[name]=await run();}
    catch(error){checks[name]=Number.isInteger(error?.upstreamStatus)?'upstream_'+error.upstreamStatus:'failed';}
  }
  const classes=new Set(['question']);
  await Promise.all([
    check('moderation',async()=>!(await models.moderate(['A synthetic work queue has three requests.'],classes))[0]?'pass':'unexpected'),
    ...[PRIMARY,FALLBACK].map(provider=>check(provider,async()=>{
      if(!models.allowed(provider,classes))return 'disabled';
      const result=await models.ask(provider,'chat_probe','Return the count from the synthetic input.',
        {text:'A synthetic work queue has three requests.'},probeSchema,classes);
      return result?.count===3?'pass':'unexpected';
    }))
  ]);
  await check('public_answer',async()=>{
    if(checks.moderation!=='pass'||(checks[PRIMARY]!=='pass'&&checks[FALLBACK]!=='pass'))return 'skipped';
    const key='synthetic-pilot-probe-label';
    const question='What changes between Generate, Ground and Govern?';
    const hub=(services.evidenceFor||createChatEvidence)({publicOnly:true});
    const evidence=await hub.acquire(question);
    if(evidence.passages.some(p=>p.access!=='public'))return 'scope_denied';
    const result=await makeAnswer({question,evidence,hub,models,key});
    if(result.status!=='answer')return 'unknown';
    return (services.reportFor||createReport)(result).then(()=> 'pass');
  });
  return send(res,200,checks);
}
module.exports={runChatProbe,authorized};
