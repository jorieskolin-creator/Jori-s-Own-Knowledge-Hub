'use strict';
(() => {
 const panel=document.getElementById('goldenStandards');
 const run=document.getElementById('runGoldenStandards');
 const health=document.getElementById('goldenStandardsHealth');
 const notice=document.getElementById('goldenStandardsNotice');
 const reports=document.getElementById('goldenStandardsReports');
 let session=0,busy=false;
 const node=(tag,text,cls)=>{
  const el=document.createElement(tag);
  if(text!==undefined)el.textContent=text;
  if(cls)el.className=cls;
  return el;
 };
 const date=value=>value?new Date(value).toLocaleString():'Unavailable';
 function renderReport(report,label){
  const details=node('details');
  const passed=report.cases.filter(row=>row.status==='Pass').length;
  details.append(node('summary',label+' · '+report.status+' · '+passed+'/'+report.cases.length+' passed · '+date(report.completed_at)));
  const deployment=report.deployment.commit?.slice(0,12)||report.deployment.id;
  details.append(node('p','Deployment '+deployment+' · Master Table published '+date(report.published_snapshot.published_at)+
   ' · Revision '+report.published_snapshot.revision.slice(0,12),'small'));
  if(report.snapshot_changed)details.append(node('p','The published snapshot changed during this run. Run again for a single-snapshot result.','status warn'));
  const totals=report.cases.reduce((sum,row)=>({
   failures:sum.failures+row.failures.length,packages:sum.packages+row.packages_returned,
   passages:sum.passages+row.passages_returned,matched:sum.matched+row.reference_passages,
   referencePackages:sum.referencePackages+row.reference_packages
  }),{failures:0,packages:0,passages:0,matched:0,referencePackages:0});
  details.append(node('p',totals.failures+' tool call failures · '+totals.packages+' packages returned, '+
   totals.referencePackages+' with reference matches · '+totals.passages+' passage returns, '+
   totals.matched+' distinct reference passages across cases','small'));
  const table=node('table');
  const head=node('tr');
  for(const label of ['Case','Result','Discovery','Evidence','Details'])head.append(node('th',label));
  const thead=node('thead');
  thead.append(head);
  table.append(thead);
  const body=node('tbody');
  for(const row of report.cases){
   const tr=node('tr');
   const summary=[...row.issues,...row.failures.map(f=>f.operation+' · '+f.reason),
    ...(row.fixture_denied===true?['Exact-ID retrieval denied.']:[]),
    ...(row.warnings.length?['Warnings: '+row.warnings.join(', ')]:[])];
   tr.append(node('th',row.id+' · '+row.title),node('td',row.status,row.status==='Pass'?'gs-pass':'gs-review'),
    node('td',row.discovery_returned+'/'+row.discovery_found+(row.discovery_truncated?' · capped':'')),
    node('td',row.passages_returned+' passages · '+row.reference_locations_found+'/'+row.reference_locations_expected+
     ' reference locations'+(row.packages_truncated?' · capped':'')),
    node('td',summary.join(' ')||'—'));
   body.append(tr);
  }
  table.append(body);
  const scroller=node('div',undefined,'gs-table');
  scroller.append(table);
  details.append(scroller);
  return details;
 }
 async function request(method){
  const response=await fetch('/api/golden-standards',{method,credentials:'same-origin',cache:'no-store'});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'Golden Standards request failed.');
  return data;
 }
 async function refresh(){
  const current=session;
  try{
   const [data,ping]=await Promise.all([
    request('GET'),
    fetch('/api/mcp-governed-unified',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({jsonrpc:'2.0',id:1,method:'ping'})})
     .then(async response=>response.ok&&(await response.json()).id===1).catch(()=>false)
   ]);
   if(current!==session)return;
   const snapshot=data.published_snapshot;
   health.textContent='Unified connector '+(ping&&data.connector_available?'available':'unavailable')+' · '+
    (snapshot?'Master Table published'+(snapshot.published_at?' '+date(snapshot.published_at):''):
     data.master_table_available?'Master Table has no published snapshot':'Master Table unavailable');
   reports.replaceChildren();
   if(data.latest){
    const currentReport=data.latest.deployment.id===data.deployment.id&&
     data.latest.published_snapshot.revision===snapshot?.revision&&!data.latest.snapshot_changed;
    reports.append(renderReport(data.latest,currentReport?'Latest verification':'Latest verification for an earlier deployment or snapshot'));
   }else{
    reports.append(node('p',data.report_storage_available?'No verification report yet.':'Saved reports are unavailable.','small'));
   }
   if(data.previous_release)reports.append(renderReport(data.previous_release,'Previous release verification'));
   return true;
  }catch{
   if(current===session)health.textContent='Golden Standards status unavailable.';
  }
 }
 run.onclick=async()=>{
  if(busy)return;
  const current=session;
  busy=true;
  run.disabled=true;
  notice.textContent='Running all 10 connector checks…';
  try{
   const {report,saved}=await request('POST');
   if(current!==session)return;
   const refreshed=saved&&await refresh();
   if(current!==session)return;
   if(!refreshed){
    reports.prepend(renderReport(report,'Current verification'));
   }
   if(reports.firstElementChild?.tagName==='DETAILS')reports.firstElementChild.open=true;
   notice.textContent=saved?'Verification finished.':'Verification finished. The report could not be saved.';
  }catch(error){
   if(current===session)notice.textContent=error instanceof SyntaxError?'Golden Standards could not complete.':error.message;
  }finally{
   busy=false;
   run.disabled=false;
  }
 };
 document.addEventListener('knowledge-hub-open',refresh);
 document.getElementById('logout').addEventListener('click',()=>{
  session++;
  health.textContent='Checking status…';
  notice.textContent='';
  reports.replaceChildren();
 });
 if(panel.closest('.shell:not(.hidden)'))refresh();
})();
