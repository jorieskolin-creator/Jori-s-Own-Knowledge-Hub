'use strict';
// Compact retrieval Golden Standard. Synthetic text, deterministic ground truth, no customer data.
const test=require('node:test');
const assert=require('node:assert/strict');
const {ReadableStream}=require('node:stream/web');
const {createHash}=require('node:crypto');
const {assembleEvidence,pick}=require('../api/_evidence_package');
const {evaluateRetrieval}=require('../api/_quality_gate');
const contract=require('../schemas/evidence-package-v1.schema.json');
const corpus={
 'costs.html':'<h1>Cost visibility</h1><p>Monthly cost allocation is reviewed by finance and application owners. Cost visibility requires owner mapping.</p><h2>Exceptions</h2><p>Unallocated spend is escalated monthly.</p>',
 'security.html':'<h1>Security architecture</h1><p>Approved identity controls require human review for privileged access.</p>',
 'releases.html':'<h1>Release notes</h1><p>Typography and release history for version labels.</p>'
};
const ids=Object.keys(corpus).map(name=>'private:02-frameworks/'+name);
const doc=id=>({id,title:id.split('/').at(-1),pathname:id.slice(8),access:'private',mime_type:'text/html'});
async function open(doc){
 const body=corpus[doc.id.split('/').at(-1)];
 if(!body)throw Error('Golden fixture deliberately absent');
 const bytes=Buffer.from(body);
 return {size:bytes.length,stream:new ReadableStream({start(c){c.enqueue(bytes);c.close()}})};
}
test('Golden G1: relevant source is retrieved and irrelevant sources remain inspected',async()=>{
 const r=await assembleEvidence({query:'cost allocation',ids,mode:'focused'},ids.map(doc),open);
 assert.equal(r.schema_version,1);
 assert.equal(r.status,'MATCHES_FOUND');
 assert.equal(r.inspected_source_count,3);
 assert.equal(r.selected_scope_examined,true);
 assert.equal(r.retrieval_quality.status,'PASS');
 assert.ok(r.passages.length>0);
 assert.deepEqual([...new Set(r.passages.map(p=>p.id))],[ids[0]]);
 for(const source of r.source_coverage){
  const name=source.id.split('/').at(-1);
  assert.equal(source.original_file_sha256,createHash('sha256').update(corpus[name]).digest('hex'));
 }
 for(const p of r.passages)assert.equal(p.source_sha256,r.source_coverage.find(s=>s.id===p.id).original_file_sha256);
});
test('Golden G2: no lexical hit cannot be misreported as verified absence',async()=>{
 const r=await assembleEvidence({query:'untested encryption key rotation',ids:[ids[0]]},[doc(ids[0])],open);
 assert.equal(r.status,'NO_LEXICAL_MATCH');
 assert.equal(r.passages.length,0);
 assert.equal(r.evidence_sufficiency,'NOT_ASSESSED');
 assert.equal(r.retrieval_quality.verified_absence,false);
 assert.equal(r.retrieval_quality.status,'WARN');
});
test('Golden G3: missing selected source is BLOCK, not absence or successful coverage',async()=>{
 const missing='private:02-frameworks/missing.html';
 const r=await assembleEvidence({query:'cost allocation',ids:[ids[0],missing]},[doc(ids[0]),doc(missing)],open);
 assert.equal(r.status,'PARTIAL_EXTRACTION');
 assert.equal(r.retrieval_quality.status,'BLOCK');
 assert.equal(r.retrieval_quality.verified_absence,false);
});
test('Golden G4: source-hash and passage-hash tampering fail independent gates',async()=>{
 const r=await assembleEvidence({query:'cost allocation',ids:[ids[0]]},[doc(ids[0])],open);
 assert.equal(r.retrieval_quality.status,'PASS');
 const copy=JSON.parse(JSON.stringify(r));
 copy.passages[0].source_sha256='0'.repeat(64);
 assert.equal(evaluateRetrieval(copy).status,'BLOCK');
 const second=JSON.parse(JSON.stringify(r));
 second.passages[0].passage_sha256='f'.repeat(64);
 assert.equal(evaluateRetrieval(second).status,'BLOCK');
 const third=JSON.parse(JSON.stringify(r));
 third.source_coverage[0].original_file_sha256=null;
 assert.ok(evaluateRetrieval(third).blocking_reasons.includes('INVALID_ORIGINAL_SOURCE_HASH'));
});
test('Golden G5: repeated retrieval preserves passage identity and digest',async()=>{
 const args={query:'owner mapping',ids:[ids[0]]};
 const a=await assembleEvidence(args,[doc(ids[0])],open);
 const b=await assembleEvidence(args,[doc(ids[0])],open);
 assert.deepEqual(a.passages,b.passages);
 assert.equal(a.retrieval_quality.status,b.retrieval_quality.status);
});
test('Golden G6: partial output preserves an exact end offset and warns',()=>{
 const long='X'.repeat(500);
 const r=pick([{id:ids[0],page:null,section:1,start:22,end:522,passage:long,
  score:10,source_order:0,context_complete:true}],{max_passages:1,per_source:1,max_characters:250},250);
 assert.equal(r.passages[0].passage.length,250);
 assert.equal(r.passages[0].end,272);
 assert.equal(r.passages[0].passage_truncated,true);
});
test('Golden G7: Evidence Package is explicitly versioned with separate SHA-256 contract fields',()=>{
 assert.equal(contract.properties.schema_version.const,1);
 assert.ok(contract.required.includes('source_coverage'));
 assert.ok(contract.required.includes('retrieval_quality'));
 assert.ok(contract.$defs.source.required.includes('original_file_sha256'));
 assert.ok(contract.$defs.passage.required.includes('source_sha256'));
 assert.ok(contract.$defs.passage.required.includes('passage_sha256'));
});
