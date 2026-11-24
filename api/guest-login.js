const {send,sign,cookie,passwordOkay,postBody}=require('./_auth');
const {isSameOrigin}=require('./_chat_auth');
module.exports=async function(req,res){
  if(req.method!=='POST')return send(res,405,{error:'Method not allowed'});
  if(!isSameOrigin(req))return send(res,403,{error:'Invalid request origin'});
  try{
    const expected=process.env.GUEST_PASSWORD;
    if(!expected)return send(res,503,{error:'Guest password not configured'});
    const {password}=postBody(req);
    if(typeof password!=='string'||!passwordOkay(password,expected))
      return send(res,401,{error:'Invalid guest password'});
    const hours=2;
    res.setHeader('Set-Cookie',[cookie('guest',sign('guest',hours),hours*3600),cookie('admin','',0)]);
    return send(res,200,{authenticated:true,role:'guest'});
  }catch{
    return send(res,503,{error:'Guest authentication unavailable'});
  }
};
