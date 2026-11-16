const recentPanel = $('recentPanel');
const recentFields = ['事项','负责人','进展','状态','下一步','截止日期'];
let recentData = {}, recentPage = 0, recentTimer, recentBusy = false;

async function recentRequest(form) {
 const headers = deviceHeaders();
 const response = await fetch('/api/recent', form ?
  {method:'POST', headers:{...headers,'Content-Type':'application/json'}, body:JSON.stringify(form)} :
  {cache:'no-store', headers});
 const data = await response.json();
 if (!response.ok) throw Error(data.error || '无法读取最近事项');
 return data;
}
function recentNotice(text) { $('recentNotice').textContent = text; }
function recentCard(row,index) {
 const card = document.createElement('article');
 const head = document.createElement('div');
 head.className = 'recent-card-head';
 const title = document.createElement('strong');
 title.textContent = row['事项'];
 const copy = document.createElement('button');
 copy.textContent = '复制';
 copy.setAttribute('aria-label','复制 '+row['事项']);
 copy.onclick = async () => {
  try {
   await navigator.clipboard.writeText(row['事项']);
   recentNotice('已复制事项名称');
  } catch { recentNotice('无法访问剪贴板，可选中事项文字手动复制'); }
 };
 head.append(title,copy);
 const meta = document.createElement('small');
 meta.textContent = row['状态']+' · '+row['负责人'];
 meta.className = row['状态']==='已完成'?'recent-done':'recent-active';
 const progress = document.createElement('p');
 progress.textContent = row['进展'];
 const full=document.createElement('details');
 full.className='recent-full';
 const summary=document.createElement('summary');
 summary.append(meta);
 summary.setAttribute('aria-label','展开或收起完整事项');
 full.append(summary,progress);
 card.append(head,full);
 if (row['下一步'] && row['下一步']!=='未注明') {
  const next = document.createElement('p');
  next.textContent = '下一步 · '+row['下一步'];
  full.append(next);
 }

 if (row['截止日期'] && row['截止日期']!=='未注明') {
  const deadline=document.createElement('p');
  deadline.textContent='截止日期 · '+row['截止日期'];
  full.append(deadline);
 }
 if (row['来源']?.length) {
  const dates=document.createElement('p');
  dates.textContent='来源 · '+[...new Set(row['来源'].map(ref=>ref.date))].join('、');
  full.append(dates);
 }
 if (!me?.admin) return card;
 const edit = document.createElement('details'), editLabel = document.createElement('summary');
 editLabel.textContent = '修改';
 edit.append(editLabel);
 const fields = {};
 for (const name of recentFields) {
  const label = document.createElement('label');
  label.textContent = name;
  const field = document.createElement(name==='状态'?'select':name==='进展'?'textarea':'input');
  if (name==='状态') for (const status of ledgerStatuses) field.add(new Option(status,status));
  field.value = row[name];
  label.append(field);
  edit.append(label);
  fields[name] = field;
 }
 const version = recentData.version;
 const save = document.createElement('button');
 save.textContent = '保存修改';
 save.onclick = () => recentAction({
  op:'edit',index,version,row:Object.fromEntries(recentFields.map(name=>[name,fields[name].value]))
 },'修改已保存，下次 AI 总结会参考。');
 edit.append(save);
 full.append(edit);
 return card;
}
function renderRecent() {
 const rows = recentData.rows || [];
 const pages = Math.max(1,Math.ceil(rows.length/10));
 recentPage = Math.min(recentPage,pages-1);
 const start = recentPage*10;
 $('recentList').replaceChildren(...rows.slice(start,start+10).map((row,i)=>recentCard(row,start+i)));
 $('recentMeta').textContent = recentData.generated?
  recentData.start+' 至 '+recentData.end+' · '+rows.length+' 条':'暂无总结。工作日 00:02 自动更新。';
 $('recentPage').textContent = (recentPage+1)+' / '+pages;
 $('recentPager').hidden = pages===1;
 $('recentPrevious').disabled = recentPage===0;
 $('recentNext').disabled = recentPage+1===pages;
 $('recentRefresh').hidden = !me?.admin;
 $('recentRefresh').disabled = recentBusy || Boolean(recentData.running);
}
async function recentAction(form,message) {
 if (recentBusy) return;
 recentBusy = true;
 $('recentRefresh').disabled = true;
 try {
  await recentRequest(form);
  recentData = await recentRequest();
  if (form.op==='generate') recentPage=0;
  recentNotice(recentData.error || (form.op==='generate'&&!recentData.running?'总结已更新。':message));
  renderRecent();
 } catch(error) { recentNotice(error.message); }
 finally {
  recentBusy=false;
  $('recentRefresh').disabled=Boolean(recentData.running);
 }
}
function closeRecent() {
 recentPanel.hidden = true;
 document.body.classList.remove('recent-open');
 $('recentOpen').setAttribute('aria-expanded','false');
 clearInterval(recentTimer);
}
$('recentOpen').onclick = async () => {
 if (!recentPanel.hidden) { closeRecent(); return; }
 recentPanel.hidden=false;
 document.body.classList.add('recent-open');
 $('recentOpen').setAttribute('aria-expanded','true');
 recentPage=0;
 recentData={};
 renderRecent();
 recentNotice('正在读取…');
 try {
  recentData=await recentRequest();
  if (recentPanel.hidden) return;
  renderRecent();
  recentNotice(recentData.running?'DeepSeek 正在更新…':recentData.error||'');
  clearInterval(recentTimer);
  recentTimer=setInterval(async()=>{
   if (!recentData.running || recentBusy || recentPanel.hidden) return;
   try {
    const next=await recentRequest();
    if (next.running) return;
    recentData=next;
    renderRecent();
    recentNotice(next.error||'总结已更新。');
   } catch(error) { recentNotice(error.message); }
  },2500);
 } catch(error) { recentNotice(error.message); }
};
$('recentClose').onclick=()=>{closeRecent();$('recentOpen').focus()};
$('recentPrevious').onclick=()=>{recentPage--;renderRecent()};
$('recentNext').onclick=()=>{recentPage++;renderRecent()};
$('recentRefresh').onclick=()=>recentAction({op:'generate'},'DeepSeek 正在更新…');
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&!recentPanel.hidden&&!document.querySelector('dialog[open]'))closeRecent();
});
const recentHeader=document.querySelector('body>header');
new ResizeObserver(()=>{
 document.body.style.setProperty('--header-height',recentHeader.getBoundingClientRect().height+'px');
}).observe(recentHeader);

