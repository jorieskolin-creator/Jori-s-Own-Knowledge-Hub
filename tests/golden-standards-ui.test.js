'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {BlobNotFoundError,BlobPreconditionFailedError}=require('@vercel/blob');
const master=require('../api/_master_table');
const {SourceAccessError}=require('../api/_request_errors');
const {FIXTURE_PATH,publishedSnapshot,runChecks,compareResults}=require('../api/_golden_standard_checks');

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
 let allowFixture=false,restaurantPassages=4;
 const service={catalog:async()=>[],execute:async(operation,args)=>{
  attempts.push(operation);
  if(operation==='retrieve_evidence'){
   assert.deepEqual(args.ids,[fixture]);
   if(allowFixture)return {delivery_status:'RELEASED',evidence:{passages:[{id:fixture}]}};
   throw new SourceAccessError('Source unavailable');
  }
  const discovery={candidates:[],candidates_found:0,candidates_returned:0,candidates_truncated:false};
  if(operation==='retrieve_topic_evidence'){
   if(args.query.includes('Helsinki'))return {discovery:{...discovery,candidates_found:1,candidates_returned:1},
    delivery_status:'RELEASED',evidence:{passages:Array.from({length:restaurantPassages},()=>({passage:'unrelated text'}))}};
   return {discovery,delivery_status:'NO_SOURCE_CANDIDATES',evidence:null};
  }
  return discovery;
 }};
 const cases=await runChecks({service,fixturePresent:true});
 assert.deepEqual(cases.map(row=>row.id),Array.from({length:10},(_,i)=>'GS-003-'+String(i+1).padStart(2,'0')));
 assert.equal(cases[0].status,'Review');
 assert.equal(cases[0].expected_status,'Review');
 assert.equal(cases[0].passages_returned,4);
 assert.equal(cases[0].reference_passages,0);
 assert.deepEqual(cases[0].differences,[]);
 assert.equal(compareResults([cases[0]]).severity,'ok');
 assert.equal(compareResults([cases[0]]).matched_cases,1);
 assert.equal(cases[9].status,'Pass');
 assert.equal(cases[9].fixture_denied,true);
 assert.equal(cases[9].failures.length,0);
 assert.ok(attempts.includes('retrieve_evidence'));
 assert.doesNotMatch(JSON.stringify(cases),/unrelated text|golden-standard\//);
 restaurantPassages=5;
 const changed=(await runChecks({service,fixturePresent:true}))[0];
 assert.equal(compareResults([changed]).severity,'warning');
 assert.deepEqual(changed.differences.map(({check,expected,actual})=>({check,expected,actual})),
  [{check:'Evidence passages returned',expected:4,actual:5}]);
 restaurantPassages=0;
 const improved=(await runChecks({service,fixturePresent:true}))[0];
 assert.equal(improved.status,'Pass');
 assert.equal(compareResults([improved]).difference_cases,1);
 assert.equal((await runChecks({service,fixturePresent:false}))[9].status,'Review');
 allowFixture=true;
 const exposed=(await runChecks({service,fixturePresent:true}))[9];
 assert.equal(compareResults([exposed]).severity,'severe');
 assert.equal(exposed.fixture_denied,false);
});

test('versioned comparisons count cases and escalate critical failures',()=>{
 const difference={case_id:'GS-003-01',title:'Out of scope',check:'Evidence passages returned',expected:0,actual:4};
 const compare=(differences,snapshotChanged=false,exceptions=[])=>compareResults([{differences}],snapshotChanged,exceptions);
 assert.equal(compare([]).severity,'ok');
 assert.equal(compare([],true).severity,'warning');
 assert.equal(compare([difference]).severity,'warning');
 const accepted=compare([difference],false,[difference]);
 assert.equal(accepted.severity,'ok');
 assert.equal(accepted.accepted_cases,1);
 assert.equal(accepted.differences[0].accepted,true);
 assert.equal(compare([{...difference,actual:5}],false,[difference]).severity,'warning');
 assert.equal(compare([difference,{...difference,check:'Tool-call failures'}]).difference_cases,1);
 const differences=Array.from({length:4},(_,i)=>({...difference,case_id:'GS-003-0'+(i+1)}));
 assert.equal(compare(differences.slice(0,3)).severity,'warning');
 assert.equal(compare(differences).severity,'severe');
 assert.equal(compare([{...difference,critical:true}],false,[difference]).severity,'severe');
});

test('report storage uses the metadata ETag, retries conflicts and retains the previous release',async()=>{
 let stored=null,writes=0,runs=0,deployment='release-a',conflictOnWrite=false,conflicts=0;
 const table=master.approveTable({records:[]},'2026-11-13T10:00:00Z');
 const cases=Array.from({length:10},(_,i)=>({id:'GS-003-'+i,status:'Pass',differences:[]}));
 const deps={
  '@vercel/blob':{
   BlobNotFoundError,BlobPreconditionFailedError,
   head:async path=>{
    if(path===FIXTURE_PATH)return {};
    if(!stored)throw new BlobNotFoundError();
    return {etag:'etag'+writes};
   },
   get:async(path,options)=>{
    assert.equal(options.useCache,false);
    return stored?{stream:new Response(JSON.stringify(stored)).body,blob:{etag:''}}:null;
   },
   put:async(path,body,options)=>{
    assert.equal(path,'_knowledge-system/golden-standard-reports-v1.json');
    assert.equal(options.access,'private');
    assert.equal(options.allowOverwrite,!!stored);
    assert.equal(options.ifMatch,stored?'etag'+writes:undefined);
    if(conflictOnWrite){
     conflictOnWrite=false;
     conflicts++;
     throw new BlobPreconditionFailedError();
    }
    stored=JSON.parse(body);
    writes++;
   }
  },
  './_auth':{valid:req=>req.admin,send:(res,code,payload)=>Object.assign(res,{code,payload})},
  './_master_table':{STORE_ID:()=> 'test-store',readMaster:async()=>({table})},
  './_governed_unified':{createService:()=>({catalog:async()=>[]})},
  './_golden_standard_checks':{FIXTURE_PATH,publishedSnapshot,compareResults,deploymentInfo:()=>({id:deployment,commit:deployment}),
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
 const first=(await call('POST')).payload;
 assert.equal(first.saved,true);
 assert.equal(first.report.comparison.severity,'ok');
 assert.equal((await call('GET')).payload.latest.deployment.id,'release-a');
 await new Promise(resolve=>setTimeout(resolve,5));
 conflictOnWrite=true;
 const second=(await call('POST')).payload;
 assert.equal(second.saved,true);
 assert.notEqual(second.report.completed_at,first.report.completed_at);
 assert.equal((await call('GET')).payload.latest.completed_at,second.report.completed_at);
 assert.equal((await call('GET')).payload.previous_release,null);
 deployment='release-b';
 await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal((await call('POST')).payload.saved,true);
 const status=(await call('GET')).payload;
 assert.equal(status.latest.deployment.id,'release-b');
 assert.equal(status.previous_release.deployment.id,'release-a');
 assert.equal(status.previous_release.completed_at,second.report.completed_at);
 assert.equal(runs,3);
 assert.equal(writes,3);
 assert.equal(conflicts,1);
});
