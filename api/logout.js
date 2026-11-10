const {send}=require('./_auth');
module.exports=async function(req,res){if(req.method!=='POST')return send(res,405,{error:'Method not allowed'});res.setHeader('Set-Cookie','__Host-kh_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');return send(res,200,{authenticated:false})};
