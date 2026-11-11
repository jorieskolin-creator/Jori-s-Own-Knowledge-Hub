'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateRetrieval,sha256}=require('../api/_quality_gate');
const {assembleEvidence}=require('../api/_evidence_package');
const {ReadableStream}=require('node:stream/web');
const make=(id='private:test.html')=>({id,title:'Test',pathname:id.slice(id.indexOf(':')+1),
 access:'private',mime_type:'text/html'});
function fixture(str){
 const data=Buffer.from(str);
 return async()=>({size:data.length,stream:new ReadableStream({start(c){c.enqueue(data);c.close()}})});
}
test('Complete selected-scope source passages pass integrity gate without asserting domain sufficiency',async()=>{
 const id='private:test.html';
 const result=await assembleEvidence({query:'evidence acquisition',ids:[id]},[make(id)],
  fixture('<h1>Architecture</h1><p>Evidence acquisition validates source references and coverage.</p>'));
 assert.equal(result.retrieval_quality.status,'PASS');
 assert.equal(result.retrieval_quality.gates.passage_provenance,'PASS');
 assert.equal(result.retrieval_quality.evidence_sufficiency,'NOT_ASSESSED');
 assert.equal(result.retrieval_quality.verified_absence,false);
 assert.equal(result.passages[0].source_verified,true);
 assert.equal(result.passages[0].source_sha256,sha256(id+'||1|'+result.passages[0].start+'|'+result.passages[0].passage));
});
test('No lexical matches returns WARN and does not verify absence',async()=>{
 const id='private:test.html';
 const r=await assembleEvidence({query:'unfindable term',ids:[id]},[make(id)],
  fixture('<h1>Architecture</h1><p>Ordinary text without matching vocabulary.</p>'));
 assert.equal(r.status,'NO_LEXICAL_MATCH');
 assert.equal(r.retrieval_quality.status,'WARN');
 assert.ok(r.retrieval_quality.warnings.includes('NO_SUPPORTING_LEXICAL_PASSAGES'));
 assert.equal(r.retrieval_quality.verified_absence,false);
});
test('Unexamined source returns BLOCK and declares gaps',async()=>{
 const ids=['private:test.html','private:missing.html'],docs=ids.map(make);
 const r=await assembleEvidence({query:'evidence acquisition',ids},docs,async doc=>{
  if(doc.id===ids[1])throw Error('unavailable');
  return fixture('<p>Evidence acquisition complete.</p>')();
 });
 assert.equal(r.retrieval_quality.status,'BLOCK');
 assert.ok(r.retrieval_quality.blocking_reasons.includes('UNEXAMINED_SOURCE'));
 assert.equal(r.retrieval_quality.evidence_sufficiency,'NOT_ASSESSED');
});
test('Tampered passage content or source path fails provenance validation',async()=>{
 const id='private:test.html';
 const r=await assembleEvidence({query:'evidence acquisition',ids:[id]},[make(id)],
  fixture('<h1>Architecture</h1><p>Evidence acquisition confirms sources.</p>'));
 r.passages[0].passage='altered';r.passages[0].end=r.passages[0].start+7;
 const q=evaluateRetrieval(r);
 assert.equal(q.status,'BLOCK');
 assert.ok(q.blocking_reasons.includes('INVALID_PASSAGE_PROVENANCE'));
 r.passages[0].pathname='different.html';
 assert.equal(evaluateRetrieval(r).status,'BLOCK');
});
test('Exhausted response budget returns WARN for omitted matches',async()=>{
 const id='private:test.html';
 const r=await assembleEvidence({query:'evidence',ids:[id],mode:'focused'},[make(id)],
  fixture('<h1>Long</h1><p>'+('evidence and safeguards '.repeat(2000))+'</p>'));
 assert.equal(r.retrieval_quality.status,'WARN');
 assert.ok(r.retrieval_quality.warnings.includes('BOUNDED_RESULTS'));
 assert.equal(r.retrieval_quality.verified_absence,false);
});
