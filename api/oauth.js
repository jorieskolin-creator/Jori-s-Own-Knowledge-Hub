'use strict';
const crypto=require('node:crypto');
const {valid}=require('./_auth');
const O=require('./_oauth');
const {BASE,RESOURCE,GOVERNED_RESOURCE,SCOPE,client,safeRedirect,sign,verify,safeEqual,reply,html,escape,readCookie,form,nonce,metadata,resourceMetadata,createUnique,readState,consumeOnce,token,hash}=O;
function bad(res,desc,status=400){return reply(res,status,{error:'invalid_request',error_description:desc})}
function method(req,res,wanted){if(req.method!==wanted){res.setHeader('Allow',wanted);return bad(res,'Method not allowed',405)}}
function validAuth(q){
 const c=client(q.client_id);
 if(!c||!safeRedirect(q.redirect_uri)||!c.redirect_uris.includes(q.redirect_uri))return false;
 if(q.response_type!=='code'||q.code_challenge_method!=='S256')return false;
 if(!/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge||''))return false;
 if(typeof q.state!=='string'||q.state.length<8||q.state.length>2048)return false;
 if(q.scope&&q.scope!==SCOPE&&q.scope!==SCOPE+' offline_access')return false;
 if(q.resource&&q.resource!==RESOURCE&&q.resource!==BASE&&q.resource!==GOVERNED_RESOURCE)return false;
 return true;
}
function redirect(res,url){
 res.statusCode=302;res.setHeader('Location',url);
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.end();
}
function bodyText(req){
 const data=form(req);
 return data&&typeof data==='object'&&!Array.isArray(data)?data:{};
}
async function authorize(req,res){
 if(req.method==='GET'){
  const q=req.query||{};
  if(!validAuth(q))return html(res,400,'<h2>Invalid authorization request</h2><p>ChatGPT must register a valid OAuth client with a permitted redirect URI and PKCE challenge.</p>');
  // Bind consent to the existing authenticated admin session, avoiding a
  // second temporary cookie that some browsers do not retain.
  const login=valid(req,'admin');
  const adminSession=readCookie(req,'__Host-kh_admin');
  const request=login?sign({kind:'authorization',exp:Date.now()+600000,
    client_id:q.client_id,redirect_uri:q.redirect_uri,state:q.state,
    challenge:q.code_challenge,scope:SCOPE,resource:q.resource||RESOURCE,
    admin_session_hash:hash(adminSession)}):null;
  const governed=q.resource===GOVERNED_RESOURCE;
   let content=governed?
    '<h1>Knowledge Hub · Governed Evidence</h1><p>ChatGPT is requesting <strong>evidence-package-only</strong> access to Private documents. This connector does not expose full-document reading.</p>':
    '<h1>Knowledge Hub · Private</h1><p>ChatGPT is requesting <strong>read-only access</strong> to documents in KnowledgeHub-Private. No upload, modification or deletion permission will be granted.</p>';
  if(!login)content+='<p class="warning">You must first sign in as Knowledge Hub administrator.</p><p><a target="_blank" rel="noopener noreferrer" href="/">Open Knowledge Hub login in a new tab</a>. After signing in, return to this page and refresh it.</p>';
  else content+=(governed?'<p>You are signed in as administrator. Approving permits only bounded Evidence Packages from the governed Private MCP endpoint, not direct document reading.</p>':'<p>You are signed in as administrator. Approving will allow the connected ChatGPT client to read Private documents until you revoke or expire its authorization.</p>')+'<form method="POST" action="/oauth/authorize"><input type="hidden" name="request" value="'+escape(request)+'"><input type="hidden" name="consent" value="yes"><button type="submit">Authorize read-only access</button></form>';
  return html(res,200,content);
 }
 if(req.method!=='POST')return bad(res,'Method not allowed',405);
 if(!valid(req,'admin'))return html(res,401,'<h2>Admin session required</h2><p>Sign in to Knowledge Hub as administrator and restart the connection.</p>');
 // Some browsers submit Origin: null from a constrained authorization
 // context. Accept that only when Fetch Metadata positively confirms a
 // same-origin navigation. Keep rejecting cross-site origins and requests.
 const origin=req.headers.origin;
 const fetchSite=req.headers['sec-fetch-site'];
 if(fetchSite&&fetchSite!=='same-origin')
  return html(res,403,'<h2>Unauthorized approval context</h2><p>The approval must be submitted from Knowledge Hub itself.</p>');
 if(origin&&origin!==BASE&&!(origin==='null'&&fetchSite==='same-origin'))
  return html(res,403,'<h2>Unauthorized approval origin</h2><p>The browser reported an origin other than Knowledge Hub. Please restart authorization in the same browser profile.</p>');
 const b=bodyText(req);
 const a=verify(b.request,'authorization');
 if(typeof b.request!=='string'||!b.request)
  return html(res,400,'<h2>Authorization form could not be read</h2><p>Restart the ChatGPT connection.</p>');
 if(!a)
  return html(res,403,'<h2>Authorization request expired or invalid</h2><p>The signed approval has expired or was modified. Restart the ChatGPT connection.</p>');
 if(b.consent!=='yes')
  return html(res,400,'<h2>Approval not confirmed</h2><p>Explicit approval is required.</p>');
 const adminSession=readCookie(req,'__Host-kh_admin');
 if(!adminSession||!a.admin_session_hash||!safeEqual(hash(adminSession),a.admin_session_hash))
  return html(res,403,'<h2>Administrator session changed</h2><p>Sign in to Knowledge Hub and restart the authorization request. The approval must use the same admin session that opened the consent form.</p>');
 const c=client(a.client_id);
 if(!c||!c.redirect_uris.includes(a.redirect_uri)||![RESOURCE,BASE,GOVERNED_RESOURCE].includes(a.resource)||a.scope!==SCOPE)return bad(res,'Invalid client or redirect URI');
 const code=nonce();
 await createUnique('__mcp-oauth-codes/'+hash(code)+'.json',{client_id:a.client_id,redirect_uri:a.redirect_uri,
  challenge:a.challenge,resource:a.resource,scope:SCOPE,exp:Date.now()+180000});
 const destination=new URL(a.redirect_uri);destination.searchParams.set('code',code);destination.searchParams.set('state',a.state);
 return redirect(res,destination.toString());
}
async function registration(req,res){
 if(req.method!=='POST')return bad(res,'Method not allowed',405);
 const b=bodyText(req),uris=b.redirect_uris;
 if(!Array.isArray(uris)||uris.length===0||uris.length>6||!uris.every(safeRedirect))
  return bad(res,'Only ChatGPT callbacks or localhost redirects can register');
 if(b.token_endpoint_auth_method&&b.token_endpoint_auth_method!=='none')return bad(res,'Only public clients with PKCE supported');
 if(b.grant_types&&(!Array.isArray(b.grant_types)||b.grant_types.some(g=>!['authorization_code','refresh_token'].includes(g))))
  return bad(res,'Unsupported grant type');
 const client_id='khc.'+sign({kind:'client',redirect_uris:uris,exp:Date.now()+365*86400000});
 return reply(res,201,{client_id,client_id_issued_at:Math.floor(Date.now()/1000),
  client_secret_expires_at:0,redirect_uris:uris,grant_types:['authorization_code','refresh_token'],
  response_types:['code'],token_endpoint_auth_method:'none',client_name:'ChatGPT Knowledge Hub Private'});
}
async function exchange(req,res){
 if(req.method!=='POST')return bad(res,'Method not allowed',405);
 const b=bodyText(req),c=client(b.client_id);
 if(!c)return reply(res,401,{error:'invalid_client'});
 if(b.grant_type==='authorization_code'){
  if(typeof b.code!=='string'||b.code.length<30||b.code.length>100||!c.redirect_uris.includes(b.redirect_uri))
   return reply(res,400,{error:'invalid_grant'});
  if(typeof b.code_verifier!=='string'||!/^[A-Za-z0-9._~-]{43,128}$/.test(b.code_verifier))
   return reply(res,400,{error:'invalid_grant'});
  const info=await readState('__mcp-oauth-codes/'+hash(b.code)+'.json');
  if(!info||info.exp<Date.now()||info.client_id!==b.client_id||info.redirect_uri!==b.redirect_uri
    ||![RESOURCE,BASE,GOVERNED_RESOURCE].includes(info.resource)||info.scope!==SCOPE)return reply(res,400,{error:'invalid_grant'});
  const digest=crypto.createHash('sha256').update(b.code_verifier).digest('base64url');
  if(!safeEqual(digest,info.challenge))return reply(res,400,{error:'invalid_grant'});
  if(b.resource&&b.resource!==info.resource)return reply(res,400,{error:'invalid_target'});
  if(!await consumeOnce('code',b.code))return reply(res,400,{error:'invalid_grant'});
  return reply(res,200,token('admin',b.client_id,info.resource));
 }
 if(b.grant_type==='refresh_token'){
  const refresh=verify(b.refresh_token,'refresh');
  if(!refresh||refresh.client_id!==b.client_id||refresh.iss!==BASE||![RESOURCE,BASE,GOVERNED_RESOURCE].includes(refresh.aud)||refresh.scope!==SCOPE)
   return reply(res,400,{error:'invalid_grant'});
  if(b.resource&&b.resource!==refresh.aud)return reply(res,400,{error:'invalid_target'});
  if(!await consumeOnce('refresh',refresh.jti))return reply(res,400,{error:'invalid_grant'});
  return reply(res,200,token(refresh.sub,b.client_id,refresh.aud));
 }
 return reply(res,400,{error:'unsupported_grant_type'});
}
module.exports=async function(req,res){
 const route=req.query?.route;
 try{
  if(route==='metadata'){
   if(req.method!=='GET')return method(req,res,'GET');
   return reply(res,200,metadata());
  }
  if(route==='resource'){
   if(req.method!=='GET')return method(req,res,'GET');
   return reply(res,200,resourceMetadata());
   }
   if(route==='resource-governed'){
    if(req.method!=='GET')return method(req,res,'GET');
    return reply(res,200,resourceMetadata(GOVERNED_RESOURCE));
  }
  if(route==='authorize')return authorize(req,res);
  if(route==='register')return registration(req,res);
  if(route==='token')return exchange(req,res);
  return bad(res,'Unknown OAuth endpoint',404);
 }catch(e){
  // Never send internal Blob error details, tokens or secrets to clients.
  return reply(res,503,{error:'temporarily_unavailable',error_description:'Knowledge Hub OAuth service temporarily unavailable'});
 }
};
