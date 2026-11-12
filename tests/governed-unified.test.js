'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ReadableStream}=require('node:stream/web');
const {createHash}=require('node:crypto');
process.env.SESSION_SECRET='test-unified-governed-evidence-'.repeat(3);
const OAuth=require('../api/_oauth');
const handler=require('../api/mcp-governed-unified');
const legacy=require('../api/mcp-private');
const oauthApi=require('../api/oauth');
const {sign:sessionSign}=require('../api/_auth');
const oldGoverned=require('../api/mcp-governed-private');
const {createService,metadata}=require('../api/_governed_unified');
const {sourceSignature,entryFromDoc}=require('../api/_master_table');
const publicStore=process.env.PUBLIC_BLOB_STORE_ID||process.env.BLOB_STORE_ID||'store_6mg9Vu2ypJJMAwV3';
const privateStore=process.env.PRIVATE_BLOB_STORE_ID||'store_YAAwH6FewcrImhA1';
const path='02-frameworks/governance.html';
const publicId='public:'+path,privateId='private:'+path;
const sources={
 public:'<h1>Governance</h1><p>Public governance guidelines require accountable platform ownership.</p>',
 private:'<h1>Governance</h1><p>Private governance exceptions require a signed decision record.</p>'
};
function fixture(scope){
 const bytes=Buffer.from(sources[scope],'utf8');
 return {size:bytes.length,stream:new ReadableStream({start(c){c.enqueue(bytes);c.close();}})};
}
const blob=scope=>({pathname:path,size:Buffer.byteLength(sources[scope]),uploadedAt:'2026-11-12T09:00:00Z',
 url:'https://raw-public.example.invalid/should-not-leak'});
function harness(config={}){
 return createService({
  list:async({storeId})=>{
   if(config.failPrivate&&storeId===privateStore)throw Error('Private store unavailable');
   return {blobs:[blob(storeId===publicStore?'public':'private')],hasMore:false};
  },
  get:async(p,{access,storeId})=>{
   assert.equal(p,path);
   assert.equal(storeId,access==='public'?publicStore:privateStore);
   return fixture(access);
  },
  readMaster:async()=>{
    const baseline=['public','private'].map(scope=>{
     const d=metadata(blob(scope),scope);
     return {...entryFromDoc(d),review_status:'Approved'};
    });
    const records=config.records||baseline;
    return {table:{schema_version:1,records,published_records:records,
     publication:{status:'Approved',approved_at:'2026-11-12T10:00:00Z'}}};
   }
 });
}
function response(){
 return {statusCode:200,headers:{},text:'',
  setHeader(k,v){this.headers[k.toLowerCase()]=v;return this;},
  end(value=''){this.text=String(value);return this;}};
}
async function rpc(fn,method,params,headers={}){
 const res=response();await fn({method:'POST',headers,body:{jsonrpc:'2.0',id:42,method,...(params?{params}:{})}},res);
 return {body:JSON.parse(res.text),headers:res.headers,status:res.statusCode};
}
function bearer(aud){
 const token=OAuth.sign({kind:'access',scope:OAuth.SCOPE,iss:OAuth.BASE,aud,exp:Date.now()+120000});
 return {authorization:'Bearer '+token};
}
test('Unified inventory lists both stores, preserving access and unique source identity',async()=>{
 const h=harness();
 const results=await h.execute('list_documents');
 assert.equal(results.total,2);
 assert.equal(results.public_count,1);
 assert.equal(results.private_count,1);
 assert.deepEqual(new Set(results.documents.map(d=>d.id)),new Set([publicId,privateId]));
 assert.ok(results.documents.every(d=>!d.source_url&&!d.url));
 const metadata=await h.execute('get_document_metadata',{id:privateId});
 assert.equal(metadata.access,'private');
 assert.equal(metadata.id,privateId);
});
test('Explicit mixed-scope evidence is packaged together and passes integrity checks',async()=>{
 const result=await harness().retrieve({query:'governance',ids:[publicId,privateId],mode:'comparative'});
 assert.equal(result.governed_mode,'EVIDENCE_ONLY');
 assert.ok(['RELEASED','RELEASED_WITH_WARNINGS'].includes(result.delivery_status));
 const pack=result.evidence;
 assert.equal(pack.schema_version,1);
 assert.equal(pack.inspected_source_count,2);
 assert.deepEqual(new Set(pack.source_coverage.map(s=>s.access)),new Set(['public','private']));
 assert.deepEqual(new Set(pack.passages.map(p=>p.id)),new Set([publicId,privateId]));
 for(const p of pack.passages){
  const source=pack.source_coverage.find(s=>s.id===p.id);
  assert.equal(p.source_sha256,source.original_file_sha256);
  assert.equal(source.original_file_sha256,createHash('sha256').update(sources[p.access]).digest('hex'));
  assert.match(p.passage_sha256,/^[a-f0-9]{64}$/);
 }
 assert.equal(result.retrieval_quality.status,'PASS');
});
test('Automatic discovery uses Approved Public and Private metadata and acquires mixed evidence',async()=>{
 const h=harness();
 const found=await h.execute('discover_sources',{query:'governance',limit:10});
 assert.equal(found.scope,'public+private');
 assert.equal(found.public_candidates,1);
 assert.equal(found.private_candidates,1);
 assert.equal(found.unindexed_count,0);
 assert.deepEqual(new Set(found.candidates.map(c=>c.id)),new Set([publicId,privateId]));
 const result=await h.topic({query:'governance',mode:'comparative'});
 assert.equal(result.selected_ids.length,2);
 assert.deepEqual(new Set(result.evidence.passages.map(p=>p.access)),new Set(['public','private']));
 assert.equal(result.verified_absence,false);
});
test('Unified coverage returns only diagnostics, never source passage text',async()=>{
 const r=await harness().verify({query:'governance',ids:[publicId,privateId]});
 assert.equal(r.inspected_source_count,2);
 assert.equal(r.retrieval_quality.status,'PASS');
 assert.equal(r.passages,undefined);
 assert.equal(r.evidence,undefined);
 assert.equal(JSON.stringify(r).includes('signed decision record'),false);
});
test('Missing matches do not become evidence of absence',async()=>{
 const r=await harness().retrieve({query:'plutonium resonance xylophone',ids:[publicId,privateId]});
 assert.equal(r.delivery_status,'NO_SUPPORTING_EVIDENCE');
 assert.equal(r.evidence,null);
 assert.equal(r.retrieval_quality.verified_absence,false);
});
test('Missing one inventory fails the entire unified operation, not a silent Public-only fallback',async()=>{
 const h=harness({failPrivate:true});
 await assert.rejects(()=>h.execute('list_documents'),/Private store unavailable/);
 await assert.rejects(()=>h.retrieve({query:'governance',ids:[publicId]}),/Private store unavailable/);
 await assert.rejects(()=>h.topic({query:'governance'}),/Private store unavailable/);
});
test('Invalid IDs and arbitrary paths are rejected before any source is retrieved',async()=>{
 const h=harness();
 for(const id of ['private:02-frameworks/unknown.html','public:secret/password.html',
  'private:02-frameworks/../governance.html','private:02-frameworks/.secrets.html']){
  await assert.rejects(()=>h.retrieve({query:'governance',ids:[id]}));
 }
});
test('Unified tool list exposes exactly seven governed operations, no raw reading',async()=>{
 const resp=await rpc(handler,'tools/list');
 assert.equal(resp.status,200);
 const names=resp.body.result.tools.map(x=>x.name);
 assert.equal(names.length,7);
 assert.ok(!names.includes('get_document'));
 assert.ok(!names.includes('search_content'));
 assert.ok(!names.includes('get_document_structure'));
 assert.ok(resp.body.result.tools.every(t=>t.securitySchemes?.[0]?.type==='oauth2'));
});
test('Unified requests require an exact audience and reject direct-reading tool calls',async()=>{
 const login=bearer(OAuth.UNIFIED_RESOURCE);
 const noToken=await rpc(handler,'tools/call',{name:'get_document',arguments:{id:privateId}});
 assert.equal(noToken.body.result.isError,true);
 assert.match(noToken.body.result.content[0].text,/Authorization required/);
 assert.match(JSON.stringify(noToken.body.result._meta),/mcp-governed-unified/);
 for(const aud of [OAuth.RESOURCE,OAuth.GOVERNED_RESOURCE,OAuth.BASE]){
  const denied=await rpc(handler,'tools/call',{name:'get_document',arguments:{id:privateId}},bearer(aud));
  assert.match(denied.body.result.content[0].text,/Authorization required/);
 }
 for(const name of ['get_document','get_document_structure','search_content']){
  const blocked=await rpc(handler,'tools/call',{name,arguments:{id:privateId}},login);
  assert.equal(blocked.body.result.isError,true);
  assert.match(blocked.body.result.content[0].text,/not available/);
 }
 const legacyDenied=await rpc(legacy,'tools/call',{name:'get_document',arguments:{id:privateId}},login);
 assert.match(legacyDenied.body.result.content[0].text,/Authorization required/);
 const otherDenied=await rpc(oldGoverned,'tools/call',{name:'get_document',arguments:{id:privateId}},login);
 assert.match(otherDenied.body.result.content[0].text,/Authorization required/);
});
test('Unified OAuth metadata advertises one exact protected resource',()=>{
 assert.equal(OAuth.resourceMetadata(OAuth.UNIFIED_RESOURCE).resource,OAuth.UNIFIED_RESOURCE);
 assert.ok(OAuth.authorized({headers:bearer(OAuth.UNIFIED_RESOURCE)},OAuth.UNIFIED_RESOURCE));
 assert.equal(OAuth.authorized({headers:bearer(OAuth.UNIFIED_RESOURCE)},OAuth.RESOURCE),null);
 assert.equal(OAuth.authorized({headers:bearer(OAuth.UNIFIED_RESOURCE)},OAuth.GOVERNED_RESOURCE),null);
});

test('Unified OAuth protected-resource route and consent explicitly name both source scopes',async()=>{
 const metaRes=response();
 await oauthApi({method:'GET',query:{route:'resource-unified'},headers:{}},metaRes);
 assert.equal(metaRes.statusCode,200);
 assert.equal(JSON.parse(metaRes.text).resource,OAuth.UNIFIED_RESOURCE);
 const redirect='https://chatgpt.com/connector/oauth/unified-test';
 const client_id='khc.'+OAuth.sign({kind:'client',redirect_uris:[redirect],exp:Date.now()+60000});
 const cookie='__Host-kh_admin='+sessionSign('admin',1);
 const consent=response();
 await oauthApi({method:'GET',query:{route:'authorize',client_id,redirect_uri:redirect,
  response_type:'code',code_challenge_method:'S256',code_challenge:'a'.repeat(43),
  state:'valid_state_unified_123',scope:OAuth.SCOPE,resource:OAuth.UNIFIED_RESOURCE},
  headers:{cookie}},consent);
 assert.equal(consent.statusCode,200);
 assert.match(consent.text,/both Public and Private/);
 assert.match(consent.text,/evidence-package-only/);
 const signed=consent.text.match(/name="request" value="([^"]+)"/)?.[1];
 assert.equal(OAuth.verify(signed,'authorization').resource,OAuth.UNIFIED_RESOURCE);
});

test('Master Table discovery hints cannot become answer evidence without matching source passages',async()=>{
 const records=['public','private'].map(scope=>{
  const base=metadata(blob(scope),scope);
  return {...base,source_signature:sourceSignature(base),source_available:true,source_changed:false,
   review_status:'Approved',summary:'Quantum topology control is documented here',key_terms:['quantum topology'],
   themes:['quantum anomaly'],review_notes:'Unverified wording is not source evidence'};
 });
 const h=harness({records});
 const search=await h.execute('discover_sources',{query:'quantum topology'});
 assert.equal(search.candidates_found,2);
 assert.ok(search.candidates.every(c=>!('review_notes' in c)));
 const r=await h.topic({query:'quantum topology'});
 assert.equal(r.delivery_status,'NO_SUPPORTING_EVIDENCE');
 assert.equal(r.evidence,null);
 assert.equal(r.retrieval_quality.verified_absence,false);
});
