'use strict';
const {createHash}=require('node:crypto');
const {createService}=require('./_governed_unified');
const {SourceAccessError,RequestInputError}=require('./_request_errors');
const {GOLDEN_STANDARD_PREFIX,isGoldenStandardPath}=require('./_master_table');

const FRAMEWORK='public:02-frameworks/AI Governance_Validation and Steps_30.10.2026.html';
const DEMAND='public:02-frameworks/Shaping Demand_The Idea_4.9.2026.pdf';
const FLOW='public:03-general-presentations/From Signal to Validated Proposal — The Story of Agentic Flow.html';
const FLYWHEEL='public:03-general-presentations/The AI-Driven Value Creation Flywheel · Concept Paper.html';
const CONCEPT='public:02-frameworks/Evolving-Modernization-The-Concept.html';
const FIXTURE_PATH=GOLDEN_STANDARD_PREFIX+FRAMEWORK.split('/').at(-1);

// Resolve Private references against the eligible catalog without publishing their paths.
const LANDING_ZONE={hash:'2966252d1aeeff753fdfff1bb02aa3688cb54a976f30ea833f9e6745347c3369'};
const OPERATING_RHYTHM={hash:'9187d325e53bcf2da01e9f38aa27a531a85c2f85491dfed2e5cb2df320b87bfb'};
const FRONTRUNNERS={hash:'ef1371877e2117d4acf3f85db7e84b9c039b37a5ac1d315f0d4fba0de2ce2a88'};
const VALUE_STREAM={hash:'fa06d62f8647408b727d26c9b20d73bb28ccb34b41753a627a1e8bcfc8813b79'};
const CASES=[
 {
  number:1,title:'Out-of-scope restaurant search',negative:'Helsinki pizza pizzeria opening hours'
 },
 {
  number:2,title:'Unverified business claim',negative:'pizzeria pizzaravintola',
  searches:[['AI Driven Value Creation Flywheel Concept Paper',[FLYWHEEL]]]
 },
 {
  number:3,title:'Generate, Ground and Govern',
  searches:[['Generate Ground Govern alternative design responses',[FRAMEWORK]]],
  query:'Generate Ground Govern candidate output retrieved material external system decision alternative design responses acceptance',
  references:[[FRAMEWORK,{sections:[5,30,31,32]}]]
 },
 {
  number:4,title:'Pilot proposal and case results',
  searches:[['Shaping Demand The Idea 4.9.2026',[DEMAND]]],
  query:'2 domains 10 accounts 90 days pilot winning ratio',
  references:[[DEMAND,{pages:[8,10]}]]
 },
 {
  number:5,title:'Proposal workflow and human approval',
  searches:[['From Signal to Validated Proposal Story of Agentic Flow',[FLOW]],['Shaping Demand The Idea 4.9.2026',[DEMAND]]],
  query:'six steps agentic workflow sense diagnose simulate propose validate route learn feedback human validation',
  references:[[FLOW,{sections:[4]}],[DEMAND,{pages:[9]}]]
 },
 {
  number:6,title:'Contradiction and tested absence',
  searches:[['Evidence Driven Landing Zone Assessment Stakeholder Proposal',[LANDING_ZONE]]],
  query:'Deny Audit contradiction workshop silence scoped collector tested absence',mode:'focused',
  references:[[LANDING_ZONE,{sections:[19]}]]
 },
 {
  number:7,title:'Meeting cadences and outputs',
  searches:[['Operating Rhythm Demand Verification Capacity Planning',[OPERATING_RHYTHM]]],
  query:'Request Review Demand Verification every Tuesday Business Demand Capacity Planning Every Month outputs',
  references:[[OPERATING_RHYTHM,{pages:[13,17]}]]
 },
 {
  number:8,title:'Reported results in a longer PDF',
  searches:[['Frontrunners IT consultancy aviation ground services',[FRONTRUNNERS]]],
  query:'IT Consultancy Data net profit delivery reliability intervention improvements causal attribution',mode:'focused',
  references:[[FRONTRUNNERS,{pages:[27,33]}]]
 },
 {
  number:9,title:'Onboarding pilot evidence across three sources',
  searches:[['Evolving Modernization The Concept',[CONCEPT]],
   ['AI Driven Value Creation Flywheel Concept Paper',[FLYWHEEL]],
   ['Value Stream Analysis Process Optimization Service Description',[VALUE_STREAM]]],
  query:'standardized maintenance iterative onboarding impact statement vertical slice baseline wait time current state future state backlog',
  references:[[CONCEPT,{sections:[24]}],[FLYWHEEL,{sections:[10,12]}],[VALUE_STREAM,{pages:[7,12]}]]
 },
 {
  number:10,title:'Golden Standard fixture exclusion',exclusion:true,
  searches:[['AI Governance Validation and Steps 30.10.2026',[]]]
 }
];
const hash=value=>createHash('sha256').update(value).digest('hex');
function publishedSnapshot(table){
 const approvedAt=table.publication.approved_at;
 const records=table.published_records;
 return {available:!!approvedAt||table.publication.status==='Approved',
  published_at:approvedAt,published_count:records.length,
  revision:hash(JSON.stringify({approvedAt,records}))};
}
function deploymentInfo(){
 return {id:process.env.VERCEL_DEPLOYMENT_ID||process.env.VERCEL_URL||process.env.VERCEL_GIT_COMMIT_SHA||'local',
  commit:process.env.VERCEL_GIT_COMMIT_SHA||null};
}
function sourceId(reference,privateIds){
 return typeof reference==='string'?reference:privateIds.get(reference.hash);
}

function countEvidence(row,response,locations){
 const pack=response.evidence;
 row.packages_returned+=Number(!!pack);
 row.passages_returned+=pack?.passages?.length||0;
 row.packages_truncated+=Number(!!pack?.package_truncated);
 for(const warning of response.retrieval_quality?.warnings||[])row.warnings.add(warning);
 if(response.delivery_status==='BLOCKED')row.issues.push('Evidence integrity checks withheld the package.');
 let hasReference=false;
 for(const passage of pack?.passages||[]){
  for(const location of locations){
   if(passage.id===location.id&&passage[location.kind]===location.value){
    location.found=true;
    hasReference=true;
    row.matchedPassages.add(passage.passage_sha256);
   }
  }
 }
 row.reference_packages+=Number(hasReference);
}
function countDiscovery(row,result){
 row.discovery_found+=result.candidates_found;
 row.discovery_returned+=result.candidates_returned;
 row.discovery_truncated||=result.candidates_truncated;
}
async function runCase(spec,service,catalog,privateIds,fixturePresent){
 const {number,title}=spec;
 const row={id:'GS-003-'+String(number).padStart(2,'0'),title,issues:[],failures:[],warnings:new Set(),
  discovery_found:0,discovery_returned:0,discovery_truncated:false,packages_returned:0,
  passages_returned:0,packages_truncated:0,reference_packages:0,matchedPassages:new Set(),fixture_denied:null};
 async function call(operation,args){
  try{return await service.execute(operation,args);}
  catch(e){
   if(spec.exclusion&&operation==='retrieve_evidence'&&e instanceof SourceAccessError){
    row.fixture_denied=true;
    return null;
   }
   row.failures.push({operation,reason:e instanceof RequestInputError?e.reason:
    e instanceof SourceAccessError?'SOURCE_UNAVAILABLE':'SERVICE_UNAVAILABLE'});
   row.issues.push('The connector could not complete '+operation+'.');
   return null;
  }
 }
 const locations=(spec.references||[]).flatMap(([reference,points])=>
  Object.entries(points).flatMap(([kind,values])=>values.map(value=>
   ({id:sourceId(reference,privateIds),kind:kind==='pages'?'page':'section',value,found:false}))));
 for(const [query,references] of spec.searches||[]){
  const result=await call('discover_sources',{query,limit:12});
  if(!result)continue;
  countDiscovery(row,result);
  if(references.some(ref=>!result.candidates.some(c=>c.id===sourceId(ref,privateIds))))
   row.issues.push('Discovery missed at least one reference source.');
  if(spec.exclusion&&result.candidates.some(c=>isGoldenStandardPath(c.pathname)))
   row.issues.push('A Golden Standard fixture appeared in discovery.');
 }
 if(spec.negative){
  const result=await call('retrieve_topic_evidence',{query:spec.negative,mode:'focused'});
  if(result){
   if(result.discovery)countDiscovery(row,result.discovery);
   countEvidence(row,result,locations);
   if(result.evidence?.passages?.length)row.issues.push('The out-of-scope query returned passages for review.');
  }
 }
 if(spec.query){
  const ids=[...new Set(locations.map(l=>l.id))];
  if(ids.some(id=>!id||!catalog.some(doc=>doc.id===id))){
   row.issues.push('At least one reference source is unavailable or ineligible.');
  }else{
   const result=await call('retrieve_evidence',{query:spec.query,ids,mode:spec.mode||'comprehensive'});
   if(result)countEvidence(row,result,locations);
  }
  if(locations.some(l=>!l.found))row.issues.push('One or more reference pages or sections were missing.');
 }
 if(spec.exclusion){
  if(!fixturePresent)row.issues.push('The reference fixture could not be confirmed in Private storage.');
  if(catalog.some(d=>isGoldenStandardPath(d.pathname)))row.issues.push('A Golden Standard fixture entered the eligible catalog.');
  const result=await call('retrieve_evidence',{query:'Generate Ground Govern',ids:['private:'+FIXTURE_PATH],mode:'focused'});
  if(result){
   row.fixture_denied=false;
   countEvidence(row,result,locations);
   row.issues.push('Exact-ID retrieval did not reject the fixture.');
  }
 }
 const {matchedPassages,warnings,...summary}=row;
 return {...summary,status:row.issues.length?'Review':'Pass',warnings:[...warnings],
  reference_locations_found:locations.filter(l=>l.found).length,reference_locations_expected:locations.length,
  reference_passages:matchedPassages.size};
}

async function runChecks({service=createService(),fixturePresent}){
 const catalog=await service.catalog();
 const privateIds=new Map(catalog.filter(d=>d.access==='private').map(d=>[hash(d.id),d.id]));
 const cases=[];
 // Bound concurrent extraction work while keeping the administrator request short.
 for(let start=0;start<CASES.length;start+=3){
  cases.push(...await Promise.all(CASES.slice(start,start+3)
   .map(spec=>runCase(spec,service,catalog,privateIds,fixturePresent))));
 }
 return cases;
}

module.exports={FIXTURE_PATH,publishedSnapshot,deploymentInfo,runChecks};
