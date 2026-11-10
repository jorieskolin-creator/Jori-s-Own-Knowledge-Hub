const crypto=require('node:crypto');
function send(res,status,payload){res.status(status).setHeader('Cache-Control','private, no-store, max-age=0').setHeader('X-Content-Type-Options','nosniff').json(payload)}
function parseCookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),decodeURIComponent(x.slice(i+1))]}))}
function safeEqual(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length && crypto.timingSafeEqual(x,y)}
function secret(){const s=process.env.SESSION_SECRET;if(!s||s.length<32)throw Error('SESSION_SECRET is missing or too short');return s}
function sign(role,hours){const body=Buffer.from(JSON.stringify({role,exp:Date.now()+hours*3600000})).toString('base64url');const mac=crypto.createHmac('sha256',secret()).update(body).digest('base64url');return body+'.'+mac}
function valid(req,role){try{const v=parseCookies(req)[role==='admin'?'__Host-kh_admin':'__Host-kh_guest'];if(!v)return false;const [body,mac]=v.split('.');if(!body||!mac)return false;const expected=crypto.createHmac('sha256',secret()).update(body).digest('base64url');if(!safeEqual(mac,expected))return false;const data=JSON.parse(Buffer.from(body,'base64url').toString());return data.role===role&&Number.isFinite(data.exp)&&data.exp>Date.now()}catch{return false}}
function cookie(role,token,age){const name=role==='admin'?'__Host-kh_admin':'__Host-kh_guest';return name+'='+token+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+age}
function passwordOkay(actual,wanted){return !!wanted && safeEqual(actual,wanted)}
function postBody(req){if(typeof req.body==='object'&&req.body)return req.body;try{return JSON.parse(req.body||'{}')}catch{return {}}}
module.exports={send,valid,sign,cookie,passwordOkay,postBody};
