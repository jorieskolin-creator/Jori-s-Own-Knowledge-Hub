'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const core=require('../api/_master_table');
const {approvedIndex}=require('../api/_approved_sources');
function document(name){return {id:`private:01-solutions/${name}.html`,pathname:`01-solutions/${name}.html`,access:'private',title:name,updated:'2026-11-10T12:00:00.000Z',size:123};}
function harness(records){
 let table={schema_version:1,records,published_records:[],publication:{status:'Draft',approved_at:null}};
 const auth={valid:()=>true,postBody:req=>req.body,send:(res,status,data)=>{res.statusCode=status;res.payload=data;return res}};
 const master={...core,readMaster:async()=>({table:structuredClone(table),etag:'v1'}),writeMaster:async next=>{table=next}};
 const deps={'./_auth':auth,'./_master_table':master,'./_master_enrich':{}};
 const loaded={exports:{}};
 new Function('require','module','exports',fs.readFileSync(require.resolve('../api/master-table'),'utf8'))(name=>deps[name],loaded,loaded.exports);
 return {table:()=>table, async run(rows){let res={setHeader(){}};await loaded.exports({method:'POST',headers:{host:'hub.example',origin:'https://hub.example'},body:{action:'import',expected_etag:'v1',records:rows}},res);return res;}};
}
test('reviewed imports preserve full fields and an unknown review date',async()=>{
 const doc=core.entryFromDoc(document('Draft'));const h=harness([doc]);
 const section=('A section, with comma and a sufficiently long description: '+ 'long '.repeat(24)).trim();
 const result=await h.run([{id:doc.id,review_status:'Draft',last_reviewed:null,important_sections:[section],
   text_extraction:'PARTIAL',text_extraction_detail:'Partial · interactive content not extracted',
   visual_inspection:'NOT_ASSESSED',visual_inspection_detail:'Not assessed',
   reported_source_hash:'a'.repeat(64),reviewed_source_updated:'2026-11-10T12:00:00Z'}]);
 assert.equal(result.statusCode,200);const record=h.table().records[0];
 assert.deepEqual(record.important_sections,[section]);assert.equal(record.last_reviewed,null);
 assert.equal(record.text_extraction_detail,'Partial · interactive content not extracted');
 assert.equal(record.reported_source_hash,'a'.repeat(64));assert.equal(record.source_hash,null);
 assert.equal(approvedIndex(h.table()).size,0);
});
test('imported approved entries require matching review timestamps and do not clear existing changed flags',async()=>{
 const docs=['Match','Mismatch','Unknown','AlreadyChanged'].map(x=>core.entryFromDoc(document(x)));
 docs[3].source_changed=true;
 const h=harness(docs), reviewed='2026-11-10T12:00:00Z';
 const rows=docs.map((d,i)=>({id:d.id,review_status:'Approved',reviewed_source_updated:i===1?'2026-11-09T12:00:00Z':i===2?null:reviewed}));
 const result=await h.run(rows);assert.equal(result.statusCode,200);
 assert.deepEqual(result.payload.version_review,docs.slice(1).map(x=>x.id));
 assert.deepEqual(h.table().records.map(x=>x.source_changed),[false,true,true,true]);
 assert.equal(approvedIndex(h.table()).size,0); // Staged data is never published automatically.
 const published=core.approveTable(h.table());assert.deepEqual([...approvedIndex(published).keys()],[docs[0].id]);
});
test('duplicate IDs fail atomically and oversized section labels are rejected',async()=>{
 const doc=core.entryFromDoc(document('Example')),h=harness([doc]);
 const response=await h.run([{id:doc.id},{id:doc.id}]);
 assert.equal(response.statusCode,400);assert.equal(h.table().records[0].enrichment,'NONE');
 assert.throws(()=>core.normalizeEdit(doc,{important_sections:['a'.repeat(501)]}),/exceeds/);
});
