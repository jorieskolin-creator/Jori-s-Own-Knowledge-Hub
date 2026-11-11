'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ReadableStream}=require('node:stream/web');
const {htmlStructure}=require('../api/_structure');
test('HTML structure extracts headings and reports whole-document examination',async()=>{
 const html='<html><head><style>h1{color:red}</style></head><body><h1>Architecture</h1><h2>Evidence Acquisition</h2><p>Control gate</p><script>ignore()</script></body></html>';
 const bytes=Buffer.from(html);
 const stream=new ReadableStream({start(c){c.enqueue(bytes);c.close()}});
 const r=await htmlStructure({stream,size:bytes.length});
 assert.equal(r.document_type,'html');
 assert.equal(r.extraction_complete,true);
 assert.equal(r.structure_complete,true);
 assert.deepEqual(r.headings.map(h=>h.heading),['Architecture','Evidence Acquisition']);
 assert.equal(r.headings[1].level,2);
 assert.equal(r.source_bytes,bytes.length);
});
