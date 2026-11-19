'use strict';
const {randomUUID}=require('node:crypto');
const {clientKey}=require('./_chat_auth');

const MINUTE=60000,DAY=86400000,LEASE_MS=120000;
const RESERVE_MICRO_USD=500000;
class ChatLimit extends Error{
  constructor(retryAt){super('Chat limit reached');this.retryAt=retryAt;}
}
function spendCap(){
  const value=Number(process.env.CHAT_DAILY_BUDGET_MICRO_USD||5000000);
  if(!Number.isSafeInteger(value)||value<RESERVE_MICRO_USD)throw Error('Invalid Chat budget');
  return value;
}
async function acquireSlot(req,session,state,key,cap=spendCap()){
  const lease=randomUUID();
  const result=await state.transact((data,now)=>{
    if(data['session:'+session.id]?.until!==session.exp)
      return {write:false,value:{signedOut:true}};
    const activeKey='active:'+session.id;
    if(data[activeKey])return {write:false,value:{retryAt:data[activeKey].until}};
    const minute=Math.floor(now/MINUTE),day=Math.floor(now/DAY);
    const checks=[
      ['rminute:'+session.id+':'+minute,5,1,(minute+1)*MINUTE],
      ['rday:'+session.id+':'+day,30,1,(day+1)*DAY],
      ['rip:'+clientKey(req,key,now)+':'+minute,15,1,(minute+1)*MINUTE],
      ['cost:'+day,cap,RESERVE_MICRO_USD,(day+1)*DAY]
    ];
    let retryAt=0;
    for(const [counter,max,increment,until] of checks){
      if((data[counter]?.count||0)+increment>max)retryAt=Math.max(retryAt,until);
    }
    if(retryAt)return {write:false,value:{retryAt}};
    for(const [counter,,increment,until] of checks)data[counter]={count:(data[counter]?.count||0)+increment,until};
    data[activeKey]={lease,until:now+LEASE_MS};
    return {value:{}};
  });
  if(result.signedOut)return null;
  if(result.retryAt)throw new ChatLimit(result.retryAt);
  return async()=>state.transact(data=>{
    const id='active:'+session.id;
    if(data[id]?.lease!==lease)return {write:false};
    delete data[id];
  });
}
module.exports={acquireSlot,ChatLimit,RESERVE_MICRO_USD};
