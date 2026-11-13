'use strict';
const {createHash}=require('node:crypto');
const {createService}=require('./_governed_unified');
const {SourceAccessError,RequestInputError}=require('./_request_errors');
const {GOLDEN_STANDARD_PREFIX,isGoldenStandardPath}=require('./_master_table');

const standard=require('../tests/golden-standards/GS-003-connector-expected-results.json');
const FIXTURE_PATH=GOLDEN_STANDARD_PREFIX+standard.sources[standard.fixture.source].split('/').at(-1);
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
function sourceId(key,privateIds){
 const reference=standard.sources[key];
 return typeof reference==='string'?reference:privateIds.get(reference.hash);
}

function compareResults(cases,snapshotChanged,exceptions=standard.accepted_exceptions){
 const differences=cases.flatMap(row=>row.differences);
 // An exception applies to the exact observed difference in a single case.
 const accepted=differences.find(d=>!d.critical&&
  differences.filter(other=>other.case_id===d.case_id).length===1&&
  exceptions.some(e=>['case_id','check','expected','actual'].every(key=>e[key]===d[key])));
 const rows=differences.map(d=>({...d,accepted:d===accepted}));
 const differenceCases=new Set(rows.filter(d=>!d.accepted).map(d=>d.case_id)).size;
 const severity=rows.some(d=>d.critical)||differenceCases>standard.warning_limit?'severe':
  differenceCases||snapshotChanged?'warning':'ok';
 return {version:standard.version,severity,difference_cases:differenceCases,
  accepted_cases:Number(!!accepted),differences:rows};
}

function countEvidence(row,response,locations){
 const pack=response.evidence;
 row.packages_returned+=Number(!!pack);
 row.passages_returned+=pack?.passages?.length||0;
 row.packages_truncated+=Number(!!pack?.package_truncated);
 for(const warning of response.retrieval_quality?.warnings||[])row.warnings.add(warning);
 if(response.delivery_status==='BLOCKED'){
  row.integrity_blocked=true;
  row.issues.push('Evidence integrity checks withheld the package.');
 }
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
 const {id,title,expected}=spec;
 const row={id,title,issues:[],failures:[],warnings:new Set(),differences:[],
  integrity_blocked:false,
  discovery_found:0,discovery_returned:0,discovery_truncated:false,packages_returned:0,
  passages_returned:0,packages_truncated:0,reference_packages:0,matchedPassages:new Set(),fixture_denied:null};
 const compare=(check,expected,actual,critical=false)=>{
  if(expected!==actual)row.differences.push({case_id:id,title,check,expected,actual,critical});
 };
 async function call(operation,args){
  try{return await service.execute(operation,args);}
  catch(e){
   if(expected.fixture_excluded&&operation==='retrieve_evidence'&&e instanceof SourceAccessError){
    row.fixture_denied=true;
    return null;
   }
   row.failures.push({operation,reason:e instanceof RequestInputError?e.reason:
    e instanceof SourceAccessError?'SOURCE_UNAVAILABLE':'SERVICE_UNAVAILABLE'});
   row.issues.push('The connector could not complete '+operation+'.');
   return null;
  }
 }
 const locations=(expected.reference_locations||[]).flatMap(({source,...points})=>
  Object.entries(points).flatMap(([kind,values])=>values.map(value=>
   ({id:sourceId(source,privateIds),kind:kind==='pages'?'page':'section',value,found:false}))));
 let expectedSources=0,foundSources=0;
 for(const {query,expected_sources:references} of spec.searches||[]){
  expectedSources+=references.length;
  const result=await call('discover_sources',{query,limit:12});
  if(!result)continue;
  countDiscovery(row,result);
  const found=references.filter(ref=>result.candidates.some(c=>c.id===sourceId(ref,privateIds))).length;
  foundSources+=found;
  if(found<references.length)row.issues.push('Discovery missed at least one reference source.');
  if(expected.fixture_excluded){
   const fixtureFound=result.candidates.some(c=>isGoldenStandardPath(c.pathname));
   compare('Fixture in discovery','Absent',fixtureFound?'Present':'Absent',true);
   if(fixtureFound)row.issues.push('A Golden Standard fixture appeared in discovery.');
  }
 }
 compare('Reference sources in discovery',expectedSources,foundSources);
 if(spec.topic_query){
  const result=await call('retrieve_topic_evidence',{query:spec.topic_query,mode:'focused'});
  if(result){
   if(result.discovery)countDiscovery(row,result.discovery);
   countEvidence(row,result,locations);
   if(result.evidence?.passages?.length)row.issues.push('The out-of-scope query returned passages for review.');
  }
 }
 if(spec.evidence_query){
  const ids=[...new Set(locations.map(l=>l.id))];
  if(ids.some(id=>!id||!catalog.some(doc=>doc.id===id))){
   row.issues.push('At least one reference source is unavailable or ineligible.');
  }else{
   const result=await call('retrieve_evidence',{query:spec.evidence_query,ids,mode:spec.mode});
   if(result)countEvidence(row,result,locations);
  }
  if(locations.some(l=>!l.found))row.issues.push('One or more reference pages or sections were missing.');
 }
 if(expected.fixture_excluded){
  compare('Fixture available for testing','Confirmed',fixturePresent?'Confirmed':'Unconfirmed');
  if(!fixturePresent)row.issues.push('The reference fixture could not be confirmed in Private storage.');
  const fixtureEligible=catalog.some(d=>isGoldenStandardPath(d.pathname));
  compare('Fixture in eligible catalog','Absent',fixtureEligible?'Present':'Absent',true);
  if(fixtureEligible)row.issues.push('A Golden Standard fixture entered the eligible catalog.');
  const result=await call('retrieve_evidence',{
   query:standard.fixture.query,ids:['private:'+FIXTURE_PATH],mode:standard.fixture.mode
  });
  if(result){
   row.fixture_denied=false;
   countEvidence(row,result,locations);
   row.issues.push('Exact-ID retrieval did not reject the fixture.');
  }
  const actual=row.fixture_denied===true?'Denied':row.fixture_denied===false?'Accepted':'Unverified';
  compare('Exact-ID fixture retrieval','Denied',actual,row.fixture_denied===false);
 }
 if(expected.max_passages!==undefined&&row.passages_returned>expected.max_passages)
  compare('Evidence passages returned',expected.max_passages,row.passages_returned,!!expected.fixture_excluded);
 const foundLocations=locations.filter(l=>l.found).length;
 compare('Reference locations found',locations.length,foundLocations);
 compare('Tool-call failures',expected.tool_failures,row.failures.length);
 compare('Evidence integrity',standard.evidence_integrity,row.integrity_blocked?'Failed':'No failures',true);
 const {matchedPassages,warnings,...summary}=row;
 return {...summary,status:row.differences.length?'Review':'Pass',warnings:[...warnings],
  reference_locations_found:foundLocations,reference_locations_expected:locations.length,
  reference_passages:matchedPassages.size};
}

async function runChecks({service=createService(),fixturePresent}){
 const catalog=await service.catalog();
 const privateIds=new Map(catalog.filter(d=>d.access==='private').map(d=>[hash(d.id),d.id]));
 const cases=[];
 // Bound concurrent extraction work while keeping the administrator request short.
 for(let start=0;start<standard.cases.length;start+=3){
  cases.push(...await Promise.all(standard.cases.slice(start,start+3)
   .map(spec=>runCase(spec,service,catalog,privateIds,fixturePresent))));
 }
 return cases;
}

module.exports={FIXTURE_PATH,publishedSnapshot,deploymentInfo,runChecks,compareResults};
