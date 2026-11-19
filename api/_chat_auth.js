'use strict';
const {createHash,createHmac,randomUUID,timingSafeEqual}=require('node:crypto');
const {isIP}=require('node:net');
const ROLE='Full_Access_Chat';
const COOKIE='__Host-kh_chat';
const SESSION_MS=30*60*1000;

function protectedConfig(){
  const password=process.env.FULL_ACCESS_CHAT_PASSWORD;
  const secret=process.env.SESSION_SECRET;
  if(!password||!secret||secret.length<32)throw Error('Chat credentials unavailable');
  const key=createHmac('sha256',secret).update('knowledge-hub-chat-v1\0').update(password).digest();
  return {password,key};
}
function digest(value){return createHash('sha256').update(value).digest();}
function mac(value,key){return createHmac('sha256',key).update(value).digest('base64url');}
function cookie(token='',age=0){
  return COOKIE+'='+token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+age;
}
function tokenFor(session,key){
  const body=Buffer.from(JSON.stringify(session)).toString('base64url');
  return body+'.'+mac(body,key);
}
function claims(req,key){
  try{
    const matches=String(req.headers.cookie||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(COOKIE+'='));
    if(matches.length!==1)return null;
    const value=matches[0].slice(COOKIE.length+1);
    if(value.length>512)return null;
    const parts=value.split('.');
    if(parts.length!==2||!timingSafeEqual(digest(parts[1]),digest(mac(parts[0],key))))return null;
    const data=JSON.parse(Buffer.from(parts[0],'base64url').toString());
    if(data.role!==ROLE||!/^[a-f0-9-]{36}$/.test(data.id)||!Number.isSafeInteger(data.exp)||data.exp<=Date.now())return null;
    return data;
  }catch{return null;}
}
function isSameOrigin(req){
  const host=req.headers.host;
  return typeof host==='string'&&/^[a-z0-9.-]+(?::[0-9]+)?$/i.test(host)&&
    req.headers.origin==='https://'+host&&
    (!req.headers['sec-fetch-site']||req.headers['sec-fetch-site']==='same-origin');
}
function clientKey(req,key,now=Date.now()){
  const address=req.headers['x-vercel-forwarded-for'];
  const ip=typeof address==='string'&&isIP(address.trim())?address.trim():'unknown';
  return mac('ip:'+Math.floor(now/86400000)+':'+ip,key);
}
async function login(req,password,state,config){
  const client=clientKey(req,config.key);
  const valid=typeof password==='string'&&password.length<=1024&&timingSafeEqual(digest(password),digest(config.password));
  return state.transact((data,now)=>{
    const keys=['login:'+client,'login:all'];
    const counters=keys.map(key=>data[key]||{count:0,until:now+60000});
    if(counters[0].count>=6||counters[1].count>=60){
      const until=Math.max(counters[0].count>=6?counters[0].until:0,counters[1].count>=60?counters[1].until:0);
      return {write:false,value:{retryAt:until}};
    }
    if(!valid){
      keys.forEach((key,i)=>{data[key]={...counters[i],count:counters[i].count+1};});
      return {value:{}};
    }
    const session={id:randomUUID(),role:ROLE,exp:now+SESSION_MS};
    data['session:'+session.id]={until:session.exp};
    return {value:{token:tokenFor(session,config.key)}};
  });
}
async function activeSession(req,state,key){
  const session=claims(req,key);
  if(!session)return null;
  const {data}=await state.read();
  return data['session:'+session.id]?.until===session.exp?session:null;
}
async function logout(req,state,key){
  const session=claims(req,key);
  if(!session)return;
  await state.transact(data=>{
    const address='session:'+session.id;
    if(!data[address])return {write:false};
    delete data[address];
  });
}
module.exports={ROLE,SESSION_MS,protectedConfig,cookie,isSameOrigin,clientKey,login,activeSession,logout};
