const ledgerDialog = $('ledgerDialog');
const ledgerColumns = ['事项','负责人','进展','状态','下一步','截止日期'];
const ledgerStatuses = ['已完成','进行中','待跟进','待确认','待核实'];
let privateLedgerMode=false;
let watchedJob, ledgerTimer, ledgerBusy = false;
async function ledgerRequest(form) {
 const response = await fetch('/api/ledger', form ? {
  method:'POST', headers:{...deviceHeaders(),'Content-Type':'application/json'}, body:JSON.stringify(form)
 } : {cache:'no-store',headers:deviceHeaders()});
 const data = await response.json();
 if (!response.ok) throw Error(data.error || '台账服务暂不可用');
 return data;
}
function ledgerMessage(message) { $('ledgerMessage').textContent = message; }
function selection(op) {
 return {op, mode:$('ledgerRange').value, start:$('ledgerStart').value, end:$('ledgerEnd').value};
}
function updateOptions(select, options, placeholder) {
 const old = select.value;
 select.replaceChildren(new Option(placeholder,''));
 for (const [key,label] of options) select.add(new Option(label,key));
 if ([...select.options].some(o=>o.value===old)) select.value=old;
}
function tableFor(report, editable) {
 const table=document.createElement('table');
 const header=table.createTHead().insertRow();
 for (const title of ['序号',...ledgerColumns,'来源']) {
  const th=document.createElement('th');th.textContent=title;header.append(th);
 }
 const tbody=table.createTBody();
 const controls=report.rows.map((row,index)=>{
  const tr=tbody.insertRow();
  tr.insertCell().textContent=index+1;
  const fields={};
  for(const key of ledgerColumns){
   const td=tr.insertCell();
   if(!editable){td.textContent=row[key];continue;}
   const el=document.createElement(key==='状态'?'select':'textarea');
   if(key==='状态') for(const status of ledgerStatuses) el.add(new Option(status,status));
   el.value=row[key];el.setAttribute('aria-label',key+' '+(index+1));td.append(el);fields[key]=el;
  }
  const origin=tr.insertCell();
  if(!editable) origin.textContent=row['来源'].join('、');
  else for(const source of row['来源']){
   const link=document.createElement('button');link.textContent=source.date+(source.field?' · '+sourceLabel(source.field):'');
   link.onclick=()=>openSource(source,ledgerDialog);
   origin.append(link);
  }
  return fields;
 });
 return {table, read:()=>report.rows.map((row,i)=>editable?{
  ...Object.fromEntries(ledgerColumns.map(k=>[k,controls[i][k].value])),
  来源:row['来源'].map(x=>x.id)
 }:row)};
}
function ledgerExport(report, rows) {
 const xml=s=>String(s??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g,'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
 const matrix=[
  ['工作台账 '+report.start+' 至 '+report.end],
  ['生成时间',report.generated],
  ['序号',...ledgerColumns,'来源日期'],
  ...rows.map((row,i)=>[i+1,...ledgerColumns.map(k=>row[k]),
   [...new Set(report.rows[i]['来源'].map(x=>typeof x==='string'?x:x.date))].join('、')])
 ];
 const sheet='<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>'+
  [8,30,16,48,14,35,16,38].map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('')+
  '</cols><sheetData>'+matrix.map((r,i)=>'<row r="'+(i+1)+'">'+r.map((value,k)=>
   '<c r="'+String.fromCharCode(65+k)+(i+1)+'" t="inlineStr"><is><t xml:space="preserve">'+xml(value)+'</t></is></c>').join('')+'</row>').join('')+'</sheetData></worksheet>';
 const url=URL.createObjectURL(zip({...parts,'xl/worksheets/sheet1.xml':onePage(sheet,'landscape')}));
 const anchor=document.createElement('a');anchor.href=url;anchor.download='安装成本-'+report.start+'_'+report.end+'.xlsx';
 anchor.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function displayReport(report, target, editable) {
 target.replaceChildren();
 if(!report)return;
 const details=document.createElement('p');
 details.textContent=report.start+' 至 '+report.end+' · 生成时间 '+report.generated.replace('T',' ').slice(0,19);
 const {table,read}=tableFor(report,editable);
 const area=document.createElement('div');area.className='scroll';area.append(table);
 const actions=document.createElement('div');actions.className='actions';
 const button=(title,handler)=>{const b=document.createElement('button');b.textContent=title;b.onclick=handler;actions.append(b)};
 button('导出 Excel',()=>ledgerExport(report,read()));
 if(editable){
  button('保存台账',()=>ledgerAction({op:'save',id:report.id,version:report.version??0,rows:read()},'台账已保存'));
  const end=new Date(report.end+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+1);
  if(report.start.endsWith('-01')&&report.start.slice(0,7)===report.end.slice(0,7)&&end.getUTCDate()===1)
   button('更新公开月报',()=>{if(confirm('将这份台账发布给所有访客查看和导出？'))
    ledgerAction({op:'publish',id:report.id,version:report.version??0,rows:read()},'公开月报已更新')});
 }
 target.append(details,area,actions);
}
async function refreshLedger() {
 const state=await ledgerRequest();
 const publicSelect=$('ledgerMonth');
 updateOptions(publicSelect,Object.keys(state.public).sort().reverse().map(m=>[m,m+' 月报']),'选择月份');
 if(!publicSelect.value && publicSelect.options.length>1)publicSelect.selectedIndex=1;
 const showPublic=()=>displayReport(state.public[publicSelect.value],$('publicReport'),false);
 publicSelect.onchange=showPublic;showPublic();
 $('noReports').hidden=Object.keys(state.public).length>0;
 $('privateLedger').hidden=!privateLedgerMode||!('drafts' in state);
 if(!privateLedgerMode||!state.drafts)return;
 $('keyStatus').textContent=state.configured?'DeepSeek 密钥已配置':'尚未配置 DeepSeek 密钥';
 $('ledgerSchedule').value=state.schedule;
 const draftSelect=$('ledgerDraft');
 updateOptions(draftSelect,state.drafts.map(d=>[d.id,d.start+' 至 '+d.end+' · '+d.generated.slice(0,16).replace('T',' ')]),'选择已生成的台账');
 if(watchedJob && state.drafts.some(d=>d.id===watchedJob)){
  draftSelect.value=watchedJob;watchedJob=null;ledgerMessage('台账已生成，可以核对并保存。');
 }else if(watchedJob && state.errors[watchedJob]){
  ledgerMessage('生成失败：'+state.errors[watchedJob].message);watchedJob=null;
 }
 const showDraft=()=>displayReport(state.drafts.find(d=>d.id===draftSelect.value),$('draftReport'),true);
 draftSelect.onchange=showDraft;showDraft();
 const errors=Object.values(state.errors).sort((a,b)=>b.time-a.time);
 $('ledgerErrors').textContent=errors.length?'最近生成失败：'+errors[0].start+' 至 '+errors[0].end+' · '+errors[0].message:'';
}
async function ledgerAction(form, done, refresh=true) {
 if(ledgerBusy)return;
 ledgerBusy=true;
 try{ledgerMessage('处理中…');await ledgerRequest(form);if(refresh)await refreshLedger();ledgerMessage(done)}
 catch(error){ledgerMessage(error.message)}
 finally{ledgerBusy=false}
}
async function previewLedger() {
 $('ledgerCustom').hidden=$('ledgerRange').value!=='custom';
 const form=selection('preview');
 if(form.mode==='custom'&&(!form.start||!form.end)){ $('ledgerPreview').textContent='请选择起止日期';return; }
 try{
  const p=await ledgerRequest(form);
  if(JSON.stringify(form)===JSON.stringify(selection('preview')))
   $('ledgerPreview').textContent=p.start+' 至 '+p.end+' · '+p.count+' 条早会记录';
 }catch(error){$('ledgerPreview').textContent=error.message}
}
async function openLedger(adminMode){
 privateLedgerMode=adminMode&&Boolean(me?.admin);
 $('privateLedger').hidden=true;
 $('ledgerTitle').textContent=privateLedgerMode?'AI 工作台账':'公开月报';
 ledgerMessage('');ledgerDialog.showModal();
 try{await refreshLedger();if(!$('privateLedger').hidden)await previewLedger()}
 catch(error){ledgerMessage(error.message)}
 ledgerTimer=setInterval(async()=>{
  if(!privateLedgerMode||!watchedJob||ledgerBusy)return;
  try{
   const state=await ledgerRequest();
   if(!state.running?.includes(watchedJob))await refreshLedger();
  }catch(error){ledgerMessage(error.message)}
 },2000);
}
$('ledgerOpen').onclick=()=>openLedger(true);
$('publicMonthOpen').onclick=()=>openLedger(false);
ledgerDialog.addEventListener('close',()=>clearInterval(ledgerTimer));
for(const id of ['ledgerRange','ledgerStart','ledgerEnd'])$(id).onchange=previewLedger;
$('ledgerGenerate').onclick=async()=>{
 if(ledgerBusy)return;
 ledgerBusy=true;
 try{
  watchedJob=(await ledgerRequest(selection('generate'))).job;
  ledgerMessage('正在生成台账，可以关闭窗口后再查看。');await refreshLedger();
 }catch(error){ledgerMessage(error.message)}
 finally{ledgerBusy=false}
};
$('ledgerSaveSettings').onclick=async()=>{
 const input=$('ledgerKey');
 await ledgerAction({op:'settings',key:input.value,schedule:$('ledgerSchedule').value},'设置已保存');
 input.value='';
};
$('ledgerTest').onclick=()=>ledgerAction({op:'test',key:$('ledgerKey').value},'DeepSeek 连接和台账格式测试成功',false);



