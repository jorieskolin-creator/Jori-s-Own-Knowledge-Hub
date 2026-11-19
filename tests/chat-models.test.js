'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createModels,PRIMARY,FALLBACK,ModelUnavailable}=require('../api/_chat_models');
const {makeAnswer}=require('../api/_chat_answer');
const {ChatPolicy}=require('../api/_chat_privacy');

const fixture={ref:'H1',source:'private:01-solutions/hidden.html',access:'private',hash:'test',section:2,
  text:'An accountable reviewer checks the catalog before granting permission to proceed with the deployment.'};
function testAnswer(models){
  return makeAnswer({question:'What does the reviewer do?',evidence:{passages:[fixture]},hub:{assertCurrent:async()=>{}},models,key:'test'});
}
test('OpenAI transport fixes the model and endpoint and opts out of stored responses',async()=>{
  const sample={status:'supported',claims:[{text:'The reviewer checks the catalogue.',refs:['H1']}]};
  const model=createModels({env:{CHAT_OPENAI_REGION:'eu',CHAT_OPENAI_API_KEY:'synthetic',CHAT_OPENAI_CLASSES:'question,private'},
    fetcher:async(url,options)=>{
      assert.equal(url,'https://eu.api.openai.com/v1/responses');
      const body=JSON.parse(options.body);
      assert.equal(body.model,PRIMARY);
      assert.equal(body.store,false);
      assert.deepEqual(body.tools,[]);
      assert.equal(options.redirect,'error');
      return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(sample)}]}]});
    }
  });
  assert.deepEqual(await model.ask(PRIMARY,'chat_answer','test',{question:'Synthetic'}, {},new Set(['question','private'])),sample);
  await assert.rejects(()=>model.ask(PRIMARY,'chat_answer','test',{}, {},new Set(['attachment'])),ModelUnavailable);
});
test('Transient primary failure only uses an eligible fallback, with safe references on release',async()=>{
  const calls=[];
  const models={
    allowed:(id,classes)=>id===FALLBACK&&classes.has('private'),
    moderate:async texts=>texts.map(()=>false),
    ask:async (id,kind,_instructions,input)=>{
      calls.push([id,kind]);
      assert.doesNotMatch(JSON.stringify(input),/hidden\.html|private:/);
      if(id===PRIMARY)throw new ModelUnavailable();
      if(kind==='chat_verification')return {supported:true};
      return {status:'supported',claims:[{text:'The reviewer checks the catalogue.',refs:['H1']}]};
    }
  };
  const answer=await testAnswer(models);
  assert.equal(answer.status,'answer');
  assert.equal(answer.citations[0].section,2);
  assert.doesNotMatch(JSON.stringify(answer.citations),/hidden\.html|private:/);
  assert.deepEqual(calls,[[PRIMARY,'chat_answer'],[FALLBACK,'chat_answer'],[FALLBACK,'chat_verification']]);
  await assert.rejects(()=>testAnswer({...models,allowed:()=>false}),ModelUnavailable);
  await assert.rejects(()=>testAnswer({...models,ask:async()=>{throw new ChatPolicy();},
    allowed:()=>assert.fail('Policy refusal cannot trigger fallback')}),ChatPolicy);
});
test('Unknown refs, document copying, and unverified claims do not reach release',async()=>{
  function models(text,refs=['H1']){
    return {moderate:async texts=>texts.map(()=>false),
      ask:async (_id,kind)=>kind==='chat_verification'?{supported:false}:{status:'supported',claims:[{text,refs}]}};
  }
  await assert.rejects(()=>testAnswer(models('The reviewer checks the catalogue.',['X1'])),/citation/);
  await assert.rejects(()=>testAnswer(models(fixture.text)),ChatPolicy);
  const result=await testAnswer(models('The reviewer missed the deadline.'));
  assert.equal(result.status,'unknown');
});
