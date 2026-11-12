'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {authorizePublicEnrichment,POLICY_VERSION,PURPOSE,RECIPIENT}=require('../api/_model_egress');
const {callModel}=require('../api/_master_enrich');
const now=Date.parse('2026-11-12T08:00:00Z');
const doc={id:'public:02-frameworks/demo.html',access:'public',source_signature:'a'.repeat(64),
 source_available:true,source_changed:false};
const source={text:'Synthetic public document containing no real customer information.'};
const approval={approved:true,purpose:PURPOSE,recipient:RECIPIENT,source_id:doc.id,
 source_signature:doc.source_signature,approved_at:new Date(now-1000).toISOString()};
test('Default deny: model egress requires source-specific explicit approval',async()=>{
 for(const value of [null,{},false,{...approval,approved:false},{...approval,purpose:'other'},
  {...approval,recipient:'other'},{...approval,source_id:'public:other'},
  {...approval,source_signature:'b'.repeat(64)}]){
  assert.throws(()=>authorizePublicEnrichment(doc,source,value,now),/Model egress denied/);
 }
 await assert.rejects(()=>callModel(doc,source,null),/Model egress denied/);
});
test('Public source access alone does not authorize model egress',()=>{
 assert.throws(()=>authorizePublicEnrichment({...doc,access:'private'},source,approval,now),/Model egress denied/);
 assert.throws(()=>authorizePublicEnrichment({...doc,source_changed:true},source,approval,now),/Model egress denied/);
 assert.throws(()=>authorizePublicEnrichment({...doc,source_available:false},source,approval,now),/Model egress denied/);
 assert.throws(()=>authorizePublicEnrichment(doc,source,{...approval,approved_at:new Date(now-360000).toISOString()},now),/Model egress denied/);
 assert.throws(()=>authorizePublicEnrichment(doc,{text:' '},approval,now),/Model egress denied/);
 assert.throws(()=>authorizePublicEnrichment(doc,{text:'x'.repeat(350001)},approval,now),/Model egress denied/);
});
test('Approved Public transfer is narrowly scoped, and cannot imply privacy clearance',()=>{
 const result=authorizePublicEnrichment(doc,source,approval,now);
 assert.equal(result.policy_version,POLICY_VERSION);
 assert.equal(result.source_id,doc.id);
 assert.equal(result.recipient,RECIPIENT);
 assert.equal(result.text_character_count,source.text.length);
 assert.equal(result.privacy_clearance,'NOT_VERIFIED_BY_THIS_GATE');
});
