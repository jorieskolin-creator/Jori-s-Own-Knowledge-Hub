'use strict';
// Server-side, default-deny authorization for the existing PUBLIC Master Table AI enrichment call.
// Not a privacy scan and not a policy for external MCP clients.
const POLICY_VERSION='public-master-enrichment-egress-v1';
const PURPOSE='master_table_discovery_enrichment';
const RECIPIENT='openai.responses';
const FIVE_MINUTES=5*60*1000;
function authorizePublicEnrichment(doc,source,approval,now=Date.now()){
 if(!doc||doc.access!=='public'||doc.source_available===false||doc.source_changed)
  throw Error('Model egress denied: only current Public sources are eligible');
 if(!source||typeof source.text!=='string'||!source.text.trim()||source.text.length>350000)
  throw Error('Model egress denied: invalid bounded source text');
 if(!approval||approval.approved!==true||approval.purpose!==PURPOSE||
   approval.recipient!==RECIPIENT||approval.source_id!==doc.id||
   approval.source_signature!==doc.source_signature||!doc.source_signature)
  throw Error('Model egress denied: explicit source-scoped administrator approval is required');
 const approvedAt=Date.parse(approval.approved_at);
 if(!Number.isFinite(approvedAt)||approvedAt>now+30000||now-approvedAt>FIVE_MINUTES)
  throw Error('Model egress denied: approval is missing, future-dated or expired');
 return {policy_version:POLICY_VERSION,purpose:PURPOSE,recipient:RECIPIENT,source_id:doc.id,
  source_signature:doc.source_signature,authorized_at:approval.approved_at,
  text_character_count:source.text.length,privacy_clearance:'NOT_VERIFIED_BY_THIS_GATE'};
}
module.exports={authorizePublicEnrichment,POLICY_VERSION,PURPOSE,RECIPIENT};
