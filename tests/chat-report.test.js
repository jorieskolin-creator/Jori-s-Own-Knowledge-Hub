'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Document,Packer,Paragraph}=require('docx');
const {createReport,referencePages}=require('../api/_chat_report');
const sample={status:'answer',claims:[{text:'An authorised reviewer checks the evidence.',refs:['H1']}],
  citations:[{ref:'H1',label:'Hub source abcdef012345',page:4,section:null}],limited:true};

test('Word export renders and is checked before release',async()=>{
  const result=await createReport(sample);
  assert.equal(result.subarray(0,2).toString(),'PK');
  assert.equal(await referencePages(result),1);
  await assert.rejects(()=>createReport(sample,async()=>{throw Error('Renderer unavailable');}),/Renderer unavailable/);
  await assert.rejects(()=>createReport({...sample,citations:[{ref:'H1',label:'private:source',page:4,section:null}]}),/Invalid Chat report citation/);
});
test('Rendered 24 and 25 page documents pass and 26 pages cannot be released',async()=>{
  for(const expected of [24,25,26]){
    const doc=new Document({sections:[{children:Array.from({length:expected},(_,i)=>
      new Paragraph({text:'Synthetic page '+(i+1),pageBreakBefore:i>0}))}]});
    const actual=await referencePages(await Packer.toBuffer(doc));
    assert.equal(actual,expected);
    if(expected<=25)assert.ok((await createReport(sample,async()=>actual)).length);
    else await assert.rejects(()=>createReport(sample,async()=>actual),/maximum length/);
  }
});
