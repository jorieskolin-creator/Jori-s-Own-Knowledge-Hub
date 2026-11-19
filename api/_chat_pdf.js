'use strict';
const {fork}=require('node:child_process');
const {resolve}=require('node:path');
const MAX_UPLOAD=4*1024*1024;
class ChatPdfError extends Error{
  constructor(){super('Attach up to two readable PDFs under 4 MB combined. Each PDF can have up to 40 pages.');}
}
async function rawBody(req){
  if(Number(req.headers['content-length'])>MAX_UPLOAD)throw new ChatPdfError();
  if(Buffer.isBuffer(req.body)){
    if(req.body.length>MAX_UPLOAD)throw new ChatPdfError();
    return req.body;
  }
  const chunks=[];
  let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>MAX_UPLOAD)throw new ChatPdfError();
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks,size);
}
async function readUpload(req){
  const type=req.headers['content-type']||'';
  if(!/^multipart\/form-data\s*;/i.test(type)||type.length>240)throw new ChatPdfError();
  const bytes=await rawBody(req);
  let form;
  try{form=await new Response(bytes,{headers:{'content-type':type}}).formData();}
  catch{throw new ChatPdfError();}
  const files=form.getAll('pdf');
  const question=form.get('question');
  const format=form.get('format')||'chat';
  if(files.length>2||files.some(file=>typeof file==='string'||file.type!=='application/pdf'||!file.size)||
    form.getAll('question').length!==1||form.getAll('format').length>1||typeof question!=='string'||
    typeof format!=='string'||[...form.keys()].some(k=>!['pdf','question','format'].includes(k)))throw new ChatPdfError();
  return {question,format,files};
}
async function isolatedPdf(file,signal){
  const encoded=Buffer.from(await file.arrayBuffer()).toString('base64');
  if(signal.aborted)throw new ChatPdfError();
  return new Promise((resolveResult,reject)=>{
    const child=fork(require.resolve('./_chat_pdf_worker'),[],{
      env:{NODE_ENV:'production'},
      stdio:['ignore','ignore','ignore','ipc'],
      execArgv:['--permission','--allow-fs-read='+__dirname,
        '--allow-fs-read='+resolve(__dirname,'../node_modules'),'--max-old-space-size=96',
        '--disallow-code-generation-from-strings']
    });
    let settled=false;
    function settle(error,result){
      if(settled)return;
      settled=true;
      clearTimeout(timeout);
      signal.removeEventListener('abort',aborted);
      child.kill('SIGKILL');
      if(error)reject(error);
      else resolveResult(result);
    }
    const timeout=setTimeout(()=>settle(new ChatPdfError()),8000);
    const aborted=()=>settle(new ChatPdfError());
    signal.addEventListener('abort',aborted,{once:true});
    child.once('message',result=>{
      if(!Array.isArray(result?.excerpts))settle(new ChatPdfError());
      else settle(null,result);
    });
    child.once('error',()=>settle(new ChatPdfError()));
    child.once('exit',()=>settle(new ChatPdfError()));
    child.send(encoded,error=>{if(error)settle(new ChatPdfError());});
  });
}
async function attachmentEvidence(files,question,signal,extract=isolatedPdf){
  const terms=new Set(question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[]);
  const passages=[];
  let incomplete=false;
  for(const [index,file] of files.entries()){
    const doc=await extract(file,signal);
    incomplete||=doc.incomplete||!doc.excerpts.length;
    const ranked=doc.excerpts.flatMap(page=>{
      const parts=[];
      for(let i=0;i<page.text.length;i+=850){
        const text=page.text.slice(i,i+1000);
        const lower=text.toLowerCase();
        const score=[...terms].filter(term=>lower.includes(term)).length;
        if(score)parts.push({text,score,page:page.page});
      }
      return parts;
    }).sort((a,b)=>b.score-a.score);
    for(const candidate of ranked.slice(0,2)){
      passages.push({ref:'A'+(passages.length+1),source:'User-provided PDF '+(index+1),
        access:'attachment',page:candidate.page,text:candidate.text});
    }
    if(ranked.length>2)incomplete=true;
  }
  return {passages,incomplete};
}
module.exports={readUpload,attachmentEvidence,ChatPdfError,isolatedPdf};
