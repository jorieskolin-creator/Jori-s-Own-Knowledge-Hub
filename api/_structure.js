'use strict';
// Lightweight structural inspection. It never stores document derivatives.
const {Readable}=require('node:stream');
const MAX_HTML_BYTES=6*1024*1024;
async function htmlStructure(file){
 if(Number.isFinite(file.size)&&file.size>MAX_HTML_BYTES)throw Error('HTML document exceeds the 6 MB inspection limit');
 const chunks=[];let bytes=0;
 for await(const c of Readable.fromWeb(file.stream)){
  bytes+=c.length;
  if(bytes>MAX_HTML_BYTES)throw Error('HTML document exceeds the 6 MB inspection limit');
  chunks.push(c);
 }
 const markup=Buffer.concat(chunks).toString('utf8');
 const cleaned=markup.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,' ');
 const headings=[];let headingsTruncated=false;
 const tags=/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;
 let match;
 while((match=tags.exec(cleaned))!==null){
  const value=match[2].replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&')
   .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/\s+/g,' ').trim();
  if(value)headings.push({level:Number(match[1]),heading:value.slice(0,250),source_offset:match.index});
  if(headings.length>=500){headingsTruncated=true;break;}
 }
 const text=cleaned.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
 return {document_type:'html',extraction:'html-text',extraction_complete:true,
  structure_complete:!headingsTruncated,headings,heading_count:headings.length,
  extracted_characters:text.length,source_bytes:bytes,
  notes:'HTML text was inspected. Heading positions are source markup offsets, not page numbers.'};
}
module.exports={htmlStructure,MAX_HTML_BYTES};
