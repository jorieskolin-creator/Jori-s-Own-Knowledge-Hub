'use strict';
const {get,put,head,BlobNotFoundError,BlobPreconditionFailedError}=require('@vercel/blob');
const {send,valid}=require('./_auth');
const {readMaster,STORE_ID}=require('./_master_table');
const {createService}=require('./_governed_unified');
const {FIXTURE_PATH,publishedSnapshot,deploymentInfo,runChecks,compareResults}=require('./_golden_standard_checks');
const {guestReport,reserveGuestRun}=require('./_guest_verification');

const REPORT_PATH='_knowledge-system/golden-standard-reports-v1.json';
const storageOptions=()=>({storeId:STORE_ID(),access:'private'});

const emptyReports=()=>({latest:null,previous_release:null});
async function readReports(){
 try{
  const file=await get(REPORT_PATH,{...storageOptions(),useCache:false});
  return file?await new Response(file.stream).json():emptyReports();
 }catch(e){
  if(e instanceof BlobNotFoundError)return emptyReports();
  throw e;
 }
}
async function reportWriteVersion(){
 try{
  const metadata=await head(REPORT_PATH,{storeId:STORE_ID()});
  if(!metadata.etag)throw Error('Missing report version');
  return metadata.etag;
 }catch(e){
  if(e instanceof BlobNotFoundError)return null;
  throw e;
 }
}
function releaseOf(deployment){return deployment.commit||deployment.id;}
async function saveReport(report){
 // Conditional writes preserve the newest completed report across concurrent runs.
 for(let attempt=0;attempt<3;attempt++){
  const etag=await reportWriteVersion();
  const stored=etag?await readReports():emptyReports();
  if(etag&&!stored.latest)continue;
  if(stored.latest&&stored.latest.completed_at>=report.completed_at)return;
  const previous=stored.latest&&releaseOf(stored.latest.deployment)!==releaseOf(report.deployment)
   ?stored.latest:stored.previous_release;
  const options={...storageOptions(),contentType:'application/json',addRandomSuffix:false,allowOverwrite:!!etag};
  if(etag)options.ifMatch=etag;
  try{
   await put(REPORT_PATH,JSON.stringify({latest:report,previous_release:previous}),options);
   return;
  }catch(e){
   if(!(e instanceof BlobPreconditionFailedError)&&
      !(!etag&&/already exists|already been taken|conflict/i.test(e.message||'')))throw e;
  }
 }
 throw Error('Could not save the report after concurrent changes.');
}
async function probeFixture(){
 try{return !!await head(FIXTURE_PATH,{storeId:STORE_ID()});}
 catch{return false;}
}
function sameOrigin(req){
 const {origin,host}=req.headers;
 return !!host&&(origin===`https://${host}`||(!origin&&req.headers['sec-fetch-site']==='same-origin'));
}
async function status(res,guest){
 const masterRead=readMaster();
 const service=createService({readMaster:()=>masterRead});
 const [catalog,master,reports]=await Promise.allSettled([service.catalog(),masterRead,readReports()]);
 const snapshot=master.status==='fulfilled'?publishedSnapshot(master.value.table):null;
 const saved=reports.status==='fulfilled'?reports.value:null;
 if(guest){
  const latest=saved?.latest;
  const current=latest?.deployment?.id===deploymentInfo().id&&
   latest.published_snapshot?.revision===snapshot?.revision&&!latest.snapshot_changed;
  return send(res,200,{
   guest:true,connector_available:catalog.status==='fulfilled',
   published_snapshot:snapshot?.available?{published_at:snapshot.published_at}:null,
   master_table_available:master.status==='fulfilled',report_storage_available:!!saved,
   latest:guestReport(latest),latest_current:Boolean(current)
  });
 }
 return send(res,200,{
  connector_available:catalog.status==='fulfilled',
  published_snapshot:snapshot?.available?snapshot:null,
  master_table_available:master.status==='fulfilled',
  deployment:deploymentInfo(),
  report_storage_available:!!saved,
  latest:saved?.latest||null,
  previous_release:saved?.previous_release||null
 });
}

async function verify(guest){
 const started_at=new Date().toISOString();
 const initial=publishedSnapshot((await readMaster()).table);
 if(!initial.available)return {status:409,payload:{error:'Publish a Master Table before running Golden Standards.'}};
 const cases=await runChecks({fixturePresent:await probeFixture()});
 const final=publishedSnapshot((await readMaster()).table);
 const snapshot_changed=initial.revision!==final.revision;
 const comparison=compareResults(cases,snapshot_changed);
 const report={suite:'GS-003',started_at,completed_at:new Date().toISOString(),
  deployment:deploymentInfo(),published_snapshot:initial,snapshot_changed,
  status:comparison.severity==='ok'?'Pass':'Review',comparison,cases};
 let saved=true;
 try{await saveReport(report);}
 catch(error){
  console.error('Golden Standards report storage write failed',error?.constructor?.name||'Error');
  saved=false;
 }
 const payload={report:guest?guestReport(report):report,saved};
 if(guest)payload.guest=true;
 return {status:200,payload};
}

module.exports=async function(req,res){
 const guest=!valid(req,'admin');
 if(guest&&!valid(req,'guest'))return send(res,401,{error:'Library sign-in required'});
 if(req.method!=='GET'&&req.method!=='POST')return send(res,405,{error:'Method not allowed'});
 if(req.method==='GET')return status(res,guest);
 if(!sameOrigin(req))return send(res,403,{error:'Same-origin verification request required'});
 let release,result;
 try{
  if(guest){
   const slot=await reserveGuestRun();
   if(slot.retryAt){
    res.setHeader('Retry-After',String(Math.max(1,Math.ceil((slot.retryAt-Date.now())/1000))));
    return send(res,429,{error:'A Guest verification is already running. Try again when it finishes.'});
   }
   release=slot.release;
  }
  result=await verify(guest);
 }catch{
  result={status:503,payload:{error:'Golden Standards could not complete. Check connector and Master Table availability.'}};
 }finally{
  if(release)await release().catch(()=>{});
 }
 return send(res,result.status,result.payload);
};
