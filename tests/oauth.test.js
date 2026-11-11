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
 assert.equal(data.result.tools.length,4);
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
