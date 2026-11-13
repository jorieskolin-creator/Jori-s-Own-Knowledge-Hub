'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const master=require('../api/_master_table');
const {SourceAccessError}=require('../api/_request_errors');
const {FIXTURE_PATH,publishedSnapshot,runChecks}=require('../api/_golden_standard_checks');

test('published snapshot identity ignores working Master Table edits',()=>{
 const published=master.approveTable({records:[master.entryFromDoc({id:'public:02-frameworks/example.html',access:'public',
  pathname:'02-frameworks/example.html',title:'Example'})]},'2026-11-13T10:00:00Z');
 const staged=master.stageTable(published);
 staged.records[0].title='Draft title';
 assert.deepEqual(publishedSnapshot(staged),publishedSnapshot(published));
 assert.notEqual(publishedSnapshot(master.approveTable(staged,'2026-11-13T11:00:00Z')).revision,
  publishedSnapshot(published).revision);
});

test('suite reports actual fixture denial and marks unrelated released evidence for review',async()=>{
 const fixture='private:'+FIXTURE_PATH;
 const attempts=[];
 const service={catalog:async()=>[],execute:async(operation,args)=>{
  attempts.push(operation);
  if(operation==='retrieve_evidence'){
   assert.deepEqual(args.ids,[fixture]);
   throw new SourceAccessError('Source unavailable');
  }
  const discovery={candidates:[],candidates_found:0,candidates_returned:0,candidates_truncated:false};
  if(operation==='retrieve_topic_evidence'){
   if(args.query.includes('Helsinki'))return {discovery:{...discovery,candidates_found:1,candidates_returned:1},
    delivery_status:'RELEASED',evidence:{passages:[{passage:'unrelated text'}]}};
   return {discovery,delivery_status:'NO_SOURCE_CANDIDATES',evidence:null};
  }
  return discovery;
 }};
 const cases=await runChecks({service,fixturePresent:true});
 assert.deepEqual(cases.map(row=>row.id),Array.from({length:10},(_,i)=>'GS-003-'+String(i+1).padStart(2,'0')));
 assert.equal(cases[0].status,'Review');
 assert.equal(cases[0].passages_returned,1);
 assert.equal(cases[0].reference_passages,0);
 assert.equal(cases[9].status,'Pass');
 assert.equal(cases[9].fixture_denied,true);
 assert.equal(cases[9].failures.length,0);
 assert.ok(attempts.includes('retrieve_evidence'));
 assert.doesNotMatch(JSON.stringify(cases),/unrelated text|golden-standard\//);
 assert.equal((await runChecks({service,fixturePresent:false}))[9].status,'Review');
});

test('administrator status is read-only and completed reports retain the previous release',async()=>{
 let stored=null,writes=0,runs=0,deployment='release-a';
 const table=master.approveTable({records:[]},'2026-11-13T10:00:00Z');
 const cases=Array.from({length:10},(_,i)=>({id:'GS-003-'+i,status:'Pass'}));
 const deps={
  '@vercel/blob':{
   head:async()=>({}),get:async()=>stored?{stream:new Response(JSON.stringify(stored)).body,blob:{etag:'etag'+writes}}:null,
   put:async(path,body,options)=>{
    assert.equal(path,'_knowledge-system/golden-standard-reports-v1.json');
    assert.equal(options.access,'private');
    assert.equal(options.ifMatch,stored?'etag'+writes:undefined);
    stored=JSON.parse(body);
    writes++;
   }
  },
  './_auth':{valid:req=>req.admin,send:(res,code,payload)=>Object.assign(res,{code,payload})},
  './_master_table':{STORE_ID:()=> 'test-store',readMaster:async()=>({table})},
  './_governed_unified':{createService:()=>({catalog:async()=>[]})},
  './_golden_standard_checks':{FIXTURE_PATH,publishedSnapshot,deploymentInfo:()=>({id:deployment,commit:deployment}),
   runChecks:async()=>{runs++;return cases;}}
 };
 const endpoint={exports:{}};
 new Function('require','module',fs.readFileSync(require.resolve('../api/golden-standards'),'utf8'))(
  name=>deps[name],endpoint);
 const call=async(method,admin=true,origin='https://hub.example')=>{
  const res={};
  await endpoint.exports({method,admin,headers:{host:'hub.example',origin}},res);
  return res;
 };
 assert.equal((await call('GET',false)).code,401);
 assert.equal((await call('POST',true,'https://other.example')).code,403);
 assert.equal((await call('GET')).payload.latest,null);
 assert.equal(runs,0);
 assert.equal(writes,0);
 assert.equal((await call('POST')).payload.saved,true);
 assert.equal((await call('GET')).payload.latest.deployment.id,'release-a');
 deployment='release-b';
 await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal((await call('POST')).payload.saved,true);
 const status=(await call('GET')).payload;
 assert.equal(status.latest.deployment.id,'release-b');
 assert.equal(status.previous_release.deployment.id,'release-a');
 assert.equal(runs,2);
 assert.equal(writes,2);
});
