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
 const pdf=await new Promise((resolve,reject)=>{
  const mod=require('pdf2json');
  const PDFParser=mod.PDFParser||mod.default||mod;
  const parser=new PDFParser(null,false);
  let done=false;
  const timeout=setTimeout(()=>finish(new Error('PDF extraction time limit exceeded')),PARSE_TIMEOUT_MS);
  function finish(error,value){
   if(done)return;
   done=true;clearTimeout(timeout);
   parser.removeAllListeners();
   if(error)reject(error);else resolve(value);
  }
  parser.on('pdfParser_dataReady',data=>finish(null,data));
  parser.on('pdfParser_dataError',data=>finish(new Error('PDF could not be parsed')));
  parser.on('error',()=>finish(new Error('PDF could not be parsed')));
  try{
   // Exact-offset copy avoids an upstream pdf2json ArrayBuffer offset issue.
   const exact=Buffer.allocUnsafeSlow(bytes.length);
   bytes.copy(exact);
   parser.parseBuffer(exact,0);
  }catch(e){finish(e)}
 });
 const totalPages=pdf.Pages?.length||0;
 if(totalPages<1)throw Error('PDF page count unavailable');
 if(range.start>totalPages)throw new RangeError('Requested page is beyond PDF page count ('+totalPages+')');
 const pages=[];let used=0;let truncated=false;
 const last=Math.min(range.end,totalPages);
 for(let number=range.start;number<=last;number++){
  const records=pdf.Pages[number-1]?.Texts||[];
  const items=records.map(t=>({x:Number(t.x)||0,y:Number(t.y)||0,
   text:(t.R||[]).map(r=>String(r.T||'')).join('')})).filter(t=>t.text);
  items.sort((a,b)=>a.y-b.y||a.x-b.x);
  let full='',prev=null;
  for(const item of items){
   if(prev!==null)full+=Math.abs(item.y-prev)>0.2?'\n':' ';
   full+=item.text;prev=item.y;
  }
  full=full.trim();
  const remaining=Math.max(0,MAX_CHARS-used);
  const part=full.slice(0,remaining);
  if(part.length<full.length)truncated=true;
  used+=part.length;
  pages.push({page:number,text:part,extraction:full.length?'text':'ocr-required',
    truncated:part.length<full.length});
  if(remaining<=full.length&&number<last)truncated=true;
 }
  const needsOcr=pages.filter(p=>p.extraction==='ocr-required').map(p=>p.page);
 return {text:pages.map(p=>'[Page '+p.page+']\n'+p.text).join('\n\n'),pages,total_pages:totalPages,
   requested_pages:{start:range.start,end:last},
   extraction:needsOcr.length?'pdf-text-partial':'pdf-text',ocr_required_pages:needsOcr,
   truncated:truncated||range.end<totalPages};

}
module.exports={pdfText,toBuffer,pageRange,MAX_BYTES,MAX_CHARS,MAX_PAGES};
