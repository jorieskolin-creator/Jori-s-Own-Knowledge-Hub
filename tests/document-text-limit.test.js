'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {MAX_HTML_TEXT_CHARACTERS,boundedHtmlText}=require('../api/_document_text_limit');
test('Direct HTML text is no longer truncated at 60,000 characters',()=>{
 assert.equal(MAX_HTML_TEXT_CHARACTERS,120000);
 for(const length of [60000,60001,119999,120000]){
  const r=boundedHtmlText('x'.repeat(length));
  assert.equal(r.text.length,length);
  assert.equal(r.truncated,false);
  assert.equal(r.extraction,'html-text');
 }
});
test('Direct HTML text over 120,000 characters is bounded and marked truncated',()=>{
 const r=boundedHtmlText('x'.repeat(120001));
 assert.equal(r.text.length,120000);
 assert.equal(r.truncated,true);
});
test('Bounded HTML text rejects unexpected non-text payloads',()=>{
 assert.throws(()=>boundedHtmlText(null),TypeError);
});
