'use strict';
const {randomUUID}=require('node:crypto');
const {createState}=require('./_chat_state');
const standard=require('../tests/golden-standards/GS-003-connector-expected-results.json');

const state=createState({namespace:'guest-verification'});
const CASES=new Map(standard.cases.map(({id,title})=>[id,title]));
const CHECKS=new Set([
 'Fixture in discovery','Reference sources in discovery','Fixture available for testing',
 'Fixture in eligible catalog','Exact-ID fixture retrieval','Evidence passages returned',
 'Reference locations found','Tool-call failures','Evidence integrity','Case result'
]);
const VALUES=new Set(['Absent','Present','Confirmed','Unconfirmed','Denied','Accepted','Unverified','Failed','No failures','Pass','Review']);
const allowedValue=value=>Number.isSafeInteger(value)||VALUES.has(value);
const tally=value=>Number.isSafeInteger(value)&&value>=0?value:0;
const status=value=>value==='Pass'?'Pass':'Review';

function guestReport(report){
 if(!report)return null;
 const comparison=report.comparison;
 const completed=Date.parse(report.completed_at);
 return {
  completed_at:Number.isFinite(completed)?new Date(completed).toISOString():null,
  status:status(report.status),snapshot_changed:report.snapshot_changed===true,
  cases:(report.cases||[]).filter(row=>CASES.has(row.id)).map(row=>({
   id:row.id,title:CASES.get(row.id),status:status(row.status),expected_status:status(row.expected_status||'Pass'),
   passages_returned:tally(row.passages_returned),failures:tally(row.failures?.length)
  })),
  comparison:comparison?{
   version:tally(comparison.version),
   severity:['ok','warning','severe'].includes(comparison.severity)?comparison.severity:'warning',
   difference_cases:tally(comparison.difference_cases),
   matched_cases:tally(comparison.matched_cases),accepted_cases:tally(comparison.accepted_cases),
   differences:(comparison.differences||[]).filter(row=>CASES.has(row.case_id)&&CHECKS.has(row.check)&&
    allowedValue(row.expected)&&allowedValue(row.actual)).map(row=>({
     case_id:row.case_id,title:CASES.get(row.case_id),check:row.check,expected:row.expected,actual:row.actual,
     critical:row.critical===true,accepted:row.accepted===true
    }))
  }:null
 };
}

async function reserveGuestRun(runtime=state){
 const lease=randomUUID();
 const retryAt=await runtime.transact((data,now)=>{
  if(data.verification)return {write:false,value:data.verification.until};
  // Outlast the 120-second function timeout and recover automatically if the process stops.
  data.verification={lease,until:now+125000};
 });
 if(retryAt)return {retryAt};
 return {release:()=>runtime.transact(data=>{
  if(data.verification?.lease!==lease)return {write:false};
  delete data.verification;
 })};
}

module.exports={guestReport,reserveGuestRun};
