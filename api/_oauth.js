'use strict';
const crypto=require('node:crypto');
const {put,get}=require('@vercel/blob');
const {Readable}=require('node:stream');
const BASE='https://jori-knowledge-hub.vercel.app';
const RESOURCE=BASE+'/api/mcp-private';
const GOVERNED_RESOURCE=BASE+'/api/mcp-governed-private';
const UNIFIED_RESOURCE=BASE+'/api/mcp-governed-unified';
const SCOPE='documents:read';
const privateStore=()=>process.env.PRIVATE_BLOB_STORE_ID||'store_YAAwH6FewcrImhA1';
function key(){
 const s=process.env.SESSION_SECRET;
 if(!s||s.length<32)throw Error('SESSION_SECRET not configured');
 return crypto.createHmac('sha256',s).update('knowledge-hub-mcp-oauth-v1').digest();
}
function hash(v){return crypto.createHash('sha256').update(v).digest('hex')}
function sign(data){
 const body=Buffer.from(JSON.stringify(data)).toString('base64url');
 return body+'.'+crypto.createHmac('sha256',key()).update(body).digest('base64url');
}
function verify(token,kind){
 try{
  if(typeof token!=='string'||token.length>6000)return null;
  const pieces=token.split('.');if(pieces.length!==2)return null;
  const [body,mac]=pieces;
  const expected=crypto.createHmac('sha256',key()).update(body).digest('base64url');
  const a=Buffer.from(mac),b=Buffer.from(expected);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
  const d=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
  if(!d||d.kind!==kind||!Number.isSafeInteger(d.exp)||d.exp<Date.now())return null;
  return d;
 }catch{return null}
}
function safeRedirect(uri){
 if(typeof uri!=='string'||uri.length>1024)return false;
 try{
  const u=new URL(uri);
  if(u.hash||u.username||u.password)return false;
  if(u.protocol==='https:'&&u.hostname==='chatgpt.com'&&!u.port)
   return u.pathname==='/connector_platform_oauth_redirect'||/^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(u.pathname);
  if(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))
   return true;
  return false;
 }catch{return false}
}
function client(id){
 if(typeof id!=='string'||!id.startsWith('khc.'))return null;
 const c=verify(id.slice(4),'client');
 if(!c||!Array.isArray(c.redirect_uris)||!c.redirect_uris.every(safeRedirect))return null;
 return c;
}
function safeEqual(a,b){
 const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));
 return x.length===y.length&&crypto.timingSafeEqual(x,y);
}
function reply(res,status,payload){
 res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');res.end(JSON.stringify(payload));
}
function secure(res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://chatgpt.com; frame-ancestors 'none'; base-uri 'none'");
}
function html(res,status,body){
 secure(res);res.statusCode=status;res.setHeader('Content-Type','text/html; charset=utf-8');
 return res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Knowledge Hub authorization</title><style>body{font:16px/1.55 system-ui,sans-serif;color:#173149;background:#f7f9fb;padding:36px 18px}main{max-width:530px;margin:36px auto;padding:30px;border-radius:16px;background:white;border:1px solid #dce4eb}button{border:0;background:#102a42;color:white;border-radius:9px;padding:13px 18px;font:inherit;cursor:pointer}a{color:#096b50}p{color:#586b7c}.warning{color:#9b2929}</style></head><body><main>'+body+'</main></body></html>');
}
function escape(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function readCookie(req,name){
 const row=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));
 return row?row.slice(name.length+1):'';
}
function form(req){
 const body=req.body;
 if(body===undefined||body===null)return {};
 if(Buffer.isBuffer(body))return parseText(body.toString('utf8'));
 if(typeof body==='string')return parseText(body);
 if(body instanceof URLSearchParams)return Object.fromEntries(body);
 if(typeof body==='object'&&!Array.isArray(body))return body;
 return {};
}
function parseText(text){
 if(typeof text!=='string'||text.length>65536)return {};
 const source=text.trim();
 if(source.startsWith('{')){
  try{const value=JSON.parse(source);return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return {}}
 }
 try{return Object.fromEntries(new URLSearchParams(source))}catch{return {}}
}
function nonce(){return crypto.randomBytes(32).toString('base64url')}
function metadata(){
 return {issuer:BASE,authorization_endpoint:BASE+'/oauth/authorize',token_endpoint:BASE+'/oauth/token',
  registration_endpoint:BASE+'/oauth/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],
  token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],
  scopes_supported:[SCOPE,'offline_access'],service_documentation:BASE};
}
function resourceMetadata(resource=RESOURCE){
 if(![RESOURCE,GOVERNED_RESOURCE,UNIFIED_RESOURCE].includes(resource))throw Error('Unknown protected resource');
 return {resource,authorization_servers:[BASE],scopes_supported:[SCOPE],
  bearer_methods_supported:['header'],resource_name:resource===UNIFIED_RESOURCE?'Jori Knowledge Hub Governed Evidence Public + Private':
   resource===GOVERNED_RESOURCE?'Jori Knowledge Hub Governed Evidence Private':'Jori Knowledge Hub Private'};
}
function challenge(res){
 res.setHeader('WWW-Authenticate','Bearer resource_metadata="'+BASE+'/.well-known/oauth-protected-resource", scope="'+SCOPE+'"');
}
function authorized(req,resource=RESOURCE){
 const header=req.headers.authorization||'';
 const m=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(header);
 const d=m?verify(m[1],'access'):null;
 // The governed resource accepts ONLY its own audience. Its token cannot call the full-document endpoint.
 const audience=resource===UNIFIED_RESOURCE?d?.aud===UNIFIED_RESOURCE:
  resource===GOVERNED_RESOURCE?d?.aud===GOVERNED_RESOURCE:
  (d?.aud===RESOURCE||d?.aud===BASE);
 return d&&audience&&d.iss===BASE&&d.scope===SCOPE?d:null;
}
function blobOptions(path){return {access:'private',storeId:privateStore(),addRandomSuffix:false,allowOverwrite:false,contentType:'application/json',ttlDays:path.includes('/refresh/')?31:1}}
async function createUnique(path,body){return put(path,JSON.stringify(body),blobOptions(path))}
async function readState(path){
 const x=await get(path,{access:'private',storeId:privateStore()});
 if(!x||!x.stream)return null;
 const chunks=[];let bytes=0;
 for await(const chunk of Readable.fromWeb(x.stream)){bytes+=chunk.length;if(bytes>12000)throw Error('OAuth state oversized');chunks.push(chunk)}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function consumeOnce(type,id){
 // The Blob store must reject duplicate pathname creation for this to be atomic.
 try{
  await createUnique('__mcp-oauth-used/'+type+'/'+hash(id)+'.json',{at:Date.now()});
  return true;
 }catch{return false}
}
function token(sub,clientId,resource=RESOURCE){
 const now=Date.now(),refreshId=nonce();
 const access_token=sign({kind:'access',sub,client_id:clientId,scope:SCOPE,iss:BASE,aud:resource,iat:now,exp:now+3600000,jti:nonce()});
 const refresh_token=sign({kind:'refresh',sub,client_id:clientId,scope:SCOPE,iss:BASE,aud:resource,iat:now,exp:now+30*86400000,jti:refreshId});
 return {access_token,token_type:'Bearer',expires_in:3600,refresh_token,scope:SCOPE};
}
module.exports={BASE,RESOURCE,GOVERNED_RESOURCE,UNIFIED_RESOURCE,SCOPE,client,safeRedirect,sign,verify,safeEqual,reply,secure,html,escape,readCookie,form,nonce,metadata,resourceMetadata,challenge,authorized,createUnique,readState,consumeOnce,token,hash};
