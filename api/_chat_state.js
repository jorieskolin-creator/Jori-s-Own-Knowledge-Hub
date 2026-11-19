'use strict';
const {get,put,BlobPreconditionFailedError}=require('@vercel/blob');
const {createHash}=require('node:crypto');
const {setTimeout:pause}=require('node:timers/promises');

const MAX_BYTES=512*1024;
function statePath(){
  const environment=process.env.VERCEL_ENV||'development';
  const branch=environment==='preview'?process.env.VERCEL_GIT_COMMIT_REF||'preview':'';
  const scope=createHash('sha256').update(environment+':'+branch).digest('hex').slice(0,24);
  return '_knowledge-system/chat-runtime-'+scope+'.json';
}
function createState({readBlob=get,writeBlob=put,backoff=pause}={}){
  const options=()=>({access:'private',storeId:process.env.PRIVATE_BLOB_STORE_ID||'store_YAAwH6FewcrImhA1'});
  async function read(){
    const file=await readBlob(statePath(),{...options(),useCache:false});
    if(file===null)return {etag:null,data:{}};
    if(file?.statusCode!==200||!file.blob?.etag||!Number.isSafeInteger(file.blob.size)||file.blob.size>MAX_BYTES)
      throw Error('Chat state unavailable');
    const data=await new Response(file.stream).json();
    if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Chat state invalid');
    return {etag:file.blob.etag,data};
  }
  async function transact(change){
    for(let attempt=0;attempt<5;attempt++){
      const {etag,data}=await read();
      const now=Date.now();
      for(const key of Object.keys(data)){
        if(!Number.isFinite(data[key]?.until))throw Error('Chat state invalid');
        if(data[key].until<=now)delete data[key];
      }
      const result=change(data,now);
      if(result?.write===false)return result.value;
      const body=JSON.stringify(data);
      if(Buffer.byteLength(body)>MAX_BYTES)throw Error('Chat state capacity exceeded');
      try{
        await writeBlob(statePath(),body,{...options(),contentType:'application/json',
          ...(etag?{ifMatch:etag}:{allowOverwrite:false})});
        return result?.value;
      }catch(error){
        if(!(error instanceof BlobPreconditionFailedError)&&
          !(!etag&&/already exists|already been taken/i.test(String(error?.message))))throw error;
        await backoff(20*(attempt+1)+Math.floor(Math.random()*25));
      }
    }
    throw Error('Chat state contention');
  }
  return {read,transact};
}
module.exports={createState,statePath};
