const {list}=require('@vercel/blob');
const {send,valid}=require('./_auth');
const {isGoldenStandardPath}=require('./_master_table');

const CATS={
  '01-solutions':'Solutions',
  '02-frameworks':'Frameworks & Methods',
  '03-general-presentations':'General Presentations',
  '04-shared-knowledge':'Shared Knowledge',
  '05-random':'Random',
  '06-personal':'Personal'
};
const cleanTitle=s=>s.replace(/\.(?:html?|pdf)$/i,'').replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim();

// Only deliberately classified files are indexed. Root-level files and files
// outside the six designated category folders must remain invisible in the Hub.
function isIndexedDocument(pathname){
  if(typeof pathname!=='string'||!/\.(?:html?|pdf)$/i.test(pathname))return false;
  const parts=pathname.split('/');
  return parts.length>=2&&parts.every(Boolean)&&Object.hasOwn(CATS,parts[0]);
}

async function scan(storeId,access){
  const all=[];
  let cursor;
  do{
    const opts={limit:1000,storeId,...(cursor?{cursor}:{})};
    const r=await list(opts);
    all.push(...r.blobs);
    cursor=r.hasMore?r.cursor:null;
  }while(cursor);
  return all.filter(b=>isIndexedDocument(b.pathname)).map(b=>{
    const p=b.pathname.split('/');
    return {
      id:access+':'+b.pathname,
      title:cleanTitle(p[p.length-1]),
      category:CATS[p[0]],
      group:p.length>2?cleanTitle(p.slice(1,-1).join(' / ')):'General',
      access,
      golden_standard:isGoldenStandardPath(b.pathname),
      pathname:b.pathname,
      url:access==='public'?b.url:null,
      updated:b.uploadedAt||null,
      size:b.size,
      origin:'blob'
    };
  });
}

module.exports=async function(req,res){
  if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
  if(!valid(req,'admin'))return send(res,401,{error:'Admin login required'});
  const warnings=[];
  let publicDocs=[],privateDocs=[];
  try{
    publicDocs=await scan(process.env.PUBLIC_BLOB_STORE_ID||process.env.BLOB_STORE_ID||'store_6mg9Vu2ypJJMAwV3','public');
  }catch{
    warnings.push('Public storage unavailable. Check Blob project connection and credentials.');
  }
  try{
    privateDocs=await scan(process.env.PRIVATE_BLOB_STORE_ID||'store_YAAwH6FewcrImhA1','private');
  }catch{
    warnings.push('Private storage unavailable. Check the Private Blob project connection and redeploy.');
  }
  let legacy=[];
  try{
    legacy=require('../catalog/public-documents.json').documents.map(d=>({
      id:d.id,title:d.title,
      category:({'solutions':'Solutions','frameworks':'Frameworks & Methods','presentations':'General Presentations','shared':'Shared Knowledge','random':'Random','personal':'Personal'})[d.category]||'Random',
      group:d.group||'Existing deployment',access:'public',url:d.url,updated:d.updated,origin:'legacy'
    }));
  }catch{}
  return send(res,200,{
    documents:[...publicDocs,...privateDocs,...legacy],
    counts:{public:publicDocs.length,private:privateDocs.length,legacy:legacy.length},
    warnings,
    checkedAt:new Date().toISOString()
  });
};
