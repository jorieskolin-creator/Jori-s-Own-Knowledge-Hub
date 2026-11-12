'use strict';
const {send,valid,postBody}=require('./_auth');
const {readMaster,writeMaster,sourceInventory,reconcile,normalizeEdit,inspectSourceLinks,descriptionHealth,MASTER_TABLE_FORMAT,withPublication,stageTable,approveTable}=require('./_master_table');
const {extractPublic,callModel}=require('./_master_enrich');
function safeMutation(req){
 const origin=req.headers?.origin,host=req.headers?.host;
 if(origin){
  try{const u=new URL(origin);return u.protocol==='https:'&&u.host===host;}catch{return false;}
 }
 return req.headers?.['sec-fetch-site']==='same-origin';
}
function error(res,e){
 const status=e.status||(/model egress denied/i.test(e.message)?403:/size limit|too many|invalid|expected|must be/i.test(e.message)?400:503);
 // Never leak provider responses, credentials or service errors.
 return send(res,status,{error:status===503?'Master Table request failed; check application configuration or retry':e.message});
}
function requireExpected(current,body){
 if(typeof body.expected_etag!=='string'&&body.expected_etag!==null)throw Object.assign(new Error('Expected Master Table revision is required'),{status:400});
 if(body.expected_etag!==current)throw Object.assign(new Error('Master Table changed; reload before saving'),{status:409});
}
async function save(res,body){
 const {table,etag}=await readMaster();
 requireExpected(etag,body);
 const idx=table.records.findIndex(x=>x.id===body.id);
 if(idx<0)return send(res,404,{error:'Master Table entry not found'});
 const entry=table.records[idx];
 const edited=normalizeEdit(entry,body.changes,{records:table.records});
 table.records[idx]=edited;
 await writeMaster(stageTable(table),etag);
 return send(res,200,{saved:true,table_approval:'Draft',record:edited,quality:descriptionHealth(edited)});
}
async function approve(res,body){
 const {table,etag}=await readMaster();
 requireExpected(etag,body);
 const next=approveTable(table);
 await writeMaster(next,etag);
 return send(res,200,{approved:true,publication:next.publication,
  published_count:next.published_records.length,
  by_status:Object.fromEntries(['Approved','Draft','Obsolete'].map(status=>[
   status,next.published_records.filter(r=>r.review_status===status).length
  ]))});
}
async function remove(res,body){
 const {table,etag}=await readMaster();requireExpected(etag,body);
 if(!table.records.some(x=>x.id===body.id))return send(res,404,{error:'Entry not found'});
 table.records=table.records.filter(x=>x.id!==body.id);
 await writeMaster(stageTable(table),etag);
 return send(res,200,{deleted:true,id:body.id,source_document_deleted:false});
}
async function sync(res){
 const {table,etag}=await readMaster();
 const {documents,failures}=await sourceInventory();
 if(failures.length===2)return send(res,503,{error:'Neither document collection could be scanned; no changes were saved'});
 const healthy=['public','private'].filter(s=>!failures.some(e=>e.startsWith(s+' ')));
 const merged=reconcile(table,documents,healthy);
 if(JSON.stringify(merged.table.records)!==JSON.stringify(table.records))await writeMaster(stageTable(merged.table),etag);
 const pending_public=merged.table.records.filter(e=>e.access==='public'&&e.source_available&&
  e.review_status!=='Obsolete'&&!e.summary&&e.enrichment==='NONE'&&!(e.key_terms||[]).length&&!(e.themes||[]).length&&!e.source_changed).map(e=>e.id);
 return send(res,200,{added:merged.added,changed:merged.changed,unavailable:merged.missing,
  pending_public,source_count:documents.length,total_entries:merged.table.records.length,
  warnings:failures,ai_used:false});
}
async function enrich(res,body){
 if(typeof body.id!=='string'||!body.id.startsWith('public:'))
  return send(res,403,{error:'AI enrichment is restricted to Public documents'});
 const {table,etag}=await readMaster();
 requireExpected(etag,body);
 const idx=table.records.findIndex(x=>x.id===body.id);
 if(idx<0)return send(res,404,{error:'Public entry not found'});
 const doc=table.records[idx];
 if(doc.review_status==='Obsolete')return send(res,409,{error:'Obsolete sources cannot be AI-enriched; change the document status first'});
 if(doc.access!=='public'||!doc.source_available||doc.source_changed)
  return send(res,409,{error:'Public source is unavailable or changed; update inventory first'});
 if(doc.summary||doc.enrichment!=='NONE'||doc.key_terms?.length||doc.themes?.length)
  return send(res,409,{error:'Existing manually maintained content is preserved; edit it in Master Table'});
 const data=await extractPublic(doc);const enrichment=await callModel(doc,data,body.model_egress_approval);
 table.records[idx]=normalizeEdit(doc,enrichment,{markApproved:false});
 table.records[idx].enrichment='AI';
 table.records[idx].extraction_status=enrichment.extraction_status;
 await writeMaster(stageTable(table),etag);
 return send(res,200,{saved:true,id:doc.id,model:'gpt-6.1-terra',extraction_complete:data.extraction_complete,
  indexed_segments:data.indexed_segments,limitations:data.limitations,quality:descriptionHealth(table.records[idx])});
}
async function importEntries(res,body){
 // Initial reviewed Master Table JSON, not arbitrary HTML. Preserve authoritative inventory fields.
 if(!Array.isArray(body.records)||body.records.length>1000)return send(res,400,{error:'Expected records array of at most 1000 items'});
 const {table,etag}=await readMaster();requireExpected(etag,body);
 let modified=0,skipped=0;const skipped_entries=[],version_review=[];const seen=new Set();
 for(const row of body.records){
  if(!row||typeof row.id!=='string'){skipped++;continue}
  if(seen.has(row.id))throw Error('Invalid import: duplicate source ID');seen.add(row.id);
  const i=table.records.findIndex(e=>e.id===row.id);
  if(i<0){skipped++;skipped_entries.push({id:row.id,reason:'NOT_IN_INVENTORY'});continue}
  const existing=table.records[i];
  // Explicitly imported human-reviewed records take precedence over AI-only metadata.
  // Preserve any entry the administrator has previously saved manually.
  if(existing.enrichment==='MANUAL'||
     ((existing.summary||existing.key_terms?.length||existing.themes?.length)&&existing.enrichment!=='AI')){
   skipped++;skipped_entries.push({id:row.id,reason:'MANUALLY_MAINTAINED'});continue;
  }
  const changes={};
  for(const k of ['title','summary','key_terms','themes','document_type','important_sections','related_documents','related_source_ids',
   'review_notes','review_version','review_status','text_extraction','visual_inspection',
   'reviewed_source_updated','reviewed_source_metadata_title','reported_source_hash',
   'text_extraction_detail','visual_inspection_detail'])
   if(Object.prototype.hasOwnProperty.call(row,k))changes[k]=row[k];
  // The imported table has already been reviewed by the Admin. Preserve its
  // source-review timestamp when supplied; do not trust imported source hashes.
  const edited=normalizeEdit(existing,changes,{reviewedAt:row.last_reviewed??null,preserveReviewDate:true,
   preserveSourceChanged:true,records:table.records});
  // A catalog timestamp is a useful mismatch check, not proof of identical bytes.
  // Existing change flags always require a separate deliberate source review.
  if(edited.review_status==='Approved'){
   const reviewed=Date.parse(edited.reviewed_source_updated),current=Date.parse(existing.source_updated);
   if(!Number.isFinite(reviewed)||!Number.isFinite(current)||Math.floor(reviewed/1000)!==Math.floor(current/1000))
    edited.source_changed=true;
   if(edited.source_changed||!edited.source_available)version_review.push(row.id);
  }
  table.records[i]=edited;modified++;
 }
 if(modified)await writeMaster(stageTable(table),etag);
 return send(res,200,{imported:modified,skipped,skipped_entries,version_review,
  manually_maintained_entries_preserved:true,ai_only_entries_may_be_replaced:true});
}
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!valid(req,'admin'))return send(res,401,{error:'Admin login required'});
 try{
  if(req.method==='GET'){
   const {table,etag}=await readMaster();
   return send(res,200,{schema_version:1,master_table_format:MASTER_TABLE_FORMAT,etag,updated_at:table.updated_at,
     publication:withPublication(table).publication,published_count:withPublication(table).published_records.length,
    records:table.records.map(r=>({...r,related_source_links:inspectSourceLinks(r,table.records),quality:descriptionHealth(r)})),count:table.records.length});
  }
  if(req.method!=='POST')return send(res,405,{error:'Method not allowed'});
  if(!safeMutation(req))return send(res,403,{error:'Same-origin administrator action required'});
  const size=Number(req.headers?.['content-length']||0);
  if(size>3*1024*1024)return send(res,413,{error:'Request too large'});
  const body=postBody(req),action=body.action;
  if(action==='sync')return await sync(res);
  if(action==='save')return await save(res,body);
   if(action==='approve')return await approve(res,body);
  if(action==='delete')return await remove(res,body);
  if(action==='enrich')return await enrich(res,body);
  if(action==='import')return await importEntries(res,body);
  return send(res,400,{error:'Unknown Master Table operation'});
 }catch(e){return error(res,e)}
};
