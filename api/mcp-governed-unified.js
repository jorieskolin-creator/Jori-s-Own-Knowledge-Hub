'use strict';
// Unified, OAuth-scoped, evidence-only MCP. No full-document operations exist here.
const OAuth=require('./_oauth');
const {createService}=require('./_governed_unified');
const governed=require('./_governed_evidence');
const VERSION='2025-03-26';
const READ_ONLY={readOnlyHint:true};
const SECURITY=[{type:'oauth2',scopes:['documents:read']}];
const ID={type:'string',minLength:8,maxLength:1150};
const QUERY={type:'string',minLength:2,maxLength:200};
const IDS={type:'array',items:ID,minItems:1,maxItems:4,uniqueItems:true};
const MODE={type:'string',enum:['focused','comparative','comprehensive']};
function tool(name,description,properties={},required=[]){
 return {name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},
  annotations:READ_ONLY,securitySchemes:SECURITY};
}
const TOOLS=[
 tool('list_documents','List categorized source metadata from both authorized Public and Private stores. No raw URLs or document bodies.',
  {category:{type:'string'},subfolder:{type:'string'},limit:{type:'integer',minimum:1,maximum:100}}),
 tool('search_documents','Search metadata only across Public and Private sources; metadata does not count as evidence.',
  {query:{type:'string',minLength:1,maxLength:200},limit:{type:'integer',minimum:1,maximum:50}},['query']),
 tool('get_document_metadata','Retrieve metadata for a Public or Private source ID; never returns its document body.',
  {id:ID},['id']),
 tool('discover_sources','Rank Public and Private candidates using current Master Table metadata and title/path fallback; not proof of recall.',
  {query:QUERY,limit:{type:'integer',minimum:1,maximum:30}},['query']),
 tool('retrieve_evidence','Acquire deterministic bounded Evidence Packages from 1–4 explicit Public/Private IDs; only integrity-gated passages are released.',
  {query:QUERY,ids:IDS,mode:MODE},['query','ids']),
 tool('retrieve_topic_evidence','Discover across Public and Private and acquire one governed package from up to four top-ranked candidate IDs.',
  {query:QUERY,mode:MODE},['query']),
 tool('verify_coverage','Recheck deterministic integrity without returning passage text, for up to four explicit Public/Private source IDs.',
  {query:QUERY,ids:IDS,mode:MODE},['query','ids'])
];
function send(res,status,value){
 res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 res.end(JSON.stringify(value));
}
function rpc(id,value){return {jsonrpc:'2.0',id,...value};}
function result(value){return {isError:false,structuredContent:value,content:[{type:'text',text:JSON.stringify(value)}]};}
function fail(message){return {isError:true,content:[{type:'text',text:message}]};}
const service=createService();
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method==='OPTIONS'){res.statusCode=204;return res.end();}
 if(req.method!=='POST')return send(res,405,{error:'MCP requests must use POST'});
 if(Number(req.headers?.['content-length']||0)>65536)return send(res,413,{error:'Request too large'});
 const data=typeof req.body==='object'?req.body:(()=>{try{return JSON.parse(req.body||'{}')}catch{return null}})();
 if(!data||Array.isArray(data)||typeof data!=='object')return send(res,400,{error:'Invalid JSON-RPC payload'});
 if(data.method==='notifications/initialized'){res.statusCode=202;return res.end();}
 if(data.jsonrpc!=='2.0'||!Object.prototype.hasOwnProperty.call(data,'id'))return send(res,400,{error:'Invalid JSON-RPC envelope'});
 const id=data.id;
 if(data.method==='initialize')return send(res,200,rpc(id,{result:{protocolVersion:VERSION,
  capabilities:{tools:{listChanged:false}},
  serverInfo:{name:'jori-knowledge-hub-governed-unified',version:'1.0.0'}}}));
 if(data.method==='ping')return send(res,200,rpc(id,{result:{}}));
 if(data.method==='tools/list')return send(res,200,rpc(id,{result:{tools:TOOLS}}));
 if(data.method!=='tools/call')return send(res,200,rpc(id,{error:{code:-32601,message:'Method not found'}}));
 if(!OAuth.authorized(req,OAuth.UNIFIED_RESOURCE)){
  const url=OAuth.BASE+'/.well-known/oauth-protected-resource/api/mcp-governed-unified';
  const challenge='Bearer resource_metadata="'+url+'", error="invalid_token", error_description="Authorize unified governed Knowledge Hub evidence"';
  res.setHeader('WWW-Authenticate',challenge);
  return send(res,200,rpc(id,{result:{isError:true,content:[{type:'text',text:'Authorization required'}],
   _meta:{'mcp/www_authenticate':[challenge]}}}));
 }
 if(!data.params||typeof data.params.name!=='string')
  return send(res,200,rpc(id,{error:{code:-32602,message:'Invalid tool parameters'}}));
 const name=data.params.name;
 if(!governed.allowed(name))return send(res,200,rpc(id,{result:fail('Operation not available in governed evidence-only mode')}));
 try{
  const args=data.params.arguments??{};
  if(!args||typeof args!=='object'||Array.isArray(args))return send(res,200,rpc(id,{result:fail('Invalid tool arguments')}));
  const value=await service.execute(name,args);
  return send(res,200,rpc(id,{result:result(value)}));
 }catch(e){
  // No raw Blob data, stack traces, secrets, or source content in error messages.
  const message=/Invalid |out of current|outside current|Query must|Specify |scope|source ID|candidate limit|retrieval mode/i.test(e.message||'')?
   'Invalid or unauthorized request to governed evidence service':'Governed evidence acquisition unavailable or incomplete';
  return send(res,200,rpc(id,{result:fail(message)}));
 }
};
module.exports.TOOLS=TOOLS;
