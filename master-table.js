'use strict';
(function(){
 const byId=id=>document.getElementById(id);
 const control=byId('refresh')?.parentElement;if(!control)return;
 const style=document.createElement('style');
 style.textContent='#mtDialog{border:1px solid #dbe4eb;border-radius:14px;box-shadow:0 24px 90px #13233e44;padding:0;width:min(1300px,96vw);max-width:none;height:90vh;max-height:95vh;color:#142840}'+
 '#mtDialog::backdrop{background:#10203088}.mt-header,.mt-tools{display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid #e1e8ef;flex-wrap:wrap}'+
 '.mt-header h2{margin:0;flex:1}.mt-tools input{min-width:180px;flex:1}.mt-tools button{font-size:12px}.mt-main{display:grid;grid-template-columns:53% 47%;height:calc(100% - 185px)}'+
 '.mt-list,.mt-editor{overflow:auto;padding:12px}.mt-list{border-right:1px solid #e1e8ef}.mt-list table{width:100%;border-collapse:collapse;font-size:12px}'+
 '.mt-list td,.mt-list th{padding:9px;border-bottom:1px solid #e1e8ef;text-align:left;vertical-align:top}.mt-list tr{cursor:pointer}'+
 '.mt-list tr:hover,.mt-selected{background:#e7f5ed}.mt-editor label{font-size:12px;font-weight:bold;display:block;margin-top:10px}.mt-editor textarea,.mt-editor input,.mt-editor select{width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;font:13px system-ui}'+
 '.mt-editor textarea{min-height:90px;resize:vertical}.mt-actions{display:flex;justify-content:flex-end;gap:10px;padding:13px 0}.mt-msg{padding:8px 20px;font-size:12px;color:#475569;min-height:32px}'+
 '.mt-error{color:#b42318}.mt-small{color:#64748b;font-size:11px}.mt-preview{color:#617085;line-height:1.4}.mt-editor input[readonly]{background:#eef2f6}'+
 '@media(max-width:820px){.mt-main{display:block;height:65vh;overflow:auto}.mt-list,.mt-editor{max-height:45vh;border-right:0;border-bottom:1px solid #e1e8ef}}';
 document.head.appendChild(style);
 function node(tag,content,cls){const n=document.createElement(tag);if(content!==undefined)n.textContent=String(content);if(cls)n.className=cls;return n}
 const updateButton=node('button','↻ Update the Master Table','secondary');updateButton.type='button';
 const openButton=node('button','▤ Master Table','secondary');openButton.type='button';
 control.append(updateButton,openButton);
 const dialog=document.createElement('dialog');dialog.id='mtDialog';
 dialog.innerHTML='<div class="mt-header"><h2>Master Table</h2><span id="mtCount" class="small"></span><button type="button" class="secondary" id="mtClose">Close</button></div>'+
 '<div class="mt-tools"><input id="mtSearch" type="search" placeholder="Search summary, title, keywords and themes">'+
 '<select id="mtScope"><option value="all">All documents</option><option value="public">Public</option><option value="private">Private</option></select>'+
 '<button id="mtReload" type="button" class="secondary">Reload</button>'+
 '<button id="mtImport" type="button" class="secondary">Import reviewed JSON</button>'+
 '<input class="hidden" type="file" id="mtJsonFile" accept=".json,application/json"></div>'+
 '<div id="mtMessage" class="mt-msg" role="status"></div>'+
 '<div class="mt-main"><section class="mt-list"><table><thead><tr><th>Document</th><th>Access</th><th>Discovery description</th></tr></thead><tbody id="mtRows"></tbody></table></section>'+
 '<section id="mtEditor" class="mt-editor"><p>Select a document to edit its Master Table metadata.</p></section></div>';
 document.body.appendChild(dialog);
 const state={records:[],etag:null,selected:null,busy:false};
 function message(s,error=false){byId('mtMessage').textContent=s;byId('mtMessage').classList.toggle('mt-error',error)}
 async function request(action,properties={}){
  const read=action==='load';
  const res=await fetch('/api/master-table',{method:read?'GET':'POST',cache:'no-store',credentials:'same-origin',
   ...(read?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...properties})})});
  let body={};try{body=await res.json()}catch{}
  if(!res.ok)throw Error(body.error||'HTTP '+res.status);return body;
 }
 const wordCount=s=>(String(s||'').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)||[]).length;
 function field(parent,label,value,multi,readonly=false){
  parent.append(node('label',label));
  const input=document.createElement(multi?'textarea':'input');input.value=value??'';
  if(!multi)input.type='text';input.readOnly=readonly;parent.append(input);return input;
 }
 function choice(parent,label,value,options){
  parent.append(node('label',label));
  const select=document.createElement('select');
  for(const [key,title] of options){const o=document.createElement('option');o.value=key;o.textContent=title;select.append(o);}
  select.value=value??options[0][0];parent.append(select);return select;
 }
 function values(s){return String(s).split(/[\n,]/g).map(x=>x.trim()).filter(Boolean)}
 function edit(){
  const host=byId('mtEditor');host.replaceChildren();
  const item=state.records.find(r=>r.id===state.selected);
  if(!item){host.append(node('p','Select a document to edit its Master Table metadata.'));return}
  host.append(node('h3',item.title));
  host.append(node('p',item.access+' · '+item.category+' · '+(item.source_available?'Source available':'SOURCE MISSING'),'mt-small'));
  if(item.source_changed)host.append(node('p','Source fingerprint changed. Review the replacement document before saving.','mt-error'));
  field(host,'Source ID (not editable)',item.id,false,true);
  field(host,'Source metadata title (deterministic, not editable)',item.source_metadata_title||'',false,true);
  field(host,'Source hash (verified original bytes, if available)',item.source_hash||'Not available',false,true);
  const title=field(host,'Display title',item.title,false);
  const type=field(host,'Document type',item.document_type,false);
  const summary=field(host,'Summary (120–135 words)',item.summary,true);
  const count=node('div',wordCount(summary.value)+' words','mt-small');host.append(count);
  summary.oninput=()=>count.textContent=wordCount(summary.value)+' words · target 120–135';
  const terms=field(host,'Key terms (comma separated, 12–25 meaningful terms)',(item.key_terms||[]).join(', '),true);
  const themes=field(host,'Themes (comma separated, target 5–10)',(item.themes||[]).join(', '),true);
  const sections=field(host,'Important sections (one per line)',(item.important_sections||[]).join('\n'),true);
  const relations=field(host,'Related documents (titles, one per line)',(item.related_documents||[]).join('\n'),true);
   const linkedSources=field(host,'Verified related source IDs (one per line)',(item.related_source_refs||[]).map(r=>r.id).join('\n'),true);
   if((item.related_source_links||[]).some(r=>r.status!=='CURRENT'))host.append(node('p','One or more source links are stale or unavailable. Recheck the target document and save to rebind.','mt-error'));
   host.append(node('p','Source IDs are resolved against the live Master Table and pinned to its metadata version fingerprint (not a verified content hash).','mt-small'))
  const notes=field(host,'Review notes — scope, limitations, claims and exceptions',item.review_notes||'',true);
  const textCoverage=choice(host,'Text extraction',item.text_extraction||'NOT_ASSESSED',[
   ['NOT_ASSESSED','Not assessed'],['COMPLETE','Complete'],['PARTIAL','Partial'],['FAILED','Failed']
  ]);
  const visualCoverage=choice(host,'Visual inspection',item.visual_inspection||'NOT_ASSESSED',[
   ['NOT_ASSESSED','Not assessed'],['COMPLETE','Complete'],['PARTIAL','Partial']
  ]);
  const version=field(host,'Review version (optional)',item.review_version||'',false);
  field(host,'Review status (Save = Approved)',item.review_status||'Not saved yet',false,true);
  field(host,'Last reviewed (recorded on Save)',item.last_reviewed||'Not yet reviewed',false,true);
  host.append(node('p','Source last updated: '+(item.source_updated||'unknown')+
   ' · Last saved: '+(item.last_saved||'not yet'),'mt-small'));
  const actions=node('div',undefined,'mt-actions'),save=node('button','Save changes','primary'),remove=node('button','Delete entry','secondary');
  actions.append(remove,save);host.append(actions);
  save.onclick=async()=>{
   save.disabled=true;
   try{
    const changes={title:title.value,document_type:type.value,summary:summary.value,key_terms:values(terms.value),
     themes:values(themes.value),important_sections:values(sections.value),related_documents:values(relations.value),
      related_source_ids:linkedSources.value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean),
     review_notes:notes.value,text_extraction:textCoverage.value,visual_inspection:visualCoverage.value,
     review_version:version.value};
    const out=await request('save',{id:item.id,expected_etag:state.etag,changes});
    await load(item.id);message('Saved and published. Summary: '+out.quality.summary_words+' words.');
   }catch(e){message(e.message,true)}finally{save.disabled=false}
  };
  remove.onclick=async()=>{
   if(!confirm('Delete Master Table entry only? The source document will not be deleted.'))return;
   remove.disabled=true;
   try{await request('delete',{id:item.id,expected_etag:state.etag});await load();message('Entry deleted; source file unaffected.')}
   catch(e){message(e.message,true)}finally{remove.disabled=false}
  };
 }
 function render(){
  const host=byId('mtRows');host.replaceChildren();
  const q=byId('mtSearch').value.trim().toLowerCase(),scope=byId('mtScope').value;
  const filtered=state.records.filter(r=>(scope==='all'||r.access===scope)&&
   [r.title,r.source_metadata_title,r.pathname,r.document_type,r.summary,r.review_notes,
    ...(r.important_sections||[]),...(r.key_terms||[]),...(r.themes||[])].join(' ').toLowerCase().includes(q));
  byId('mtCount').textContent=filtered.length+' / '+state.records.length+' entries';
  for(const r of filtered){
   const tr=document.createElement('tr');if(r.id===state.selected)tr.className='mt-selected';
   const name=node('td');name.append(node('strong',r.title),node('div',r.pathname,'mt-small'));
   const access=node('td',r.access);if(!r.source_available)access.append(node('div','Unavailable','mt-error'));
   if(r.source_changed)access.append(node('div','Changed','mt-error'));
   const details=node('td');details.append(node('div',r.summary?.slice(0,150)||'(No summary yet)','mt-preview'),
    node('div',(r.key_terms?.length||0)+' terms · '+(r.themes?.length||0)+' themes · '+
     (r.review_status||'not saved')+' · Text: '+(r.text_extraction||'not assessed')+
     ' · Visual: '+(r.visual_inspection||'not assessed'),'mt-small'));
   tr.append(name,access,details);
   tr.onclick=()=>{state.selected=r.id;render();edit()};host.append(tr);
  }
 }
 async function load(selected=state.selected){
  const d=await request('load');state.records=d.records||[];state.etag=d.etag??null;
  state.selected=state.records.some(r=>r.id===selected)?selected:null;render();edit();
 }
 async function update(){
  if(state.busy)return;
  state.busy=true;updateButton.disabled=true;openButton.disabled=true;
  if(!dialog.open)dialog.showModal();
  try{
   message('Reconciling Public and Private document inventories…');
   const d=await request('sync');
   await load();message('Inventory: '+d.added.length+' new, '+d.changed.length+' changed, '+d.unavailable.length+' unavailable.'+
    (d.warnings?.length?' Warnings: '+d.warnings.join('; '):''),!!d.warnings?.length);
   const pending=d.pending_public||[];
   if(pending.length&&!confirm('Use GPT-6.1 Terra to enrich '+pending.length+' Public documents? Private documents will NOT be sent.'))return;
   let okay=0,failed=0;
   for(let i=0;i<pending.length;i++){
    message('Enriching Public source '+(i+1)+' of '+pending.length+'…');
    try{await request('enrich',{id:pending[i],expected_etag:state.etag});okay++}
    catch(e){failed++;message('AI enrichment failed: '+e.message,true)}
    await load();
   }
   if(pending.length)message('Update complete: '+okay+' Public entries enriched, '+failed+' incomplete. Private entries remain manual.',failed>0);
  }catch(e){message(e.message,true)}
  finally{state.busy=false;updateButton.disabled=false;openButton.disabled=false}
 }
 updateButton.onclick=update;
 openButton.onclick=async()=>{dialog.showModal();try{await load();message('Edit an entry and Save to publish. No separate approval is required.')}catch(e){message(e.message,true)}};
 byId('mtClose').onclick=()=>dialog.close();byId('mtSearch').oninput=render;byId('mtScope').onchange=render;
 byId('mtReload').onclick=async()=>{try{await load();message('Master Table reloaded.')}catch(e){message(e.message,true)}};
 byId('mtImport').onclick=()=>byId('mtJsonFile').click();
 byId('mtJsonFile').onchange=async()=>{
  const input=byId('mtJsonFile');if(!input.files.length)return;
  try{const data=JSON.parse(await input.files[0].text()),records=Array.isArray(data)?data:data.records;
   if(!Array.isArray(records))throw Error('Expected JSON array or an object with records');
   if(!confirm('Import '+records.length+' reviewed records? Manually saved entries will be preserved; reviewed records may replace AI-only descriptions.'))return;
   const out=await request('import',{records,expected_etag:state.etag});
   await load();message('Imported '+out.imported+' entries; skipped '+out.skipped+'.');
  }catch(e){message('Import failed: '+e.message,true)}finally{input.value=''}
 };
 byId('logout')?.addEventListener('click',()=>{if(dialog.open)dialog.close();state.records=[];state.etag=null});
})();
