'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {entryFromDoc,normalizeEdit,descriptionHealth,sourceSignature,reconcile,words,inspectSourceLinks}=require('../api/_master_table');
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
 const entry={...entryFromDoc(d),review_status:'Approved',summary:'Independent technical verification for AI risk decisions and human oversight.',
  key_terms:['control effectiveness','AI governance'],themes:['solution assurance']};
 const result=await discover('control effectiveness','private',[d],12,[entry]);
 assert.equal(result.candidates_found,1);
 assert.equal(result.candidates[0].source_kind,'approved_master_table');
 assert.equal(result.candidates[0].summary_available,true);
 assert.equal(result.unindexed_count,0);
});
test('Discovery excludes documents missing from approved Master Table',async()=>{
 const d=doc('public','Risk Assessment');
 const result=await discover('risk assessment','public',[d],12,[]);
 assert.equal(result.unindexed_count,1);
 assert.equal(result.candidates_found,0);
 assert.deepEqual(result.candidates,[]);
 assert.equal(result.discovery_complete,false);
});
test('Discovery does not expose Private entries on Public endpoint',async()=>{
 const pub=doc('public','Governance'),priv=doc('private','Governance');
 const r=await discover('governance','public',[pub],12,[{...entryFromDoc(pub),review_status:'Approved'},
  {...entryFromDoc(priv),review_status:'Approved'}]);
 assert.equal(r.candidates.length,1);
 assert.equal(r.candidates[0].id,pub.id);
 assert.equal(r.master_entries,1);
});
test('Stale source fingerprints are not used for authoritative Master Table discovery',async()=>{
 const d=doc('public','Governance');
 const edited={...d,updated:'2026-11-12T00:00:00Z'};
 const result=await discover('governance','public',[edited],12,[{...entryFromDoc(d),review_status:'Approved'}]);
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
   ()=>callModel({id:'public:02-frameworks/sample.html',access:'public',title:'Public Sample',
     source_signature:'a'.repeat(64),source_available:true,source_changed:false},
     {text:'Public sample text',extraction_complete:true},
     {approved:true,purpose:'master_table_discovery_enrichment',recipient:'openai.responses',
      source_id:'public:02-frameworks/sample.html',source_signature:'a'.repeat(64),approved_at:new Date().toISOString()}),
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
 assert.equal(doc.review_status,'Draft');
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
  review_version:'v1.0',review_status:'Approved',text_extraction:'Complete',visual_inspection:'Not assessed'
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
 assert.equal(e.review_status,'Draft');
 assert.equal(e.last_reviewed,null);
 assert.equal(e.text_extraction,'PARTIAL');
 assert.match(e.review_notes,/visual inspection/);
});
test('Initial JSON import can preserve its existing approved review date',()=>{
 const d=entryFromDoc(doc('private','Risk Review'));
 const e=normalizeEdit(d,{review_version:'v1.0',review_status:'Approved',review_notes:'Complete text; visuals not assessed.'},
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

test('Reviewed JSON import preserves manual entries and supersedes AI-only fields',async()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../api/master-table.js'),'utf8');
 const ai=entryFromDoc(doc('public','AI'));
 ai.summary='Unreviewed AI-only text';ai.enrichment='AI';
 const manual=normalizeEdit(entryFromDoc(doc('private','Manual')),{summary:''});
 const empty=entryFromDoc(doc('private','Empty'));
 let table={schema_version:1,records:[ai,manual,empty]},version='v1',writes=0;
 const dependencies={
  './_auth':{valid:()=>true,postBody:req=>req.body,send:(res,status,data)=>{
   res.statusCode=status;res.payload=data;return res;
  }},
  './_master_table':{
   readMaster:async()=>({table:structuredClone(table),etag:version}),
   writeMaster:async(next,etag)=>{assert.equal(etag,version);table=next;version='v'+(++writes+1);},
   sourceInventory:async()=>({documents:[],failures:[]}),reconcile:()=>{throw Error('Not used')},
   normalizeEdit,stageTable:require('../api/_master_table').stageTable,
   approveTable:require('../api/_master_table').approveTable,
   withPublication:require('../api/_master_table').withPublication,
   descriptionHealth,MASTER_TABLE_FORMAT:'1.0'
  },
  './_master_enrich':{extractPublic:()=>{throw Error('Do not enrich on import')},
   callModel:()=>{throw Error('Do not enrich on import')}}
 };
 const loaded={exports:{}};
 new Function('require','module','exports',source)(name=>dependencies[name],loaded,loaded.exports);
 const response={statusCode:200,payload:null,setHeader(){return this}};
 const importedDate='2026-11-11T14:41:00.000Z';
 await loaded.exports({method:'POST',headers:{host:'hub.example',origin:'https://hub.example'},
  body:{action:'import',expected_etag:'v1',records:[
   {id:ai.id,summary:'Approved human summary',review_notes:'Observed text only',
    review_version:'v1.0',text_extraction:'COMPLETE',visual_inspection:'NOT_ASSESSED',last_reviewed:importedDate},
   {id:manual.id,summary:'Should never overwrite manually saved empty entry'},
   {id:empty.id,summary:'Approved text',review_notes:'Visuals not assessed'}
  ]}},response);
 assert.equal(response.statusCode,200);
 assert.equal(response.payload.imported,2);
 assert.equal(response.payload.skipped,1);
 assert.equal(writes,1);
 assert.equal(table.records[0].summary,'Approved human summary');
 assert.equal(table.records[0].last_reviewed,importedDate);
 assert.equal(table.records[0].review_notes,'Observed text only');
 assert.equal(table.records[0].review_status,'Draft');
 assert.equal(table.records[1].summary,'');
 assert.equal(table.records[2].review_status,'Draft');
});

test('Verified links bind source ID and metadata version, not ambiguous titles',()=>{
 const a=entryFromDoc(doc('private','Architecture')),b=entryFromDoc(doc('private','Verification'));
 const edited=normalizeEdit(a,{related_source_ids:[b.id]},{records:[a,b]});
 assert.deepEqual(edited.related_source_refs,[{id:b.id,source_signature:b.source_signature}]);
 assert.equal(inspectSourceLinks(edited,[a,b])[0].status,'CURRENT');
 const changed={...b,source_signature:'f'.repeat(64)};
 assert.equal(inspectSourceLinks(edited,[a,changed])[0].status,'STALE_VERSION');
 assert.equal(inspectSourceLinks(edited,[a])[0].status,'MISSING');
 assert.equal(inspectSourceLinks(edited,[a,{...b,source_available:false}])[0].status,'UNAVAILABLE');
});
test('Verified links reject missing, duplicate, self, stale and unauthorized cross-scope IDs',()=>{
 const a=entryFromDoc(doc('public','Public')),b=entryFromDoc(doc('private','Private'));
 const c=entryFromDoc(doc('public','Public Other'));
 const records=[a,b,c];
 for(const invalid of [[a.id],[c.id,c.id],['missing'],[b.id]]){
  assert.throws(()=>normalizeEdit(a,{related_source_ids:invalid},{records}),/Invalid related source ID/);
 }
 assert.throws(()=>normalizeEdit(a,{related_source_ids:[c.id]}),/Invalid related source inventory/);
 assert.throws(()=>normalizeEdit(a,{related_source_ids:[c.id]},{records:[a,b,{...c,source_changed:true}]}),/Invalid related source ID/);
 const privateLink=normalizeEdit(b,{related_source_ids:[a.id]},{records});
 assert.equal(privateLink.related_source_refs[0].id,a.id);
});
