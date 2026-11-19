'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHandler}=require('../api/chat');
const {sign}=require('../api/_auth');
const {createState}=require('../api/_chat_state');
const {BlobPreconditionFailedError}=require('@vercel/blob');

process.env.SESSION_SECRET='local-synthetic-session-secret-'.repeat(2);
process.env.FULL_ACCESS_CHAT_PASSWORD='synthetic-password';

function memoryState(){
  let etag=0,stored=null;
  const state=createState({
    readBlob:async(path,options)=>{
      assert.equal(options.access,'private');
      assert.equal(options.useCache,false);
      if(!stored)return null;
      return {statusCode:200,blob:{etag:String(etag),size:Buffer.byteLength(stored)},stream:new Blob([stored]).stream()};
    },
    writeBlob:async(path,body,options)=>{
      if(etag&&options.ifMatch!==String(etag))throw new BlobPreconditionFailedError();
      stored=body;
      etag++;
    },
    backoff:async()=>{}
  });
  return state;
}
function request(handler,action,method='GET',{cookie='',origin='https://example.test',password}={}){
  const res={
    headers:{},
    status(code){this.statusCode=code;return this;},
    setHeader(k,v){this.headers[k.toLowerCase()]=v;return this;},
    json(payload){this.payload=payload;return this;},
    end(payload){this.payload=payload;return this;}
  };
  const headers={cookie,origin,host:'example.test','content-type':'application/json','x-vercel-forwarded-for':'192.0.2.5'};
  return Promise.resolve(handler({headers,method,body:{password},query:{action}},res)).then(()=>res);
}
test('Chat disabled by default, rejects cross-origin and revokes sessions on logout',async()=>{
  assert.equal((await request(createHandler(),'shell')).statusCode,404);
  const handler=createHandler({state:memoryState(),enabled:()=>true});
  assert.equal((await request(handler,'login','POST',{origin:'https://other.test',password:'synthetic-password'})).statusCode,403);
  const logged=await request(handler,'login','POST',{password:'synthetic-password'});
  assert.equal(logged.statusCode,200);
  assert.match(logged.headers['set-cookie'],/^__Host-kh_chat=.*HttpOnly; Secure; SameSite=Strict/);
  const cookie=logged.headers['set-cookie'].split(';')[0];
  assert.deepEqual((await request(handler,'session','GET',{cookie})).payload,{authenticated:true});
  assert.equal((await request(handler,'session','GET',{cookie:'__Host-kh_admin='+sign('admin',1)})).payload.authenticated,false);
  assert.equal((await request(handler,'session','GET',{cookie:cookie.slice(0,-1)+'#'})).payload.authenticated,false);
  for(const [file,method] of [['documents','GET'],['master-table','GET'],['view','GET'],['private-document','GET'],['initialize-folders','POST']]){
    const res={status(code){this.code=code;return this;},setHeader(){return this;},json(){return this;}};
    await require('../api/'+file)({method,headers:{cookie},query:{access:'private',pathname:'01-solutions/fixture.html'}},res);
    assert.equal(res.code,401,file);
  }
  assert.equal((await request(handler,'logout','POST',{cookie})).statusCode,200);
  assert.equal((await request(handler,'session','GET',{cookie})).payload.authenticated,false);
});
test('Login throttles failed attempts and missing credentials fail closed',async()=>{
  const handler=createHandler({state:memoryState(),enabled:()=>true});
  for(let i=0;i<6;i++)assert.equal((await request(handler,'login','POST',{password:'incorrect'})).statusCode,401);
  assert.equal((await request(handler,'login','POST',{password:'synthetic-password'})).statusCode,429);
  const pass=process.env.FULL_ACCESS_CHAT_PASSWORD;
  delete process.env.FULL_ACCESS_CHAT_PASSWORD;
  try{assert.equal((await request(handler,'session')).statusCode,503);}
  finally{process.env.FULL_ACCESS_CHAT_PASSWORD=pass;}
});
module.exports={memoryState,request};
