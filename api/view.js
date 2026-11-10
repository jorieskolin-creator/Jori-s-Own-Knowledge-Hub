const {get}=require('@vercel/blob');
const {Readable}=require('node:stream');
const {send,valid}=require('./_auth');

// This endpoint is intentionally public for documents from Public Blob.
// Private Blob requires an authenticated admin or guest session.
const PATH=/^0[1-6]-[a-z-]+\/(?:[a-z0-9._+() -]+\/)*[^/]+\.(?:html?|pdf)$/i;
function cleanPath(value){
  if(typeof value!=='string'||value.length>1024||!PATH.test(value))return null;
  if(value.split('/').some(p=>p==='.'||p==='..'||p.startsWith('.')))return null;
  return value;
}
module.exports=async function(req,res){
  if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'Method not allowed'});
  const access=req.query.access==='private'?'private':req.query.access==='public'?'public':null;
  const pathname=cleanPath(req.query.pathname);
  if(!access||!pathname)return send(res,400,{error:'Invalid document request'});
  if(access==='private'&&!valid(req,'guest')&&!valid(req,'admin'))return send(res,401,{error:'Guest password required'});
  const storeId=access==='public'
    ?(process.env.PUBLIC_BLOB_STORE_ID||process.env.BLOB_STORE_ID||'store_6mg9Vu2ypJJMAwV3')
    :(process.env.PRIVATE_BLOB_STORE_ID||'store_YAAwH6FewcrImhA1');
  try{
    const file=await get(pathname,{access,storeId});
    if(!file||file.statusCode===404||!file.stream)return send(res,404,{error:'Document not found'});
    const pdf=/\.pdf$/i.test(pathname);
    res.status(200);
    res.setHeader('Content-Type',pdf?'application/pdf':'text/html; charset=utf-8');
    res.setHeader('Content-Disposition','inline');
    res.setHeader('Cache-Control',access==='private'?'private, no-store, max-age=0':'public, max-age=60');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    // HTML must NOT get the parent app's origin. CSP sandbox isolates cookies and APIs.
    // Do not add allow-same-origin; interactive HTML may need asset rewriting in later versions.
    if(!pdf)res.setHeader('Content-Security-Policy',"sandbox allow-scripts allow-forms allow-popups; base-uri 'none'; frame-ancestors 'self'");
    if(req.method==='HEAD'){file.stream.cancel?.();return res.end()}
    Readable.fromWeb(file.stream).on('error',()=>res.end()).pipe(res);
  }catch(error){return send(res,503,{error:'Unable to render document from Blob storage'})}
};
