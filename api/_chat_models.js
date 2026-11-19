'use strict';
const {sign}=require('node:crypto');
const {ChatPolicy}=require('./_chat_privacy');
const PRIMARY='gpt-6.2-sol';
const FALLBACK='gemini-4-hydrogen';
const PRIMARY_URL='https://api.openai.com/v1';
const PRIMARY_CLASSES=new Set(['question','public']);
const MAX_RESPONSE_BYTES=96*1024;
class ModelUnavailable extends Error{
  constructor(){super('Chat model temporarily unavailable');}
}
function eligible(setting,classes){
  const enabled=new Set(String(setting||'').split(',').map(s=>s.trim()));
  return [...classes].every(c=>enabled.has(c));
}
function encode(value){return Buffer.from(JSON.stringify(value)).toString('base64url');}
async function readJson(response){
  if(Number(response.headers.get('content-length'))>MAX_RESPONSE_BYTES)throw new ModelUnavailable();
  const reader=response.body?.getReader();
  if(!reader)throw new ModelUnavailable();
  const parts=[];let size=0;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_RESPONSE_BYTES)throw new ModelUnavailable();
      parts.push(value);
    }
    return JSON.parse(Buffer.concat(parts,size).toString('utf8'));
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
}
function createModels({fetcher=fetch,env=process.env,signal}={}){
  async function call(url,headers,body,ms=18000){
    try{
      const timeout=AbortSignal.timeout(ms);
      const response=await fetcher(url,{method:'POST',headers,body,redirect:'error',
        signal:signal?AbortSignal.any([signal,timeout]):timeout});
      if(!response.ok){
        await response.body?.cancel().catch(()=>{});
        if([408,429,500,502,503,504,529].includes(response.status))throw new ModelUnavailable();
        throw Error('Chat model request rejected');
      }
      return await readJson(response);
    }catch(error){
      if(error instanceof TypeError||error?.name==='TimeoutError'||error?.name==='AbortError')
        throw new ModelUnavailable();
      throw error;
    }
  }
  const openaiKey=env.KNOWLEDGE_HUB_API_KEY;
  const allowedOpenai=classes=>Boolean(openaiKey&&[...classes].every(value=>PRIMARY_CLASSES.has(value)));
  const googleMode=env.CHAT_GEMINI_ROUTE;
  function allowed(provider,classes){
    if(provider===PRIMARY)return allowedOpenai(classes);
    if(provider===FALLBACK){
      const credentials=googleMode==='developer-api'?env.GEMINI_API_KEY:googleMode==='vertex-eu'&&
        env.CHAT_GOOGLE_SERVICE_ACCOUNT_JSON&&/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(env.CHAT_GOOGLE_PROJECT||'');
      return Boolean(env.CHAT_GEMINI_ENABLED==='true'&&credentials&&eligible(env.CHAT_GEMINI_CLASSES,classes));
    }
    return false;
  }
  function openaiHeaders(){
    return {'Content-Type':'application/json',Authorization:'Bearer '+openaiKey};
  }
  async function moderate(texts,classes){
    if(!allowedOpenai(classes))
      throw new ModelUnavailable();
    const result=await call(PRIMARY_URL+'/moderations',openaiHeaders(),JSON.stringify({
      model:'omni-moderation-latest',input:texts
    }),8000);
    if(!Array.isArray(result.results)||result.results.length!==texts.length||
      result.results.some(x=>typeof x?.flagged!=='boolean'))throw new ModelUnavailable();
    return result.results.map(x=>x.flagged);
  }
  let googleAccess;
  async function googleToken(){
    if(googleAccess)return googleAccess;
    const account=JSON.parse(env.CHAT_GOOGLE_SERVICE_ACCOUNT_JSON);
    const aud='https://oauth2.googleapis.com/token';
    const now=Math.floor(Date.now()/1000);
    const input=encode({alg:'RS256',typ:'JWT'})+'.'+encode({
      iss:account.client_email,scope:'https://www.googleapis.com/auth/cloud-platform',aud,iat:now,exp:now+600
    });
    const assertion=input+'.'+sign('RSA-SHA256',Buffer.from(input),account.private_key).toString('base64url');
    const data=await call(aud,{'Content-Type':'application/x-www-form-urlencoded'},
      new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),8000);
    if(typeof data.access_token!=='string'||!data.access_token)throw new ModelUnavailable();
    googleAccess=data.access_token;
    return googleAccess;
  }
  async function ask(provider,kind,instructions,input,schema,classes){
    if(!allowed(provider,classes))throw new ModelUnavailable();
    let raw;
    if(provider===PRIMARY){
      const result=await call(PRIMARY_URL+'/responses',openaiHeaders(),JSON.stringify({
        model:PRIMARY,store:false,reasoning:{effort:'low'},max_output_tokens:kind==='chat_verification'?850:3600,tools:[],
        instructions,input:JSON.stringify(input),
        text:{format:{type:'json_schema',name:kind,schema,strict:true}}
      }));
      const parts=(result.output||[]).flatMap(x=>x.type==='message'?x.content||[]:[]);
      if(parts.some(x=>x.type==='refusal')||result.incomplete_details?.reason==='content_filter')throw new ChatPolicy();
      if(result.status!=='completed')throw Error('Chat output incomplete');
      raw=parts.filter(x=>x.type==='output_text').map(x=>x.text).join('');
    }else{
      const body=JSON.stringify({
        systemInstruction:{parts:[{text:instructions}]},contents:[{role:'user',parts:[{text:JSON.stringify(input)}]}],
        generationConfig:{maxOutputTokens:kind==='chat_verification'?850:3600,thinkingConfig:{thinkingLevel:'LOW'},
          responseMimeType:'application/json',responseJsonSchema:schema}
      });
      // Bound the entire request below the documented implicit caching minimum, with space for framing.
      if(Buffer.byteLength(body)>3500)throw new ModelUnavailable();
      let endpoint,headers={'Content-Type':'application/json'};
      if(googleMode==='developer-api'){
        endpoint='https://generativelanguage.googleapis.com/v1beta/models/'+FALLBACK+':generateContent';
        headers['x-goog-api-key']=env.GEMINI_API_KEY;
      }else{
        endpoint='https://aiplatform.eu.rep.googleapis.com/v1/projects/'+env.CHAT_GOOGLE_PROJECT+
          '/locations/eu/publishers/google/models/'+FALLBACK+':generateContent';
        headers.Authorization='Bearer '+await googleToken();
      }
      const result=await call(endpoint,headers,body);
      const candidate=result.candidates?.[0];
      if(result.promptFeedback?.blockReason||['SAFETY','BLOCKLIST','PROHIBITED_CONTENT','SPII','RECITATION'].includes(candidate?.finishReason))
        throw new ChatPolicy();
      if(candidate?.finishReason!=='STOP')throw Error('Chat output incomplete');
      raw=(candidate.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('');
    }
    if(!raw||raw.length>16000)throw Error('Invalid Chat model response');
    return JSON.parse(raw);
  }
  return {allowed,ask,moderate};
}
module.exports={createModels,PRIMARY,FALLBACK,ModelUnavailable};
