function sourceLabel(field) {
 const index=Number(field.slice(1));
 if(field.startsWith('B')&&index>=10&&index<=22)return '昨日回顾第 '+(index-9)+' 行';
 if(field.startsWith('B')&&index>=24&&index<=39)return '今日安排第 '+(index-23)+' 行';
 return {A41:'协调问题',A44:'重要通知',A47:'遗留问题'}[field]||'原纪要';
}
async function openSource(ref,dialog) {
 await queue;
 try {
  const state=await request();
  if(state.status!==200)throw Error(state.error||'无法读取来源');
  apply(state);
  if(!records.some(record=>record.id===ref.id))throw Error('这条来源记录已移除');
  if(dialog)dialog.close();
  if(!recentPanel.hidden)closeRecent();
  active=ref.id;
  render();
  const field=[...$('paper').querySelectorAll('[data-field]')].find(el=>el.dataset.field===ref.field);
  const target=field?.closest('tr')||field?.closest('#notes section')||$('paper');
  target.classList.add('source-highlight');
  target.scrollIntoView({block:'center'});
  setTimeout(()=>target.classList.remove('source-highlight'),3500);
 } catch(error) {
  if(dialog)ledgerMessage(error.message);
  else recentNotice(error.message);
 }
}
async function openCarry(index,version){
 await queue;
 const record=records.find(r=>r.id===active);
 if(!record){recentNotice('请先打开一条早会记录');return;}
 const panel=$('carryDialog');
 $('carryDate').textContent=record.date;
 $('carryConfirm').onclick=async()=>{
  const group=Number($('carryGroup').value);
  panel.close();
  await change({op:'insert_task',id:record.id,group,index,version},result=>{
   recentNotice('已带入第 '+(result.row-group+1)+' 行，进展留空供填写。');
  });
 };
 panel.showModal();
}

const trashDialog=$('trashDialog');
let trashBusy=false;
function showTrash(items){
 const root=$('trashList');
 root.replaceChildren();
 $('restoreTrash').disabled=!items.length;
 $('trashCount').textContent=items.length?items.length+' 条已删除记录':'回收站为空';
 for(const record of [...items].sort((a,b)=>String(b.deleted_at).localeCompare(String(a.deleted_at)))){
  const box=document.createElement('section'),label=document.createElement('label');
  const check=document.createElement('input');
  check.type='checkbox';check.value=record.id;
  label.append(check,record.date+' · '+(record.fields.A5||'早会记录'));
  const details=document.createElement('details'),title=document.createElement('summary');
  title.textContent='查看内容';
  details.append(title);
  const info=document.createElement('p');
  info.textContent='移入时间 '+String(record.deleted_at||'').replace('T',' ').slice(0,19);
  details.append(info);
  const basics=document.createElement('p');
  basics.textContent=labels.map((name,i)=>name+'：'+(record.fields['ABCDEF'[i]+'5']||'—'))
   .concat('参会人员：'+(record.fields.A7||'—')).join(' · ');
  details.append(basics);
  for(const [start,end,title] of groups){
   const heading=document.createElement('strong'),list=document.createElement('ul');
   heading.textContent=title;
   for(let n=start;n<=end;n++){
    const values=['B','E','F'].map(col=>record.fields[col+n]).filter(Boolean);
    if(!values.length)continue;
    const li=document.createElement('li');
    li.textContent=values.join(' · ');
    list.append(li);
   }
   if(list.children.length)details.append(heading,list);
  }
  for(const [key,name] of [['A41','协调问题'],['A44','重要通知'],['A47','遗留问题']]){
   if(!record.fields[key])continue;
   const note=document.createElement('p');
   note.textContent=name+' · '+record.fields[key];
   details.append(note);
  }
  box.append(label,details);
  root.append(box);
 }
}
$('trashOpen').onclick=async()=>{
 if(!me?.admin)return;
 $('settingsDialog').close();
 trashDialog.showModal();
 $('trashCount').textContent='正在读取…';
 $('trashList').replaceChildren();
 $('restoreTrash').disabled=true;
 try{
  const state=await request();
  if(state.status!==200||!state.me?.admin)throw Error('需要管理员权限');
  showTrash(state.trash||[]);
 }catch(error){$('trashCount').textContent=error.message}
};
$('restoreTrash').onclick=async()=>{
 if(trashBusy||!me?.admin)return;
 const ids=[...$('trashList').querySelectorAll('input:checked')].map(x=>Number(x.value));
 if(!ids.length){$('trashCount').textContent='请选择要恢复的记录';return;}
 trashBusy=true;
 $('restoreTrash').disabled=true;
 try{
  let result=await request({op:'restore',ids});
  while(result.status===409&&result.dates?.length){
   if(!await workConfirmation('以下日期已有重复记录。确认仍然恢复？',result.dates.join('、')))return;
   result=await request({op:'restore',ids,confirmed_dates:result.dates});
  }
  if(result.status!==200)throw Error(result.error||'恢复失败');
  apply(result.state);
  render();
  showTrash(result.state.trash||[]);
  $('trashCount').textContent='已恢复 '+ids.length+' 条记录';
 }catch(error){$('trashCount').textContent=error.message}
 finally{trashBusy=false;$('restoreTrash').disabled=!$('trashList').children.length}
};
