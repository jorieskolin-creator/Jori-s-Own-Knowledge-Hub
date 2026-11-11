'use strict';
// Master Table schema and persistence. The catalog is administrative metadata, NEVER source evidence.
// Private Blob holds both public and private descriptions; no record is put into Public Blob.
const {get,put,head,list}=require('@vercel/blob');
const crypto=require('node:crypto');
const {Readable}=require('node:stream');
const STORE_ID=()=>process.env.PRIVATE_BLOB_STORE_ID||'store_YAAwH6FewcrImhA1';
const MASTER_PATH='_knowledge-system/master-table-v1.json';
const MAX_MASTER_BYTES=3*1024*1024;
const CATS=new Set(['01-solutions','02-frameworks','03-general-presentations','04-shared-knowledge','05-random','06-personal']);
function masterEmpty(){return {schema_version:1,updated_at:null,records:[]};}
function permitted(path){return typeof path==='string'&&path.length<=1024&&
 /\.(?:html?|pdf)$/i.test(path)&&path.split('/').length>1&&
 path.split('/').every(s=>s&&s!=='.'&&s!=='..'&&!s.startsWith('.'))&&CATS.has(path.split('/')[0]);}
function words(s){return (String(s||'').trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)||[]).length;}
function text(s,max=300){return String(s??'').trim().replace(/\s+/g,' ').slice(0,max);}
function strings(input,max=30){
 if(!Array.isArray(input))throw Error('Expected a list of terms or themes');
 const found=[],seen=new Set();
 for(const item of input){if(typeof item!=='string')throw Error('Invalid list entry');
  const val=text(item,100);if(val&&!seen.has(val.toLowerCase())){found.push(val);seen.add(val.toLowerCase());}}
 if(found.length>max)throw Error('Too many list entries');return found;
}
function sourceSignature(d){return crypto.createHash('sha256').update([d.id,d.updated||'',d.size||0].join('|')).digest('hex');}
function entryFromDoc(d){
 const path=d.pathname,part=path.split('/');
 return {id:d.id,access:d.access,pathname:path,
  title:text(d.title||part.at(-1).replace(/\.(?:html?|pdf)$/i,''),220),
  category:part[0],folder:part.slice(1,-1).join('/'),mime_type:d.mime_type||(/\.pdf$/i.test(path)?'application/pdf':'text/html'),
  source_updated:d.updated||null,source_size:d.size??null,source_signature:sourceSignature(d),
  source_available:true,source_changed:false,
  summary:'',key_terms:[],themes:[],document_type:'',important_sections:[],related_documents:[],
  extraction_status:'NOT_INSPECTED',enrichment:'NONE',last_saved:null};
}
function normalizeEdit(entry,changes){
 if(!changes||typeof changes!=='object'||Array.isArray(changes))throw Error('Invalid changes');
 const out={...entry};
 if('title'in changes)out.title=text(changes.title,220);
 if('summary'in changes){if(typeof changes.summary!=='string'||changes.summary.length>2400)throw Error('Summary must be text up to 2400 characters');out.summary=changes.summary.trim();}
 if('key_terms'in changes)out.key_terms=strings(changes.key_terms,40);
 if('themes'in changes)out.themes=strings(changes.themes,20);
 if('document_type'in changes)out.document_type=text(changes.document_type,100);
 if('important_sections'in changes)out.important_sections=strings(changes.important_sections,60);
 if('related_documents'in changes)out.related_documents=strings(changes.related_documents,30);
 if('extraction_status'in changes&&['COMPLETE','PARTIAL','NOT_INSPECTED','FAILED','MANUAL'].includes(changes.extraction_status))
  out.extraction_status=changes.extraction_status;
 out.last_saved=new Date().toISOString();
 if(entry.access==='private')out.enrichment='MANUAL';
 else if(changes.enrichment==='AI')out.enrichment='AI'; else out.enrichment='MANUAL';
 if(entry.source_changed)out.source_changed=false; // Admin saves after reviewing current source.
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
 return {table,etag:info.etag};
}
async function writeMaster(table,etag){
 const body=JSON.stringify({...table,schema_version:1,updated_at:new Date().toISOString()});
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
   source_updated:d.updated||null,source_size:d.size??null,source_signature:sig});
 }
 for(const [id,e] of existing){if(!seen.has(id)&&successfulScopes.includes(e.access)){
   existing.set(id,{...e,source_available:false});missing.push(id);}}
 const records=[...existing.values()].sort((a,b)=>a.access.localeCompare(b.access)||a.title.localeCompare(b.title));
 return {table:{...table,records},added,changed,missing};
}
module.exports={MASTER_PATH,STORE_ID,masterEmpty,permitted,words,strings,sourceSignature,
 entryFromDoc,normalizeEdit,descriptionHealth,readMaster,writeMaster,sourceInventory,reconcile};
