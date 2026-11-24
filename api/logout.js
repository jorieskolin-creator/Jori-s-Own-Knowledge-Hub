const {send,cookie}=require('./_auth');
module.exports=async function(req,res){
  if(req.method!=='POST')return send(res,405,{error:'Method not allowed'});
  res.setHeader('Set-Cookie',[cookie('admin','',0),cookie('guest','',0)]);
  return send(res,200,{authenticated:false});
};
