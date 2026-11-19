'use strict';
const {get,head}=require('@vercel/blob');
const {createHmac}=require('node:crypto');
const {createService,permitted}=require('./_governed_unified');
const {readMaster,sourceSignature}=require('./_master_table');
const {approvedIndex}=require('./_approved_sources');
const {MAX_DOCUMENTS}=require('./_content_search');
const {screenPassages}=require('./_chat_privacy');

const CATEGORIES=new Set(['01-solutions','02-frameworks','03-general-presentations','04-shared-knowledge','05-random']);
function chatPath(path){
  return permitted(path)&&CATEGORIES.has(path.split('/')[0])&&!/[\\\u0000-\u001f]/.test(path);
}
const STOP_WORDS=new Set('a an and are as at be can could do does for from had has have how i in is it me of on or please should tell that the their them this to was were what when where which who why will with would you your ja ei tätä miten miksi mitä missä milloin mikä on sekä tai voisi'.split(' '));
const IMPLEMENTATION=/^(?:how\s+(?:(?:can|could|do|should)\s+(?:i|we|you)\s+|to\s+))?(?:build|implement|establish|set up|design|create|develop)\s+(?:good\s+)?/i;
const DEFINITION=/^(?:what\s+(?:is|are)|define)\s+/i;
const SEARCH_BUDGET_MS=32000;

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
function searchPlan(question){
  const implementing=IMPLEMENTATION.test(question);
  const topic=retrievalQuery(implementing?question.replace(IMPLEMENTATION,''):question);
  if(!topic)return [];
  if(!implementing&&!DEFINITION.test(question))return [topic,topic,topic];
  const practical=retrievalQuery('steps controls '+topic);
  return implementing?[practical,topic,practical]:[topic,practical,topic];
}
function strongTag(value){
  if(typeof value!=='string'||!value||value.startsWith('W/'))return null;
  return value.replace(/^"([^"]+)"$/,'$1');
}
async function unchanged(path,storeId,doc,headBlob){
  const info=await headBlob(path,{storeId});
  const etag=strongTag(info?.etag);
  if(!etag||info.pathname!==path||info.size!==doc.size||
    new Date(info.uploadedAt).getTime()!==new Date(doc.updated).getTime())throw Error('Chat source changed');
  return etag;
}
function createChatEvidence({publicOnly=false,list,readBlob=get,headBlob=head,readPublication=()=>readMaster({fresh:true})}={}){
  const versions=new Map(); // Per request. Never shared between users.
  const service=createService({list,publicOnly,readMaster:readPublication,allowPath:chatPath,get:async(path,opts,doc)=>{
    const etag=await unchanged(path,opts.storeId,doc,headBlob);
    const file=await readBlob(path,{...opts,useCache:false,headers:{'accept-encoding':'identity'}});
    if(file?.statusCode!==200||strongTag(file.blob?.etag)!==etag)throw Error('Chat source changed');
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
      if(!version||!record||!chatPath(record.pathname)||(publicOnly&&record.access!=='public')||record.source_signature!==sourceSignature(version.doc)||
        (record.source_hash&&passages.some(p=>p.source===id&&p.hash!==record.source_hash)))
        throw Error('Chat source no longer approved');
      if(await unchanged(version.doc.pathname,version.storeId,version.doc,headBlob)!==version.etag)
        throw Error('Chat source changed');
    }));
  }
  async function acquire(question,{signal}={}){
    const queries=searchPlan(question);
    if(!queries.length)return {passages:[],limited:true};
    const deadline=Date.now()+SEARCH_BUDGET_MS;
    const docs=await service.catalog();
    const rankings=new Map();
    const attempted=new Set();
    const groups=[];
    const safeTexts=new Set();
    const safeSources=new Set();
    let limited=false,blocked=false;

    for(const [index,query] of queries.entries()){
      signal?.throwIfAborted();
      if(Date.now()+1000>=deadline){limited=true;break;}
      if(!rankings.has(query))rankings.set(query,await service.locate(query,docs,30));
      const found=rankings.get(query);
      limited||=Boolean(found.stale_count||found.unindexed_count);
      const ids=found.candidates.filter(d=>!attempted.has(d.id)).slice(0,MAX_DOCUMENTS).map(d=>d.id);
      if(!ids.length)continue;
      ids.forEach(id=>attempted.add(id));
      const result=await service.retrieve({query,mode:'comparative',ids},{docs,deadline});
      if(result.delivery_status==='BLOCKED'){
        blocked=true;
        limited=true;
        continue;
      }
      limited||=result.delivery_status!=='RELEASED';
      const group=[];
      for(const p of result.evidence?.passages||[]){
        if(!chatPath(p.pathname)||p.id!==p.access+':'+p.pathname||!(publicOnly?['public']:['public','private']).includes(p.access)||!versions.has(p.id))
          throw Error('Unexpected chat passage scope');
        const passage={source:p.id,hash:p.source_sha256,access:p.access,
          page:p.page,section:p.section,start:p.start,text:p.passage};
        const [safe]=screenPassages([passage]);
        if(!safe){limited=true;continue;}
        const text=safe.text.toLowerCase().replace(/\s+/gu,' ');
        if(safeTexts.has(text))continue;
        safeTexts.add(text);
        safeSources.add(passage.source);
        group.push(passage);
      }
      groups.push(group);
      if((index>0||queries[0]===queries[1])&&safeTexts.size>=5&&safeSources.size>=2)break;
    }
    if(blocked&&!groups.length)throw Error('Chat retrieval failed');
    limited||=[...rankings.values()].some(found=>
      found.candidates_truncated||found.candidates.some(d=>!attempted.has(d.id)));
    // Interleave results from different searches so both topics fit in the model evidence budget.
    const passages=[];
    for(let i=0;groups.some(group=>i<group.length);i++){
      for(const group of groups)if(group[i])passages.push({...group[i],ref:'H'+(passages.length+1)});
    }
    await assertCurrent(passages);
    return {passages,limited:limited||!passages.length};
  }
  return {acquire,assertCurrent,service};
}
function sourceLabel(source,key){
  return 'Hub source '+createHmac('sha256',key).update(source).digest('hex').slice(0,12);
}
module.exports={createChatEvidence,retrievalQuery,chatPath,sourceLabel,strongTag};
