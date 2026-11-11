'use strict';
const {list,get}=require('@vercel/blob');
const {Readable}=require('node:stream');
const OAuth=require('./_oauth');
const VERSION='2025-03-26';
const CATS={
 '01-solutions':'Solutions',
 '02-frameworks':'Frameworks & Methods',
 '03-general-presentations':'General Presentations',
 '04-shared-knowledge':'Shared Knowledge',
 '05-random':'Random',
 '06-personal':'Personal'
};
const SOLUTION_GROUPS={
 'solution-assurance-engine':'Solution Assurance Concept',
 'solution-assurance-documentation-support':'Solution Assurance Concept',
 'solution-assurance-concept':'Solution Assurance Concept'
};
const MAX_BYTES=6*1024*1024,MAX_TEXT=60000;
const storeId=()=>process.env.PRIVATE_BLOB_STORE_ID||'store_YAAwH6FewcrImhA1';
function permitted(path){
 if(typeof path!=='string'||path.length>1024||!/\.(?:html?|pdf)$/i.test(path))return false;
 const p=path.split('/');
 return p.length>1&&p.every(x=>x&&x!=='.'&&x!=='..'&&!x.startsWith('.'))&&Object.prototype.hasOwnProperty.call(CATS,p[0]);
}
function metadata(b){
 const p=b.pathname.split('/'),subfolder=p.length>2?p.slice(1,-1).join('/'):null;
 return {id:'private:'+b.pathname,title:p.at(-1).replace(/\.(?:html?|pdf)$/i,'').replace(/[-_]+/g,' '),
   category:CATS[p[0]],subfolder,display_group:SOLUTION_GROUPS[p[1]]||subfolder||'General',
   access:'private',pathname:b.pathname,mime_type:/\.pdf$/i.test(b.pathname)?'application/pdf':'text/html',
   updated:b.uploadedAt||null,source_url:null};
}
async function entries(){
 let cursor,all=[];
 do{const r=await list({storeId:storeId(),limit:1000,...(cursor?{cursor}:{})});all.push(...r.blobs);cursor=r.hasMore?r.cursor:null}while(cursor);
 return all.filter(b=>permitted(b.pathname)).map(metadata);
}
function stripHtml(h){
 return h.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,' ')
 .replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li|\/tr)\b[^>]*>/gi,'\n').replace(/<[^>]+>/g,' ')
 .replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
 .replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/[ \t]+/g,' ').replace(/\n\s*\n\s*\n/g,'\n\n').trim();
}
async function getContent(doc){
 if(!permitted(doc.pathname)||doc.access!=='private')throw Error('Not permitted');
 const file=await get(doc.pathname,{access:'private',storeId:storeId()});
 if(!file||!file.stream)throw Error('Document not found');
 if(doc.mime_type==='application/pdf')return {text:'PDF text extraction is not enabled in this initial MCP release. Open the source URL to inspect the PDF.',truncated:false,extraction:'metadata-only'};
 if(file.size>MAX_BYTES)throw Error('Document exceeds maximum retrieval size');
 const chunks=[];let total=0;
 for await(const chunk of Readable.fromWeb(file.stream)){
  total+=chunk.length;
  if(total>MAX_BYTES)throw Error('Document exceeds maximum retrieval size');
  chunks.push(chunk);
 }
 const text=stripHtml(Buffer.concat(chunks).toString('utf8'));
 return {text:text.slice(0,MAX_TEXT),truncated:text.length>MAX_TEXT,extraction:'html-text'};
}
function result(value){return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError:false}}
function fail(message){return {content:[{type:'text',text:String(message)}],isError:true}}
const TOOLS=[
 {name:'list_documents',description:'List private Knowledge Hub documents in the six explicit storage categories. Root-level files are excluded; access requires OAuth.',inputSchema:{type:'object',properties:{category:{type:'string'},subfolder:{type:'string'},limit:{type:'integer',minimum:1,maximum:100}},additionalProperties:false},annotations:{readOnlyHint:true},securitySchemes:[{type:'oauth2',scopes:['documents:read']}]},
 {name:'search_documents',description:'Search private Knowledge Hub document titles, categories, paths, and display groups. Metadata search only; not full-text.',inputSchema:{type:'object',properties:{query:{type:'string'},limit:{type:'integer',minimum:1,maximum:50}},required:['query'],additionalProperties:false},annotations:{readOnlyHint:true},securitySchemes:[{type:'oauth2',scopes:['documents:read']}]},
 {name:'get_document_metadata',description:'Fetch source metadata for a private Knowledge Hub document by its private:path identifier.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:true},securitySchemes:[{type:'oauth2',scopes:['documents:read']}]},
 {name:'get_document',description:'Read the text of an authenticated Private HTML document by private:path identifier. PDF is currently metadata-only. Only authorized read-only access to private documents.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:true},securitySchemes:[{type:'oauth2',scopes:['documents:read']}]}
];
async function callTool(name,args){
 if(name==='list_documents'){
  const docs=await entries(),limit=Math.min(100,Math.max(1,Number(args.limit)||100));
  const subset=docs.filter(d=>(!args.category||d.category===args.category||d.pathname.startsWith(args.category+'/'))&&(!args.subfolder||d.subfolder===args.subfolder));
  return result({documents:subset.slice(0,limit),total:subset.length,truncated:subset.length>limit});
 }
 if(name==='search_documents'){
  const q=String(args.query||'').trim().toLowerCase();if(!q||q.length>200)return fail('Search query must contain 1–200 characters');
  const docs=await entries();const found=docs.filter(d=>[d.title,d.category,d.pathname,d.display_group].join(' ').toLowerCase().includes(q));
  const limit=Math.min(50,Math.max(1,Number(args.limit)||20));
  return result({documents:found.slice(0,limit),total:found.length,search_scope:'metadata',truncated:found.length>limit});
 }
 if(name==='get_document'||name==='get_document_metadata'){
  const id=String(args.id||'');if(!id.startsWith('private:')||!permitted(id.slice(8)))return fail('Only categorized private document identifiers are allowed');
  const docs=await entries();const doc=docs.find(d=>d.id===id);
  if(!doc)return fail('Document not found in Private catalog');
  if(name==='get_document_metadata')return result(doc);
  const body=await getContent(doc);return result({...doc,...body});
 }
 return fail('Unknown tool');
}
function send(res,status,data){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(data))}
function rpc(id,payload){return {jsonrpc:'2.0',id,...payload}}
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}
 if(req.method!=='POST')return send(res,405,{error:'MCP requests must use POST'});
 const size=Number(req.headers['content-length']||0);
 if(size>65536)return send(res,413,{error:'Request too large'});
 const data=typeof req.body==='object'?req.body:(()=>{try{return JSON.parse(req.body||'{}')}catch{return {}}})();
 if(!data||Array.isArray(data)||typeof data!=='object')return send(res,400,{error:'Invalid JSON-RPC request'});
 if(data.method==='notifications/initialized'){res.statusCode=202;return res.end()}
 if(data.jsonrpc!=='2.0'||!Object.prototype.hasOwnProperty.call(data,'id'))return send(res,400,{error:'Invalid JSON-RPC envelope'});
 try{
  if(data.method==='initialize')return send(res,200,rpc(data.id,{result:{protocolVersion:VERSION,capabilities:{tools:{listChanged:false}},serverInfo:{name:'jori-knowledge-hub-private',version:'0.1.0'}}}));
  if(data.method==='ping')return send(res,200,rpc(data.id,{result:{}}));
  if(data.method==='tools/list')return send(res,200,rpc(data.id,{result:{tools:TOOLS}}));
  if(data.method==='tools/call'){
   if(!OAuth.authorized(req)){
    const challenge='Bearer resource_metadata="'+OAuth.BASE+'/.well-known/oauth-protected-resource", error="invalid_token", error_description="Authorize Knowledge Hub Private to read protected documents"';
    res.setHeader('WWW-Authenticate',challenge);
    return send(res,200,rpc(data.id,{result:{isError:true,content:[{type:'text',text:'Authorization required'}],_meta:{'mcp/www_authenticate':[challenge]}}}));
   }
   if(!data.params||typeof data.params.name!=='string')return send(res,200,rpc(data.id,{error:{code:-32602,message:'Invalid params'}}));
   const output=await callTool(data.params.name,data.params.arguments||{});
   return send(res,200,rpc(data.id,{result:output}));
  }
  return send(res,200,rpc(data.id,{error:{code:-32601,message:'Method not found'}}));
 }catch(e){
  // Do not leak storage credentials, Blob internals or stack traces.
  return send(res,200,rpc(data.id,{result:fail('Knowledge Hub retrieval failed. Check storage configuration or document availability.')}));
 }
};
