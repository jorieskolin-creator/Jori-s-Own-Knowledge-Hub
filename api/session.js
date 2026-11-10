const {send,valid}=require('./_auth');
module.exports=async function(req,res){if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});return send(res,200,{authenticated:valid(req,'admin')})};
