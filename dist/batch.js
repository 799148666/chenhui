function batchDates(mode, todayDate, start, end) {
 const current = new Date(todayDate+'T00:00:00Z');
 const day = value => value.toISOString().slice(0,10);
 const year = current.getUTCFullYear(), month = current.getUTCMonth();
 if(mode==='week') return week(todayDate);
 if(mode==='month') return [day(new Date(Date.UTC(year,month,1))),day(new Date(Date.UTC(year,month+1,0)))];
 if(mode==='previous') return [day(new Date(Date.UTC(year,month-1,1))),day(new Date(Date.UTC(year,month,0)))];
 if(!start||!end) throw Error('请选择开始和结束日期');
 if(start>end) throw Error('结束日期不能早于开始日期');
 return [start,end];
}
function batchSelection() {
 return batchDates($('batchRange').value,today(),$('batchStart').value,$('batchEnd').value);
}
function batchMatches(items, first, last) {
 return items.filter(r=>r.date>=first&&r.date<=last).sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id);
}
function batchPreview(){
 $('batchCustom').hidden=$('batchRange').value!=='custom';
 try {
  const [first,last]=batchSelection();
  const count=batchMatches(records,first,last).length;
  $('batchStatus').textContent=first+' 至 '+last+' · '+count+' 条早会记录';
  $('batchDownload').disabled=!count;
 }catch(error){
  $('batchStatus').textContent=error.message;
  $('batchDownload').disabled=true;
 }
}
async function batchArchive(items){
 const counts={};
 const entries=[];
 for(const record of items){
  const num=counts[record.date]=(counts[record.date]||0)+1;
  const name='安装成本-'+record.date+(num>1?'-'+num:'')+'.xlsx';
  entries.push([name,new Uint8Array(await exportBook(record).arrayBuffer())]);
 }
 return zip(Object.fromEntries(entries),'application/zip');
}
$('batchOpen').onclick=async()=>{
 $('batchDialog').showModal();
 $('batchDownload').disabled=true;
 $('batchStatus').textContent='正在读取早会记录…';
 try{
  await queue;
  const fresh=await request();
  if(fresh.status!==200)throw Error(fresh.error||'读取失败');
  apply(fresh);
  batchPreview();
 }catch(error){$('batchStatus').textContent=error.message}
};
for(const id of ['batchRange','batchStart','batchEnd'])$(id).onchange=batchPreview;
$('batchDownload').onclick=async()=>{
 $('batchDownload').disabled=true;
 try{
  const [first,last]=batchSelection();
  $('batchStatus').textContent='正在生成压缩包…';
  await queue;
  const fresh=await request();
  if(fresh.status!==200)throw Error(fresh.error||'读取失败');
  const items=batchMatches(fresh.records,first,last);
  if(!items.length)throw Error('这个日期范围没有早会记录');
  saveBlob(await batchArchive(items),'安装成本-'+first+'_'+last+'.zip');
  $('batchStatus').textContent='已导出 '+items.length+' 条早会记录';
 }catch(error){$('batchStatus').textContent=error.message}
 finally{$('batchDownload').disabled=false}
};


