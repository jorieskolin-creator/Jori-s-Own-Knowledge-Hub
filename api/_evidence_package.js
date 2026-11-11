'use strict';
// Read-only, deterministic evidence packaging. This is retrieval, not factual verification.
const {pdfSegments,htmlSegments,searchSegments,termsOf,MAX_DOCUMENTS}=require('./_content_search');
const MODES=Object.freeze({
 focused:{max_passages:6,per_source:3,max_characters:10000,context:300},
 comparative:{max_passages:10,per_source:4,max_characters:18000,context:400},
 comprehensive:{max_passages:16,per_source:6,max_characters:28000,context:550}
});
const TIME_BUDGET_MS=24000;
function validateRequest(args){
 if(!args||typeof args!=='object')throw Error('Invalid request');
 termsOf(args.query);
 const ids=args.ids;
 if(!Array.isArray(ids)||ids.length===0||ids.length>MAX_DOCUMENTS||new Set(ids).size!==ids.length||
    ids.some(x=>typeof x!=='string'))throw Error('Specify 1-4 distinct document identifiers');
 const mode=args.mode===undefined?'focused':args.mode;
 if(!Object.prototype.hasOwnProperty.call(MODES,mode))throw Error('Invalid retrieval mode');
 return {query:args.query,ids,mode};
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
 if(!base)return {passage:match.passage,start:match.start,end:match.end,context_complete:false};
 const center=Math.max(0,match.start-base.start);
 const from=Math.max(0,center-context);
 const length=Math.min(base.text.length-from,900+context*2);
 const passage=base.text.slice(from,from+length);
 return {passage,start:base.start+from,end:base.start+from+passage.length,
  context_complete:from===0&&from+passage.length===base.text.length};
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
  if(already.some(r=>Math.min(r.end,match.end)-Math.max(r.start,match.start)>100))continue;
  const text=match.passage.slice(0,budget);
  if(text.length<100&&match.passage.length>=100)break;
  selected.push({...match,passage:text,passage_truncated:match.passage.length>text.length||!match.context_complete});
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
    extraction_complete:coverage.extraction_complete,
    examined_pages:coverage.examined_pages??null,total_pages:coverage.total_pages??null,
    ocr_required_pages:coverage.ocr_required_pages||[],
    indexed_sections:coverage.indexed_sections??null,
    indexed_segments:coverage.indexed_segments,
    matching_segments:matches.total_matches,limitations:coverage.limitations||[]});
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
 const incomplete=failures.length>0||sources.some(s=>!s.extraction_complete);
 const limitations=[
  'Selection is lexical; relevant concepts expressed using other words may be missed.',
  'Only explicitly selected documents were examined. No verified-absence conclusion is possible.',
  'Extracted PDF text does not establish visual, diagram, image or table comprehension.'
 ];
 if(incomplete)limitations.push('One or more documents or pages could not be fully examined.');
 if(omitted)limitations.push('Additional matching passages were withheld by package limits.');
 return {
  request:{query:req.query,mode:req.mode,requested_document_ids:req.ids},
  search_method:'deterministic_lexical_with_context',
  status:incomplete?'PARTIAL_EXTRACTION':candidates.length===0?'NO_LEXICAL_MATCH':'MATCHES_FOUND',
  inspected_source_count:sources.length,requested_source_count:docs.length,
  selected_scope_examined:failures.length===0,
  source_extraction_complete:!incomplete,
  source_coverage:sources,failures,
  passages:packaged.passages.map(({source_order,context_complete,...p},n)=>({...p,
   passage_id:'E'+String(n+1).padStart(3,'0'),context_complete})),
  matching_segments_found:candidates.length,
  passages_returned:packaged.passages.length,
  relevant_passages_omitted:omitted,
  package_truncated:omitted>0||packaged.passages.some(p=>p.passage_truncated),
  remaining_character_budget:packaged.remaining_character_budget,
  evidence_sufficiency:'NOT_ASSESSED',
  limitations
 };
}
module.exports={assembleEvidence,validateRequest,MODES,pick,expand};
