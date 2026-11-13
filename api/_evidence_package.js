'use strict';
// Read-only, deterministic evidence packaging. This is retrieval, not factual verification.
const {pdfSegments,htmlSegments,searchSegments,termsOf,MAX_DOCUMENTS}=require('./_content_search');
const {evaluateRetrieval,sha256}=require('./_quality_gate');
const {RequestInputError}=require('./_request_errors');
const MODES=Object.freeze({
 focused:{max_passages:6,per_source:3,max_characters:10000,context:300},
 comparative:{max_passages:10,per_source:4,max_characters:18000,context:400},
 comprehensive:{max_passages:16,per_source:6,max_characters:28000,context:550}
});
const TIME_BUDGET_MS=24000;
function validateMode(mode='focused'){
 if(typeof mode!=='string'||!Object.prototype.hasOwnProperty.call(MODES,mode))
  throw new RequestInputError('RETRIEVAL_MODE',`Mode must be one of: ${Object.keys(MODES).join(', ')}.`);
 return mode;
}
function validateRequest(args){
 if(!args||typeof args!=='object')throw new RequestInputError('ARGUMENTS_TYPE','Tool arguments must be a JSON object.');
 termsOf(args.query);
 const ids=args.ids;
 if(!Array.isArray(ids)||ids.length===0||ids.length>MAX_DOCUMENTS)
  throw new RequestInputError('SOURCE_ID_COUNT',`Supply an array of 1–${MAX_DOCUMENTS} source IDs.`);
 if(ids.some(id=>typeof id!=='string'))
  throw new RequestInputError('SOURCE_ID_TYPE','Each source ID must be a string.');
 if(new Set(ids).size!==ids.length)
  throw new RequestInputError('DUPLICATE_SOURCE_IDS','Supply distinct source IDs. Remove duplicate IDs and retry.');
 return {query:args.query,ids,mode:validateMode(args.mode)};
}
function orderMatches(a,b){
 return b.score-a.score||a.source_order-b.source_order||
  (a.page||0)-(b.page||0)||(a.section||0)-(b.section||0)||a.start-b.start;
}
function expand(match,segments,context){
 // Use the original segments, not a previously truncated search excerpt.
 const candidates=segments.filter(s=>s.page===match.page&&s.section===match.section&&
  s.end>=match.start&&s.start<=match.end);
 const base=candidates.find(s=>s.start<=match.start&&s.end>=match.end)||candidates[0];
 if(!base)return {passage:match.passage,start:match.start,end:match.end,context_complete:false,source_verified:false};
 const center=Math.max(0,match.start-base.start);
 const from=Math.max(0,center-context);
 const length=Math.min(base.text.length-from,900+context*2);
 const passage=base.text.slice(from,from+length);
 return {passage,start:base.start+from,end:base.start+from+passage.length,
  context_complete:from===0&&from+passage.length===base.text.length,
  source_verified:base.text.slice(from,from+passage.length)===passage&&base.start+from>=0};
}
function pick(ranked,config,budget){
 const selected=[],bySource=new Map(),ranges=new Map();
 for(const match of ranked){
  if(selected.length>=config.max_passages||budget<=0)break;
  const count=bySource.get(match.id)||0;
  if(count>=config.per_source)continue;
  const pos=match.page!==null?'p:'+match.page:'s:'+match.section;
  const key=match.id+'|'+pos;
  const already=ranges.get(key)||[];
  if(already.some(r=>Math.min(r.end,match.end)-Math.max(r.start,match.start)>Math.min(120,(match.end-match.start)*0.4)))continue;
  const text=match.passage.slice(0,budget);
  if(text.length<100&&match.passage.length>=100)break;
  selected.push({...match,passage:text,end:match.start+text.length,
    passage_truncated:match.passage.length>text.length||!match.context_complete});
  budget-=text.length;
  bySource.set(match.id,count+1);
  already.push({start:match.start,end:match.start+text.length});
  ranges.set(key,already);
 }
 return {passages:selected,remaining_character_budget:budget};
}
async function assembleEvidence(args,docs,openFile){
 const req=validateRequest(args),config=MODES[req.mode];
 if(!Array.isArray(docs)||docs.length!==req.ids.length||typeof openFile!=='function')
  throw Error('Authorized document list required');
 const sources=[],candidates=[],failures=[],deadline=Date.now()+TIME_BUDGET_MS;
 for(let i=0;i<docs.length;i++){
  const doc=docs[i];
  if(doc.id!==req.ids[i])throw Error('Document scope mismatch');
  if(Date.now()+1000>=deadline){
   failures.push({id:doc.id,reason:'Time budget exhausted before examination'});continue;
  }
  try{
   const file=await openFile(doc);
   if(!file||!file.stream)throw Error('Blob unavailable');
   const index=doc.mime_type==='application/pdf'?
    await pdfSegments(file,deadline-Date.now()):await htmlSegments(file);
   const coverage=index.coverage;
   const matches=searchSegments(index.segments,req.query,1000);
   sources.push({id:doc.id,title:doc.title,pathname:doc.pathname,
    access:doc.access,document_type:coverage.document_type,
    original_file_sha256:coverage.original_file_sha256,
    extraction_complete:coverage.extraction_complete,
    examined_pages:coverage.examined_pages??null,total_pages:coverage.total_pages??null,
    ocr_required_pages:coverage.ocr_required_pages||[],
    indexed_sections:coverage.indexed_sections??null,
    indexed_segments:coverage.indexed_segments,
    matching_segments:matches.total_matches,candidate_matches_capped:matches.results_truncated,
    limitations:coverage.limitations||[]});
   for(const m of matches.matches){
    const expanded=expand(m,index.segments,config.context);
    candidates.push({id:doc.id,title:doc.title,pathname:doc.pathname,
     access:doc.access,source_order:i,page:m.page,section:m.section,heading:m.heading,
     score:m.score,matched_terms:m.matched_terms,...expanded});
   }
  }catch(_e){
   failures.push({id:doc.id,reason:'Extraction or indexing failed within the supported limits'});
  }
 }
 candidates.sort(orderMatches);
 // Round one: establish fair representation of relevant sources before filling by score.
 const seed=[],remaining=[],seen=new Set();
 for(const m of candidates){
  if(!seen.has(m.id)){seed.push(m);seen.add(m.id)}else remaining.push(m);
 }
 const packaged=pick([...seed,...remaining],config,config.max_characters);
 const omitted=Math.max(0,candidates.length-packaged.passages.length);
 const candidateCapReached=sources.some(s=>s.candidate_matches_capped);
 const incomplete=failures.length>0||sources.some(s=>!s.extraction_complete);
 const limitations=[
  'Selection is lexical; relevant concepts expressed using other words may be missed.',
  'Only explicitly selected documents were examined. No verified-absence conclusion is possible.',
  'Extracted PDF text does not establish visual, diagram, image or table comprehension.'
 ];
 if(incomplete)limitations.push('One or more documents or pages could not be fully examined.');
 if(omitted)limitations.push('Additional matching passages were withheld by package limits.');
 if(candidateCapReached)limitations.push('Candidate match enumeration was capped within at least one source.');
 const sourceHashes=new Map(sources.map(s=>[s.id,s.original_file_sha256]));
 const result={
  schema_version:1,
  request:{query:req.query,mode:req.mode,requested_document_ids:req.ids},
  search_method:'deterministic_lexical_with_context',
  status:incomplete?'PARTIAL_EXTRACTION':candidates.length===0?'NO_LEXICAL_MATCH':'MATCHES_FOUND',
  inspected_source_count:sources.length,requested_source_count:docs.length,
  selected_scope_examined:failures.length===0,
  source_extraction_complete:!incomplete,
  source_coverage:sources,failures,
  passages:packaged.passages.map(({source_order,context_complete,...p},n)=>({...p,
   passage_id:'E'+String(n+1).padStart(3,'0'),context_complete,
   source_sha256:sourceHashes.get(p.id),
   passage_sha256:sha256(p.id+'|'+(p.page??'')+'|'+(p.section??'')+'|'+p.start+'|'+p.passage)})),
  matching_segments_found:candidates.length,
  passages_returned:packaged.passages.length,
  relevant_passages_omitted:omitted,
  package_truncated:omitted>0||candidateCapReached||packaged.passages.some(p=>p.passage_truncated),
  remaining_character_budget:packaged.remaining_character_budget,
  evidence_sufficiency:'NOT_ASSESSED',
  limitations
 };
 result.retrieval_quality=evaluateRetrieval(result);
 return result;
}
module.exports={assembleEvidence,validateRequest,validateMode,MODES,pick,expand};
