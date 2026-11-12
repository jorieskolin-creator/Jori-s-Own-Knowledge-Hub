'use strict';
// Deterministic, ephemeral lexical retrieval. No remote AI and no storage writes.
const {Readable}=require('node:stream');
const {createHash}=require('node:crypto');
const {pdfText}=require('./_pdf');
const MAX_HTML_BYTES=6*1024*1024;
const MAX_RESULTS=20;
const MAX_DOCUMENTS=4;
const WINDOW=1800,OVERLAP=240,MAX_PASSAGE=900;
function termsOf(query){
 if(typeof query!=='string'||query.trim().length<2||query.length>200)
  throw new RangeError('Query must be 2-200 characters');
 const tokens=Array.from(query.toLocaleLowerCase('en').matchAll(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu),m=>m[0]);
 const terms=[...new Set(tokens.filter(t=>t.length>1))];
 if(!terms.length||terms.length>20)throw new RangeError('Query must have 1-20 searchable terms');
 return terms;
}
function plainHtml(s){
 return s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,' ')
  .replace(/<!--[\s\S]*?-->/g,' ')
  .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/section|\/article)\b[^>]*>/gi,'\n')
  .replace(/<[^>]+>/g,' ')
  .replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<')
  .replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
  .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(0x10ffff,Number(n))))
  .replace(/[ \t]+/g,' ').replace(/\n[ \t]*/g,'\n').trim();
}
function windows(text){
 if(!text)return [];
 const spans=[];
 for(let start=0;start<text.length;start+=WINDOW-OVERLAP){
  spans.push({start,end:Math.min(text.length,start+WINDOW),text:text.slice(start,start+WINDOW)});
  if(start+WINDOW>=text.length)break;
 }
 return spans;
}
async function htmlSegments(file){
 if(Number.isFinite(file.size)&&file.size>MAX_HTML_BYTES)throw new RangeError('HTML size exceeds 6 MB');
 let size=0;const parts=[];
 for await(const p of Readable.fromWeb(file.stream)){
  size+=p.byteLength;
  if(size>MAX_HTML_BYTES)throw new RangeError('HTML size exceeds 6 MB');
  parts.push(p);
 }
 const originalBytes=Buffer.concat(parts,size);
 const original_file_sha256=createHash('sha256').update(originalBytes).digest('hex');
 const source=originalBytes.toString('utf8');
 const cleaned=source.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,' ')
   .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,' ');
 const heads=/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;
 const points=[];let m;
 while((m=heads.exec(cleaned))!==null){
  points.push({offset:m.index,end:heads.lastIndex,level:Number(m[1]),heading:plainHtml(m[2]).slice(0,240)});
  if(points.length>2000)throw new RangeError('HTML exceeds maximum indexed heading count');
 }
 const sections=[];
 if(!points.length)sections.push({heading:null,level:null,text:plainHtml(cleaned),section:1});
 else{
  const intro=plainHtml(cleaned.slice(0,points[0].offset));
  if(intro)sections.push({heading:null,level:null,text:intro,section:0});
  points.forEach((h,i)=>{
   const end=i+1<points.length?points[i+1].offset:cleaned.length;
   sections.push({heading:h.heading,level:h.level,section:i+1,text:plainHtml(cleaned.slice(h.end,end))});
  });
 }
 const segments=sections.flatMap(section=>windows(section.text).map(w=>({
  page:null,section:section.section,heading:section.heading,heading_level:section.level,
  start:w.start,end:w.end,text:w.text
 })));
 return {segments,coverage:{document_type:'html',original_file_sha256,extraction_complete:true,
  indexed_sections:sections.length,indexed_segments:segments.length,source_bytes:size,
  limitations:['HTML visual, image and script content is not semantically interpreted.']}};
}
async function pdfSegments(file,timeoutMs){
 const data=await pdfText(file,{search_all:true,timeout_ms:timeoutMs});
 const segments=data.pages.flatMap(p=>windows(p.text).map(w=>({
  page:p.page,section:null,heading:null,start:w.start,end:w.end,text:w.text
 })));
 return {segments,coverage:{document_type:'pdf',original_file_sha256:data.original_file_sha256,total_pages:data.total_pages,
  examined_pages:data.examined_pages,text_pages:data.total_pages-data.ocr_required_pages.length,
  ocr_required_pages:data.ocr_required_pages,extraction_complete:data.extraction_complete,
  indexed_segments:segments.length,
  limitations:data.ocr_required_pages.length?['Pages with no extractable text require OCR.']:[],
  note:'PDF page text only; diagrams and embedded images are not interpreted.'}};
}
function rank(segment,query,terms){
 const hay=segment.text.toLocaleLowerCase('en');
 const heading=(segment.heading||'').toLocaleLowerCase('en');
 const phrase=query.toLocaleLowerCase('en').trim();
 const matched=terms.filter(t=>hay.includes(t)||heading.includes(t));
 if(!matched.length)return null;
 const hits=terms.reduce((acc,t)=>acc+(hay.includes(t)?1:0),0);
 const score=(hay.includes(phrase)?12:0)+(heading.includes(phrase)?8:0)+
  matched.length*3+hits+(matched.length===terms.length?8:0);
 let offset=hay.indexOf(phrase);
 if(offset<0){offset=Math.min(...matched.map(t=>hay.indexOf(t)).filter(n=>n>=0));}
 if(!Number.isFinite(offset)||offset<0)offset=0;
 const from=Math.max(0,offset-200),to=Math.min(segment.text.length,from+MAX_PASSAGE);
 return {page:segment.page,section:segment.section,heading:segment.heading,
  start:segment.start+from,end:segment.start+to,score,matched_terms:matched,
  passage:segment.text.slice(from,to),passage_truncated:from>0||to<segment.text.length};
}
function searchSegments(segments,query,limit=10){
 const terms=termsOf(query);
 const ranked=segments.map(s=>rank(s,query,terms)).filter(Boolean);
 ranked.sort((a,b)=>b.score-a.score||(a.page||0)-(b.page||0)||(a.section||0)-(b.section||0)||a.start-b.start);
 return {matches:ranked.slice(0,limit),total_matches:ranked.length,results_truncated:ranked.length>limit};
}
async function searchFile(file,mime,query,limit,timeoutMs){
 termsOf(query);
 const index=mime==='application/pdf'?await pdfSegments(file,timeoutMs):await htmlSegments(file);
 return {...searchSegments(index.segments,query,limit),coverage:index.coverage};
}
module.exports={searchFile,searchSegments,pdfSegments,htmlSegments,termsOf,windows,MAX_RESULTS,MAX_DOCUMENTS};
