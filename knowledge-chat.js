'use strict';
const el=id=>document.getElementById(id);
const login=el('chat-login');
const workspace=el('chat-workspace');
const password=el('chat-password');
const statusMessage=el('chat-status');
const logout=el('chat-logout');
const questionForm=el('chat-question-form');
const question=el('chat-question');
const results=el('chat-results');
const followLabel=el('chat-follow-label');
const follow=el('chat-follow');
const pdfFields=el('chat-pdf-fields');
const pdfFiles=el('chat-pdfs');
const wordLabel=el('chat-word-label');
const word=el('chat-word');
let previous=null;
let pending=null;

async function chatRequest(action,body,signal){
  const options={cache:'no-store',signal};
  if(body!==undefined){
    options.method='POST';
    if(body instanceof FormData)options.body=body;
    else{
      options.headers={'Content-Type':'application/json'};
      options.body=JSON.stringify(body);
    }
  }
  const response=await fetch('/api/chat?action='+action,options);
  if(response.ok&&response.headers.get('content-type')?.startsWith('application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
    return {report:await response.blob()};
  const result=await response.json();
  if(!response.ok){
    if(response.status===401&&action!=='login')showSession(false);
    const wait=response.headers.get('Retry-After');
    throw Error((result.error||'Chat temporarily unavailable')+(wait?' Try again in '+wait+' seconds.':''));
  }
  return result;
}
function showSession(authenticated,pdfs=false,wordEnabled=false){
  pdfFields.hidden=!pdfs;
  wordLabel.hidden=!wordEnabled;
  login.hidden=authenticated;
  workspace.hidden=!authenticated;
  logout.hidden=!authenticated;
  statusMessage.textContent='';
  if(!authenticated){
    pending?.abort();
    previous=null;
    question.value='';
    pdfFiles.value='';
    word.checked=false;
    results.replaceChildren();
    follow.checked=false;
    followLabel.hidden=true;
  }
}
function insert(parent,tag,text){
  const node=document.createElement(tag);
  node.textContent=text;
  parent.append(node);
  return node;
}
function showAnswer(asked,result){
  const article=document.createElement('article');
  insert(article,'h2',asked);
  if(result.status==='answer'){
    for(const claim of result.claims)insert(article,'p',claim.text+' ['+claim.refs.join(', ')+']');
    const details=insert(article,'details','');
    insert(details,'summary','Evidence');
    const list=insert(details,'ul','');
    for(const source of result.citations){
      const locator=source.page!==null?' · page '+source.page:source.section!==null?' · section '+source.section:'';
      insert(list,'li',source.ref+' · '+source.label+locator);
    }
  }else insert(article,'p',result.answer);
  if(result.limited)insert(article,'p','The evidence search or available passages were limited.').className='hint';
  results.prepend(article);
  while(results.children.length>10)results.lastElementChild.remove();
}
login.addEventListener('submit',async event=>{
  event.preventDefault();
  const supplied=password.value;
  password.value='';
  const button=login.querySelector('button');
  button.disabled=true;
  try{const result=await chatRequest('login',{password:supplied});showSession(result.authenticated,result.pdfs,result.word);}
  catch(error){statusMessage.textContent=error.message;}
  finally{button.disabled=false;}
});
logout.addEventListener('click',async()=>{
  try{showSession((await chatRequest('logout',{})).authenticated);}
  catch(error){statusMessage.textContent=error.message;}
});
questionForm.addEventListener('submit',async event=>{
  event.preventDefault();
  if(pending)return;
  const asked=question.value.trim();
  const context=follow.checked&&previous&&previous.expires>Date.now()?previous.question:null;
  const combined=context?context+'\n'+asked:asked;
  if(combined.length>1200){statusMessage.textContent='Shorten the question or clear the previous-question option.';return;}
  const files=pdfFields.hidden?[]:[...pdfFiles.files];
  if(files.length>2||files.reduce((sum,file)=>sum+file.size,0)>=4*1024*1024){
    statusMessage.textContent='Choose up to two PDFs under 4 MB combined.';return;
  }
  const format=!wordLabel.hidden&&word.checked?'word':'chat';
  let payload={question:combined,format};
  if(files.length){
    payload=new FormData();
    payload.set('question',combined);
    payload.set('format',format);
    for(const file of files)payload.append('pdf',file);
  }
  const button=el('chat-submit');
  pending=new AbortController();
  button.disabled=true;
  statusMessage.textContent='Checking the evidence…';
  try{
    const result=await chatRequest('answer',payload,pending.signal);
    if(result.report){
      const url=URL.createObjectURL(result.report);
      const link=document.createElement('a');
      link.href=url;
      link.download='knowledge-hub-chat-report.docx';
      link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }else showAnswer(asked,result);
    previous=files.length?null:{question:asked,expires:Date.now()+5*60*1000};
    followLabel.hidden=!previous;
    pdfFiles.value='';
    follow.checked=false;
    question.value='';
    statusMessage.textContent='';
  }catch(error){
    if(error.name!=='AbortError')statusMessage.textContent=error.message;
  }finally{pending=null;button.disabled=false;}
});
chatRequest('session').then(result=>showSession(result.authenticated,result.pdfs,result.word))
  .catch(error=>{statusMessage.textContent=error.message;});
