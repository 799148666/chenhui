const $=id=>document.getElementById(id), key='morning-notes-v1';
let records=[],people=[],active,rev=-1,renderedRev=-1,queue=Promise.resolve(), busy=0;
const tabId=Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
function deviceHeaders(){
 try {
  const key='morning-device-v1';
  let device=localStorage.getItem(key);
  if(!/^[0-9a-f]{64}$/.test(device||'')){
   device=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
   localStorage.setItem(key,device);
  }
  return {'X-Morning-Device':device};
 }catch {return {}}
}
let me,guests=[],locks=[],focused=null;
function presence(s){
 if(!s.me)return;
 me=s.me;guests=s.guests||[];locks=s.locks||[];
 $('ledgerOpen').hidden=!me.admin;
 $('new').hidden=!me.admin;
 $('trashOpen').hidden=!me.admin;
 const deleteButton=$('remove');if(deleteButton)deleteButton.hidden=!me.admin;
 if(!me.admin)$('context').hidden=true;
 $('identity').textContent=me.admin?'管理员':me.name;
 for(const el of document.querySelectorAll('[data-field]')){
  const other=locks.find(l=>l.id===active&&l.field===el.dataset.field&&l.tab!==tabId);
  el.classList.toggle('occupied',Boolean(other));
  const note=el.parentElement.querySelector('.editing');
  if(note)note.textContent=other?other.name+' 正在编辑':'';
  if(el!==document.activeElement)el.disabled=Boolean(other);
 }
}
function leaseBody(op,cell){return {op,id:cell.id,field:cell.field,tab:tabId}}
function bindLease(el,rec,k){
 el.dataset.field=k;
 el.onfocus=async()=>{
  const cell={id:rec.id,field:k};focused=cell;
  if(el.tagName!=='SELECT')el.readOnly=true;
  try{
   const d=await request(leaseBody('lease',cell));
   if(focused!==cell){if(d.status===200)await request(leaseBody('release',cell));return}
   if(d.status!==200){el.blur();alert(d.error);return}
   el.readOnly=false;presence(d.state);
  }catch {el.blur()}
 };
 return ()=>{const cell=focused;if(!cell||cell.id!==rec.id||cell.field!==k)return;focused=null;task(async()=>{const d=await request(leaseBody('release',cell));presence(d.state||{})})};
}
const openGroups=new Set();
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function apply(s){presence(s);if(s.rev<rev)return;({records,people,rev}=s);if(!records.some(r=>r.id===active))active=records[0]?.id}
async function request(body){
 const options=body?{method:'POST',headers:{...deviceHeaders(),'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store', headers:deviceHeaders()};
 const res=await fetch(body?'/api/change':'/api/state',options), data=await res.json();
 return {...data,status:res.status};
}
function task(fn){busy++;queue=queue.then(fn).catch(e=>alert(e.message||'保存失败，请检查连接')).finally(()=>busy--);return queue}
function change(body,done){return task(async()=>{const d=await request(body);if(d.status!==200){if(d.status===409||d.status===410){apply(await request());render()}throw Error(d.error||'保存失败')}apply(d.state);done?.(d);render()})}
function commit(rec,k,base,value,el){
 if(base===value)return;
 task(async()=>{
  let d;
  try{
   d=await request({op:'field',id:rec.id,field:k,tab:tabId,base:el.dataset.base??base,value});
   if(d.status===409&&Object.hasOwn(d,'value')){
    if(confirm('同一字段已被他人修改。\n服务器内容：'+d.value+'\n你的内容：'+value+'\n确定：使用你的内容；取消：保留服务器内容。'))d=await request({op:'field',id:rec.id,field:k,tab:tabId,base:d.value,value});
    else {apply(await request());if(el.multiple){const selected=d.value.split(/[、，,]/);for(const o of el.options)o.selected=selected.includes(o.value)}else el.value=d.value;el.dataset.base=d.value;return}
   }
   if(d.status!==200)throw Error(d.error||'字段再次发生冲突');
   apply(d.state);el.dataset.base=value;
  }catch(e){throw Error(e.message+'。你的输入：'+value+'。可回到字段再修改或重试。')}
 });
}
function week(date){
 const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);const start=d.toISOString().slice(0,10);
 d.setUTCDate(d.getUTCDate()+6);return [start,d.toISOString().slice(0,10)];
}
function history(tabs, rec){
 tabs.replaceChildren();
 const now=today(), months=new Map(), weeks=new Map(), current=[];
 for(const r of [...records].sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id)){
  const m=r.date.slice(0,7), [start,end]=week(r.date);
  const [map,k]=m<now.slice(0,7)?[months,m]:end<now?[weeks,start+' ~ '+end]:[null,null];
  if(map){if(!map.has(k))map.set(k,[]);map.get(k).push(r)}else current.push(r);
 }
 function tab(r){
  const b=document.createElement('button'), peers=records.filter(x=>x.date===r.date);
  b.textContent=r.date+(peers.length>1?' · '+(peers.indexOf(r)+1):'');b.setAttribute('role','tab');b.setAttribute('aria-selected',String(r===rec));
  b.onclick=()=>queue.then(()=>{active=r.id;render()});
  b.oncontextmenu=e=>{if(!me?.admin)return;e.preventDefault();const m=$('context');m.hidden=false;m.style.left=Math.min(e.clientX,innerWidth-155)+'px';m.style.top=Math.min(e.clientY,innerHeight-55)+'px';m.onclick=()=>{m.hidden=true;remove(r.id)}};
  return b;
 }
 function archive(label,rs){
  const d=document.createElement('details'), s=document.createElement('summary');s.textContent=label;d.append(s,...rs.map(tab));d.open=openGroups.has(label);
  d.ontoggle=()=>d.open?openGroups.add(label):openGroups.delete(label);tabs.append(d);
 }
 for(const [m,rs] of months)archive(m+' 月归档',rs);
 for(const [w,rs] of weeks)archive(w+' 周归档',rs);
 tabs.append(...current.map(tab));
}
function remove(id){if(!me?.admin)return;queue.then(()=>{const r=records.find(x=>x.id===id);if(r&&confirm('将 '+r.date+' 的这条早会记录移入回收站？'))change({op:'delete',id,version:r.version})})}
const groups=[[10,22,'1. 昨日工作回顾 / 完成情况','完成情况'],[24,39,'2. 今日重点工作安排','完成要求']];
const expandedMeetings=new Set();
const labels=['会议主题','会议地点','主持人','记录人','开始时间','结束时间'];
function render(){ renderedRev=rev;
 const rec=records.find(r=>r.id===active), tabs=$('tabs'), paper=$('paper');
 history(tabs,rec);
 if(!rec){paper.innerHTML='<div class="empty"><h1>还没有早会记录</h1><p class="muted">点击「新建早会记录」，开始填写今天的纪要。</p></div>';return}
 paper.innerHTML='<div class="top"><div><h1></h1></div><div class="actions"><button id="download">导出 Excel</button><button id="remove">删除记录</button></div></div><details id="meetingDetails"><summary><strong>会议基本信息</strong><span id="meetingSummary"></span></summary><div class="meeting-fields"><div class="grid" id="basic"></div><div id="people"></div></div></details><section id="workFocus" aria-labelledby="workTitle"><h2 id="workTitle">会议内容记录</h2><div id="work"></div></section><div id="notes"></div>';
 paper.querySelector('h1').textContent='早会记录表 · '+rec.date;
 const details=$('meetingDetails');
 details.open=expandedMeetings.has(rec.id);
 details.ontoggle=()=>{if(details.isConnected){if(details.open)expandedMeetings.add(rec.id);else expandedMeetings.delete(rec.id)}};
 const fields=rec.fields;
 const time=[fields.E5,fields.F5].filter(Boolean).join('－');
 const summary=[fields.A5,fields.B5,time,fields.C5&&'主持 '+fields.C5,
   fields.D5&&'记录 '+fields.D5,fields.A7&&'参会 '+fields.A7].filter(Boolean).join(' · ');
 $('meetingSummary').textContent=summary||'尚未填写';
 $('meetingSummary').title=summary;

 function field(k,label,multi=false,wrap=true,isPerson=false){
  const el=document.createElement(isPerson?'select':multi?'textarea':'input');el.setAttribute('aria-label',label);
  const v=String(rec.fields[k]??'');
  if(isPerson)for(const p of new Set(['',...people,...(v?[v]:[])]))el.add(new Option(p||'请选择人员',p));
  el.value=v;el.dataset.field=k;el.dataset.base=v;
  const release=bindLease(el,rec,k);
  const write=()=>commit(rec,k,el.dataset.base,el.value,el);
  if(isPerson){el.onchange=write;el.onblur=release}else {el.onblur=()=>{write();release()};el.onkeydown=e=>{if(!multi&&e.key==='Enter')el.blur()}}
  const note=document.createElement('small');note.className='editing';
  const box=document.createElement(wrap?'label':'div');if(wrap)box.append(label);box.append(el,note);return box;
 }
 labels.forEach((l,i)=>$('basic').append(field('ABCDEF'[i]+'5',l,false,true,i===2||i===3)));
 const peopleBox=$('people'), selected=(rec.fields.A7||'').split(/[、，,]/).filter(Boolean);
 const label=document.createElement('div');label.textContent='参会人员名单';
 const list=document.createElement('div');list.className='attendees';
 const add=document.createElement('button');add.textContent='＋';add.setAttribute('aria-label','添加参会人员');
 const picker=document.createElement('select');picker.hidden=true;picker.setAttribute('aria-label','选择参会人员');picker.dataset.base=rec.fields.A7||'';
 const note=document.createElement('small');note.className='editing';
 const release=bindLease(picker,rec,'A7');picker.onblur=release;
 function drawPeople(){
  list.replaceChildren();
  for(const person of selected){const chip=document.createElement('span');chip.textContent=person;list.append(chip)}
  list.append(add);
  picker.replaceChildren(new Option('请选择人员',''));
  for(const p of people.filter(p=>!selected.includes(p)))picker.add(new Option(p,p));
  add.disabled=picker.options.length===1;
 }
 add.onclick=()=>{picker.hidden=false;picker.focus();if(picker.showPicker)try{picker.showPicker()}catch{}};
 picker.onchange=()=>{if(!picker.value)return;selected.push(picker.value);commit(rec,'A7',picker.dataset.base,selected.join('、'),picker);picker.hidden=true;release();drawPeople()};
 drawPeople();peopleBox.append(label,list,picker,note);
 for(const [start,end,title,last] of groups){
  const section=document.createElement('section');section.innerHTML='<h3>'+title+'</h3><div class="scroll"><table><thead><tr><th>序号</th><th>工作内容</th><th>负责人</th><th>'+last+'</th></tr></thead><tbody></tbody></table></div>';
  const tbody=section.querySelector('tbody');
  const row=n=>{const tr=tbody.insertRow();tr.insertCell().textContent=n-start+1;['工作内容','负责人',last].forEach((label,i)=>tr.insertCell().append(field('BEF'[i]+n,label+'（第 '+(n-start+1)+' 行）',i!==1,false,i===1)));return tr};
  const count=rec.rows[start]??2;for(let i=0;i<count;i++) row(start+i);
  const add=document.createElement('button');add.className='add';add.textContent='＋ 增加一行';add.hidden=count>=end-start+1;
  add.onclick=()=>change({op:'row',id:rec.id,group:start});
const actions=document.createElement('div');actions.className='work-actions';
  if(start===10){
   const copy=document.createElement('button');copy.className='add';copy.textContent='复制昨日安排';
   copy.title='复制前一天的今日重点工作到本表，保留已有内容';
   copy.onclick=async()=>{
    copy.disabled=true;
    try{
     await queue;
     const preview=await request({op:'copy_preview',id:rec.id});
     if(preview.status!==200)throw Error(preview.error||'无法读取历史安排');
     if(preview.fallback){
      const day=new Date(preview.source.date+'T00:00:00Z');
      const currentWeek=week(rec.date)[0];
      const lastMonday=new Date(currentWeek+'T00:00:00Z');
      lastMonday.setUTCDate(lastMonday.getUTCDate()-7);
      const previousWeek=lastMonday.toISOString().slice(0,10);
      const weekday='日一二三四五六'[day.getUTCDay()];
      const prefix=preview.source.date>=currentWeek?'本周':preview.source.date>=previousWeek?'上周':'周';
      const selected=await workConfirmation('前一天没有可复制的安排。最近一次是'+prefix+weekday,preview.source.date);
      if(!selected)return;
     }
     await change({op:'copy_yesterday',id:rec.id,source:preview.source},d=>{
      const count=d.count;
      setTimeout(()=>{const status=$('copyWorkStatus');if(status)status.textContent=count?'已复制 '+count+' 项':'没有新的工作需要复制'},0);
     });
    }catch(error){alert(error.message)}
    finally{copy.disabled=false}
   };
   actions.append(copy);
   const status=document.createElement('div');status.id='copyWorkStatus';status.setAttribute('role','status');section.append(status);
  }
  actions.append(add);section.append(actions);$('work').append(section);
 }
 for(const [k,l] of [['A41','3. 需要协调解决的问题'],['A44','4. 重要通知与事项传达'],['A47','三、其他事项 / 遗留问题']]){
  const h=document.createElement(k==='A47'?'h2':'h3');h.textContent=l;const note=document.createElement('section');note.append(h,field(k,l,true,false));$('notes').append(note);
 }
 $('download').onclick=()=>queue.then(()=>{const latest=records.find(x=>x.id===rec.id);if(latest)download(latest)});
 $('remove').hidden=!me?.admin;
 $('remove').onclick=()=>remove(rec.id);
}
function workConfirmation(message, date=''){
 const dialog=$('workConfirmation');
 $('workConfirmText').textContent=message;
 $('workConfirmDate').textContent=date?'（'+date+'）':'';
 dialog.returnValue='cancel';
 return new Promise(resolve=>{
  dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true});
  dialog.showModal();
 });
}
$('new').onclick=()=>task(async()=>{
 if(!me?.admin)return;
 const button=$('new');button.disabled=true;
 try{
  let response=await request({op:'new'});
  if(response.status===409&&response.date){
   if(!await workConfirmation('当天已生成早会记录，仍要再新建一条吗？',response.date))return;
   response=await request({op:'new',confirm_date:response.date});
  }
  if(response.status!==200)throw Error(response.error||'新建失败');
  apply(response.state);active=response.id;render();
 }finally{button.disabled=false}
});
$('logoutAdmin').onclick=()=>{
 $('settingsDialog').close();
 change({op:'logout_admin'});
};
document.addEventListener('click',e=>{if(!$('context').contains(e.target))$('context').hidden=true});
document.addEventListener('keydown',e=>{if(e.key==='Escape')$('context').hidden=true});
$('settings').onclick=()=>queue.then(()=>{
 const d=$('settingsDialog'), box=$('names'), base=[...people];box.value=base.join('\n');d.showModal();
 $('adminLogin').hidden=Boolean(me?.admin);$('adminTools').hidden=!me?.admin;
 $('adminKey').value='';
 const panel=$('guestList');panel.replaceChildren();
 for(const g of guests){const row=document.createElement('div');row.className='guest-row';const name=document.createElement('input');name.value=g.name;name.setAttribute('aria-label','游客名称');const rename=document.createElement('button');rename.textContent='改名';const block=document.createElement('button');block.textContent=g.blocked?'解除拉黑':'拉黑';const update=blocked=>{d.close();change({op:'guest',guest:g.id,name:name.value,blocked})};rename.onclick=()=>update(g.blocked);block.onclick=()=>update(!g.blocked);row.append(name,rename,block);panel.append(row)}
 $('saveNames').onclick=()=>{const value=[...new Set(box.value.split(/[\n、，,]/).map(x=>x.trim()).filter(Boolean))];d.close();change({op:'people',base,value})};
});
$('claimAdmin').onclick=()=>{const key=$('adminKey').value.trim();$('settingsDialog').close();change({op:'admin',key},()=>setTimeout(()=>$('settings').click(),0))};
$('clearGuests').onclick=()=>{
 if(!confirm('清空未拉黑的游客记录？已拉黑名单和早会纪要会保留。游客再次填写时会以原身份重新显示。'))return;
 $('settingsDialog').close();
 change({op:'clear_guests'},()=>setTimeout(()=>$('settings').click(),0));
};
const enc=new TextEncoder();
function crc(a){let c=-1;for(const b of a){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^-1)>>>0}
function zip(files, type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'){
 const local=[],central=[];let offset=0,size=0;
 const make=(n,nums)=>{let a=new Uint8Array(n),v=new DataView(a.buffer);for(const [i,x,l] of nums) l===4?v.setUint32(i,x,true):v.setUint16(i,x,true);return a};
 for(const [name,value] of Object.entries(files)){
  const n=enc.encode(name),b=typeof value==='string'?enc.encode(value):value,c=crc(b);
  local.push(make(30,[[0,0x04034b50,4],[4,20],[6,0x800],[14,c,4],[18,b.length,4],[22,b.length,4],[26,n.length]]),n,b);
  central.push(make(46,[[0,0x02014b50,4],[4,20],[6,20],[8,0x800],[16,c,4],[20,b.length,4],[24,b.length,4],[28,n.length],[42,offset,4]]),n);
  offset+=30+n.length+b.length;size+=46+n.length;
 }
 const count=Object.keys(files).length;
 return new Blob([...local,...central,make(22,[[0,0x06054b50,4],[8,count],[10,count],[12,size,4],[16,offset,4]])],{type});
}
function onePage(sheet, orientation='portrait'){
 const properties='<pageSetUpPr fitToPage="1"/>';
 if(sheet.includes('<pageSetUpPr/>'))sheet=sheet.replace('<pageSetUpPr/>',properties);
 else sheet=sheet.replace(/<worksheet[^>]*>/,tag=>tag+'<sheetPr>'+properties+'</sheetPr>');
 const margins='<pageMargins left="0.3" right="0.3" top="0.35" bottom="0.35" header="0.15" footer="0.15"/>';
 const setup='<pageSetup paperSize="9" orientation="'+orientation+'" fitToWidth="1" fitToHeight="1"/>';
 return sheet.replace(/<pageMargins[^>]*\/>/,'').replace('</worksheet>',margins+setup+'</worksheet>');
}
function exportBook(rec){
 const values={...rec.fields,A1:'早会记录表 · '+rec.date};
 const hidden=new Set();
 for(const [start,end] of groups){
  let number=0;
  const populated=[];
  for(let row=start;row<=end;row++){
   if(['B','E','F'].some(col=>String(values[col+row]??'').trim()))populated.push(row);
  }
  const visible=new Set(populated.length?populated:[start]);
  for(let row=start;row<=end;row++){
   if(visible.has(row))values['A'+row]=++number;
   else {hidden.add(row);values['A'+row]='';}
  }
 }
 const esc=s=>String(s??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g,'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
 const sheet=parts['xl/worksheets/sheet1.xml']
  .replace(/<row\b([^>]*\br="(\d+)"[^>]*)>/g,(tag,attrs,index)=>hidden.has(Number(index))?
   '<row '+attrs.trim().replace(/\s+hidden="[^"]*"/,'')+' hidden="1">':tag)
  .replace(/<t>__FIELD_([A-Z]+\d+)__<\/t>/g,(_,k)=>'<t xml:space="preserve">'+esc(values[k])+'</t>');
 const workbook=parts['xl/workbook.xml'].replace('<definedNames/>',
  '<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">早会记录!$A$1:$F$49</definedName></definedNames>');
 return zip({...parts,'xl/workbook.xml':workbook,'xl/worksheets/sheet1.xml':onePage(sheet)});
}
function saveBlob(blob,name){
 const url=URL.createObjectURL(blob), anchor=document.createElement('a');
 anchor.href=url;anchor.download=name;anchor.click();
 setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function download(rec){
 saveBlob(exportBook(rec),'安装成本-'+rec.date+'.xlsx');
}
async function start(){
 $('new').disabled=true;
 try{
  const old=JSON.parse(localStorage.getItem(key)||'[]');
  if(old.length){const d=await request({op:'import',records:old});if(d.status!==200)throw Error('旧版记录迁移失败');apply(d.state);localStorage.removeItem(key)}
  else {const s=await request();if(s.status!==200)throw Error(s.error);apply(s)}
  const opening=records.find(record=>record.date===today());
  if(opening)active=opening.id;
  render();$('new').disabled=false;
  let polling=false;
  setInterval(async()=>{
   if(polling)return;
   polling=true;
   try{
    const cell=focused;
    const r=cell?await request(leaseBody('lease',cell)):await request();
    if(r.status===403){$('new').disabled=true;$('paper').textContent=r.error;return}
    const s=r.state||r;
    presence(s);
    if(!busy&&!focused&&!document.querySelector('dialog[open]')&&s.rev>renderedRev){apply(s);render();presence(s)}
   }catch{}finally{polling=false}
  },1500);
 }catch(e){$('paper').textContent='无法连接共享服务，请重新打开或刷新页面。'+e.message}
}
start();





