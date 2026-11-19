'use strict';
const login=document.getElementById('chat-login');
const workspace=document.getElementById('chat-workspace');
const password=document.getElementById('chat-password');
const status=document.getElementById('chat-status');
const logout=document.getElementById('chat-logout');

async function chatRequest(action,body){
  const options={cache:'no-store'};
  if(body!==undefined){
    options.method='POST';
    options.headers={'Content-Type':'application/json'};
    options.body=JSON.stringify(body);
  }
  const response=await fetch('/api/chat?action='+action,options);
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'Chat temporarily unavailable');
  return result;
}
function showSession(authenticated){
  login.hidden=authenticated;
  workspace.hidden=!authenticated;
  status.textContent='';
}
login.addEventListener('submit',async event=>{
  event.preventDefault();
  const supplied=password.value;
  password.value='';
  const button=login.querySelector('button');
  button.disabled=true;
  try{showSession((await chatRequest('login',{password:supplied})).authenticated);}
  catch(error){status.textContent=error.message;}
  finally{button.disabled=false;}
});
logout.addEventListener('click',async()=>{
  try{showSession((await chatRequest('logout',{})).authenticated);}
  catch(error){status.textContent=error.message;}
});
chatRequest('session').then(result=>showSession(result.authenticated))
  .catch(error=>{status.textContent=error.message;});
