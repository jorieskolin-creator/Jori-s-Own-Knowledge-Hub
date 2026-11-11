'use strict';
const {send,valid,postBody}=require('./_auth');
const {readMaster,writeMaster,sourceInventory,reconcile,normalizeEdit,descriptionHealth}=require('./_master_table');
const {extractPublic,callModel}=require('./_master_enrich');
function safeMutation(req){
 const origin=req.headers?.origin,host=req.headers?.host;
 if(origin){
  try{const u=new URL(origin);return u.protocol==='https:'&&u.host===host;}catch{return false;}
 }
 return req.headers?.['sec-fetch-site']==='same-origin';
}
function error(res,e){
 const status=e.status||(/size limit|too many|invalid|expected|must be/i.test(e.message)?400:503);
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
 const edited=normalizeEdit(entry,body.changes);
 table.records[idx]=edited;
 await writeMaster(table,etag);
 return send(res,200,{saved:true,record:edited,quality:descriptionHealth(edited)});
}
async function remove(res,body){
 const {table,etag}=await readMaster();requireExpected(etag,body);
 if(!table.records.some(x=>x.id===body.id))return send(res,404,{error:'Entry not found'});
 table.records=table.records.filter(x=>x.id!==body.id);
 await writeMaster(table,etag);
 return send(res,200,{deleted:true,id:body.id,source_document_deleted:false});
}
async function sync(res){
 const {table,etag}=await readMaster();
 const {documents,failures}=await sourceInventory();
 if(failures.length===2)return send(res,503,{error:'Neither document collection could be scanned; no changes were saved'});
 const healthy=['public','private'].filter(s=>!failures.some(e=>e.startsWith(s+' ')));
 const merged=reconcile(table,documents,healthy);
 if(JSON.stringify(merged.table.records)!==JSON.stringify(table.records))await writeMaster(merged.table,etag);
 const pending_public=merged.table.records.filter(e=>e.access==='public'&&e.source_available&&
  !e.summary&&!e.source_changed).map(e=>e.id);
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
 if(doc.access!=='public'||!doc.source_available||doc.source_changed)
  return send(res,409,{error:'Public source is unavailable or changed; update inventory first'});
 if(doc.summary)return send(res,409,{error:'Existing summary is preserved; edit it manually'});
 const data=await extractPublic(doc);const enrichment=await callModel(doc,data);
 table.records[idx]=normalizeEdit(doc,enrichment);
 table.records[idx].enrichment='AI';
 table.records[idx].extraction_status=enrichment.extraction_status;
 await writeMaster(table,etag);
 return send(res,200,{saved:true,id:doc.id,model:'gpt-6.1-terra',extraction_complete:data.extraction_complete,
  indexed_segments:data.indexed_segments,limitations:data.limitations,quality:descriptionHealth(table.records[idx])});
}
async function importEntries(res,body){
 // Initial reviewed Master Table JSON, not arbitrary HTML. Preserve authoritative inventory fields.
 if(!Array.isArray(body.records)||body.records.length>1000)return send(res,400,{error:'Expected records array of at most 1000 items'});
 const {table,etag}=await readMaster();requireExpected(etag,body);
 let modified=0,skipped=0;
 for(const row of body.records){
  if(!row||typeof row.id!=='string'){skipped++;continue}
  const i=table.records.findIndex(e=>e.id===row.id);
  if(i<0){skipped++;continue}
  const existing=table.records[i];
  if(existing.summary||existing.key_terms?.length||existing.themes?.length){skipped++;continue;}
  const changes={};
  for(const k of ['title','summary','key_terms','themes','document_type','important_sections','related_documents'])
   if(Object.prototype.hasOwnProperty.call(row,k))changes[k]=row[k];
  table.records[i]=normalizeEdit(existing,changes);modified++;
 }
 if(modified)await writeMaster(table,etag);
 return send(res,200,{imported:modified,skipped,existing_entries_preserved:true});
}
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!valid(req,'admin'))return send(res,401,{error:'Admin login required'});
 try{
  if(req.method==='GET'){
   const {table,etag}=await readMaster();
   return send(res,200,{schema_version:1,etag,updated_at:table.updated_at,
    records:table.records.map(r=>({...r,quality:descriptionHealth(r)})),count:table.records.length});
  }
  if(req.method!=='POST')return send(res,405,{error:'Method not allowed'});
  if(!safeMutation(req))return send(res,403,{error:'Same-origin administrator action required'});
  const size=Number(req.headers?.['content-length']||0);
  if(size>3*1024*1024)return send(res,413,{error:'Request too large'});
  const body=postBody(req),action=body.action;
  if(action==='sync')return await sync(res);
  if(action==='save')return await save(res,body);
  if(action==='delete')return await remove(res,body);
  if(action==='enrich')return await enrich(res,body);
  if(action==='import')return await importEntries(res,body);
  return send(res,400,{error:'Unknown Master Table operation'});
 }catch(e){return error(res,e)}
};
