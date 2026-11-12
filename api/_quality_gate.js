'use strict';
// Deterministic retrieval-integrity gate. PASS never asserts factual correctness or semantic completeness.
const {createHash}=require('node:crypto');
const POLICY_VERSION='retrieval-integrity-v2';
const sha256=s=>createHash('sha256').update(s,'utf8').digest('hex');
function citationValid(p,sources){
 const source=sources.find(s=>s.id===p.id);
 if(!source||source.pathname!==p.pathname||source.access!==p.access)return false;
 if(typeof p.passage!=='string'||!p.passage.length||!Number.isSafeInteger(p.start)||
    !Number.isSafeInteger(p.end)||p.start<0||p.end-p.start!==p.passage.length)return false;
 if(typeof p.source_verified!=='boolean'||p.source_verified!==true)return false;
 if(!/^[a-f0-9]{64}$/.test(source.original_file_sha256||'')||p.source_sha256!==source.original_file_sha256)return false;
 if(!p.passage_sha256||p.passage_sha256!==sha256(p.id+'|'+(p.page??'')+'|'+(p.section??'')+'|'+p.start+'|'+p.passage))return false;
 if(source.document_type==='pdf')
  return Number.isInteger(p.page)&&p.page>=1&&p.page<=source.total_pages&&
    (p.section===null||p.section===undefined)&&!source.ocr_required_pages.includes(p.page);
 if(source.document_type==='html')
  return Number.isSafeInteger(p.section)&&p.section>=0&&p.page===null;
 return false;
}
function evaluateRetrieval(packageData){
 const reasons=[],warnings=[];
 const sources=Array.isArray(packageData.source_coverage)?packageData.source_coverage:[];
 const passages=Array.isArray(packageData.passages)?packageData.passages:[];
 const requested=packageData.request?.requested_document_ids||[];
 const failures=packageData.failures||[];
 if(!Array.isArray(requested)||requested.length<1||requested.length>4)
  reasons.push('INVALID_REQUEST_SCOPE');
 if(!Array.isArray(failures)||!Array.isArray(packageData.source_coverage)||!Array.isArray(packageData.passages))
  reasons.push('INVALID_PACKAGE_STRUCTURE');
 if(requested.length!==packageData.requested_source_count||
    sources.length!==packageData.inspected_source_count||
    sources.length+failures.length!==requested.length)
  reasons.push('SOURCE_COUNT_MISMATCH');
 if(new Set(sources.map(s=>s.id)).size!==sources.length||
    sources.some(s=>!requested.includes(s.id))||failures.some(f=>!requested.includes(f.id)))
  reasons.push('SOURCE_SCOPE_MISMATCH');
 if(sources.some(s=>!/^[a-f0-9]{64}$/.test(s.original_file_sha256||'')))reasons.push('INVALID_ORIGINAL_SOURCE_HASH');
 if(passages.some(p=>!citationValid(p,sources)))reasons.push('INVALID_PASSAGE_PROVENANCE');
 if(passages.length!==packageData.passages_returned)reasons.push('PASSAGE_COUNT_MISMATCH');
 const invalidCoverage=sources.some(s=>{
  if(s.document_type==='pdf')return !Number.isInteger(s.total_pages)||s.total_pages<1||
   !Number.isInteger(s.examined_pages)||s.examined_pages<0||s.examined_pages>s.total_pages||
   !Array.isArray(s.ocr_required_pages)||s.ocr_required_pages.some(n=>!Number.isInteger(n)||n<1||n>s.total_pages);
  return s.document_type!=='html'||!Number.isInteger(s.indexed_sections)||s.indexed_sections<0;
 });
 if(invalidCoverage)reasons.push('INVALID_EXTRACTION_MANIFEST');
 if(sources.length!==requested.length||failures.length)reasons.push('UNEXAMINED_SOURCE');
 if(sources.some(s=>!s.extraction_complete||s.ocr_required_pages.length))warnings.push('PARTIAL_TEXT_EXTRACTION');
 if(packageData.package_truncated||packageData.relevant_passages_omitted>0||
    sources.some(s=>s.candidate_matches_capped))warnings.push('BOUNDED_RESULTS');
 if(!passages.length)warnings.push('NO_SUPPORTING_LEXICAL_PASSAGES');
 if(passages.some(p=>p.passage_truncated||!p.context_complete))warnings.push('PARTIAL_PASSAGE_CONTEXT');
 // All selected source content may be examined and yet semantic relevance remains unproven.
 warnings.push('SEMANTIC_COMPLETENESS_NOT_VERIFIED');
 const decision=reasons.length?'BLOCK':warnings.some(x=>x!=='SEMANTIC_COMPLETENESS_NOT_VERIFIED')?'WARN':'PASS';
 return {policy_version:POLICY_VERSION,status:decision,
  gates:{
   source_scope:reasons.some(x=>x.includes('SCOPE')||x.includes('COUNT')||x==='UNEXAMINED_SOURCE')?'FAIL':'PASS',
   extraction:sources.some(s=>!s.extraction_complete)?'PARTIAL':reasons.length?'FAIL':'PASS',
   passage_provenance:reasons.includes('INVALID_PASSAGE_PROVENANCE')?'FAIL':'PASS',
   original_source_hash:reasons.includes('INVALID_ORIGINAL_SOURCE_HASH')?'FAIL':'PASS',
   bounded_output:packageData.package_truncated?'WARN':'PASS',
   relevance_completeness:'NOT_VERIFIED'
  },
  blocking_reasons:[...new Set(reasons)],warnings:[...new Set(warnings)],
  authority:'retrieval_integrity_only',
  evidence_sufficiency:'NOT_ASSESSED',
  verified_absence:false,
  notes:'PASS means only that the selected sources were processed and returned passages passed structural integrity checks; it is not a domain assessment, legal assurance, semantic recall guarantee, or verification of absent evidence. The source SHA-256 covers original document bytes; the passage SHA-256 covers the selected locator and text.'};
}
module.exports={evaluateRetrieval,citationValid,sha256,POLICY_VERSION};
