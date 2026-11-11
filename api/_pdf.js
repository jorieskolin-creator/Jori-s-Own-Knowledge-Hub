'use strict';
const {Readable}=require('node:stream');
const MAX_BYTES=8*1024*1024;
const MAX_CHARS=45000;
const MAX_PAGES=10;
const PARSE_TIMEOUT_MS=20000;
function pageRange(options={}){
 const {page_start,page_end}=options;
 const start=page_start===undefined?1:page_start;
 const end=page_end===undefined?(page_start===undefined?5:start):page_end;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start||end-start+1>MAX_PAGES)
  throw new RangeError('Invalid PDF page range: choose positive page_start and page_end, up to 10 pages per request');
 return {start,end};
}
async function toBuffer(file){
 if(Number.isFinite(file.size)&&file.size>MAX_BYTES)throw new RangeError('Document exceeds 8 MB retrieval limit');
 const chunks=[];let total=0;
 try{
  for await(const part of Readable.fromWeb(file.stream)){
   total+=part.byteLength;
   if(total>MAX_BYTES)throw new RangeError('Document exceeds 8 MB retrieval limit');
   chunks.push(part);
  }
 }catch(error){await file.stream.cancel?.().catch(()=>{});throw error}
 return Buffer.concat(chunks,total);
}
async function pdfText(file,options={}){
 const range=pageRange(options);
 const bytes=await toBuffer(file);
 if(bytes.subarray(0,5).toString('ascii')!=='%PDF-')throw Error('File is not a valid PDF');
 let parser;
 try{
  const {PDFParse}=require('pdf-parse');
  parser=new PDFParse({data:new Uint8Array(bytes)});
  let timeout;
  let result;
  try{
   result=await Promise.race([
    parser.getText({first:range.start,last:range.end}),
    new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('PDF extraction time limit exceeded')),PARSE_TIMEOUT_MS)})
   ]);
  }finally{if(timeout)clearTimeout(timeout)}
  const totalPages=result.total;
  if(!Number.isInteger(totalPages)||totalPages<1)throw Error('PDF page count unavailable');
  if(range.start>totalPages)throw new RangeError('Requested page is beyond PDF page count ('+totalPages+')');
  const pages=[];let used=0;let truncated=false;
  for(const p of result.pages||[]){
   const full=String(p.text||'').trim();
   const remaining=Math.max(0,MAX_CHARS-used);
   const part=full.slice(0,remaining);
   if(part.length<full.length)truncated=true;
   used+=part.length;
   pages.push({page:p.num,text:part,extraction:full.length?'text':'ocr-required',truncated:part.length<full.length});
   if(remaining<=full.length&&p.num<Math.min(range.end,totalPages))truncated=true;
  }
  const needsOcr=pages.filter(p=>p.extraction==='ocr-required').map(p=>p.page);
  return {text:pages.map(p=>'[Page '+p.page+']\n'+p.text).join('\n\n'),pages,total_pages:totalPages,
   requested_pages:{start:range.start,end:Math.min(range.end,totalPages)},
   extraction:needsOcr.length?'pdf-text-partial':'pdf-text',ocr_required_pages:needsOcr,
   truncated:truncated||range.end<totalPages};
 }finally{
  if(parser)await parser.destroy().catch(()=>{});
 }
}
module.exports={pdfText,toBuffer,pageRange,MAX_BYTES,MAX_CHARS,MAX_PAGES};
