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

test('Stripe-format secret is rejected before any OpenAI provider request',async()=>{
 const {callModel}=require('../api/_master_enrich');
 const previous=process.env.KNOWLEDGE_HUB_API_KEY;
 process.env.KNOWLEDGE_HUB_API_KEY='sk_live_not_an_openai_key';
 try{
  await assert.rejects(
   ()=>callModel({title:'Public Sample'},{text:'Public sample text',extraction_complete:true}),
   /Stripe key/);
 }finally{
  if(previous===undefined)delete process.env.KNOWLEDGE_HUB_API_KEY;
  else process.env.KNOWLEDGE_HUB_API_KEY=previous;
 }
});

test('Master Table Format 1.0 contains exact reviewed HTML fields',()=>{
 const schema=require('../schemas/master-table-v1.schema.json');
 const imp=require('../schemas/master-table-import-v1.schema.json');
 const fields=['review_notes','review_status','review_version','last_reviewed',
  'text_extraction','visual_inspection','source_metadata_title','source_hash'];
 for(const field of fields)assert.ok(schema.$defs.record.properties[field],field);
 for(const field of ['review_notes','review_version','last_reviewed','text_extraction','visual_inspection'])
  assert.ok(imp.$defs.record.properties[field],field);
 assert.equal(schema.$defs.record.properties.review_status.enum[0],'Approved');
 assert.equal(schema.$defs.record.properties.source_hash.type[1],'null');
});
test('New records separate actual content hashes from metadata-only signatures',()=>{
 const doc=entryFromDoc({id:'public:02-frameworks/Example.pdf',access:'public',
  pathname:'02-frameworks/Example.pdf',title:'Example',mime_type:'application/pdf',
  updated:'2026-11-10T10:00:00Z',size:123});
 assert.equal(doc.source_hash,null);
 assert.match(doc.source_signature,/^[0-9a-f]{64}$/);
 assert.equal(doc.source_metadata_title,'Example');
 assert.equal(doc.text_extraction,'NOT_ASSESSED');
 assert.equal(doc.visual_inspection,'NOT_ASSESSED');
 assert.equal(doc.review_status,null);
 assert.equal(doc.last_reviewed,null);
});
test('Saving approved manual descriptions preserves all reviewed HTML v1.0 information',()=>{
 const {withReviewFields}=require('../api/_master_table');
 const d=entryFromDoc(doc('private','Review'));
 const updated=normalizeEdit(d,{
  title:'Main heading distinct from metadata title',
  summary:'The document reports a finding; the finding was not independently replicated.',
  key_terms:['governance','risk'],themes:['assurance'],
  review_notes:'PDF text was read; figures were not independently inspected.',
  review_version:'v1.0',text_extraction:'Complete',visual_inspection:'Not assessed'
 });
 assert.equal(updated.review_status,'Approved');
 assert.ok(Date.parse(updated.last_reviewed)>0);
 assert.equal(updated.review_version,'v1.0');
 assert.equal(updated.review_notes,'PDF text was read; figures were not independently inspected.');
 assert.equal(updated.text_extraction,'COMPLETE');
 assert.equal(updated.visual_inspection,'NOT_ASSESSED');
 assert.equal(updated.extraction_status,'COMPLETE');
 assert.equal(updated.source_metadata_title,'Review'); // Deterministic source name
 assert.equal(updated.title,'Main heading distinct from metadata title');
 assert.equal(withReviewFields(updated).summary,updated.summary);
});
test('AI enrichment does not falsely record a manual review approval',()=>{
 const d=entryFromDoc(doc('public','Architecture'));
 const e=normalizeEdit(d,{summary:'Generated public discovery description',enrichment:'AI',
   text_extraction:'PARTIAL',visual_inspection:'NOT_ASSESSED',
   review_notes:'Extractable text only; visual inspection not assessed.'},{markApproved:false});
 assert.equal(e.enrichment,'AI');
 assert.equal(e.review_status,null);
 assert.equal(e.last_reviewed,null);
 assert.equal(e.text_extraction,'PARTIAL');
 assert.match(e.review_notes,/visual inspection/);
});
test('Initial JSON import can preserve its existing approved review date',()=>{
 const d=entryFromDoc(doc('private','Risk Review'));
 const e=normalizeEdit(d,{review_version:'v1.0',review_notes:'Complete text; visuals not assessed.'},
  {reviewedAt:'2026-11-11T14:41:00.000Z'});
 assert.equal(e.review_status,'Approved');
 assert.equal(e.last_reviewed,'2026-11-11T14:41:00.000Z');
 assert.throws(()=>normalizeEdit(d,{}, {reviewedAt:'an invalid time'}),/Invalid last reviewed/);
});
test('Legacy Master Table records gain fields without losing existing summaries',()=>{
 const {withReviewFields}=require('../api/_master_table');
 const legacy=entryFromDoc(doc('public','Legacy'));
 legacy.summary='An existing approved descriptive summary';
 delete legacy.text_extraction;delete legacy.visual_inspection;
 delete legacy.review_notes;delete legacy.source_metadata_title;
 legacy.extraction_status='COMPLETE';
 const upgraded=withReviewFields(legacy);
 assert.equal(upgraded.summary,legacy.summary);
 assert.equal(upgraded.text_extraction,'COMPLETE');
 assert.equal(upgraded.visual_inspection,'NOT_ASSESSED');
 assert.equal(upgraded.review_notes,'');
 assert.equal(upgraded.source_metadata_title,'Legacy');
});
