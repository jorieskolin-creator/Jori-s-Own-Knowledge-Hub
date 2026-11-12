'use strict';
const {list,get}=require('@vercel/blob');
const {Readable}=require('node:stream');
const {pdfText}=require('./_pdf');
const {htmlStructure}=require('./_structure');
const {searchFile,termsOf,MAX_RESULTS,MAX_DOCUMENTS}=require('./_content_search');
const {assembleEvidence,validateRequest,MODES}=require('./_evidence_package');
const {discover}=require('./_master_discovery');
const governed=require('./_governed_evidence');
const VERSION='2025-03-26';
const CATS={
 '01-solutions':'Solutions',
 '02-frameworks':'Frameworks & Methods',
 '03-general-presentations':'General Presentations',
 '04-shared-knowledge':'Shared Knowledge',
 '05-random':'Random',
 '06-personal':'Personal'
};
const SOLUTION_GROUPS={
 'solution-assurance-engine':'Solution Assurance Concept',
 'solution-assurance-documentation-support':'Solution Assurance Concept',
 'solution-assurance-concept':'Solution Assurance Concept'
};
const MAX_BYTES=6*1024*1024,MAX_TEXT=60000;
const storeId=()=>process.env.PUBLIC_BLOB_STORE_ID||process.env.BLOB_STORE_ID||'store_6mg9Vu2ypJJMAwV3';
function permitted(path){
 if(typeof path!=='string'||path.length>1024||!/\.(?:html?|pdf)$/i.test(path))return false;
 const p=path.split('/');
 return p.length>1&&p.every(x=>x&&x!=='.'&&x!=='..'&&!x.startsWith('.'))&&Object.prototype.hasOwnProperty.call(CATS,p[0]);
}
function metadata(b){
 const p=b.pathname.split('/'),subfolder=p.length>2?p.slice(1,-1).join('/'):null;
 return {id:'public:'+b.pathname,title:p.at(-1).replace(/\.(?:html?|pdf)$/i,'').replace(/[-_]+/g,' '),
   category:CATS[p[0]],subfolder,display_group:SOLUTION_GROUPS[p[1]]||subfolder||'General',
   access:'public',pathname:b.pathname,mime_type:/\.pdf$/i.test(b.pathname)?'application/pdf':'text/html',
   updated:b.uploadedAt||null,size:b.size,source_url:b.url};
}
async function entries(){
 let cursor,all=[];
 do{const r=await list({storeId:storeId(),limit:1000,...(cursor?{cursor}:{})});all.push(...r.blobs);cursor=r.hasMore?r.cursor:null}while(cursor);
 return all.filter(b=>permitted(b.pathname)).map(metadata);
}
function stripHtml(h){
 return h.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,' ')
 .replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li|\/tr)\b[^>]*>/gi,'\n').replace(/<[^>]+>/g,' ')
 .replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
 .replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/[ \t]+/g,' ').replace(/\n\s*\n\s*\n/g,'\n\n').trim();
}
async function getContent(doc,options={}){
 if(!permitted(doc.pathname)||doc.access!=='public')throw Error('Not permitted');
 const file=await get(doc.pathname,{access:'public',storeId:storeId()});
 if(!file||!file.stream)throw Error('Document not found');
 if(doc.mime_type==='application/pdf')return pdfText(file,options);
 if(file.size>MAX_BYTES)throw Error('Document exceeds maximum retrieval size');
 const chunks=[];let total=0;
 for await(const chunk of Readable.fromWeb(file.stream)){
  total+=chunk.length;
  if(total>MAX_BYTES)throw Error('Document exceeds maximum retrieval size');
  chunks.push(chunk);
 }
 const text=stripHtml(Buffer.concat(chunks).toString('utf8'));
 return {text:text.slice(0,MAX_TEXT),truncated:text.length>MAX_TEXT,extraction:'html-text'};
}

async function inspectStructure(doc){
 if(!permitted(doc.pathname)||doc.access!=='public')throw Error('Not permitted');
 const file=await get(doc.pathname,{access:'public',storeId:storeId()});
 if(!file||!file.stream)throw Error('Document not found');
 return doc.mime_type==='application/pdf'?pdfText(file,{structure_only:true}):htmlStructure(file);
}
async function searchContent(args){
 const query=String(args.query||'');
 termsOf(query);
 const ids=args.ids;
 if(!Array.isArray(ids)||ids.length<1||ids.length>MAX_DOCUMENTS||new Set(ids).size!==ids.length)
  return fail('Supply 1-4 distinct document IDs in ids; catalog-wide searching is not yet enabled');
 const limit=args.limit===undefined?10:args.limit;
 if(!Number.isSafeInteger(limit)||limit<1||limit>MAX_RESULTS)return fail('limit must be an integer from 1 to 20');
 if(!ids.every(id=>typeof id==='string'&&id.startsWith('public:')&&permitted(id.slice(7))))
  return fail('Only categorized public document IDs are permitted');
 const docs=await entries();
 const chosen=ids.map(id=>docs.find(d=>d.id===id));
 if(chosen.some(d=>!d))return fail('A requested document was not found within the authorized catalog');
 const matches=[],inspected=[],failures=[];
 const deadline=Date.now()+24000;
 for(const doc of chosen){
  if(Date.now()+1000>=deadline){failures.push({id:doc.id,reason:'Request processing time budget exhausted; document not examined'});continue;}
  try{
   const file=await get(doc.pathname,{access:'public',storeId:storeId()});
   if(!file||!file.stream)throw Error('Document unavailable');
   const index=await searchFile(file,doc.mime_type,query,MAX_RESULTS,deadline-Date.now());
   inspected.push({id:doc.id,pathname:doc.pathname,...index.coverage,matching_segments:index.total_matches,
     results_truncated:index.results_truncated});
   matches.push(...index.matches.map(m=>({id:doc.id,title:doc.title,pathname:doc.pathname,...m})));
  }catch(_error){
   failures.push({id:doc.id,reason:'Document could not be fully indexed within processing limits'});
  }
 }
 matches.sort((a,b)=>b.score-a.score||a.pathname.localeCompare(b.pathname)||(a.page||0)-(b.page||0)||a.start-b.start);
 const selected=matches.slice(0,limit);
 return result({query,search_scope:'explicit_document_ids',search_method:'deterministic_lexical',
  searched_documents:inspected.length,requested_documents:ids.length,documents:inspected,
  failures,matches:selected,returned_matches:selected.length,
  matches_truncated:matches.length>limit||inspected.some(x=>x.results_truncated),
  selected_scope_examined:failures.length===0,
  source_extraction_complete:failures.length===0&&inspected.every(x=>x.extraction_complete),
  result_set_complete:failures.length===0&&matches.length<=limit&&!inspected.some(x=>x.results_truncated),
  limitations:['Lexical matching does not establish semantic completeness or verified absence.',
  'Only explicitly selected documents were examined; diagrams and scanned pages may contain unseen information.']});
}
async function retrieveEvidence(args,governedMode=false){
 let request;
 try{request=validateRequest(args)}catch(e){return fail('Invalid evidence request: '+e.message)}
 if(!request.ids.every(id=>id.startsWith('public:')&&permitted(id.slice(7))))
  return fail('Only authorized public document identifiers are permitted');
 const catalog=await entries();
 const documents=request.ids.map(id=>catalog.find(d=>d.id===id));
 if(documents.some(d=>!d))return fail('A requested document was not found within the authorized catalog');
 const output=await assembleEvidence(request,documents,doc=>get(doc.pathname,{access:'public',storeId:storeId()}));
 return result(governedMode?governed.releasePackage(output):output);
}
async function verifyCoverage(args){
 const existing=await retrieveEvidence(args);
 if(existing.isError)return existing;
 const report=existing.structuredContent;
 return result({request:report.request,retrieval_quality:report.retrieval_quality,
  source_coverage:report.source_coverage,failures:report.failures,
  passages_returned:report.passages_returned,matching_segments_found:report.matching_segments_found,
  relevant_passages_omitted:report.relevant_passages_omitted,package_truncated:report.package_truncated,
  evidence_sufficiency:'NOT_ASSESSED',verified_absence:false});
}
async function discoverSources(args,governedMode=false){
 try{
  const query=String(args.query||'');termsOf(query);
  const limit=args.limit===undefined?12:args.limit;
  const docs=await entries();
  const report=await discover(query,'public',docs,limit);
  return result(governedMode?governed.sanitizedDiscovery(report):report);
 }catch(e){return fail('Discovery failed: '+(e.message==='Invalid discovery scope'?'Invalid scope':'Review Master Table configuration or request'))}
}
async function retrieveTopicEvidence(args,governedMode=false){
 try{
  const query=String(args.query||'');termsOf(query);
  const mode=args.mode===undefined?'focused':args.mode;
  if(!Object.prototype.hasOwnProperty.call(MODES,mode))return fail('Invalid evidence retrieval mode');
  const docs=await entries();
  const found=await discover(query,'public',docs,30);
  const ids=found.candidates.slice(0,4).map(x=>x.id);
  if(!ids.length){
   const empty={status:'NO_LEXICAL_CANDIDATES',discovery:found,evidence:null,
    retrieval_quality:'NOT_ASSESSED',verified_absence:false};
   return result(governedMode?governed.releaseTopic(empty):empty);
  }
  const selected=ids.map(id=>docs.find(d=>d.id===id));
  const evidence=await assembleEvidence({query,mode,ids},selected,
   doc=>get(doc.pathname,{access:'public',storeId:storeId()}));
  const unexamined=found.candidates_found-ids.length;
  const discovery_warning=unexamined>0||found.unindexed_count>0||found.stale_count>0;
  const report={status:'EVIDENCE_PACKAGE_CREATED',discovery:found,
   selected_ids:ids,additional_candidates_not_examined:unexamined,
   discovery_coverage_status:discovery_warning?'WARN':'CANDIDATES_EXAMINED',
   evidence,verified_absence:false};
  return result(governedMode?governed.releaseTopic(report):report);
 }catch(_e){return fail('Knowledge source discovery or evidence acquisition failed')}
}
function result(value){return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError:false}}
function fail(message){return {content:[{type:'text',text:String(message)}],isError:true}}
const TOOLS=[
 {name:'list_documents',description:'List public Knowledge Hub documents in the six explicit storage categories. Root files and protected documents are excluded.',inputSchema:{type:'object',properties:{category:{type:'string'},subfolder:{type:'string'},limit:{type:'integer',minimum:1,maximum:100}},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'search_documents',description:'Search public Knowledge Hub document titles, categories, paths, and display groups. Metadata search only; not full-text.',inputSchema:{type:'object',properties:{query:{type:'string'},limit:{type:'integer',minimum:1,maximum:50}},required:['query'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'get_document_metadata',description:'Fetch source metadata for a public Knowledge Hub document by its public:path identifier.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'get_document',description:'Read HTML text or PDF text with page numbers, extraction status and an optional PDF page_start/page_end (maximum 10 pages). Returns only Public Blob documents. No modifications.',inputSchema:{type:'object',properties:{id:{type:'string'},page_start:{type:'integer',minimum:1},page_end:{type:'integer',minimum:1}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:true}} ,{name:'get_document_structure',description:'Inspect the complete Public document on demand and report page/heading structure, extraction coverage, OCR gaps and processing limits without returning full source text.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:true}}
 ,{name:'search_content',description:'Search actual text within 1-4 explicitly selected public PDF/HTML documents. Examines all available PDF pages and HTML sections, returns ranked source-located passages and coverage/gap metadata. Deterministic and read-only; not a whole-library search.',inputSchema:{type:'object',properties:{query:{type:'string',minLength:2,maxLength:200},ids:{type:'array',items:{type:'string'},minItems:1,maxItems:4},limit:{type:'integer',minimum:1,maximum:20}},required:['query','ids'],additionalProperties:false},annotations:{readOnlyHint:true}}
 ,{name:'retrieve_evidence',description:'Assemble a bounded, source-referenced evidence package from 1–4 explicitly selected public HTML/PDF documents. Modes: focused, comparative, comprehensive. Selects lexical matches with context and source coverage diagnostics; cannot verify semantic completeness or factual absence. Read-only.',inputSchema:{type:'object',properties:{query:{type:'string',minLength:2,maxLength:200},ids:{type:'array',items:{type:'string'},minItems:1,maxItems:4},mode:{type:'string',enum:['focused','comparative','comprehensive']}},required:['query','ids'],additionalProperties:false},annotations:{readOnlyHint:true}}
 ,{name:'verify_coverage',description:'Recompute a bounded retrieval-integrity check for 1–4 explicitly selected public documents. Returns source inspection and deterministic quality gate without passage text. Does not verify semantic completeness, factual accuracy or absence. Read-only.',inputSchema:{type:'object',properties:{query:{type:'string',minLength:2,maxLength:200},ids:{type:'array',items:{type:'string'},minItems:1,maxItems:4},mode:{type:'string',enum:['focused','comparative','comprehensive']}},required:['query','ids'],additionalProperties:false},annotations:{readOnlyHint:true}}
 ,{name:'discover_sources',description:'Search the approved public Master Table summary, terms and themes (with metadata fallback) to find likely documents. Returns candidate IDs, ranking and discovery limitations. No factual absence conclusions.',inputSchema:{type:'object',properties:{query:{type:'string',minLength:2,maxLength:200},limit:{type:'integer',minimum:1,maximum:30}},required:['query'],additionalProperties:false},annotations:{readOnlyHint:true}}
 ,{name:'retrieve_topic_evidence',description:'Discover relevant public documents from Master Table and automatically acquire a bounded source evidence package from up to 4 best-ranked candidates. Reports candidates not examined; never claims complete domain coverage.',inputSchema:{type:'object',properties:{query:{type:'string',minLength:2,maxLength:200},mode:{type:'string',enum:['focused','comparative','comprehensive']}},required:['query'],additionalProperties:false},annotations:{readOnlyHint:true}}

];
async function callTool(name,args,governedMode=false){
 if(governedMode&&!governed.allowed(name))return fail('Operation not available in governed evidence-only mode');
 if(name==='list_documents'){
  const docs=await entries(),limit=Math.min(100,Math.max(1,Number(args.limit)||100));
  const subset=docs.filter(d=>(!args.category||d.category===args.category||d.pathname.startsWith(args.category+'/'))&&(!args.subfolder||d.subfolder===args.subfolder));
  return result({documents:governedMode?subset.slice(0,limit).map(governed.catalogEntry):subset.slice(0,limit),total:subset.length,truncated:subset.length>limit});
 }
 if(name==='search_documents'){
  const q=String(args.query||'').trim().toLowerCase();if(!q||q.length>200)return fail('Search query must contain 1–200 characters');
  const docs=await entries();const found=docs.filter(d=>[d.title,d.category,d.pathname,d.display_group].join(' ').toLowerCase().includes(q));
  const limit=Math.min(50,Math.max(1,Number(args.limit)||20));
  return result({documents:governedMode?found.slice(0,limit).map(governed.catalogEntry):found.slice(0,limit),total:found.length,search_scope:'metadata',truncated:found.length>limit});
 }
 if(name==='search_content')return searchContent(args);
 if(name==='retrieve_evidence')return retrieveEvidence(args,governedMode);
 if(name==='verify_coverage')return verifyCoverage(args);
 if(name==='discover_sources')return discoverSources(args,governedMode);
 if(name==='retrieve_topic_evidence')return retrieveTopicEvidence(args,governedMode);
 if(name==='get_document'||name==='get_document_metadata'||name==='get_document_structure'){
  const id=String(args.id||'');if(!id.startsWith('public:')||!permitted(id.slice(7)))return fail('Only categorized public document identifiers are allowed');
  const docs=await entries();const doc=docs.find(d=>d.id===id);
  if(!doc)return fail('Document not found in public catalog');
  if(name==='get_document_metadata')return result(governedMode?governed.catalogEntry(doc):doc);
  if(name==='get_document_structure')return result({...doc,...await inspectStructure(doc)});
  const body=await getContent(doc,args);return result({...doc,...body});
 }
 return fail('Unknown tool');
}
function send(res,status,data){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(data))}
function rpc(id,payload){return {jsonrpc:'2.0',id,...payload}}
module.exports=async function(req,res,options={}){
 const governedMode=options.governedEvidenceOnly===true;
 res.setHeader('Access-Control-Allow-Origin','*');
 res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
 res.setHeader('Access-Control-Allow-Headers','content-type, mcp-protocol-version, mcp-session-id, authorization');
 if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}
 if(req.method!=='POST')return send(res,405,{error:'MCP requests must use POST'});
 const size=Number(req.headers['content-length']||0);
 if(size>65536)return send(res,413,{error:'Request too large'});
 const data=typeof req.body==='object'?req.body:(()=>{try{return JSON.parse(req.body||'{}')}catch{return {}}})();
 if(!data||Array.isArray(data)||typeof data!=='object')return send(res,400,{error:'Invalid JSON-RPC request'});
 if(data.method==='notifications/initialized'){res.statusCode=202;return res.end()}
 if(data.jsonrpc!=='2.0'||!Object.prototype.hasOwnProperty.call(data,'id'))return send(res,400,{error:'Invalid JSON-RPC envelope'});
 try{
  if(data.method==='initialize')return send(res,200,rpc(data.id,{result:{protocolVersion:VERSION,capabilities:{tools:{listChanged:false}},serverInfo:{name:'jori-knowledge-hub-public',version:'0.1.0'}}}));
  if(data.method==='ping')return send(res,200,rpc(data.id,{result:{}}));
  if(data.method==='tools/list')return send(res,200,rpc(data.id,{result:{tools:governedMode?governed.advertised(TOOLS):TOOLS}}));
  if(data.method==='tools/call'){
   if(!data.params||typeof data.params.name!=='string')return send(res,200,rpc(data.id,{error:{code:-32602,message:'Invalid params'}}));
   const output=await callTool(data.params.name,data.params.arguments||{},governedMode);
   return send(res,200,rpc(data.id,{result:output}));
  }
  return send(res,200,rpc(data.id,{error:{code:-32601,message:'Method not found'}}));
 }catch(e){
  // Do not leak storage credentials, Blob internals or stack traces.
  return send(res,200,rpc(data.id,{result:fail('Knowledge Hub retrieval failed. Check storage configuration or document availability.')}));
 }
};
