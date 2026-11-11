'use strict';
// Master Table discovery is a hint layer, never a substitute for source evidence.
const {readMaster,sourceSignature}=require('./_master_table');
const {termsOf}=require('./_content_search');
function relevance(query,entry){
 const q=query.toLocaleLowerCase('en').trim(),terms=termsOf(query);
 const title=String(entry.title||'').toLocaleLowerCase('en');
 const summary=String(entry.summary||'').toLocaleLowerCase('en');
 const metadata=String(entry.pathname||'').toLocaleLowerCase('en');
 const keys=(entry.key_terms||[]).join(' ').toLocaleLowerCase('en');
 const themes=(entry.themes||[]).join(' ').toLocaleLowerCase('en');
 const hit=terms.filter(t=>[title,summary,keys,themes,metadata].some(s=>s.includes(t)));
 if(!hit.length)return null;
 const score=hit.length*2+(hit.length===terms.length?8:0)+
  (title.includes(q)?15:0)+(keys.includes(q)?14:0)+
  (themes.includes(q)?12:0)+(summary.includes(q)?10:0)+
  (metadata.includes(q)?4:0)+
  terms.reduce((n,t)=>n+(keys.includes(t)?6:0)+(themes.includes(t)?5:0)+(summary.includes(t)?2:0)+(title.includes(t)?3:0),0);
 return {score,matching_terms:hit};
}
async function discover(query,scope,docs,limit=12,indexOverride=null){
 termsOf(query);
 if(!['public','private'].includes(scope))throw Error('Invalid discovery scope');
 if(!Number.isInteger(limit)||limit<1||limit>30)throw Error('limit must be 1–30');
 const table=indexOverride===null?(await readMaster()).table:{records:indexOverride};
 const index=table.records.filter(r=>r.access===scope);
 const byId=new Map(index.map(r=>[r.id,r]));
 const found=[],stale=[],noEntry=[];
 for(const d of docs){
  const r=byId.get(d.id);
  if(!r){noEntry.push(d.id);}
  if(r?.source_changed||r?.source_available===false||(r?.source_signature&&d.size!==undefined&&sourceSignature(d)!==r.source_signature)){
   stale.push(d.id);continue;
  }
  const entry=r||{id:d.id,title:d.title||'',pathname:d.pathname,summary:'',key_terms:[],themes:[]};
  const v=relevance(query,entry);
  if(v)found.push({id:d.id,title:entry.title||d.title,pathname:d.pathname,
   source_kind:r?'master_table':'metadata_fallback',summary_available:!!r?.summary,
   key_terms_available:!!r?.key_terms?.length,score:v.score,matching_terms:v.matching_terms});
 }
 found.sort((a,b)=>b.score-a.score||a.pathname.localeCompare(b.pathname));
 return {query,scope,discovery_method:'approved_master_table_with_metadata_fallback',
  inventory_documents:docs.length,master_entries:index.length,
  master_entries_available:index.filter(r=>r.source_available!==false).length,
  unindexed_count:noEntry.length,unindexed_ids:noEntry.slice(0,30),
  stale_count:stale.length,stale_ids:stale.slice(0,30),
  candidates_found:found.length,candidates_returned:Math.min(limit,found.length),
  candidates_truncated:found.length>limit,
  candidates:found.slice(0,limit),
  discovery_complete:false,
  limitations:[
   'Master Table summaries and themes are discovery hints, not primary evidence.',
   'Lexical matching cannot establish that all semantically relevant documents were discovered.',
   ...(noEntry.length?['Unindexed documents were searched using metadata only.']:[]),
   ...(stale.length?['Stale or unavailable source entries were not used.']:[]),
   ...(found.length>limit?['Additional candidate documents were not returned due to limit.']:[])
  ]};
}
module.exports={discover,relevance};
