'use strict';
// Master Table schema and persistence. The catalog is administrative metadata, NEVER source evidence.
// Private Blob holds both public and private descriptions; no record is put into Public Blob.
const {get,put,head,list}=require('@vercel/blob');
const crypto=require('node:crypto');
const {Readable}=require('node:stream');
const STORE_ID=()=>process.env.PRIVATE_BLOB_STORE_ID||'store_YAAwH6FewcrImhA1';
const MASTER_PATH='_knowledge-system/master-table-v1.json';
const MAX_MASTER_BYTES=3*1024*1024;
const MASTER_TABLE_FORMAT='1.0';
const TEXT_EXTRACTION=['NOT_ASSESSED','COMPLETE','PARTIAL','FAILED'];
const VISUAL_INSPECTION=['NOT_ASSESSED','COMPLETE','PARTIAL'];
const DOCUMENT_STATUSES=['Approved','Draft','Obsolete'];
const CATS=new Set(['01-solutions','02-frameworks','03-general-presentations','04-shared-knowledge','05-random','06-personal']);
function masterEmpty(){return {schema_version:1,updated_at:null,records:[],
 published_records:[],publication:{status:'Draft',approved_at:null}};}
function reviewStatus(value){
 const status=value===null||value===undefined?'Draft':value;
 if(!DOCUMENT_STATUSES.includes(status))throw Error('Invalid document review status');
 return status;
}
// Freeze the previous discovery state when migrating a legacy table.
function withPublication(table){
 const working=(table.records||[]).map(withReviewFields);
 const published=Array.isArray(table.published_records)?
  table.published_records.map(withReviewFields):working.map(r=>({...r}));
 const publication=table.publication||{
  status:working.length?'Approved':'Draft',approved_at:table.updated_at||null
 };
 if(!['Approved','Draft'].includes(publication.status))throw Error('Invalid Master Table publication status');
 return {...table,records:working,published_records:published,publication};
}
function stageTable(table){
 const t=withPublication(table);
 return {...t,publication:{...t.publication,status:'Draft'}};
}
function approveTable(table,at=new Date().toISOString()){
 const t=withPublication(table),date=new Date(at);
 if(!Number.isFinite(date.getTime()))throw Error('Invalid approval timestamp');
 return {...t,published_records:t.records.map(r=>structuredClone(r)),
  publication:{status:'Approved',approved_at:date.toISOString()}};
}
function discoveryRecords(table){return withPublication(table).published_records;}
function permitted(path){return typeof path==='string'&&path.length<=1024&&
 /\.(?:html?|pdf)$/i.test(path)&&path.split('/').length>1&&
 path.split('/').every(s=>s&&s!=='.'&&s!=='..'&&!s.startsWith('.'))&&CATS.has(path.split('/')[0]);}
function words(s){return (String(s||'').trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)||[]).length;}
function text(s,max=300){return String(s??'').trim().replace(/\s+/g,' ').slice(0,max);}
function strings(input,max=30,itemMax=100){
 if(!Array.isArray(input))throw Error('Expected a list of terms or themes');
 const found=[],seen=new Set();
 for(const item of input){if(typeof item!=='string')throw Error('Invalid list entry');
  if(item.trim().length>itemMax)throw Error('List entry exceeds '+itemMax+' characters');
  const val=text(item,itemMax);if(val&&!seen.has(val.toLowerCase())){found.push(val);seen.add(val.toLowerCase());}}
 if(found.length>max)throw Error('Too many list entries');return found;
}
function coverageState(value,allowed){
 const state=String(value??'NOT_ASSESSED').trim().toUpperCase().replace(/[\s-]+/g,'_');
 const normalized=state==='NOT_INSPECTED'||state==='MANUAL'?'NOT_ASSESSED':state;
 if(!allowed.includes(normalized))throw Error('Invalid review coverage value');
 return normalized;
}
function sourceTitle(path){
 return String(path||'').split('/').at(-1).replace(/\.(?:html?|pdf)$/i,'').replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim();
}
function withReviewFields(entry){
 // Additive compatibility for Master Table records created before Format 1.0.
 const e={...entry};
 e.source_metadata_title=e.source_metadata_title??sourceTitle(e.pathname);
 e.source_hash=e.source_hash??null; // Reserved for a verified SHA-256 of the original file bytes.
 e.related_source_refs=Array.isArray(e.related_source_refs)?e.related_source_refs:[]; // Version-pinned IDs, not title guesses.
 e.review_notes=e.review_notes??'';
 e.reviewed_source_updated=e.reviewed_source_updated??null;
 e.reviewed_source_metadata_title=e.reviewed_source_metadata_title??'';
 e.reported_source_hash=e.reported_source_hash??null;
 e.text_extraction_detail=e.text_extraction_detail??'';
 e.visual_inspection_detail=e.visual_inspection_detail??'';
 e.review_status=reviewStatus(e.review_status);
 e.review_version=e.review_version??'';
 e.last_reviewed=e.last_reviewed??null;
 const old=e.extraction_status==='NOT_INSPECTED'||e.extraction_status==='MANUAL'?'NOT_ASSESSED':e.extraction_status;
 e.text_extraction=coverageState(e.text_extraction??old??'NOT_ASSESSED',TEXT_EXTRACTION);
 e.visual_inspection=coverageState(e.visual_inspection??'NOT_ASSESSED',VISUAL_INSPECTION);
 return e;
}
function sourceSignature(d){return crypto.createHash('sha256').update([d.id,d.updated||'',d.size||0].join('|')).digest('hex');}
function entryFromDoc(d){
 const path=d.pathname,part=path.split('/');
 return {id:d.id,access:d.access,pathname:path,
  title:text(d.title||part.at(-1).replace(/\.(?:html?|pdf)$/i,''),220),
  category:part[0],folder:part.slice(1,-1).join('/'),mime_type:d.mime_type||(/\.pdf$/i.test(path)?'application/pdf':'text/html'),
  source_updated:d.updated||null,source_size:d.size??null,source_signature:sourceSignature(d),
  source_available:true,source_changed:false,source_hash:null,
  source_metadata_title:text(d.title||sourceTitle(path),220),
  summary:'',key_terms:[],themes:[],document_type:'',important_sections:[],related_documents:[],related_source_refs:[],
  review_notes:'',review_status:'Draft',review_version:'',last_reviewed:null,
  text_extraction:'NOT_ASSESSED',visual_inspection:'NOT_ASSESSED',
  extraction_status:'NOT_INSPECTED',enrichment:'NONE',last_saved:null};
}
// Validated cross-document links are separate from free-text related document names.
function bindRelatedSourceIds(source,ids,records){
 if(!Array.isArray(ids)||ids.length>30)throw Error('Invalid related source IDs: expected at most 30');
 if(!Array.isArray(records))throw Error('Invalid related source inventory');
 const byId=new Map(records.map(r=>[r.id,r])),seen=new Set();
 return ids.map(id=>{
  if(typeof id!=='string'||!id.trim()||seen.has(id)||id===source.id)
   throw Error('Invalid related source ID (empty, duplicate or self-reference)');
  seen.add(id);
  const target=byId.get(id);
  if(!target||target.source_available===false||target.source_changed||
     !/^[a-f0-9]{64}$/.test(target.source_signature||''))
   throw Error('Invalid related source ID: target missing, unavailable, or stale');
  if(source.access==='public'&&target.access==='private')
   throw Error('Invalid related source ID: Public metadata cannot link to Private');
  return {id,source_signature:target.source_signature};
 });
}
function inspectSourceLinks(source,records){
 const byId=new Map(records.map(r=>[r.id,r]));
 return (source.related_source_refs||[]).map(ref=>{
  const target=byId.get(ref.id);
  const status=!target?'MISSING':target.source_available===false?'UNAVAILABLE':
   target.source_changed||target.source_signature!==ref.source_signature?'STALE_VERSION':'CURRENT';
  return {id:ref.id,source_signature:ref.source_signature,status};
 });
}
function normalizeEdit(entry,changes,options={}){
 if(!changes||typeof changes!=='object'||Array.isArray(changes))throw Error('Invalid changes');
 const out=withReviewFields(entry);
 if('title'in changes)out.title=text(changes.title,220);
 if('summary'in changes){if(typeof changes.summary!=='string'||changes.summary.length>2400)throw Error('Summary must be text up to 2400 characters');out.summary=changes.summary.trim();}
 if('key_terms'in changes)out.key_terms=strings(changes.key_terms,40);
 if('themes'in changes)out.themes=strings(changes.themes,20);
 if('document_type'in changes)out.document_type=text(changes.document_type,100);
 if('important_sections'in changes)out.important_sections=strings(changes.important_sections,60,500);
 if('related_documents'in changes)out.related_documents=strings(changes.related_documents,30,500);
 if('related_source_ids'in changes)out.related_source_refs=bindRelatedSourceIds(entry,changes.related_source_ids,options.records);
 if('review_notes'in changes){
  if(typeof changes.review_notes!=='string'||changes.review_notes.length>6000)throw Error('Review notes must be text up to 6000 characters');
  out.review_notes=changes.review_notes.trim();
 }
 if('review_version'in changes){
  if(typeof changes.review_version!=='string'||changes.review_version.length>50)throw Error('Invalid review version');
  out.review_version=changes.review_version.trim();
 }
 for(const key of ['reviewed_source_metadata_title','text_extraction_detail','visual_inspection_detail']){
  if(key in changes){if(typeof changes[key]!=='string'||changes[key].length>500)throw Error('Invalid review detail');out[key]=changes[key].trim();}
 }
 if('reviewed_source_updated'in changes){
  const value=changes.reviewed_source_updated;
  if(value!==null&&(typeof value!=='string'||!Number.isFinite(Date.parse(value))))throw Error('Invalid reviewed source date');
  out.reviewed_source_updated=value===null?null:new Date(value).toISOString();
 }
 if('reported_source_hash'in changes){
  const value=changes.reported_source_hash;
  if(value!==null&&(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value)))throw Error('Invalid reported source hash');
  out.reported_source_hash=value;
 }
 if('text_extraction'in changes){
  out.text_extraction=coverageState(changes.text_extraction,TEXT_EXTRACTION);
  out.extraction_status=out.text_extraction==='NOT_ASSESSED'?'NOT_INSPECTED':out.text_extraction;
 }else if('extraction_status'in changes){
  // Legacy enrichment clients can still supply the previous field.
  out.text_extraction=coverageState(changes.extraction_status,TEXT_EXTRACTION);
  out.extraction_status=out.text_extraction==='NOT_ASSESSED'?'NOT_INSPECTED':out.text_extraction;
 }
 if('visual_inspection'in changes)out.visual_inspection=coverageState(changes.visual_inspection,VISUAL_INSPECTION);
 if('review_status'in changes)out.review_status=reviewStatus(changes.review_status);
 if(options.markApproved!==false){
  if(options.reviewedAt!==undefined&&options.reviewedAt!==null){
   const time=Date.parse(options.reviewedAt);
   if(!Number.isFinite(time))throw Error('Invalid last reviewed date');
   out.last_reviewed=new Date(time).toISOString();
  }else if(options.preserveReviewDate)out.last_reviewed=null;
  else out.last_reviewed=new Date().toISOString();
 }
 out.last_saved=new Date().toISOString();
 if(entry.access==='private')out.enrichment='MANUAL';
 else if(changes.enrichment==='AI')out.enrichment='AI'; else out.enrichment='MANUAL';
 if(entry.source_changed&&!options.preserveSourceChanged)out.source_changed=false; // Admin saves after reviewing current source.
 return out;
}
function descriptionHealth(e){return {summary_words:words(e.summary),
  summary_within_target:words(e.summary)>=120&&words(e.summary)<=135,
  term_count:e.key_terms?.length||0,theme_count:e.themes?.length||0,
  discoverable:!!(e.summary||e.key_terms?.length||e.themes?.length||e.title),
  descriptive_fields_complete:words(e.summary)>=120&&words(e.summary)<=135&&
  e.key_terms?.length>=12&&e.themes?.length>=5};
}
async function readBytes(file,limit){
 const parts=[];let n=0;
 for await(const p of Readable.fromWeb(file.stream)){n+=p.length;if(n>limit)throw Error('Master Table exceeds size limit');parts.push(p);}
 return Buffer.concat(parts).toString('utf8');
}
async function readMaster(){
 const storeId=STORE_ID();
 let info;try{info=await head(MASTER_PATH,{storeId});}catch(e){
  if(/not.?found|404|does not exist/i.test(String(e?.message||'')))return {table:masterEmpty(),etag:null};
  throw e;
 }
 if(!info)return {table:masterEmpty(),etag:null};
 const file=await get(MASTER_PATH,{access:'private',storeId});
 if(!file||!file.stream)throw Error('Master Table could not be read');
 const table=JSON.parse(await readBytes(file,MAX_MASTER_BYTES));
 if(table.schema_version!==1||!Array.isArray(table.records))throw Error('Unsupported Master Table schema');
 return {table:withPublication(table),etag:info.etag};
}
async function writeMaster(table,etag){
 const body=JSON.stringify({...withPublication(table),schema_version:1,updated_at:new Date().toISOString()});
 if(Buffer.byteLength(body)>MAX_MASTER_BYTES)throw Error('Master Table storage limit exceeded');
 const opts={access:'private',storeId:STORE_ID(),contentType:'application/json'};
 if(etag){opts.allowOverwrite=true;opts.ifMatch=etag;}
 try{return await put(MASTER_PATH,body,opts);}
 catch(e){
  if(/precondition|already exists|already been taken|conflict|409|412/i.test(String(e?.message||''))){
   const err=Error('Master Table was updated elsewhere; reload before saving');err.status=409;throw err;
  }
  throw e;
 }
}
async function sourceInventory(){
 const out=[],failures=[];
 for(const scope of ['public','private']){
  const storeId=scope==='public'?
   (process.env.PUBLIC_BLOB_STORE_ID||process.env.BLOB_STORE_ID||'store_6mg9Vu2ypJJMAwV3'):STORE_ID();
  try{
   let cursor;do{
    const r=await list({storeId,limit:1000,...(cursor?{cursor}:{})});
    for(const b of r.blobs){
     if(!permitted(b.pathname))continue;
     const path=b.pathname;
     out.push({id:scope+':'+path,access:scope,pathname:path,
      title:path.split('/').at(-1).replace(/\.(?:html?|pdf)$/i,'').replace(/[-_]+/g,' '),
      mime_type:/\.pdf$/i.test(path)?'application/pdf':'text/html',
      updated:b.uploadedAt||null,size:b.size});
    }cursor=r.hasMore?r.cursor:null;
   }while(cursor);
  }catch(e){failures.push(scope+' document inventory unavailable');}
 }
 return {documents:out,failures};
}
function reconcile(table,documents,successfulScopes){
 const existing=new Map(table.records.map(e=>[e.id,e])),seen=new Set(),added=[],changed=[],missing=[];
 for(const d of documents){seen.add(d.id);const prior=existing.get(d.id);
  if(!prior){const e=entryFromDoc(d);existing.set(d.id,e);added.push(d.id);continue;}
  const sig=sourceSignature(d);if(prior.source_signature!==sig)changed.push(d.id);
  existing.set(d.id,{...prior,source_available:true,source_changed:prior.source_changed||prior.source_signature!==sig,
   source_updated:d.updated||null,source_size:d.size??null,source_signature:sig,
   source_metadata_title:text(d.title||sourceTitle(d.pathname),220)});
 }
 for(const [id,e] of existing){if(!seen.has(id)&&successfulScopes.includes(e.access)){
   existing.set(id,{...e,source_available:false});missing.push(id);}}
 const records=[...existing.values()].sort((a,b)=>a.access.localeCompare(b.access)||a.title.localeCompare(b.title));
 return {table:{...table,records},added,changed,missing};
}
module.exports={MASTER_PATH,STORE_ID,MASTER_TABLE_FORMAT,TEXT_EXTRACTION,VISUAL_INSPECTION,DOCUMENT_STATUSES,
 masterEmpty,withPublication,stageTable,approveTable,discoveryRecords,reviewStatus,
 permitted,words,strings,sourceSignature,sourceTitle,withReviewFields,coverageState,
 entryFromDoc,normalizeEdit,bindRelatedSourceIds,inspectSourceLinks,descriptionHealth,readMaster,writeMaster,sourceInventory,reconcile};
