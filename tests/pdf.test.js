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
