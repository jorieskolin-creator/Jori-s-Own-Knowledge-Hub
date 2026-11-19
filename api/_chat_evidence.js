'use strict';
const {get,head}=require('@vercel/blob');
const {createHmac}=require('node:crypto');
const {createService,permitted}=require('./_governed_unified');
const {readMaster,sourceSignature}=require('./_master_table');
const {approvedIndex}=require('./_approved_sources');

const CATEGORIES=new Set(['01-solutions','02-frameworks','03-general-presentations','04-shared-knowledge','05-random']);
function chatPath(path){
  return permitted(path)&&CATEGORIES.has(path.split('/')[0])&&!/[\\\u0000-\u001f]/.test(path);
}
const STOP_WORDS=new Set('a an and are as at be can could do does for from had has have how i in is it me of on or please should tell that the their them this to was were what when where which who why will with would you your ja ei tätä miten miksi mitä missä milloin mikä on sekä tai voisi'.split(' '));

function retrievalQuery(question){
  const terms=[...new Set((question.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]+/gu)||[])
    .filter(term=>term.length<=100&&!STOP_WORDS.has(term)))];
  const selected=[];
  for(const term of terms){
    if(selected.length===20||[...selected,term].join(' ').length>200)break;
    selected.push(term);
  }
  return selected.join(' ');
}
async function unchanged(path,storeId,doc,headBlob){
  const info=await headBlob(path,{storeId});
  if(!info?.etag||info.pathname!==path||info.size!==doc.size||
    new Date(info.uploadedAt).getTime()!==new Date(doc.updated).getTime())throw Error('Chat source changed');
  return info.etag;
}
function createChatEvidence({list,readBlob=get,headBlob=head,readPublication=()=>readMaster({fresh:true})}={}){
  const versions=new Map(); // Per request. Never shared between users.
  const service=createService({list,readMaster:readPublication,allowPath:chatPath,get:async(path,opts,doc)=>{
    const etag=await unchanged(path,opts.storeId,doc,headBlob);
    const file=await readBlob(path,{...opts,useCache:false});
    if(file?.statusCode!==200||file.blob?.etag!==etag)throw Error('Chat source changed');
    versions.set(doc.id,{doc,storeId:opts.storeId,etag});
    return {stream:file.stream,size:doc.size};
  }});
  async function assertCurrent(passages){
    if(!passages.length)return;
    const {table}=await readPublication();
    const index=approvedIndex(table);
    const ids=new Set(passages.map(p=>p.source));
    await Promise.all([...ids].map(async id=>{
      const version=versions.get(id);
      const record=index.get(id);
      if(!version||!record||!chatPath(record.pathname)||record.source_signature!==sourceSignature(version.doc)||
        (record.source_hash&&passages.some(p=>p.source===id&&p.hash!==record.source_hash)))
        throw Error('Chat source no longer approved');
      if(await unchanged(version.doc.pathname,version.storeId,version.doc,headBlob)!==version.etag)
        throw Error('Chat source changed');
    }));
  }
  async function acquire(question){
    const query=retrievalQuery(question);
    if(!query)return {passages:[],limited:true};
    const result=await service.topic({query,mode:'focused'});
    if(result.delivery_status==='BLOCKED'||result.evidence?.failures?.length)
      throw Error('Chat retrieval failed');
    const passages=(result.evidence?.passages||[]).map((p,i)=>{
      if(!chatPath(p.pathname)||p.id!==p.access+':'+p.pathname||!['public','private'].includes(p.access)||!versions.has(p.id))
        throw Error('Unexpected chat passage scope');
      return {ref:'H'+(i+1),source:p.id,hash:p.source_sha256,access:p.access,
        page:p.page,section:p.section,text:p.passage};
    });
    await assertCurrent(passages);
    return {passages,limited:result.discovery_coverage_status==='WARN'||result.delivery_status!=='RELEASED'};
  }
  return {acquire,assertCurrent,service};
}
function sourceLabel(source,key){
  return 'Hub source '+createHmac('sha256',key).update(source).digest('hex').slice(0,12);
}
module.exports={createChatEvidence,retrievalQuery,chatPath,sourceLabel};
