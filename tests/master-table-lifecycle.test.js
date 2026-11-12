'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {entryFromDoc,normalizeEdit,stageTable,approveTable,withPublication,discoveryRecords,reviewStatus}=require('../api/_master_table');
const {discover}=require('../api/_master_discovery');
function doc(label='Workflow',access='private'){
 const pathname='02-frameworks/'+label+'.html';
 return {id:access+':'+pathname,access,pathname,title:label,
  mime_type:'text/html',updated:'2026-11-12T10:00:00Z',size:7000};
}
test('Document statuses are independent of whole-table publication and explicitly validated',()=>{
 const source=entryFromDoc(doc());
 assert.equal(source.review_status,'Draft');
 const obsolete=normalizeEdit(source,{review_status:'Obsolete',summary:'Historical architecture kept for comparison'});
 assert.equal(obsolete.review_status,'Obsolete');
 assert.ok(Date.parse(obsolete.last_reviewed)>0);
 assert.equal(normalizeEdit(obsolete,{summary:'Historical amended'}).review_status,'Obsolete');
 assert.equal(normalizeEdit(obsolete,{review_status:'Approved'}).review_status,'Approved');
 assert.equal(normalizeEdit(source,{summary:'New summary'}).review_status,'Draft');
 assert.throws(()=>reviewStatus('Decommissioned'),/Invalid document review status/);
 assert.throws(()=>normalizeEdit(source,{review_status:'Deleted'}),/Invalid document review status/);
});
test('Saving an entry stages working content while discovery retains last published snapshot',()=>{
 const record=normalizeEdit(entryFromDoc(doc()),{
  review_status:'Approved',summary:'Published trustworthy context',
  key_terms:['trusted content']});
 const table=approveTable({schema_version:1,updated_at:null,records:[record]});
 const edited=normalizeEdit(record,{summary:'Unapproved edited context',key_terms:['unapproved concept']});
 const staged=stageTable({...table,records:[edited]});
 assert.equal(staged.publication.status,'Draft');
 assert.equal(staged.records[0].summary,'Unapproved edited context');
 assert.equal(discoveryRecords(staged)[0].summary,'Published trustworthy context');
 const newer=approveTable(staged,'2026-11-12T10:30:00Z');
 assert.equal(newer.publication.status,'Approved');
 assert.equal(newer.publication.approved_at,'2026-11-12T10:30:00.000Z');
 assert.equal(discoveryRecords(newer)[0].summary,'Unapproved edited context');
 assert.deepEqual(newer.records.map(r=>r.id),table.records.map(r=>r.id));
});
test('Legacy Master Table gains an approved snapshot without losing records or review dates',()=>{
 const entry=normalizeEdit(entryFromDoc(doc()),{review_status:'Approved',
  summary:'Previously live summary'});
 const old={schema_version:1,updated_at:'2026-11-10T00:00:00Z',records:[entry]};
 const migrated=withPublication(old);
 assert.equal(migrated.publication.status,'Approved');
 assert.equal(migrated.published_records[0].summary,'Previously live summary');
 const staged=stageTable(migrated);
 staged.records[0]=normalizeEdit(staged.records[0],{summary:'Now staged'});
 assert.equal(staged.published_records[0].summary,'Previously live summary');
});
test('Obsolete records are preserved for explicit source retrieval but omitted from default discovery',async()=>{
 const a=doc('Legacy'),b=doc('Latest'),c=doc('Unreviewed');
 const aEntry=normalizeEdit(entryFromDoc(a),{review_status:'Obsolete',summary:'Quantum comparison of versions'});
 const bEntry=normalizeEdit(entryFromDoc(b),{review_status:'Approved',summary:'Quantum comparison of versions'});
 const cEntry=normalizeEdit(entryFromDoc(c),{review_status:'Draft',summary:'Quantum comparison of versions'});
 const records=[aEntry,bEntry,cEntry],all=[a,b,c];
 const answer=await discover('quantum','private',all,12,records);
 assert.equal(answer.obsolete_count,1);
 assert.equal(answer.draft_count,1);
 assert.deepEqual(answer.candidates.map(x=>x.id),[b.id]);
 assert.equal(answer.candidates[0].review_status,'Approved');
 assert.equal(records.some(x=>x.id===a.id),true);
 const draft=await discover('Unreviewed','private',all,12,records);
 assert.equal(draft.candidates[0].source_kind,'metadata_fallback');
 assert.equal(draft.candidates[0].summary_available,false);
});
test('Unpublished Approved edits cannot affect discovery until Master Table is approved',async()=>{
 const d=doc('OriginalTitle'),original=normalizeEdit(entryFromDoc(d),{review_status:'Approved',
  summary:'Production architecture approved evidence',key_terms:['production architecture']});
 const released=approveTable({schema_version:1,records:[original]});
 const draft=stageTable({...released,records:[normalizeEdit(original,{
  summary:'Secret new terminology not yet approved',key_terms:['secret terminology']})]});
 const prior=await discover('secret terminology','private',[d],12,discoveryRecords(draft));
 assert.equal(prior.candidates_found,0);
 const after=await discover('secret terminology','private',[d],12,discoveryRecords(approveTable(draft)));
 assert.equal(after.candidates_found,1);
});
test('Admin UI separates entry Save from explicit whole-table Save and Approve',()=>{
 const src=fs.readFileSync(require('node:path').join(__dirname,'../master-table.js'),'utf8');
 assert.match(src,/Document lifecycle status/);
 assert.match(src,/Save &amp; approve Master Table/);
 assert.match(src,/Save entry \(stage changes\)/);
 assert.doesNotMatch(src,/Review status \(Save = Approved\)/);
 assert.doesNotThrow(()=>new Function(src));
});
