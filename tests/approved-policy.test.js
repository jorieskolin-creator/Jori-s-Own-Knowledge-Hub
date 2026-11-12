'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {ReadableStream}=require('node:stream/web');
const {approvedIndex,isApproved,approvedDocs,authorizedCatalog,requireApprovedSource}=require('../api/_approved_sources');
const {entryFromDoc,approveTable,stageTable,normalizeEdit}=require('../api/_master_table');
const {createService,metadata}=require('../api/_governed_unified');
const {discover}=require('../api/_master_discovery');
const names=['Approved','Draft','Obsolete','Unindexed'];
function source(name,scope='private'){
 const pathname='02-frameworks/'+name+'.html';
 return {id:scope+':'+pathname,access:scope,pathname,title:name,
  updated:'2026-11-12T10:00:00Z',size:128,mime_type:'text/html'};
}
function approved(name,scope='private'){
 return {...entryFromDoc(source(name,scope)),review_status:'Approved'};
}
function data(){
 const records=[approved('Approved'),{...approved('Draft'),review_status:'Draft'},
  {...approved('Obsolete'),review_status:'Obsolete'}];
 return approveTable({schema_version:1,records},'2026-11-12T10:00:00Z');
}
test('Only exact Approved and version-matching sources pass published policy',()=>{
 const table=data(),index=approvedIndex(table),docs=names.map(n=>source(n));
 assert.deepEqual(approvedDocs(docs,index).map(d=>d.id),[source('Approved').id]);
 assert.equal(isApproved(source('Draft'),index),false);
 assert.equal(isApproved(source('Obsolete'),index),false);
 assert.equal(isApproved(source('Unindexed'),index),false);
 assert.equal(isApproved({...source('Approved'),updated:'2026-11-12T11:00:00Z'},index),false);
 assert.equal(isApproved({...source('Approved'),access:'public'},index),false);
});
test('Published status, not unapproved working status, is authoritative',()=>{
 const table=data();
 const changed=stageTable({...table,records:table.records.map(r=>
  r.id===source('Approved').id?{...r,review_status:'Obsolete'}:
  r.id===source('Draft').id?{...r,review_status:'Approved'}:r)});
 const index=approvedIndex(changed);
 assert.equal(isApproved(source('Approved'),index),true);
 assert.equal(isApproved(source('Draft'),index),false);
 const released=approvedIndex(approveTable(changed));
 assert.equal(isApproved(source('Approved'),released),false);
 assert.equal(isApproved(source('Draft'),released),true);
});
test('Missing/unpublished/malformed policy fails closed, preserving source files',async()=>{
 assert.deepEqual([...approvedIndex({schema_version:1,records:[],published_records:[],
   publication:{status:'Draft',approved_at:null}}).keys()],[]);
 await assert.rejects(()=>authorizedCatalog([source('Approved')],async()=>null),/unavailable/);
 await assert.rejects(()=>authorizedCatalog([source('Approved')],async()=>{throw Error('Store failure')}),
  /Store failure/);
 await assert.rejects(()=>requireApprovedSource(source('Obsolete'),async()=>({table:data()})),/not Approved/);
 assert.equal(data().records.length,3);
});
test('Stale, missing, or changed Approved entries never become eligible',()=>{
 const table=data();
 for(const mutation of [
  {source_changed:true},{source_available:false},{source_signature:'a'.repeat(64)}
 ]){
  const next={...table,published_records:table.published_records.map(r=>
   r.id===source('Approved').id?{...r,...mutation}:r)};
  assert.equal(isApproved(source('Approved'),approvedIndex(next)),false);
 }
});
test('Approved-only discovery never returns Draft/Obsolete or unindexed filename hits',async()=>{
 const records=data().published_records;
 const docs=names.map(n=>source(n));
 const r=await discover('Approved','private',docs,30,records);
 assert.deepEqual(r.candidates.map(d=>d.id),[source('Approved').id]);
 const draft=await discover('Draft','private',docs,30,records);
 const obsolete=await discover('Obsolete','private',docs,30,records);
 const unknown=await discover('Unindexed','private',docs,30,records);
 for(const result of [draft,obsolete,unknown]){
  assert.equal(result.candidates_found,0);
  assert.equal(result.discovery_complete,false);
 }
});
test('Unified MCP rejects exact Draft/Obsolete IDs before any document bytes are read',async()=>{
 let opened=0;
 const pathname=name=>'02-frameworks/'+name+'.html';
 const baseline=data();
 const service=createService({
  list:async()=>({blobs:names.slice(0,3).map(name=>({pathname:pathname(name),
   uploadedAt:'2026-11-12T10:00:00Z',size:128})),hasMore:false}),
  get:async()=>{opened++;throw Error('No test source access required');},
  readMaster:async()=>({table:baseline})
 });
 const cat=await service.catalog();
 assert.equal(cat.length,1); // Only Private Approved has a matching published source ID.
 assert.ok(cat.every(x=>x.access==='private'||x.access==='public'));
 // Only Private Approved is eligible: test store enumerations are both populated.
 assert.deepEqual(cat.map(x=>x.id),[source('Approved').id]);
 for(const id of [source('Draft').id,source('Obsolete').id]){
  await assert.rejects(()=>service.retrieve({query:'approved',ids:[id]}),/outside current authorized catalog/);
  await assert.rejects(()=>service.verify({query:'approved',ids:[id]}),/outside current authorized catalog/);
  await assert.rejects(()=>service.execute('get_document_metadata',{id}),/outside current authorized catalog/);
 }
 assert.equal(opened,0);
});
test('Scoped MCP servers gate all standard operations before source reading',async()=>{
 const NodeModule=require('node:module');
 const actualRequire=NodeModule.createRequire(require('node:path').join(__dirname,'../api/mcp.js'));
 for(const scope of ['public','private']){
  const pathname='02-frameworks/Approved.html';
  const draftPath='02-frameworks/Draft.html';
  const blobs=[pathname,draftPath].map(p=>({pathname:p,uploadedAt:'2026-11-12T10:00:00Z',size:128,
   url:'https://example.invalid/'+encodeURIComponent(p)}));
  const records=blobs.map(b=>{
   const d={id:scope+':'+b.pathname,access:scope,pathname:b.pathname,
    updated:b.uploadedAt,size:b.size,title:b.pathname.split('/').at(-1),
    mime_type:'text/html'};
   return {...entryFromDoc(d),review_status:b.pathname===pathname?'Approved':'Draft'};
  });
  const table=approveTable({schema_version:1,records});
  const policy={
   authorizedCatalog:docs=>Promise.resolve(approvedDocs(docs,approvedIndex(table))),
   requireApprovedSource:doc=>isApproved(doc,approvedIndex(table))?Promise.resolve(doc):
    Promise.reject(Error('Not Approved'))
  };
  let reads=0;
  const script=fs.readFileSync(require('node:path').join(__dirname,'../api/'+
   (scope==='private'?'mcp-private.js':'mcp.js')),'utf8');
  const module={exports:{}};
  new Function('require','module','exports',script)(name=>{
   if(name==='@vercel/blob')return {
    list:async()=>({blobs,hasMore:false}),
    get:async()=>{reads++;const b=Buffer.from('<p>Approved evidence for testing</p>');
     return {size:b.length,stream:new ReadableStream({start(c){c.enqueue(b);c.close()}})};}
   };
   if(name==='./_approved_sources')return policy;
   if(name==='./_oauth')return {authorized:()=>true,RESOURCE:'private',
    GOVERNED_RESOURCE:'governed',BASE:'https://hub.test'};
   if(name==='./_master_discovery')return {discover:(query,scope,docs,limit)=>
    discover(query,scope,docs,limit,table.published_records)};
   return actualRequire(name);
  },module,module.exports);
  async function rpc(name,args={}){
   const res={statusCode:200,text:'',setHeader(){return this},end(t=''){this.text=String(t);return this}};
   await module.exports({method:'POST',headers:{},body:{jsonrpc:'2.0',id:1,
    method:'tools/call',params:{name,arguments:args}}},res);
   return JSON.parse(res.text).result;
  }
  const draftId=scope+':'+draftPath;
  const allowedId=scope+':'+pathname;
  const catalog=await rpc('list_documents');
  assert.deepEqual(catalog.structuredContent.documents.map(d=>d.id),[allowedId]);
  for(const name of ['get_document','get_document_structure','get_document_metadata']){
   const r=await rpc(name,{id:draftId});
   assert.equal(r.isError,true,scope+' '+name);
  }
  for(const name of ['retrieve_evidence','search_content','verify_coverage']){
   const r=await rpc(name,{query:'approved',ids:[draftId]});
   assert.equal(r.isError,true,scope+' '+name);
  }
  const discovery=await rpc('discover_sources',{query:'draft'});
  assert.equal(discovery.structuredContent.candidates_found,0);
  assert.equal(reads,0);
  const r=await rpc('retrieve_evidence',{query:'approved',ids:[allowedId]});
  assert.equal(r.isError,false);
  assert.ok(reads>0);
 }
});
