'use strict';
// Unified, OAuth-scoped, evidence-only MCP. No full-document operations exist here.
const OAuth=require('./_oauth');
const {createService}=require('./_governed_unified');
const governed=require('./_governed_evidence');
const {MAX_QUERY_LENGTH,MAX_QUERY_TERMS,MAX_DOCUMENTS}=require('./_content_search');
const {MODES}=require('./_evidence_package');
const {RequestInputError,SourceAccessError}=require('./_request_errors');
const VERSION='2025-03-26';
const READ_ONLY={readOnlyHint:true};
const SECURITY=[{type:'oauth2',scopes:['documents:read']}];
const ID={type:'string',minLength:8,maxLength:1150};
const QUERY_GUIDANCE=`Use a concise query of 2–${MAX_QUERY_LENGTH} characters with at most ${MAX_QUERY_TERMS} distinct searchable terms.`;
const QUERY={type:'string',minLength:2,maxLength:MAX_QUERY_LENGTH,description:QUERY_GUIDANCE};
const IDS={type:'array',items:ID,minItems:1,maxItems:MAX_DOCUMENTS,uniqueItems:true};
const MODE={type:'string',enum:Object.keys(MODES)};
function tool(name,description,properties={},required=[]){
 return {name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},
  annotations:READ_ONLY,securitySchemes:SECURITY};
}
const TOOLS=[
 tool('list_documents','List only Approved documents from the last published Master Table across Public and Private stores. No raw URLs or document bodies.',
  {category:{type:'string'},subfolder:{type:'string'},limit:{type:'integer',minimum:1,maximum:100}}),
 tool('search_documents','Search metadata for Approved documents only; metadata is not evidence.',
  {query:{type:'string',minLength:1,maxLength:MAX_QUERY_LENGTH},limit:{type:'integer',minimum:1,maximum:50}},['query']),
 tool('get_document_metadata','Retrieve metadata for an Approved Public or Private source ID only; never returns its document body.',
  {id:ID},['id']),
 tool('discover_sources','Rank Approved Public and Private documents in the last published Master Table. '+QUERY_GUIDANCE,
  {query:QUERY,limit:{type:'integer',minimum:1,maximum:30}},['query']),
 tool('retrieve_evidence','Acquire bounded Evidence Packages from 1–4 Approved Public/Private IDs. '+QUERY_GUIDANCE,
  {query:QUERY,ids:IDS,mode:MODE},['query','ids']),
 tool('retrieve_topic_evidence','Discover Approved sources across both scopes and acquire one governed package from up to four top-ranked candidates. '+QUERY_GUIDANCE,
  {query:QUERY,mode:MODE},['query']),
 tool('verify_coverage','Recheck deterministic integrity for 1–4 Approved Public/Private sources and return coverage diagnostics. '+QUERY_GUIDANCE,
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
  if(typeof args!=='object'||Array.isArray(args))
   throw new RequestInputError('ARGUMENTS_TYPE','Tool arguments must be a JSON object.');
  const value=await service.execute(name,args);
  return send(res,200,rpc(id,{result:result(value)}));
 }catch(e){
  if(e instanceof RequestInputError){
   const message='Invalid tool arguments: '+e.message;
   return send(res,200,rpc(id,{result:{...fail(message),
    structuredContent:{error_code:'INVALID_ARGUMENT',reason:e.reason,message}}}));
  }
  // Source access denials and unexpected errors never expose source or provider details.
  const message=e instanceof SourceAccessError?
   'Invalid or unauthorized request to governed evidence service':'Governed evidence acquisition unavailable or incomplete';
  return send(res,200,rpc(id,{result:fail(message)}));
 }
};
module.exports.TOOLS=TOOLS;
