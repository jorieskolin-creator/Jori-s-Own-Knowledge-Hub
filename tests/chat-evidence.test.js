'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createChatEvidence,retrievalQuery,chatPath,sourceLabel}=require('../api/_chat_evidence');
const {metadata}=require('../api/_governed_unified');
const {entryFromDoc}=require('../api/_master_table');

const visible='01-solutions/governance.html';
const personal='06-personal/governance.html';
const fixture='05-random/golden-standard/governance.html';
const dated='2026-11-12T09:00:00.521Z';
const html='<h1>Governance</h1><p>Governance requires distinct compliance checks.</p>';
test('Personal never enters either Chat inventory or an explicit source read',async()=>{
  const current=new Map([visible,personal,fixture].map(pathname=>[pathname,{pathname,uploadedAt:dated,size:Buffer.byteLength(html)}]));
  const all=['public','private'].flatMap(access=>[...current.values()].map(blob=>
    ({...entryFromDoc(metadata(blob,access)),review_status:'Approved'})));
  let published=all;
  const accesses=[];
  const h=createChatEvidence({
    list:async()=>({blobs:[...current.values()]}),
    headBlob:async pathname=>({...current.get(pathname),etag:'fixed'}),
    readBlob:async(pathname,{access,useCache})=>{
      accesses.push([pathname,access]);assert.equal(useCache,false);
      return {statusCode:200,blob:{etag:'fixed'},stream:new Blob([html]).stream()};
    },
    readPublication:async()=>({table:{records:all,published_records:published,publication:{status:'Approved'}}})
  });
  for(const scope of ['public','private']){
    for(const path of [personal,fixture]){
      await assert.rejects(()=>h.service.retrieve({query:'governance',ids:[scope+':'+path]}));
    }
  }
  const discovered=await h.service.locate('governance');
  assert.equal(discovered.inventory_documents,2);
  const found=await h.acquire('What does the governance require?');
  assert.deepEqual(new Set(found.passages.map(p=>p.access)),new Set(['public','private']));
  assert.ok(accesses.every(([path])=>path===visible));
  published=all.filter(d=>d.access==='public');
  await assert.rejects(()=>h.assertCurrent(found.passages),/no longer approved/);
  assert.equal(chatPath('06-personal/test.pdf'),false);
  assert.equal(chatPath('01-solutions/../06-personal/test.pdf'),false);
  assert.doesNotMatch(sourceLabel('private:'+visible,'secret'),/private|solutions/);
});
test('Chat derives a bounded lexical query from the question',()=>{
  assert.equal(retrievalQuery('How is the governance organised?'),'governance organised');
  assert.ok(retrievalQuery('abc '.repeat(25)+'x'.repeat(110)).length<200);
});

test('Public test scope never lists, opens, or returns Private sources',async()=>{
  const listed=[];
  const blob={pathname:visible,uploadedAt:dated,size:Buffer.byteLength(html)};
  const records=['public','private'].map(access=>({...entryFromDoc(metadata(blob,access)),review_status:'Approved'}));
  const evidence=createChatEvidence({
    publicOnly:true,
    list:async({storeId})=>{listed.push(storeId);return {blobs:[blob]};},
    headBlob:async()=>({...blob,etag:'fixture'}),
    readBlob:async(_path,{access})=>{
      assert.equal(access,'public');
      return {statusCode:200,blob:{etag:'fixture'},stream:new Blob([html]).stream()};
    },
    readPublication:async()=>({table:{records,published_records:records,publication:{status:'Approved'}}})
  });
  const result=await evidence.acquire('What does the governance require?');
  assert.ok(result.passages.length);
  assert.ok(result.passages.every(p=>p.access==='public'));
  await assert.rejects(()=>evidence.service.retrieve({query:'governance',ids:['private:'+visible]}),/authorized catalog/);
  assert.ok(listed.length>0);
  assert.equal(new Set(listed).size,1);
  assert.equal(listed[0],process.env.PUBLIC_BLOB_STORE_ID||process.env.BLOB_STORE_ID||'store_6mg9Vu2ypJJMAwV3');
});

test('Chat source verification normalizes quoted strong ETags and rejects weak validators',()=>{
  const {strongTag}=require('../api/_chat_evidence');
  assert.equal(strongTag('"canonical"'),strongTag('canonical'));
  assert.equal(strongTag('W/"canonical"'),null);
  assert.equal(strongTag(''),null);
});
