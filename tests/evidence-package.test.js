'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ReadableStream}=require('node:stream/web');
const {assembleEvidence,validateRequest,pick,MODES}=require('../api/_evidence_package');
function doc(id,title){return {id,title,pathname:id.slice(id.indexOf(':')+1),mime_type:'text/html',access:'private'};}
const files={
 a:'<h1>Evidence Acquisition</h1><p>Evidence acquisition establishes source provenance, coverage and identity.</p><h2>Review</h2><p>Validation reports missing controls.</p>',
 b:'<h1>Independent Verification</h1><p>Evidence acquisition needs independent verification of cited source records.</p><h2>Exceptions</h2><p>Exceptions require review by authorized humans.</p>'
};
function openFile(doc){
 const text=files[doc.id.split(':').at(-1)];
 if(!text)return Promise.reject(Error('Missing fixture'));
 const buf=Buffer.from(text);
 return Promise.resolve({size:buf.length,stream:new ReadableStream({start(c){c.enqueue(buf);c.close()}})});
}
test('Evidence request validation is deterministic and bounded',()=>{
 assert.deepEqual(validateRequest({query:'evidence',ids:['private:a']}),{query:'evidence',ids:['private:a'],mode:'focused'});
 for(const req of [{query:'evidence',ids:[]},{query:'evidence',ids:['private:a','private:a']},
  {query:'evidence',ids:['a','b','c','d','e']},{query:'?',ids:['private:a']},
  {query:'evidence',ids:['private:a'],mode:'surprise'}])
  assert.throws(()=>validateRequest(req));
});
test('Evidence packages include both relevant sources with source and section provenance',async()=>{
 const ids=['private:a','private:b'],docs=[doc(ids[0],'A'),doc(ids[1],'B')];
 const r=await assembleEvidence({query:'evidence acquisition',ids,mode:'comparative'},docs,openFile);
 assert.equal(r.status,'MATCHES_FOUND');
 assert.equal(r.selected_scope_examined,true);
 assert.equal(r.source_extraction_complete,true);
 assert.equal(r.evidence_sufficiency,'NOT_ASSESSED');
 assert.equal(r.requested_source_count,2);
 assert.equal(r.inspected_source_count,2);
 assert.equal(new Set(r.passages.map(p=>p.id)).size,2);
 for(const p of r.passages){
  assert.ok(p.passage_id.startsWith('E'));
  assert.ok(Number.isInteger(p.section));
  assert.ok(p.pathname);
  assert.match(p.passage,/evidence acquisition/i);
 }
});
test('Evidence retrieval distinguishes zero lexical hits from verified absence',async()=>{
 const ids=['private:a'],r=await assembleEvidence({query:'quantum entanglement',ids},
  [doc('private:a','A')],openFile);
 assert.equal(r.status,'NO_LEXICAL_MATCH');
 assert.equal(r.evidence_sufficiency,'NOT_ASSESSED');
 assert.equal(r.source_extraction_complete,true);
 assert.equal(r.passages.length,0);
});
test('Evidence retrieval reports partial extraction when one selected document fails',async()=>{
 const ids=['private:a','private:missing'];
 const r=await assembleEvidence({query:'evidence',ids},
  [doc('private:a','A'),doc('private:missing','Missing')],openFile);
 assert.equal(r.status,'PARTIAL_EXTRACTION');
 assert.equal(r.selected_scope_examined,false);
 assert.equal(r.failures.length,1);
 assert.equal(r.evidence_sufficiency,'NOT_ASSESSED');
});
test('Package selection obeys hard output character budget and passage cap',()=>{
 const candidates=Array.from({length:30},(_,i)=>({id:'doc'+i,page:i+1,section:null,start:0,end:800,passage:'x'.repeat(800),score:100-i,source_order:i,context_complete:true}));
 const config={max_passages:4,per_source:1,max_characters:1300};
 const r=pick(candidates,config,config.max_characters);
 assert.ok(r.passages.length<=4);
 assert.ok(r.passages.reduce((n,p)=>n+p.passage.length,0)<=1300);
 assert.ok(r.remaining_character_budget>=0);
});
test('Comparative mode allows a larger but bounded output than focused',()=>{
 assert.ok(MODES.comparative.max_characters>MODES.focused.max_characters);
 assert.ok(MODES.comprehensive.max_characters>MODES.comparative.max_characters);
});
