'use strict';
// Governed unified Public + Private evidence service. All retrieval is deterministic,
// scoped to current inventory and independently gated before returned text is released.
const {list,get}=require('@vercel/blob');
const {termsOf}=require('./_content_search');
const {validateRequest,assembleEvidence,MODES}=require('./_evidence_package');
const {discover}=require('./_master_discovery');
const {readMaster}=require('./_master_table');
const governed=require('./_governed_evidence');

const CATS={
 '01-solutions':'Solutions','02-frameworks':'Frameworks & Methods',
 '03-general-presentations':'General Presentations','04-shared-knowledge':'Shared Knowledge',
 '05-random':'Random','06-personal':'Personal'
};
const GROUPS={
 'solution-assurance-engine':'Solution Assurance Concept',
 'solution-assurance-documentation-support':'Solution Assurance Concept',
 'solution-assurance-concept':'Solution Assurance Concept'
};
const SCOPES=['public','private'];
const stores={
 public:()=>process.env.PUBLIC_BLOB_STORE_ID||process.env.BLOB_STORE_ID||'store_6mg9Vu2ypJJMAwV3',
 private:()=>process.env.PRIVATE_BLOB_STORE_ID||'store_YAAwH6FewcrImhA1'
};
function permitted(path){
 if(typeof path!=='string'||path.length>1024||!/\.(?:html?|pdf)$/i.test(path))return false;
 const parts=path.split('/');
 return parts.length>1&&parts.every(p=>p&&p!=='.'&&p!=='..'&&!p.startsWith('.'))&&
  Object.prototype.hasOwnProperty.call(CATS,parts[0]);
}
function metadata(blob,scope){
 const parts=blob.pathname.split('/'),subfolder=parts.length>2?parts.slice(1,-1).join('/'):null;
 return {id:scope+':'+blob.pathname,access:scope,pathname:blob.pathname,
  title:parts.at(-1).replace(/\.(?:html?|pdf)$/i,'').replace(/[-_]+/g,' '),
  category:CATS[parts[0]],subfolder,display_group:GROUPS[parts[1]]||subfolder||'General',
  mime_type:/\.pdf$/i.test(blob.pathname)?'application/pdf':'text/html',
  updated:blob.uploadedAt||null,size:blob.size};
}
function createService(deps={}){
 const inventoryCall=deps.list||list;
 const sourceCall=deps.get||get;
 const masterCall=deps.readMaster||readMaster;
 const discoverCall=deps.discover||discover;
 const assembleCall=deps.assembleEvidence||assembleEvidence;

 async function enumerate(scope){
  if(!SCOPES.includes(scope))throw Error('Invalid source scope');
  let cursor,all=[],rounds=0;
  do{
   if(++rounds>100)throw Error('Document inventory pagination limit');
   const r=await inventoryCall({storeId:stores[scope](),limit:1000,...(cursor?{cursor}:{})});
   if(!r||!Array.isArray(r.blobs))throw Error('Document inventory unavailable');
   all.push(...r.blobs.filter(b=>permitted(b.pathname)).map(b=>metadata(b,scope)));
   cursor=r.hasMore?r.cursor:null;
   if(r.hasMore&&!cursor)throw Error('Document inventory cursor unavailable');
  }while(cursor);
  return all;
 }
 async function catalog(){
  // Both inventories are mandatory: never silently claim unified coverage from one store.
  const [pub,priv]=await Promise.all([enumerate('public'),enumerate('private')]);
  const docs=[...pub,...priv],unique=new Map(docs.map(d=>[d.id,d]));
  if(unique.size!==docs.length)throw Error('Duplicate source identifiers in catalog');
  return docs;
 }
 async function open(doc){
  if(!doc||!SCOPES.includes(doc.access)||doc.id!==doc.access+':'+doc.pathname||!permitted(doc.pathname))
   throw Error('Invalid source authorization');
  return sourceCall(doc.pathname,{access:doc.access,storeId:stores[doc.access]()});
 }
 function scopedDocuments(ids,docs){
  const indexed=new Map(docs.map(d=>[d.id,d]));
  if(ids.some(id=>typeof id!=='string'||!(/^(?:public|private):/).test(id)||
     !permitted(id.slice(id.indexOf(':')+1))))throw Error('Invalid source ID or path');
  const selected=ids.map(id=>indexed.get(id));
  if(selected.some(d=>!d))throw Error('Source ID outside current authorized catalog');
  return selected;
 }
 async function locate(query,docs,limit=12){
  termsOf(query);
  if(!Number.isInteger(limit)||limit<1||limit>30)throw Error('Invalid candidate limit');
  const raw=await masterCall();
  const records=raw?.table?.records||raw?.records;
  if(!Array.isArray(records))throw Error('Master Table inventory unavailable');
  const [pub,priv]=await Promise.all(SCOPES.map(scope=>
   discoverCall(query,scope,docs.filter(d=>d.access===scope),30,records)));
  const candidates=[...pub.candidates,...priv.candidates].sort((a,b)=>
    b.score-a.score||a.id.localeCompare(b.id));
  const available=candidates.length,returned=candidates.slice(0,limit);
  const missing=pub.unindexed_count+priv.unindexed_count;
  const stale=pub.stale_count+priv.stale_count;
  return governed.sanitizedDiscovery({
   query,scope:'public+private',discovery_method:'master_table_with_metadata_fallback',
   discovery_complete:false,inventory_documents:docs.length,
   candidates_found:available,candidates_returned:returned.length,candidates_truncated:available>limit,
   public_candidates:pub.candidates_found,private_candidates:priv.candidates_found,
   unindexed_count:missing,stale_count:stale,
   candidates:returned,
   limitations:[...new Set([...pub.limitations,...priv.limitations,
    'Both source collections were examined for discovery. Relevance ranking is lexical and semantic recall is not verified.'])]
  });
 }
 async function retrieve(args){
  const request=validateRequest(args),docs=await catalog();
  const selected=scopedDocuments(request.ids,docs);
  return governed.releasePackage(await assembleCall(request,selected,open));
 }
 async function verify(args){
  const request=validateRequest(args),docs=await catalog();
  const selected=scopedDocuments(request.ids,docs);
  const p=await assembleCall(request,selected,open);
  const release=governed.releasePackage(p);
  // Never forward supporting passages or direct source bodies in coverage reports.
  return {governed_mode:'EVIDENCE_ONLY',delivery_status:release.delivery_status,
   retrieval_quality:release.retrieval_quality,evidence_contract_version:1,
   requested_source_count:p.requested_source_count,inspected_source_count:p.inspected_source_count,
   source_coverage:p.source_coverage,failures:p.failures,passages_returned:p.passages_returned,
   matching_segments_found:p.matching_segments_found,relevant_passages_omitted:p.relevant_passages_omitted,
   package_truncated:p.package_truncated,verified_absence:false,evidence_sufficiency:'NOT_ASSESSED',
   limitations:release.limitations};
 }
 async function topic(args){
  termsOf(args?.query);
  const mode=args.mode??'focused';
  if(!Object.prototype.hasOwnProperty.call(MODES,mode))throw Error('Invalid retrieval mode');
  const docs=await catalog();
  const found=await locate(args.query,docs,30);
  const ids=found.candidates.slice(0,4).map(d=>d.id);
  if(!ids.length)return governed.releaseTopic({status:'NO_LEXICAL_CANDIDATES',discovery:found,evidence:null});
  const selected=scopedDocuments(ids,docs);
  const evidence=await assembleCall({query:args.query,mode,ids},selected,open);
  const omitted=found.candidates_found-ids.length;
  return governed.releaseTopic({status:'EVIDENCE_PACKAGE_CREATED',
   discovery:found,selected_ids:ids,additional_candidates_not_examined:omitted,
   discovery_coverage_status:omitted||found.unindexed_count||found.stale_count?'WARN':'CANDIDATES_EXAMINED',
   evidence,verified_absence:false});
 }
 async function execute(name,args={}){
  if(!governed.allowed(name))throw Error('Operation not available in governed evidence-only mode');
  if(name==='retrieve_evidence')return retrieve(args);
  if(name==='retrieve_topic_evidence')return topic(args);
  if(name==='verify_coverage')return verify(args);
  if(name==='discover_sources'){
   const query=args.query,limit=args.limit===undefined?12:args.limit;
   return locate(query,await catalog(),limit);
  }
  const docs=await catalog();
  if(name==='list_documents'){
   const limit=args.limit===undefined?100:args.limit;
   if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid catalog limit');
   const filtered=docs.filter(d=>(!args.category||d.category===args.category||
    d.pathname.startsWith(args.category+'/'))&&(!args.subfolder||d.subfolder===args.subfolder));
   return {documents:filtered.slice(0,limit).map(governed.catalogEntry),
    total:filtered.length,public_count:filtered.filter(d=>d.access==='public').length,
    private_count:filtered.filter(d=>d.access==='private').length,truncated:filtered.length>limit};
  }
  if(name==='search_documents'){
   const query=String(args.query||'').trim().toLowerCase();
   if(!query||query.length>200)throw Error('Invalid metadata query');
   const limit=args.limit===undefined?20:args.limit;
   if(!Number.isInteger(limit)||limit<1||limit>50)throw Error('Invalid search limit');
   const hits=docs.filter(d=>[d.title,d.category,d.pathname,d.display_group].join(' ').toLowerCase().includes(query));
   return {documents:hits.slice(0,limit).map(governed.catalogEntry),
    total:hits.length,search_scope:'public+private_metadata',truncated:hits.length>limit};
  }
  if(name==='get_document_metadata'){
   const result=scopedDocuments([args.id],docs)[0];
   return governed.catalogEntry(result);
  }
  throw Error('Unknown operation');
 }
 return {execute,catalog,locate,retrieve,topic,verify,open,scopedDocuments};
}
module.exports={createService,permitted,metadata,CATS,SCOPES};
