'use strict';
// Shared release control for both Public and Private governed evidence MCP endpoints.
// No direct text-reading capability is exposed in this mode.
const {evaluateRetrieval,POLICY_VERSION}=require('./_quality_gate');
const POLICY='governed-evidence-delivery-v1';
const ALLOWED=new Set([
 'list_documents','search_documents','get_document_metadata',
 'discover_sources','retrieve_evidence','retrieve_topic_evidence','verify_coverage'
]);
function allowed(name){return typeof name==='string'&&ALLOWED.has(name);}
function advertised(tools){return tools.filter(t=>allowed(t.name)).map(t=>({
 ...t,description:t.description+' Governed mode: discovery metadata is not answer evidence. Cite only retrieved evidence-package passages.'
}));}
// Governed discovery returns catalog identifiers, not directly fetchable Blob URLs.
function catalogEntry(doc){
 if(!doc||typeof doc!=='object')return null;
 const {id,title,category,subfolder,display_group,access,pathname,mime_type,updated,size}=doc;
 return {id,title,category,subfolder,display_group,access,pathname,mime_type,updated,size};
}
function sanitizedDiscovery(report){
 if(!report||typeof report!=='object')return report;
 return {...report,candidates:Array.isArray(report.candidates)?
  report.candidates.map(({review_notes,...metadata})=>metadata):[]};
}
function releasePackage(pack){
 const q=pack&&typeof pack==='object'?evaluateRetrieval(pack):null;
 const compatible=pack?.schema_version===1&&pack?.retrieval_quality?.policy_version===POLICY_VERSION&&
  pack?.evidence_sufficiency==='NOT_ASSESSED'&&
  !pack?.verified_absence&&
  Array.isArray(pack?.passages)&&Array.isArray(pack?.source_coverage)&&
  Array.isArray(pack?.limitations)&&pack?.request?.requested_document_ids?.length>=1;
 const checked=q&&pack.retrieval_quality.status===q.status&&
   JSON.stringify(pack.retrieval_quality.blocking_reasons)===JSON.stringify(q.blocking_reasons)&&
   JSON.stringify(pack.retrieval_quality.warnings)===JSON.stringify(q.warnings);
 const invalid=!compatible||!checked||q?.status==='BLOCK';
 const empty=!invalid&&(!Array.isArray(pack.passages)||pack.passages.length===0);
 const delivery_status=invalid?'BLOCKED':empty?'NO_SUPPORTING_EVIDENCE':
  q.status==='WARN'?'RELEASED_WITH_WARNINGS':'RELEASED';
 return {
  governed_mode:'EVIDENCE_ONLY',delivery_policy:POLICY,delivery_status,
  source_text_access:'EVIDENCE_PACKAGES_ONLY',
  evidence_contract_version:1,retrieval_quality:q,
  evidence:invalid||empty?null:{...pack,retrieval_quality:q},
  limitations:[
   'Only passages inside a released Evidence Package may support a factual answer. Catalog metadata is discovery context only.',
   'PASS and WARN concern retrieval integrity, not factual truth, semantic completeness or evidence sufficiency.',
   ...(empty?['No supporting passages were released. Do not infer verified absence.']:[]),
   ...(invalid?['The package failed deterministic release control; all passage text is withheld.']:[])
  ]
 };
}
function releaseTopic(report){
 if(!report||report.status==='NO_LEXICAL_CANDIDATES'||!report.evidence)
  return {governed_mode:'EVIDENCE_ONLY',delivery_policy:POLICY,
   delivery_status:'NO_SOURCE_CANDIDATES',source_text_access:'EVIDENCE_PACKAGES_ONLY',
   discovery:sanitizedDiscovery(report?.discovery),evidence:null,verified_absence:false,
   limitations:['No source candidates were found. This is not evidence of absence. Specify document IDs or improve source metadata.']};
 const released=releasePackage(report.evidence);
 return {
  ...released,discovery:sanitizedDiscovery(report.discovery),selected_ids:report.selected_ids,
  additional_candidates_not_examined:report.additional_candidates_not_examined,
  discovery_coverage_status:report.discovery_coverage_status,
  verified_absence:false
 };
}
module.exports={POLICY,allowed,advertised,catalogEntry,sanitizedDiscovery,releasePackage,releaseTopic};
