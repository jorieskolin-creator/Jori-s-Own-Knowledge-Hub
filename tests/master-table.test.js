'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {entryFromDoc,normalizeEdit,descriptionHealth,sourceSignature,reconcile,words}=require('../api/_master_table');
const {discover}=require('../api/_master_discovery');
const {extractPublic}=require('../api/_master_enrich');
function doc(scope,name,updated='2026-11-11T00:00:00Z'){
 const path='02-frameworks/'+name+'.html';
 return {id:scope+':'+path,access:scope,pathname:path,
  title:name,mime_type:'text/html',updated,size:1223};
}
test('New Public and Private documents have deterministic, empty descriptions',()=>{
 for(const scope of ['public','private']){
  const d=doc(scope,'AI Governance'),e=entryFromDoc(d);
  assert.equal(e.summary,'');assert.deepEqual(e.key_terms,[]);assert.deepEqual(e.themes,[]);
  assert.equal(e.access,scope);assert.equal(e.source_signature,sourceSignature(d));
  assert.equal(descriptionHealth(e).descriptive_fields_complete,false);
 }
});
test('Manual saving is valid with empty fields and can include long summaries',()=>{
 const e=entryFromDoc(doc('private','Private Design'));
 const change=normalizeEdit(e,{summary:'Source supported text.',key_terms:['governance','GOVERNANCE','risk'],themes:['assurance']});
 assert.deepEqual(change.key_terms,['governance','risk']);
 assert.equal(change.enrichment,'MANUAL');
 assert.equal(change.summary,'Source supported text.');
 assert.equal(words('Data-driven governance and architecture'),4);
});
test('Master Table reconciliation detects new, changed and missing documents without deleting records',()=>{
 const a=doc('public','Architecture'),b=doc('private','Internal'),extra=doc('public','New');
 const prior={schema_version:1,records:[entryFromDoc(a),entryFromDoc(b)]};
 prior.records[0].summary='An existing manually reviewed description';
 const changed={...a,updated:'2026-11-12T00:00:00Z'};
 const result=reconcile(prior,[changed,extra],['public','private']);
 assert.equal(result.added.length,1);
 assert.equal(result.changed.length,1);
 assert.equal(result.missing.length,1);
 assert.equal(result.table.records.find(e=>e.id===a.id).summary,prior.records[0].summary);
 assert.equal(result.table.records.find(e=>e.id===a.id).source_changed,true);
 assert.equal(result.table.records.find(e=>e.id===b.id).source_available,false);
});
test('Discovery matches full summaries and key terms, not only filenames',async()=>{
 const d=doc('private','Unrelated Filename');
 const entry={...entryFromDoc(d),summary:'Independent technical verification for AI risk decisions and human oversight.',
  key_terms:['control effectiveness','AI governance'],themes:['solution assurance']};
 const result=await discover('control effectiveness','private',[d],12,[entry]);
 assert.equal(result.candidates_found,1);
 assert.equal(result.candidates[0].source_kind,'master_table');
 assert.equal(result.candidates[0].summary_available,true);
 assert.equal(result.unindexed_count,0);
});
test('Discovery reports metadata fallback for documents missing from Master Table',async()=>{
 const d=doc('public','Risk Assessment');
 const result=await discover('risk assessment','public',[d],12,[]);
 assert.equal(result.unindexed_count,1);
 assert.equal(result.candidates[0].source_kind,'metadata_fallback');
 assert.equal(result.discovery_complete,false);
});
test('Discovery does not expose Private entries on Public endpoint',async()=>{
 const pub=doc('public','Governance'),priv=doc('private','Governance');
 const r=await discover('governance','public',[pub],12,[entryFromDoc(pub),entryFromDoc(priv)]);
 assert.equal(r.candidates.length,1);
 assert.equal(r.candidates[0].id,pub.id);
 assert.equal(r.master_entries,1);
});
test('Stale source fingerprints are not used for authoritative Master Table discovery',async()=>{
 const d=doc('public','Governance');
 const edited={...d,updated:'2026-11-12T00:00:00Z'};
 const result=await discover('governance','public',[edited],12,[entryFromDoc(d)]);
 assert.equal(result.candidates.length,0);
 assert.equal(result.stale_count,1);
});
test('Private documents cannot enter AI extraction path',async()=>{
 const e=entryFromDoc(doc('private','Restricted'));
 await assert.rejects(()=>extractPublic(e),/Only Public/);
});
test('Admin-only Master Table UI and API scripts parse correctly',()=>{
 for(const path of ['master-table.js','api/master-table.js','api/_master_enrich.js']){
  const src=fs.readFileSync(require('node:path').join(__dirname,'..',path),'utf8');
  assert.doesNotThrow(()=>new Function(src));
 }
});
