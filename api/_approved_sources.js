'use strict';
// Source-level publication gate. Status is authoritative ONLY in the last
// explicitly published Master Table snapshot, never in working edits.
const {readMaster,withPublication,discoveryRecords,sourceSignature,isGoldenStandardPath}=require('./_master_table');

function approvedIndex(table){
 if(!table||typeof table!=='object'||!Array.isArray(table.records))
  throw Error('Approved-source policy unavailable: Master Table is missing');
 const normalized=withPublication(table);
 // An unapproved first table has no authoritative discovery snapshot.
 if(!normalized.published_records.length&&normalized.publication.status!=='Approved')
  return new Map();
 const index=new Map();
 for(const record of discoveryRecords(normalized)){
  if(isGoldenStandardPath(record.pathname)||record.review_status!=='Approved'||record.source_available!==true||record.source_changed===true)continue;
  if(typeof record.id!=='string'||!['public','private'].includes(record.access)||
     record.id!==record.access+':'+record.pathname||
     typeof record.source_signature!=='string'||!(/^[a-f0-9]{64}$/).test(record.source_signature))
   continue;
  if(index.has(record.id))throw Error('Duplicate approved source ID in published Master Table');
  index.set(record.id,record);
 }
 return index;
}
function isApproved(doc,index){
 const record=index.get(doc?.id);
 return !isGoldenStandardPath(doc?.pathname)&&!!record&&record.access===doc.access&&record.pathname===doc.pathname&&
  record.source_available===true&&!record.source_changed&&
  record.source_signature===sourceSignature(doc);
}
function approvedDocs(docs,index){
 if(!Array.isArray(docs)||!(index instanceof Map))throw Error('Invalid source approval inventory');
 return docs.filter(doc=>isApproved(doc,index));
}
async function authorizedCatalog(docs,read=readMaster){
 const response=await read();
 if(!response||!response.table)throw Error('Approved-source policy unavailable');
 return approvedDocs(docs,approvedIndex(response.table));
}
async function requireApprovedSource(doc,read=readMaster){
 if(!doc||!(await authorizedCatalog([doc],read)).length)
  throw Error('Source is not Approved in the currently published Master Table');
 return doc;
}
module.exports={approvedIndex,isApproved,approvedDocs,authorizedCatalog,requireApprovedSource};
