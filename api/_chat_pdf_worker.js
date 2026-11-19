'use strict';
const {pdfText}=require('./_pdf');

process.once('message',async message=>{
  try{
    const bytes=Buffer.from(message,'base64');
    if(bytes.length>4*1024*1024||bytes.subarray(0,5).toString('ascii')!=='%PDF-'||
      !/%%EOF\s*$/.test(bytes.subarray(-1024).toString('latin1')))throw Error('Invalid PDF');
    const syntax=bytes.toString('latin1').replace(/#([a-f0-9]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
    if(/\/(?:Encrypt|JavaScript|JS|OpenAction|AA|Launch|RichMedia|EmbeddedFiles|XFA)\b/.test(syntax))
      throw Error('Unsupported PDF features');
    const data=await pdfText({size:bytes.length,stream:new Blob([bytes]).stream()},{search_all:true,timeout_ms:6500});
    if(data.total_pages>40)throw Error('PDF page limit exceeded');
    const excerpts=[];
    let remaining=24000,incomplete=false;
    for(const page of data.pages){
      const text=page.text.trim();
      if(!text||text.length>remaining)incomplete=true;
      if(text&&remaining>0){
        excerpts.push({page:page.page,text:text.slice(0,remaining)});
        remaining-=text.length;
      }
    }
    process.send?.({excerpts,incomplete});
  }catch{process.send?.({invalid:true});}
});
