'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createHandler}=require('../api/chat');
const {createChatEvidence}=require('../api/_chat_evidence');
const {metadata}=require('../api/_governed_unified');
const {entryFromDoc}=require('../api/_master_table');
const {FALLBACK,PRIMARY,ModelUnavailable}=require('../api/_chat_models');
const {referencePages}=require('../api/_chat_report');

process.env.SESSION_SECRET='synthetic-integration-session-secret-'.repeat(2);
process.env.FULL_ACCESS_CHAT_PASSWORD='integration-fixture-password';
const privateId='private:02-frameworks/access-review.html';
const privateText='<h1>Governance review</h1><p>A reviewer records the decision before the release can proceed.</p>';
const staged=[
  {access:'private',pathname:privateId.slice(8),text:privateText},
  {access:'public',pathname:'03-general-presentations/governance.html',text:'<p>The process involves a governance review.</p>'},
  {access:'private',pathname:'06-personal/governance.html',text:'<p>PERSONALFIXTUREMARKER</p>'}
].map(r=>({...r,size:Buffer.byteLength(r.text),uploadedAt:'2026-11-10T00:00:00Z'}));
const approved=staged.map(row=>({...entryFromDoc(metadata(row,row.access)),review_status:'Approved',key_terms:['governance','reviewer']}));
const privateStore=process.env.PRIVATE_BLOB_STORE_ID||'store_YAAwH6FewcrImhA1';

async function harness(t,{fault=false,allowFallback=true}={}){
  const data={};
  const state={
    read:async()=>({data}),
    transact:async change=>{
      const now=Date.now();
      for(const field of Object.keys(data))if(data[field].until<=now)delete data[field];
      return change(data,now)?.value;
    }
  };
  const calls=[];
  let publication=approved;
  function evidenceFor(){
    const lookup=(pathname,storeId)=>staged.find(r=>r.pathname===pathname&&r.access===(storeId===privateStore?'private':'public'));
    return createChatEvidence({
      list:async({storeId})=>({blobs:staged.filter(r=>r.access===(storeId===privateStore?'private':'public'))}),
      headBlob:async(path,{storeId})=>({...lookup(path,storeId),etag:'fixture'}),
      readBlob:async(path,{storeId})=>{
        const source=lookup(path,storeId);
        assert.ok(source);
        assert.doesNotMatch(path,/06-personal/);
        return {statusCode:200,blob:{etag:'fixture'},stream:new Blob([source.text]).stream()};
      },
      readPublication:async()=>({table:{records:approved,published_records:publication,publication:{status:'Approved'}}})
    });
  }
  const handler=createHandler({
    state,evidenceFor,enabled:()=>true,publicOnly:()=>false,pdfEnabled:()=>true,wordEnabled:()=>true,
    modelsFor:()=>({
      allowed:(provider,classes)=>provider===FALLBACK&&allowFallback&&classes.has('private'),
      moderate:async texts=>{
        assert.doesNotMatch(JSON.stringify(texts),/PERSONALFIXTUREMARKER|Jane Placeholder|private:|access-review.html/);
        return texts.map(value=>value.includes('synthetic blocked request'));
      },
      ask:async (provider,kind,instructions,input)=>{
        calls.push([provider,kind]);
        assert.doesNotMatch(JSON.stringify(input),/PERSONALFIXTUREMARKER|Jane Placeholder|private:|access-review.html/);
        if(fault&&provider===PRIMARY)throw new ModelUnavailable();
        if(kind==='chat_verification')return {supported:true};
        const passage=input.evidence.find(x=>x.text.includes('records the decision'));
        if(!passage)return {status:'unknown',claims:[]};
        return {status:'partial',claims:[{text:'A reviewer documents the decision before release.',refs:[passage.ref]}]};
      }
    })
  });
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    req.query=Object.fromEntries(url.searchParams);
    if(url.pathname==='/chat')req.query.action='shell';
    if(req.headers['content-type']?.startsWith('application/json')){
      const chunks=[];
      for await(const chunk of req)chunks.push(chunk);
      req.body=Buffer.concat(chunks);
    }
    res.status=code=>{res.statusCode=code;return res;};
    res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));return res;};
    const direct={
      '/api/documents':require('../api/documents'),'/api/master-table':require('../api/master-table'),
      '/api/view':require('../api/view')
    };
    try{await (direct[url.pathname]||handler)(req,res);}
    catch{if(!res.headersSent)res.status(500).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const addr='http://127.0.0.1:'+server.address().port;
  let cookie='';
  async function call(path,body,session=cookie){
    const headers={cookie:session,origin:addr.replace('http:','https:'),'x-vercel-forwarded-for':'192.0.2.1'};
    const options={headers,method:body===undefined?'GET':'POST'};
    if(body instanceof FormData)options.body=body;
    else if(body!==undefined){headers['content-type']='application/json';options.body=JSON.stringify(body);}
    return fetch(addr+path,options);
  }
  const ask=(question,format)=>call('/api/chat?action=answer',{question,format});
  const login=async()=>{
    const response=await call('/api/chat?action=login',{password:process.env.FULL_ACCESS_CHAT_PASSWORD},'');
    assert.equal(response.status,200);
    cookie=response.headers.get('Set-Cookie').split(';')[0];
  };
  return {call,ask,login,calls,unpublish:()=>{publication=approved.filter(r=>r.id!==privateId);}};
}

test('HTTP journey reveals checked Private evidence and a Word report through Chat only',async t=>{
  const h=await harness(t);
  const shell=await h.call('/chat');
  assert.equal(shell.status,200);
  assert.match(await shell.text(),/Ask Knowledge Hub/);
  assert.equal((await h.ask('What does a governance reviewer do?')).status,401);
  await h.login();
  const reply=await h.ask('What does a governance reviewer do?');
  const answer=await reply.json();
  assert.equal(answer.status,'answer');
  assert.equal(answer.partial,true);
  assert.match(answer.claims[0].text,/documents the decision/);
  assert.match(answer.citations[0].label,/^Hub source [a-f0-9]{12}$/);
  assert.doesNotMatch(JSON.stringify(answer),/private:|sourceChecks|excerptUse|access-review.html|PERSONALFIXTUREMARKER/);
  assert.match(reply.headers.get('Cache-Control'),/no-store/);
  for(const path of ['/api/documents','/api/master-table','/api/view?access=private&pathname=02-frameworks%2Faccess-review.html'])
    assert.equal((await h.call(path)).status,401);
  const report=await h.ask('What does a governance reviewer do?','word');
  assert.equal(report.status,200);
  assert.match(report.headers.get('Content-Disposition'),/^attachment;/);
  assert.equal(await referencePages(new Uint8Array(await report.arrayBuffer())),1);
  h.unpublish();
  assert.equal((await (await h.ask('What does a governance reviewer do?')).json()).status,'unknown');
});

test('HTTP journey distinguishes Golden Standard abstention, policy refusals and provider failure',async t=>{
  const h=await harness(t,{fault:true});
  await h.login();
  const selected=await (await h.ask('What does a governance reviewer do?')).json();
  assert.equal(selected.status,'answer');
  assert.deepEqual(h.calls,[[PRIMARY,'chat_answer'],[FALLBACK,'chat_answer'],[FALLBACK,'chat_verification']]);
  const calls=h.calls.length;
  const unknown=await (await h.ask('Which pizza restaurants in central Helsinki are open right now?')).json();
  assert.equal(unknown.answer,'Unknown from available evidence.');
  assert.equal((await h.ask('Which governance rule applies to Jane Placeholder?')).status,422);
  assert.equal((await h.ask('What did the governance synthetic blocked request say?')).status,422);
  assert.equal(h.calls.length,calls);
  assert.equal((await h.call('/api/chat?action=logout',{})).status,200);
  assert.equal((await h.ask('What does a governance reviewer do?')).status,401);
});

test('HTTP journey fails closed when the fallback cannot receive Private evidence',async t=>{
  const h=await harness(t,{fault:true,allowFallback:false});
  await h.login();
  const response=await h.ask('What does a governance reviewer do?');
  assert.equal(response.status,503);
  assert.deepEqual(h.calls,[[PRIMARY,'chat_answer']]);
});
