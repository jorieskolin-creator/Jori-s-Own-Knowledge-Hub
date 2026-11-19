'use strict';
const {send}=require('./_auth');
const auth=require('./_chat_auth');
const {createState}=require('./_chat_state');

function chatShell(res){
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('Referrer-Policy','no-referrer');
  return res.status(200).end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Ask Knowledge Hub</title><script src="/knowledge-chat.js" defer></script></head>
<body><main><h1>Ask Knowledge Hub</h1>
<form id="chat-login" hidden><label for="chat-password">Chat password</label>
<input id="chat-password" type="password" required maxlength="1024" autocomplete="current-password"><button>Sign in</button></form>
<section id="chat-workspace" hidden><button id="chat-logout" type="button">Sign out</button></section>
<p id="chat-status" role="status">Checking session…</p></main></body></html>`);
}
function createHandler({state=createState(),enabled=()=>process.env.KNOWLEDGE_HUB_CHAT_ENABLED==='true'}={}){
  return async function(req,res){
    if(!enabled())return send(res,404,{error:'Chat unavailable'});
    const action=req.query?.action||'shell';
    if(!['shell','session','login','logout'].includes(action))return send(res,404,{error:'Chat operation unavailable'});
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
        return send(res,415,{error:'Send a JSON sign-in request'});
      const body=Buffer.isBuffer(req.body)?JSON.parse(req.body.toString()):typeof req.body==='string'?JSON.parse(req.body):req.body;
      const result=await auth.login(req,body?.password,state,config);
      if(result.retryAt){
        res.setHeader('Retry-After',String(Math.max(1,Math.ceil((result.retryAt-Date.now())/1000))));
        return send(res,429,{error:'Too many sign-in attempts'});
      }
      if(!result.token)return send(res,401,{error:'Invalid chat password'});
      res.setHeader('Set-Cookie',auth.cookie(result.token,auth.SESSION_MS/1000));
      return send(res,200,{authenticated:true});
    }catch(error){
      if(error instanceof SyntaxError)return send(res,400,{error:'Invalid request'});
      return send(res,503,{error:'Chat temporarily unavailable'});
    }
  };
}
module.exports=createHandler();
module.exports.createHandler=createHandler;
