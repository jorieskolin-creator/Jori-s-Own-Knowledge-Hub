'use strict';
const {send}=require('./_auth');
const auth=require('./_chat_auth');
const {createState}=require('./_chat_state');
const {acquireSlot,ChatLimit}=require('./_chat_limits');
const {screenQuestion,ChatPolicy}=require('./_chat_privacy');
const {createChatEvidence}=require('./_chat_evidence');
const {createModels,ModelUnavailable}=require('./_chat_models');
const {makeAnswer}=require('./_chat_answer');

function chatShell(res){
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('Referrer-Policy','no-referrer');
  return res.status(200).end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Ask Knowledge Hub</title>
<link rel="stylesheet" href="/knowledge-chat.css"><script src="/knowledge-chat.js" defer></script></head>
<body><main><header><h1>Ask Knowledge Hub</h1><button id="chat-logout" type="button" hidden>Sign out</button></header>
<form id="chat-login" hidden><label for="chat-password">Chat password</label>
<div class="login-fields"><input id="chat-password" type="password" required maxlength="1024" autocomplete="current-password"><button class="primary">Sign in</button></div></form>
<section id="chat-workspace" hidden>
<form id="chat-question-form"><label for="chat-question">Your question</label>
<textarea id="chat-question" required minlength="2" maxlength="1200" rows="4" aria-describedby="chat-input-guidance"></textarea>
<p id="chat-input-guidance" class="hint">Use roles or generic descriptions in place of names and company names.</p>
<label id="chat-follow-label" hidden><input type="checkbox" id="chat-follow"> Include my previous question for context</label>
<button id="chat-submit" class="primary">Ask</button></form>
<section id="chat-results" aria-label="Answers" aria-live="polite"></section></section>
<p id="chat-status" role="status">Checking session…</p></main></body></html>`);
}
function createHandler({state=createState(),enabled=()=>process.env.KNOWLEDGE_HUB_CHAT_ENABLED==='true',
  evidenceFor=createChatEvidence,modelsFor=createModels}={}){
  function retry(res,at,message){
    res.setHeader('Retry-After',String(Math.max(1,Math.ceil((at-Date.now())/1000))));
    return send(res,429,{error:message});
  }
  async function answer(req,res,config,body){
    const session=await auth.activeSession(req,state,config.key);
    if(!session)return send(res,401,{error:'Sign in to use Chat'});
    const release=await acquireSlot(req,session,state,config.key);
    if(!release)return send(res,401,{error:'Sign in to use Chat'});
    const closed=new AbortController();
    const onClose=()=>closed.abort();
    res.once?.('close',onClose);
    const signal=AbortSignal.any([closed.signal,AbortSignal.timeout(95000)]);
    const stillSignedIn=async()=>{
      if(signal.aborted)throw new ModelUnavailable();
      const active=await auth.activeSession(req,state,config.key);
      if(!active||active.id!==session.id)throw new ModelUnavailable();
    };
    try{
      const question=screenQuestion(body?.question,'chat');
      const hub=evidenceFor();
      const evidence=await hub.acquire(question);
      const result=await makeAnswer({question,evidence,hub,models:modelsFor({signal}),
        key:config.key,beforeEgress:stillSignedIn});
      await stillSignedIn();
      return send(res,200,result);
    }finally{
      res.off?.('close',onClose);
      // The self-expiring lease remains effective if release is interrupted.
      await release().catch(()=>{});
    }
  }
  return async function(req,res){
    if(!enabled())return send(res,404,{error:'Chat unavailable'});
    const action=req.query?.action||'shell';
    if(!['shell','session','login','logout','answer'].includes(action))return send(res,404,{error:'Chat operation unavailable'});
    if(req.method!==(['shell','session'].includes(action)?'GET':'POST'))return send(res,405,{error:'Method not allowed'});
    if(req.method==='POST'&&!auth.isSameOrigin(req))return send(res,403,{error:'Invalid request origin'});
    try{
      const config=auth.protectedConfig();
      if(action==='shell')return chatShell(res);
      if(action==='session'){
        const active=await auth.activeSession(req,state,config.key);
        return send(res,200,{authenticated:Boolean(active)});
      }
      if(action==='logout'){
        await auth.logout(req,state,config.key);
        res.setHeader('Set-Cookie',auth.cookie());
        return send(res,200,{authenticated:false});
      }
      if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))
        return send(res,415,{error:'Send a JSON request'});
      const body=Buffer.isBuffer(req.body)?JSON.parse(req.body.toString()):typeof req.body==='string'?JSON.parse(req.body):req.body;
      if(action==='answer')return await answer(req,res,config,body);
      const result=await auth.login(req,body?.password,state,config);
      if(result.retryAt)return retry(res,result.retryAt,'Too many sign-in attempts');
      if(!result.token)return send(res,401,{error:'Invalid chat password'});
      res.setHeader('Set-Cookie',auth.cookie(result.token,auth.SESSION_MS/1000));
      return send(res,200,{authenticated:true});
    }catch(error){
      if(error instanceof ChatLimit)return retry(res,error.retryAt,'Chat limit reached. Try again after the indicated wait.');
      if(error instanceof ChatPolicy)return send(res,422,{error:'The request or answer could not be released under the Chat rules.'});
      if(error instanceof SyntaxError||error instanceof RangeError)return send(res,400,{error:'Invalid request'});
      return send(res,503,{error:'Chat temporarily unavailable'});
    }
  };
}
module.exports=createHandler();
module.exports.createHandler=createHandler;
