'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {createRequire}=require('node:module');
const {Writable}=require('node:stream');
const {finished}=require('node:stream/promises');
const {sign}=require('../api/_auth');
const master=require('../api/_master_table');
const verification=require('../api/_guest_verification');
const {FIXTURE_PATH}=require('../api/_golden_standard_checks');

process.env.SESSION_SECRET='test-secret-for-library-guest-sessions-0123';
process.env.ADMIN_PASSWORD='test-admin-password';
process.env.GUEST_PASSWORD='test-guest-password';

function endpoint(file,stubs){
 const path=require.resolve('../api/'+file);
 const resolve=createRequire(path),module={exports:{}};
 new Function('require','module',readFileSync(path,'utf8'))(
  name=>Object.hasOwn(stubs,name)?stubs[name]:resolve(name),module);
 return module.exports;
}
function cookie(role){
 return '__Host-kh_'+role+'='+sign(role,1);
}
async function request(handler,{role,cookies,method='GET',query={},body,origin='https://hub.example'}={}){
 const output=[],headers={};
 const res=new Writable({write(chunk,encoding,done){output.push(chunk);done()}});
 res.status=code=>{res.statusCode=code;return res};
 res.setHeader=(key,value)=>{headers[key.toLowerCase()]=value;return res};
 res.json=value=>{res.payload=value;res.end();return res};
 const req={method,query,body,headers:{host:'hub.example',origin,cookie:cookies??(role?cookie(role):'')}};
 await handler(req,res);
 await finished(res);
 return {status:res.statusCode,payload:res.payload,headers,body:Buffer.concat(output).toString()};
}

test('Guest sign-in uses the configured password, switches the browser role and clears both library cookies on logout',async()=>{
 const login=require('../api/guest-login');
 const session=require('../api/session');
 const logout=require('../api/logout');
 const attempt=(password,origin)=>request(login,{method:'POST',body:{password},origin,role:'admin'});
 assert.equal((await attempt(process.env.ADMIN_PASSWORD)).status,401);
 assert.equal((await attempt(process.env.GUEST_PASSWORD,'https://elsewhere.example')).status,403);
 const signedIn=await attempt(process.env.GUEST_PASSWORD);
 assert.equal(signedIn.status,200);
 assert.deepEqual(signedIn.payload,{authenticated:true,role:'guest'});
 const [guest,clearAdmin]=signedIn.headers['set-cookie'];
 assert.match(clearAdmin,/^__Host-kh_admin=;.*Max-Age=0$/);
 assert.match(guest,/HttpOnly; Secure; SameSite=Lax; Max-Age=7200/);
 const cookies=guest.split(';')[0];
 assert.deepEqual((await request(session,{cookies})).payload,{authenticated:true,role:'guest'});
 assert.deepEqual((await request(session,{role:'admin'})).payload,{authenticated:true,role:'admin'});
 assert.deepEqual((await request(session)).payload,{authenticated:false,role:null});
 try{
  process.env.GUEST_PASSWORD='test-rotated-guest-password';
  assert.equal((await request(session,{cookies})).payload.authenticated,false);
 }finally{process.env.GUEST_PASSWORD='test-guest-password'}
 const signedOut=await request(logout,{method:'POST',cookies});
 assert.equal(signedOut.headers['set-cookie'].length,2);
 assert.ok(signedOut.headers['set-cookie'].every(value=>value.endsWith('Max-Age=0')));
});

test('Guest receives locked cards without Private paths and cannot open Private or Personal from either viewer',async()=>{
 const publicPath='02-frameworks/public.html';
 const privatePath='01-solutions/finops-engine/locked.pdf';
 const personalPath='06-personal/private-marker.html';
 const publicStore=process.env.PUBLIC_BLOB_STORE_ID||process.env.BLOB_STORE_ID||'store_6mg9Vu2ypJJMAwV3';
 const listed=endpoint('documents',{'@vercel/blob':{list:async({storeId})=>({
  blobs:(storeId===publicStore?[publicPath,personalPath]:[privatePath,personalPath]).map(pathname=>({
   pathname,size:123,uploadedAt:'2026-11-01',url:'https://storage.example/'+pathname
  }))
 })}});
 assert.equal((await request(listed)).status,401);
 const guest=(await request(listed,{role:'guest'})).payload;
 assert.equal(guest.role,'guest');
 assert.equal(guest.counts.public,1);
 assert.equal(guest.counts.private,1);
 assert.ok(guest.documents.some(row=>row.pathname===publicPath));
 const locked=guest.documents.find(row=>row.access==='private');
 assert.equal(locked.title,'locked');
 assert.equal(locked.solution_folder,'finops-engine');
 for(const field of ['id','pathname','url','size'])assert.equal(field in locked,false);
 assert.doesNotMatch(JSON.stringify(guest),/private-marker|06-personal|storage.example/);
 const admin=(await request(listed,{role:'admin'})).payload;
 assert.equal(admin.counts.private,2);
 assert.ok(admin.documents.some(row=>row.access==='private'&&row.pathname===personalPath));
 const opens=[];
 const storage={get:async(pathname,{access})=>{
  opens.push([pathname,access]);
  return {statusCode:200,stream:new Blob(['fixture contents']).stream()};
 }};
 const view=endpoint('view',{'@vercel/blob':storage});
 const legacy=endpoint('private-document',{'@vercel/blob':storage});
 for(const method of ['GET','HEAD']){
  assert.equal((await request(view,{role:'guest',method,query:{access:'private',pathname:privatePath}})).status,403);
  for(const access of ['public','private']){
   assert.equal((await request(view,{role:'guest',method,query:{access,pathname:personalPath}})).status,404);
  }
 }
 assert.equal((await request(legacy,{role:'guest',query:{pathname:personalPath}})).status,403);
 assert.equal(opens.length,0);
 assert.equal((await request(view,{role:'guest',query:{access:'public',pathname:publicPath}})).body,'fixture contents');
 assert.equal((await request(view,{role:'admin',query:{access:'private',pathname:privatePath}})).body,'fixture contents');
 assert.match((await request(view,{role:'admin',query:{access:'public',pathname:personalPath}})).headers['cache-control'],/no-store/);
 assert.equal((await request(require('../api/initialize-folders'),{role:'guest',method:'POST'})).status,401);
});

test('Guest Master Table reads only the published Public metadata and cannot run any mutations',async()=>{
 const doc=(pathname,access,title,review_status='Approved')=>({
  ...master.entryFromDoc({pathname,access,id:access+':'+pathname,title}),
  review_status,summary:'Published '+title,review_notes:'internal review marker',related_documents:['internal relation marker']
 });
 const publicDoc=doc('02-frameworks/public.html','public','Public reference');
 const published=master.approveTable({records:[
  publicDoc,doc('02-frameworks/private.html','private','Private marker'),
  doc('06-personal/public.html','public','Personal marker'),
  doc('02-frameworks/draft.html','public','Draft marker','Draft')
 ]},'2026-11-01');
 const table=master.stageTable(published);
 table.records[0].summary='Unpublished edit marker';
 let reads=0;
 const handler=endpoint('master-table',{'./_master_table':{...master,readMaster:async({fresh})=>{
  assert.equal(fresh,true);
  reads++;
  return {table,etag:'admin-revision'};
 }}});
 for(const action of ['save','approve','delete','sync','import','enrich']){
  assert.equal((await request(handler,{role:'guest',method:'POST',body:{action}})).status,403);
 }
 assert.equal(reads,0);
 assert.equal((await request(handler)).status,401);
 const guest=await request(handler,{role:'guest'});
 assert.equal(guest.status,200);
 assert.equal(guest.payload.read_only,true);
 assert.equal(guest.payload.count,1);
 assert.equal(guest.payload.records[0].summary,publicDoc.summary);
 assert.doesNotMatch(JSON.stringify(guest.payload),/marker|etag|admin-revision/);
});

test('Guest can run the fixed verification and read safe results while concurrent Guest runs are blocked',async()=>{
 const {BlobNotFoundError}=require('@vercel/blob');
 const table=master.approveTable({records:[]},'2026-11-01');
 let report,runs=0,continueChecks,started;
 const resumed=new Promise(resolve=>{continueChecks=resolve});
 const entered=new Promise(resolve=>{started=resolve});
 const data={};
 const runtime={transact:async action=>action(data,Date.now())?.value};
 const golden=require('../api/_golden_standard_checks');
 const handler=endpoint('golden-standards',{
  '@vercel/blob':{
   BlobNotFoundError,
   head:async path=>{if(path===FIXTURE_PATH)return {};throw new BlobNotFoundError()},
   get:async()=>report?{stream:new Blob([JSON.stringify(report)]).stream()}:null,
   put:async(_path,value)=>{report=JSON.parse(value)}
  },
  './_master_table':{STORE_ID:()=> 'test-store',readMaster:async()=>({table})},
  './_governed_unified':{createService:()=>({catalog:async()=>[]})},
  './_guest_verification':{...verification,reserveGuestRun:()=>verification.reserveGuestRun(runtime)},
  './_golden_standard_checks':{...golden,runChecks:async options=>{
   assert.deepEqual(options,{fixturePresent:true});
   runs++;
   started();
   await resumed;
   return [{
    id:'GS-003-01',title:'Private title marker',status:'Review',expected_status:'Review',passages_returned:4,
    failures:[],issues:['private issue marker'],source:'private:06-personal/private.html',
    differences:[{case_id:'GS-003-01',title:'private marker',check:'Evidence passages returned',expected:0,actual:4}]
   }];
  }}
 });
 assert.equal((await request(handler,{method:'POST'})).status,401);
 assert.equal((await request(handler,{role:'guest',method:'POST',origin:'https://elsewhere.example'})).status,403);
 const first=request(handler,{role:'guest',method:'POST',body:{query:'arbitrary query'}});
 await entered;
 const overlapping=await request(handler,{role:'guest',method:'POST'});
 assert.equal(overlapping.status,429);
 assert.ok(Number(overlapping.headers['retry-after'])>0);
 continueChecks();
 const result=await first;
 assert.equal(result.status,200);
 assert.equal(result.payload.saved,true);
 assert.equal(runs,1);
 assert.equal(data.verification,undefined);
 assert.equal(result.payload.report.cases[0].passages_returned,4);
 assert.equal(result.payload.report.comparison.differences[0].actual,4);
 assert.doesNotMatch(JSON.stringify(result.payload),/private|deployment|revision/);
 const displayed=await request(handler,{role:'guest'});
 assert.deepEqual(displayed.payload.latest,result.payload.report);
 assert.equal(displayed.payload.latest_current,true);
 assert.equal((await request(handler,{role:'admin'})).payload.latest.cases[0].title,'Private title marker');
});
