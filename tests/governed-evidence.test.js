'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ReadableStream}=require('node:stream/web');
process.env.SESSION_SECRET='test-secret-governed-evidence-'.repeat(3);
const {sign,authorized,BASE,RESOURCE,GOVERNED_RESOURCE,SCOPE,resourceMetadata}=require('../api/_oauth');
const publicMcp=require('../api/mcp');
const publicGoverned=require('../api/mcp-governed');
const privateMcp=require('../api/mcp-private');
const privateGoverned=require('../api/mcp-governed-private');
const {assembleEvidence}=require('../api/_evidence_package');
const {releasePackage,releaseTopic,sanitizedDiscovery,catalogEntry}=require('../api/_governed_evidence');
function response(){
 return {statusCode:200,headers:{},text:'',
  setHeader(k,v){this.headers[k.toLowerCase()]=v;return this},
  end(s=''){this.text=String(s);return this}};
}
async function rpc(handler,method,params,headers={},overrides={}){
 const res=response();
 const body={jsonrpc:'2.0',id:5,method,...(params===undefined?{}:{params}),...overrides};
 await handler({method:'POST',headers,body},res);
 return JSON.parse(res.text);
}
function bearer(aud){
 return {authorization:'Bearer '+sign({kind:'access',scope:SCOPE,iss:BASE,aud,exp:Date.now()+600000})};
}
function blobFile(raw){
 const b=Buffer.from(raw);
 return {size:b.length,stream:new ReadableStream({start(c){c.enqueue(b);c.close()}})};
}
const id='private:02-frameworks/evidence-fixture.html';
const doc={id,title:'Synthetic Evidence',pathname:id.slice(8),access:'private',mime_type:'text/html'};
const sample='<h1>Evidence control</h1><p>Governed evidence requires stable source hashes and verified passage locators.</p>';
async function validPackage(){
 return assembleEvidence({query:'governed evidence',ids:[id]},[doc],()=>blobFile(sample));
}
test('Governed endpoints advertise only metadata/discovery and packaged evidence tools',async()=>{
 const allow=['list_documents','search_documents','get_document_metadata',
  'discover_sources','retrieve_evidence','retrieve_topic_evidence','verify_coverage'];
 for(const handler of [publicGoverned,privateGoverned]){
  const list=await rpc(handler,'tools/list');
  const names=list.result.tools.map(x=>x.name).sort();
  assert.deepEqual(names,allow.slice().sort());
  assert.ok(names.every(x=>!['get_document','search_content','get_document_structure'].includes(x)));
 }
 const oldPublic=await rpc(publicMcp,'tools/list');
 const oldPrivate=await rpc(privateMcp,'tools/list');
 for(const old of [oldPublic,oldPrivate]){
  assert.equal(old.result.tools.length,10);
  assert.ok(old.result.tools.some(x=>x.name==='get_document'));
  assert.ok(old.result.tools.some(x=>x.name==='search_content'));
 }
});
test('Public governed endpoint rejects direct reading, search and structure even when called by name',async()=>{
 for(const name of ['get_document','search_content','get_document_structure','any_other_tool']){
  const result=await rpc(publicGoverned,'tools/call',{name,arguments:{id:'public:02-frameworks/test.html'}});
  assert.equal(result.result.isError,true);
  assert.match(result.result.content[0].text,/not available in governed/);
 }
 const list=await rpc(publicGoverned,'tools/list',undefined,{}, {governedEvidenceOnly:false});
 assert.equal(list.result.tools.length,7);
});
test('Private governed endpoint requires its own audience, and tokens cannot unlock the legacy raw endpoint',async()=>{
 const governedHeader=bearer(GOVERNED_RESOURCE),legacyHeader=bearer(RESOURCE),baseHeader=bearer(BASE);
 const raw=await rpc(privateGoverned,'tools/call',{name:'get_document',arguments:{id}});
 assert.equal(raw.result.isError,true);
 assert.match(raw.result.content[0].text,/Authorization required/);
 assert.match(JSON.stringify(raw.result._meta),/mcp-governed-private/);
 for(const oldToken of [legacyHeader,baseHeader]){
  const denied=await rpc(privateGoverned,'tools/call',{name:'get_document',arguments:{id}},oldToken);
  assert.match(denied.result.content[0].text,/Authorization required/);
 }
 const noRaw=await rpc(privateGoverned,'tools/call',{name:'get_document',arguments:{id}},governedHeader);
 assert.equal(noRaw.result.isError,true);
 assert.match(noRaw.result.content[0].text,/not available in governed/);
 const noSearch=await rpc(privateGoverned,'tools/call',{name:'search_content',arguments:{query:'governed',ids:[id]}},governedHeader);
 assert.match(noSearch.result.content[0].text,/not available in governed/);
 const rawDenied=await rpc(privateMcp,'tools/call',{name:'get_document',arguments:{id}},governedHeader);
 assert.match(rawDenied.result.content[0].text,/Authorization required/);
});
test('OAuth resource discovery and verification preserve separate Private audiences',()=>{
 assert.equal(resourceMetadata(GOVERNED_RESOURCE).resource,GOVERNED_RESOURCE);
 assert.equal(resourceMetadata().resource,RESOURCE);
 assert.ok(authorized({headers:bearer(GOVERNED_RESOURCE)},GOVERNED_RESOURCE));
 assert.equal(authorized({headers:bearer(GOVERNED_RESOURCE)}),null);
 assert.equal(authorized({headers:bearer(RESOURCE)},GOVERNED_RESOURCE),null);
 assert.equal(authorized({headers:bearer(BASE)},GOVERNED_RESOURCE),null);
});
test('Valid governed Evidence Package includes only hash-verified passages and explicit limits',async()=>{
 const p=await validPackage();
 const governed=releasePackage(p);
 assert.equal(governed.governed_mode,'EVIDENCE_ONLY');
 assert.ok(['RELEASED','RELEASED_WITH_WARNINGS'].includes(governed.delivery_status));
 assert.equal(governed.evidence.schema_version,1);
 assert.equal(governed.evidence.passages.length,p.passages.length);
 assert.equal(governed.evidence.passages[0].passage_sha256,p.passages[0].passage_sha256);
 assert.equal(governed.evidence.retrieval_quality.verified_absence,false);
});
test('A blocked or forged package cannot emit even a valid-looking passage',async()=>{
 const p=await validPackage();
 p.passages[0].passage_sha256='f'.repeat(64);
 const r=releasePackage(p);
 assert.equal(r.delivery_status,'BLOCKED');
 assert.equal(r.evidence,null);
 assert.equal(r.retrieval_quality.status,'BLOCK');
 const p2=await validPackage();
 p2.schema_version=999;
 assert.equal(releasePackage(p2).evidence,null);
 const p3=await validPackage();
 p3.retrieval_quality.status='BLOCK'; // forged status must not bypass recalculated check
 assert.equal(releasePackage(p3).evidence,null);
});
test('A query without hits yields NO_SUPPORTING_EVIDENCE, never verified absence',async()=>{
 const pack=await assembleEvidence({query:'unrelated neutrino absorption',ids:[id]},[doc],()=>blobFile(sample));
 const r=releasePackage(pack);
 assert.equal(r.delivery_status,'NO_SUPPORTING_EVIDENCE');
 assert.equal(r.evidence,null);
 assert.equal(r.retrieval_quality.verified_absence,false);
});
test('Discovery metadata cannot leak review notes as unapproved answer evidence',()=>{
 const discovery={query:'sample',candidates:[{id,review_notes:'Unapproved source details',title:'Title'}]};
 assert.equal(JSON.stringify(sanitizedDiscovery(discovery)).includes('Unapproved'),false);
 const topic=releaseTopic({status:'EVIDENCE_PACKAGE_CREATED',discovery,selected_ids:[id],
   additional_candidates_not_examined:0,discovery_coverage_status:'CANDIDATES_EXAMINED',
   evidence:null});
 assert.equal(topic.evidence,null);
 assert.equal(JSON.stringify(topic).includes('Unapproved'),false);
});

test('Governed catalog metadata never includes direct Blob URL even for Public sources',()=>{
 const record={id:'public:02-frameworks/a.html',title:'A',access:'public',pathname:'02-frameworks/a.html',
  source_url:'https://public.blob.vercel-storage.com/secret.html',url:'https://other.example/secret',
  description:'unreviewed prose',category:'Frameworks'};
 const clean=catalogEntry(record);
 assert.equal(clean.source_url,undefined);
 assert.equal(clean.url,undefined);
 assert.equal(clean.description,undefined);
 assert.equal(clean.id,record.id);
});
