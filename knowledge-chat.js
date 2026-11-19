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
let previous=null;
let pending=null;

async function chatRequest(action,body,signal){
  const options={cache:'no-store',signal};
  if(body!==undefined){
    options.method='POST';
    options.headers={'Content-Type':'application/json'};
    options.body=JSON.stringify(body);
  }
  const response=await fetch('/api/chat?action='+action,options);
  const result=await response.json();
  if(!response.ok){
    if(response.status===401&&action!=='login')showSession(false);
    const wait=response.headers.get('Retry-After');
    throw Error((result.error||'Chat temporarily unavailable')+(wait?' Try again in '+wait+' seconds.':''));
  }
  return result;
}
function showSession(authenticated){
  login.hidden=authenticated;
  workspace.hidden=!authenticated;
  logout.hidden=!authenticated;
  statusMessage.textContent='';
  if(!authenticated){
    pending?.abort();
    previous=null;
    question.value='';
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
  try{showSession((await chatRequest('login',{password:supplied})).authenticated);}
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
  const button=el('chat-submit');
  pending=new AbortController();
  button.disabled=true;
  statusMessage.textContent='Checking the evidence…';
  try{
    const result=await chatRequest('answer',{question:combined},pending.signal);
    showAnswer(asked,result);
    previous={question:asked,expires:Date.now()+5*60*1000};
    followLabel.hidden=false;
    follow.checked=false;
    question.value='';
    statusMessage.textContent='';
  }catch(error){
    if(error.name!=='AbortError')statusMessage.textContent=error.message;
  }finally{pending=null;button.disabled=false;}
});
chatRequest('session').then(result=>showSession(result.authenticated))
  .catch(error=>{statusMessage.textContent=error.message;});
