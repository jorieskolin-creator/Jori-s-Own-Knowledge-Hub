'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
process.env.SESSION_SECRET='test-secret-only-for-local-tests-'.repeat(3);
const OAuth=require('../api/_oauth');
const {sign:sessionSign}=require('../api/_auth');
const privateMcp=require('../api/mcp-private');
const oauthApi=require('../api/oauth');

function fakeResponse(){
 return {
  statusCode:200,headers:{},text:'',
  setHeader(k,v){this.headers[k.toLowerCase()]=v;return this},
  getHeader(k){return this.headers[k.toLowerCase()]},
  end(s=''){this.text=String(s);return this},
  status(s){this.statusCode=s;return this}
 };
}
async function request(handler,method,query={},body={},headers={}){
 const res=fakeResponse();
 await handler({method,query,body,headers},res);
 return res;
}
test('OAuth discovery identifies private MCP as resource',()=>{
 const p=OAuth.resourceMetadata();
 assert.equal(p.resource,OAuth.RESOURCE);
 assert.deepEqual(p.authorization_servers,[OAuth.BASE]);
 assert.ok(OAuth.metadata().registration_endpoint.includes('/oauth/register'));
});
test('Callback allowlist restricts redirection',()=>{
 assert.equal(OAuth.safeRedirect('https://chatgpt.com/connector/oauth/abc_012'),true);
 assert.equal(OAuth.safeRedirect('https://chatgpt.com/connector_platform_oauth_redirect'),true);
 assert.equal(OAuth.safeRedirect('https://chatgpt.com.evil.example/connector/oauth/abc'),false);
 assert.equal(OAuth.safeRedirect('https://evil.example/oauth/callback'),false);
 assert.equal(OAuth.safeRedirect('https://chatgpt.com/connector/oauth/abc#fragment'),false);
 assert.equal(OAuth.safeRedirect('javascript:alert(1)'),false);
});
test('Signed OAuth client cannot be forged',()=>{
 const id='khc.'+OAuth.sign({kind:'client',redirect_uris:['https://chatgpt.com/connector/oauth/abc'],exp:Date.now()+30000});
 assert.ok(OAuth.client(id));
 assert.equal(OAuth.client(id.slice(0,-1)+'x'),null);
});
test('Access token validates audience and scope',()=>{
 const tok=OAuth.token('admin','client-test');
 const req={headers:{authorization:'Bearer '+tok.access_token}};
 assert.equal(OAuth.authorized(req).sub,'admin');
 const wrong=OAuth.sign({kind:'access',aud:'https://evil.example',iss:OAuth.BASE,scope:OAuth.SCOPE,exp:Date.now()+10000});
 assert.equal(OAuth.authorized({headers:{authorization:'Bearer '+wrong}}),null);
 assert.equal(OAuth.authorized({headers:{}}),null);
});
test('Private MCP only lists tool schemas without authentication',async()=>{
 const init=await request(privateMcp,'POST',{}, {jsonrpc:'2.0',id:1,method:'initialize',params:{}});
 assert.equal(init.statusCode,200);
 const tools=await request(privateMcp,'POST',{}, {jsonrpc:'2.0',id:2,method:'tools/list'});
 const data=JSON.parse(tools.text);
 assert.equal(data.result.tools.length,10);
 assert.ok(data.result.tools.every(t=>t.securitySchemes?.[0]?.type==='oauth2'));
});
test('Unauthenticated private document call never returns document data',async()=>{
 const res=await request(privateMcp,'POST',{}, {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'list_documents',arguments:{}}});
 const body=JSON.parse(res.text);
 assert.equal(body.result.isError,true);
 assert.ok(body.result._meta['mcp/www_authenticate']);
 assert.ok(!JSON.stringify(body).includes('pathname'));
});
test('Unauthorized OAuth approval is rejected before accessing private Blob',async()=>{
 const res=await request(oauthApi,'POST',{route:'authorize'},{consent:'yes',request:'bad'}, {cookie:''});
 assert.equal(res.statusCode,401);
 assert.match(res.text,/Admin session required/);
});
test('Client registration rejects external redirect destinations',async()=>{
 const bad=await request(oauthApi,'POST',{route:'register'},{redirect_uris:['https://attacker.example/callback']});
 assert.equal(bad.statusCode,400);
 const okay=await request(oauthApi,'POST',{route:'register'},{redirect_uris:['https://chatgpt.com/connector/oauth/abc']});
 assert.equal(okay.statusCode,201);
 assert.ok(JSON.parse(okay.text).client_id.startsWith('khc.'));
});

test('OAuth form parser accepts URL encoded and JSON text without losing signed requests',()=>{
 const signature=OAuth.sign({kind:'authorization',exp:Date.now()+200000});
 for(const body of [
  'consent=yes&request='+encodeURIComponent(signature),
  Buffer.from('consent=yes&request='+encodeURIComponent(signature)),
  JSON.stringify({consent:'yes',request:signature}),
  {consent:'yes',request:signature}
 ]){
  const parsed=OAuth.form({body});
  assert.equal(parsed.consent,'yes');
  assert.equal(parsed.request,signature);
 }
});
test('OAuth consent binds to authenticated admin session without a second cookie',async()=>{
 const redirect='https://chatgpt.com/connector/oauth/test';
 const clientId='khc.'+OAuth.sign({kind:'client',redirect_uris:[redirect],exp:Date.now()+300000});
 const query={route:'authorize',client_id:clientId,redirect_uri:redirect,response_type:'code',
  code_challenge_method:'S256',code_challenge:'a'.repeat(43),state:'validstate123456',scope:OAuth.SCOPE};
 const adminCookie='__Host-kh_admin='+sessionSign('admin',1);
 const first=await request(oauthApi,'GET',query,{}, {cookie:adminCookie});
 assert.equal(first.statusCode,200);
 assert.equal(first.headers['set-cookie'],undefined);
 const signed=first.text.match(/name="request" value="([^"]+)"/)?.[1];
 assert.ok(signed);
 assert.equal(OAuth.verify(signed,'authorization').admin_session_hash,OAuth.hash(adminCookie.split('=')[1]));
 const again=await request(oauthApi,'GET',query,{}, {cookie:adminCookie});
 assert.equal(again.statusCode,200);
 assert.match(again.text,/Authorize read-only access/);
});
test('OAuth consent error classification preserves session binding and blocks cross-site approval',async()=>{
 const adminCookie='__Host-kh_admin='+sessionSign('admin',1);
 const approval=OAuth.sign({kind:'authorization',exp:Date.now()+60000,
  admin_session_hash:OAuth.hash(adminCookie.split('=')[1])});
 const cases=[
  [{consent:'yes'},'Authorization form could not be read',{}],
  [{consent:'yes',request:'invalid.signature'},'Authorization request expired or invalid',{}],
  [{consent:'yes',request:OAuth.sign({kind:'authorization',exp:Date.now()+60000,admin_session_hash:OAuth.hash('different-session')})},'Administrator session changed',{}],
  [{consent:'yes',request:approval},'Unauthorized approval origin',{origin:'https://attacker.example'}],
  [{consent:'yes',request:approval},'Unauthorized approval origin',{origin:'null'}],
  [{consent:'yes',request:approval},'Unauthorized approval context',{'sec-fetch-site':'cross-site'}]
 ];
 for(const [body,message,headers] of cases){
  const r=await request(oauthApi,'POST',{route:'authorize'},body,{cookie:adminCookie,...headers});
  assert.match(r.text,new RegExp(message));
  assert.ok([400,403].includes(r.statusCode));
 }
});

test('Opaque origin is accepted only with same-origin fetch metadata, but signed consent remains enforced',async()=>{
 const adminCookie='__Host-kh_admin='+sessionSign('admin',1);
 const r=await request(oauthApi,'POST',{route:'authorize'},
  {consent:'yes',request:'not-a-valid-signature'},
  {cookie:adminCookie,origin:'null','sec-fetch-site':'same-origin'});
 assert.equal(r.statusCode,403);
 assert.match(r.text,/Authorization request expired or invalid/);
 assert.doesNotMatch(r.text,/Unauthorized approval origin/);
});

test('OAuth authorization CSP permits self submission and registered ChatGPT redirect',async()=>{
 const redirect='https://chatgpt.com/connector/oauth/test';
 const clientId='khc.'+OAuth.sign({kind:'client',redirect_uris:[redirect],exp:Date.now()+300000});
 const q={route:'authorize',client_id:clientId,redirect_uri:redirect,response_type:'code',
  code_challenge_method:'S256',code_challenge:'a'.repeat(43),state:'validstate123456',scope:OAuth.SCOPE};
 const adminCookie='__Host-kh_admin='+sessionSign('admin',1);
 const page=await request(oauthApi,'GET',q,{}, {cookie:adminCookie});
 assert.equal(page.statusCode,200);
 assert.match(page.headers['content-security-policy'],/form-action 'self' https:\/\/chatgpt\.com;/);
 assert.doesNotMatch(page.headers['content-security-policy'],/form-action \*/);
 assert.match(page.text,/method="POST" action="\/oauth\/authorize"/);
});

test('Private MCP advertises read-only document structure inspection under OAuth',async()=>{
 const res=await request(privateMcp,'POST',{}, {jsonrpc:'2.0',id:33,method:'tools/list'});
 assert.equal(res.statusCode,200);
 const declared=JSON.parse(res.text).result.tools;
 const tool=declared.find(t=>t.name==='get_document_structure');
 assert.ok(tool);
 assert.equal(tool.annotations.readOnlyHint,true);
 assert.equal(tool.securitySchemes[0].type,'oauth2');
 assert.deepEqual(tool.inputSchema.required,['id']);
});
test('Private document structure requires authorization',async()=>{
 const res=await request(privateMcp,'POST',{}, {jsonrpc:'2.0',id:34,method:'tools/call',
  params:{name:'get_document_structure',arguments:{id:'private:01-solutions/cscf-demo/Secure Software Development Process_V1.0A.pdf'}}});
 const out=JSON.parse(res.text).result;
 assert.equal(out.isError,true);
 assert.match(out.content[0].text,/Authorization required/);
});

test('Private content search is advertised as OAuth-protected and read-only',async()=>{
 const res=await request(privateMcp,'POST',{}, {jsonrpc:'2.0',id:52,method:'tools/list'});
 const tools=JSON.parse(res.text).result.tools;
 const search=tools.find(t=>t.name==='search_content');
 assert.ok(search);
 assert.equal(search.annotations.readOnlyHint,true);
 assert.equal(search.securitySchemes[0].type,'oauth2');
 assert.deepEqual(search.inputSchema.required,['query','ids']);
});
test('Private content search rejects unauthorized calls before reading Blob',async()=>{
 const res=await request(privateMcp,'POST',{}, {jsonrpc:'2.0',id:53,method:'tools/call',params:{
  name:'search_content',arguments:{query:'security',ids:['private:01-solutions/cscf-demo/Secure Software Development Process_V1.0A.pdf']}}});
 assert.match(JSON.parse(res.text).result.content[0].text,/Authorization required/);
});

test('Private evidence package is declared read-only with OAuth authorization',async()=>{
 const r=await request(privateMcp,'POST',{}, {jsonrpc:'2.0',id:64,method:'tools/list'});
 const tools=JSON.parse(r.text).result.tools;
 const found=tools.find(t=>t.name==='retrieve_evidence');
 assert.ok(found);
 assert.equal(found.annotations.readOnlyHint,true);
 assert.equal(found.securitySchemes[0].type,'oauth2');
 assert.deepEqual(found.inputSchema.required,['query','ids']);
});
test('Unauthenticated private evidence package cannot inspect source material',async()=>{
 const r=await request(privateMcp,'POST',{}, {jsonrpc:'2.0',id:65,method:'tools/call',params:{
  name:'retrieve_evidence',arguments:{query:'security controls',ids:['private:01-solutions/cscf-demo/Secure Software Development Process_V1.0A.pdf'],mode:'focused'}}});
 const payload=JSON.parse(r.text).result;
 assert.equal(payload.isError,true);
 assert.match(payload.content[0].text,/Authorization required/);
});

test('Private coverage inspection requires OAuth and is marked read-only',async()=>{
 const declared=await request(privateMcp,'POST',{}, {jsonrpc:'2.0',id:80,method:'tools/list'});
 const tool=JSON.parse(declared.text).result.tools.find(t=>t.name==='verify_coverage');
 assert.ok(tool);
 assert.equal(tool.annotations.readOnlyHint,true);
 assert.equal(tool.securitySchemes[0].type,'oauth2');
 const r=await request(privateMcp,'POST',{}, {jsonrpc:'2.0',id:81,method:'tools/call',params:{
  name:'verify_coverage',arguments:{query:'evidence',ids:['private:01-solutions/cscf-demo/Secure Software Development Process_V1.0A.pdf']}}});
 assert.match(JSON.parse(r.text).result.content[0].text,/Authorization required/);
});

test('Private Master Table discovery and automatic evidence tools are OAuth-scoped',async()=>{
 const r=await request(privateMcp,'POST',{}, {jsonrpc:'2.0',id:90,method:'tools/list'});
 const definitions=JSON.parse(r.text).result.tools;
 for(const name of ['discover_sources','retrieve_topic_evidence']){
  const t=definitions.find(x=>x.name===name);
  assert.ok(t);
  assert.equal(t.annotations.readOnlyHint,true);
  assert.equal(t.securitySchemes[0].type,'oauth2');
  const noAuth=await request(privateMcp,'POST',{}, {jsonrpc:'2.0',id:91,method:'tools/call',
   params:{name,arguments:{query:'AI governance'}}});
  assert.match(JSON.parse(noAuth.text).result.content[0].text,/Authorization required/);
 }
});
test('Master Table administration rejects requests without an admin session',async()=>{
 const masterTable=require('../api/master-table');
 const r=await request(masterTable,'GET',{}, {}, {});
 assert.equal(r.statusCode,401);
 assert.match(r.text,/Admin login required/);
});
