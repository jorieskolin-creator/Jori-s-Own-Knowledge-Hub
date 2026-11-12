'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ReadableStream}=require('node:stream/web');
const {searchSegments,searchFile,htmlSegments,termsOf}=require('../api/_content_search');
function htmlFile(s){
 const bytes=Buffer.from(s,'utf8');
 return {size:bytes.length,stream:new ReadableStream({start(c){c.enqueue(bytes);c.close()}})};
}
test('Lexical ranking uses full exact phrase and retains page provenance',()=>{
 const segments=[
  {page:57,section:null,heading:null,start:0,end:90,text:'Exception: change control must include security sign-off.'},
  {page:1,section:null,heading:null,start:0,end:60,text:'Architecture and security considerations.'},
  {page:3,section:null,heading:null,start:0,end:80,text:'Change management and cost visibility.'}
 ];
 const r=searchSegments(segments,'security sign-off',5);
 assert.equal(r.matches[0].page,57);
 assert.match(r.matches[0].passage,/security sign-off/);
 assert.ok(r.matches[0].score>r.matches[1]?.score||r.matches.length===1);
});
test('Input validation prevents empty, oversized or non-searchable queries',()=>{
 for(const q of ['', ' ', 'a','?','x'.repeat(201)])assert.throws(()=>termsOf(q),RangeError);
 assert.deepEqual(termsOf('Security security review'),['security','review']);
});
test('HTML content search indexes text across headings without scripts',async()=>{
 const raw='<h1>Architecture</h1><p>Platform overview.</p>'+
   '<h2>Risk and exceptions</h2><p>Escalation requires owner approval.</p>'+
   '<script>owner approval should not be indexed as script</script>'+
   '<h2>Other</h2><p>Operations information.</p>';
 const r=await searchFile(htmlFile(raw),'text/html','owner approval',10);
 assert.equal(r.coverage.document_type,'html');
 assert.equal(r.coverage.extraction_complete,true);
 assert.equal(r.coverage.original_file_sha256,
   require('node:crypto').createHash('sha256').update(raw).digest('hex'));
 assert.ok(r.matches.length>=1);
 assert.equal(r.matches[0].heading,'Risk and exceptions');
 assert.equal(r.matches[0].section,2);
 assert.match(r.matches[0].passage,/owner approval/);
 assert.equal(r.matches.some(m=>m.heading==='Other'),false);
});
test('HTML indexing examines entire document rather than response-chunk prefix',async()=>{
 const source='<h1>Beginning</h1><p>'+('introductory padding '.repeat(3500))+
  '</p><h2>Final policy</h2><p>Decisive exception needs written authorization.</p>';
 const r=await searchFile(htmlFile(source),'text/html','written authorization',10);
 assert.equal(r.matches[0].heading,'Final policy');
 assert.equal(r.coverage.extraction_complete,true);
 assert.ok(r.coverage.indexed_segments>10);
});
