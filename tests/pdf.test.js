'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ReadableStream}=require('node:stream/web');
const {pageRange,toBuffer,MAX_BYTES}=require('../api/_pdf');
test('PDF page ranges enforce positive inclusive bounded requests',()=>{
 assert.deepEqual(pageRange({}),{start:1,end:5});
 assert.deepEqual(pageRange({page_start:4,page_end:7}),{start:4,end:7});
 assert.deepEqual(pageRange({page_start:10}),{start:10,end:10});
 for(const o of [{page_start:0},{page_start:1,page_end:11},{page_start:3,page_end:2},{page_start:1.5},{page_end:'5'}])
  assert.throws(()=>pageRange(o),RangeError);
});
test('PDF streaming accepts bounded bytes without writing back to storage',async()=>{
 const chunks=[Buffer.from('%PDF-'),Buffer.from('test')];
 const stream=new ReadableStream({start(c){for(const x of chunks)c.enqueue(x);c.close()}});
 const b=await toBuffer({stream,size:9});
 assert.equal(b.toString(),'%PDF-test');
});
test('PDF extraction rejects files exceeding configured byte limit',async()=>{
 const stream=new ReadableStream({start(c){c.enqueue(Buffer.from('%PDF-test'));c.close()}});
 await assert.rejects(()=>toBuffer({stream,size:MAX_BYTES+1}),RangeError);
});

function makePdf(text){
 const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
 ];
 const stream='BT /F1 16 Tf 72 720 Td ('+text+') Tj ET';
 objects.push('<< /Length '+Buffer.byteLength(stream)+' >>\nstream\n'+stream+'\nendstream');
 let pdf='%PDF-1.4\n';
 const offsets=[0];
 for(let i=0;i<objects.length;i++){
  offsets.push(Buffer.byteLength(pdf));
  pdf+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';
 }
 const xref=Buffer.byteLength(pdf);
 pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';
 for(const offset of offsets.slice(1))pdf+=String(offset).padStart(10,'0')+' 00000 n \n';
 pdf+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
 return Buffer.from(pdf,'latin1');
}
test('PDF content extraction returns page number, text, and no OCR warning for text PDF',async()=>{
 const {pdfText}=require('../api/_pdf');
 const bytes=makePdf('Knowledge Hub PDF Test');
 const stream=new ReadableStream({start(c){c.enqueue(bytes);c.close()}});
 const output=await pdfText({stream,size:bytes.length},{page_start:1,page_end:1});
 assert.equal(output.total_pages,1);
 assert.equal(output.pages[0].page,1);
 assert.match(output.pages[0].text,/Knowledge Hub PDF Test/);
 assert.equal(output.extraction,'pdf-text');
 assert.deepEqual(output.ocr_required_pages,[]);
});

test('PDF structure inspection examines complete file without returning full text',async()=>{
 const {pdfText}=require('../api/_pdf');
 const bytes=makePdf('Full Document Structure Test');
 const stream=new ReadableStream({start(c){c.enqueue(bytes);c.close()}});
 const result=await pdfText({stream,size:bytes.length},{structure_only:true});
 assert.equal(result.total_pages,1);
 assert.equal(result.examined_pages,1);
 assert.equal(result.text_pages,1);
 assert.equal(result.extraction_coverage,1);
 assert.equal(result.text_layer_coverage,1);
 assert.equal(result.extraction_complete,true);
 assert.equal(result.pages[0].page,1);
 assert.match(result.pages[0].preview,/Full Document Structure Test/);
 assert.equal(result.text,undefined);
});

test('On-demand lexical search retrieves text from a PDF with numbered page source',async()=>{
 const {searchFile}=require('../api/_content_search');
 const bytes=makePdf('Evidence Acquisition Control');
 const stream=new ReadableStream({start(c){c.enqueue(bytes);c.close()}});
 const r=await searchFile({size:bytes.length,stream},'application/pdf','Evidence Acquisition',5);
 assert.equal(r.coverage.total_pages,1);
 assert.equal(r.coverage.examined_pages,1);
 assert.equal(r.coverage.extraction_complete,true);
 assert.equal(r.matches[0].page,1);
 assert.match(r.matches[0].passage,/Evidence Acquisition/);
});
