const {send,libraryRole}=require('./_auth');
module.exports=async function(req,res){
  if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
  const role=libraryRole(req);
  return send(res,200,{authenticated:Boolean(role),role});
};
