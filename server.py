import json, threading, os, secrets, time, hashlib, re
from http.cookies import SimpleCookie
from datetime import date, datetime, timedelta
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
import ledger
import recent
root=Path(__file__).resolve().parent
path=root/'records.json'
lock=threading.Lock()
state=json.loads(path.read_text(encoding='utf-8')) if path.exists() else dict(records=[],people=['王晓祯','陈秀春'],imported=[],rev=0,next=1)
state.setdefault('guests', {})
state.setdefault('trash', [])
state.setdefault('guest_next', len(state['guests'])+1)

leases = {}
admin_path = root / 'admin-key.txt'
admin_key = os.environ.get('MORNING_NOTES_ADMIN_KEY')
if not admin_key:
 if not admin_path.exists(): admin_path.write_text(secrets.token_urlsafe(32), encoding='utf-8')
 admin_key = admin_path.read_text(encoding='utf-8').strip()

# Mainland China statutory holiday and makeup-day notices, 2026 and 2027.
CALENDAR = {
 2026: (
  [('01-01','01-03'),('02-15','02-23'),('04-04','04-06'),('05-01','05-05'),
   ('06-19','06-21'),('09-25','09-27'),('10-01','10-07')],
  {'01-04','02-14','02-28','05-09','09-20','10-10'}),
 2027: (
  [('01-01','01-03'),('02-05','02-13'),('04-03','04-05'),('05-01','05-05'),
   ('06-09','06-09'),('09-15','09-15'),('10-01','10-07')],
  {'01-31','02-14','05-08','09-26','10-09'}),
}
template_line=(root/'dist'/'template.js').read_text(encoding='utf-8-sig').splitlines()[0]
template_fields=json.loads(template_line.removeprefix('const defaults=').removesuffix(';'))
template_fields['A7']='陈秀春、王晓祯'

def is_workday(day):
 if day.year not in CALENDAR: return False
 holidays, makeup=CALENDAR[day.year]
 month_day=day.strftime('%m-%d')
 return month_day in makeup or (day.weekday()<5 and not any(a<=month_day<=b for a,b in holidays))

def add_template(day):
 record=dict(id=state['next'],date=day,fields=dict(template_fields),rows={},version=0)
 state['records'].insert(0,record)
 state['next']+=1
 return record

def ensure_workday_record(now):
 day=now.date()
 stamp=day.isoformat()
 if (now.hour,now.minute)<(0,1) or not is_workday(day) or state.get('auto_checked')==stamp:
  return False
 if not any(r['date']==stamp for r in state['records']):
  add_template(stamp)
  state['rev']+=1
 state['auto_checked']=stamp
 persist()
 return True

def schedule_workday():
 while True:
  try:
   with lock: ensure_workday_record(datetime.now(ledger.TZ))
  except Exception:
   import traceback
   traceback.print_exc()
  time.sleep(5)

def persist():
 tmp=path.with_suffix('.tmp')
 tmp.write_text(json.dumps(state,ensure_ascii=False),encoding='utf-8')
 os.replace(tmp,path)
def correct_person_name():
 old, new = '陈秀陈', '陈秀春'
 people = list(dict.fromkeys(new if name == old else name for name in state['people']))
 changed = people != state['people']
 state['people'] = people
 for record in state['records']:
  fields = record['fields']
  corrections = {}
  for field, value in fields.items():
   if field == 'A7' and isinstance(value, str) and old in value:
    import re
    names = re.split(r'[、，,]', value)
    if old in (name.strip() for name in names):
     corrections[field] = '、'.join(dict.fromkeys(new if name.strip() == old else name.strip() for name in names if name.strip()))
   elif (field in ('C5','D5') or field.startswith('E') and field != 'E5') and value == old:
    corrections[field] = new
  if corrections:
   fields.update(corrections)
   record['version'] += 1
   changed = True
 if changed:
  state['rev'] += 1
  persist()

correct_person_name()

class Handler(SimpleHTTPRequestHandler):
 def identity(self):
  jar=SimpleCookie(self.headers.get('Cookie',''))
  token=jar['morning_guest'].value if 'morning_guest' in jar else ''
  guests=state['guests']
  device=self.headers.get('X-Morning-Device','')
  digest=hashlib.sha256(device.encode()).hexdigest() if re.fullmatch(r'[0-9a-f]{64}',device) else None
  match=next((k for k,g in guests.items() if digest and not g['admin'] and g.get('device')==digest),None)
  changed=False
  if token not in guests:
   token=match or secrets.token_urlsafe(24)
   if token not in guests:
    guests[token]={'name':'游客 '+str(state['guest_next']),'blocked':False,'admin':False,'id':secrets.token_hex(8)}
    state['guest_next']+=1
    changed=True
   self.cookie=token
  self.guest=guests[token]
  if digest and not match and not self.guest['admin'] and not self.guest.get('device'):
   self.guest['device']=digest
   changed=True
  if changed: persist()
 @staticmethod
 def guest_view(guest):
  return {key:guest[key] for key in ('id','name','admin','blocked')}
 def snapshot(self):
  now=time.monotonic()
  for k,v in list(leases.items()):
   if v['expires']<=now: del leases[k]
  data={k:state[k] for k in ('records','people','rev')}
  data['me']=self.guest_view(self.guest)
  data['locks']=[{'id':k[0],'field':k[1],'tab':v['tab'],'name':v['guest']['name']} for k,v in leases.items()]
  if self.guest['admin']: data['trash']=state['trash']
  if self.guest['admin']: data['guests']=[self.guest_view(g) for g in state['guests'].values() if not g['admin'] and (g['blocked'] or not g.get('cleared'))]
  return data
 def reply(self, data, status=200):
  b=json.dumps(data,ensure_ascii=False).encode()
  self.send_response(status)
  self.send_header('Content-Type','application/json; charset=utf-8')
  self.send_header('Cache-Control','no-store')
  if getattr(self,'cookie',None):
   secure='; Secure' if os.environ.get('MORNING_NOTES_SECURE_COOKIE')=='1' else ''
   self.send_header('Set-Cookie',f'morning_guest={self.cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000'+secure)
  self.send_header('Content-Length',str(len(b)))
  self.end_headers()
  self.wfile.write(b)
 def do_GET(self):
  if self.path in ('/api/ledger','/api/recent'):
   with lock:
    self.identity()
    if self.guest['blocked']: return self.reply({'error':'此游客已被管理员拉黑'},403)
    admin=self.guest['admin']
   if self.path=='/api/recent':
    with lock:
     progress={}
     for record in sorted(state['records'],key=lambda r:r['date']):
      for row,task in record.get('tasks',{}).items():
       n=int(row)
       fact=str(record['fields'].get('F'+row,'')).strip() if 10<=n<=22 else ''
       previous=progress.get(task)
       if not previous or fact and fact!=previous[1]:
        progress[task]=(record['date'],fact)
    view=recent.snapshot(admin)
    today=datetime.now(ledger.TZ).date()
    for item in view.get('rows',[]):
     latest=max(ref['date'] for ref in item['来源'])
     if item.get('task_id') in progress: latest=progress[item['task_id']][0]
     latest=date.fromisoformat(latest)
     item['stale']=item['状态']!='已完成' and sum(is_workday(today-timedelta(days=n))
      for n in range(max(0,(today-latest).days)))>=3
    return self.reply(view)
   return self.reply(ledger.snapshot(admin))
  if self.path!='/api/state': return super().do_GET()
  with lock:
   self.identity()
   if self.guest['blocked']: return self.reply({'error':'此游客已被管理员拉黑'},403)
   self.reply(self.snapshot())
 def do_POST(self):
  if self.path not in ('/api/change','/api/ledger','/api/recent'): return self.send_error(404)
  try:
   n=int(self.headers.get('Content-Length',0))
   if not 0<n<=1000000: raise ValueError()
   if self.headers.get_content_type()!='application/json': raise ValueError()
   d=json.loads(self.rfile.read(n))
   with lock:
    self.identity()
    if self.guest['blocked']: return self.reply({'error':'此游客已被管理员拉黑'},403)
    if self.path=='/api/change': return self.change(d)
    if not self.guest['admin']: return self.reply({'error':'需要管理员权限'},403)
    records=json.loads(json.dumps(state['records']))
   try: self.reply((recent if self.path=='/api/recent' else ledger).action(d,records))
   except ValueError as error: self.reply({'error':str(error)},400)
  except (ValueError,KeyError,TypeError,AttributeError): self.reply({'error':'请求无效'},400)
 def change(self,d):
  op=d['op']; rs=state['records']
  if op=='admin':
   if not secrets.compare_digest(str(d['key']).encode(),admin_key.encode()): return self.reply({'error':'管理员密钥不正确'},403)
   self.guest['admin']=True
   persist()
   return self.reply({'state':self.snapshot()})
  if op in ('people','guest','clear_guests','new','logout_admin','delete','restore') and not self.guest['admin']: return self.reply({'error':'需要管理员权限'},403)
  if op=='logout_admin':
   self.guest['admin']=False
   self.guest['cleared']=True
   state['rev']+=1
   persist()
   return self.reply({'state':self.snapshot()})
  if op=='clear_guests':
   for guest in state['guests'].values():
    if not guest['admin'] and not guest['blocked']:
     guest['cleared']=True
   state['rev']+=1
   persist()
   return self.reply({'state':self.snapshot()})
  if op=='guest':
   guest=next((g for g in state['guests'].values() if g['id']==d['guest'] and not g['admin']),None)
   if guest is None: return self.reply({'error':'游客不存在'},404)
   guest.update(name=str(d['name']).strip()[:60] or guest['name'],blocked=bool(d['blocked']))
   if guest['blocked']:
    for k,v in list(leases.items()):
     if v['guest'] is guest: del leases[k]
   state['rev']+=1
   persist()
   return self.reply({'state':self.snapshot()})
  self.snapshot()
  cell=(d.get('id'),d.get('field'))
  lease=leases.get(cell)
  owned=lease and lease['guest'] is self.guest and lease['tab']==d.get('tab')
  if op=='release':
   if owned: del leases[cell]
   return self.reply({'state':self.snapshot()})
  if op=='lease':
   if not any(r['id']==cell[0] for r in rs): return self.reply({'error':'记录已删除'},410)
   if lease and not owned: return self.reply({'error':lease['guest']['name']+' 正在编辑'},423)
   leases[cell]={'guest':self.guest,'tab':d['tab'],'expires':time.monotonic()+15}
   return self.reply({'state':self.snapshot()})
  r=next((r for r in rs if r['id']==d.get('id')),None)
  if op in ('field','row','delete','copy_yesterday','copy_preview','insert_task') and r is None: return self.reply({'error':'这条记录已被删除'},410)
  def add(src):
   rec=dict(id=state['next'],date=src['date'],fields=src['fields'],rows=src.get('rows',{}),version=0)
   rs.insert(0,rec);state['next']+=1
   return rec
  result={}
  if op=='new':
   day=datetime.now(ledger.TZ).date().isoformat()
   if any(record['date']==day for record in rs) and d.get('confirm_date')!=day:
    return self.reply({'error':'当天已生成早会记录','date':day},409)
   result['id']=add_template(day)['id']
  elif op=='import':
   for src in reversed(d['records']):
    if src['id'] not in state['imported']:
     add(src);state['imported'].append(src['id'])
  elif op=='restore':
   selected=d.get('ids')
   if not isinstance(selected,list) or not selected or any(type(i) is not int for i in selected):
    raise ValueError()
   restored=[r for r in state['trash'] if r['id'] in selected]
   if len(restored)!=len(set(selected)): return self.reply({'error':'部分记录已恢复，请刷新回收站'},409)
   dates=[r['date'] for r in restored]
   collisions=sorted({day for day in dates if dates.count(day)>1 or any(rec['date']==day for rec in rs)})
   if collisions and d.get('confirmed_dates')!=collisions:
    return self.reply({'error':'存在同日期的记录','dates':collisions},409)
   for record in restored:
    state['trash'].remove(record)
    record.pop('deleted_at',None)
    record['version']+=1
    rs.append(record)
   rs.sort(key=lambda record:(record['date'],record['id']),reverse=True)
  elif op=='insert_task':
   item=recent.item(d['version'],d['index'])
   first,last={10:(10,22),24:(24,39)}[d['group']]
   task=item.get('task_id')
   for row in range(first,last+1):
    title=str(r['fields'].get(f'B{row}','')).strip()
    owner=str(r['fields'].get(f'E{row}','')).strip()
    if title and (task and r.get('tasks',{}).get(str(row))==task or
                  (title,owner)==(item['事项'].strip(),item['负责人'].strip())):
     return self.reply({'error':'该事项已在所选工作表中'},409)
   row=next((n for n in range(first,last+1) if all(not str(r['fields'].get(f'{col}{n}','')).strip()
       and (r['id'],f'{col}{n}') not in leases for col in 'BEF')),None)
   if row is None: return self.reply({'error':'没有可用空行，或空行正在编辑'},409)
   if not task:
    origins=[]
    for ref in item['来源']:
     original=next((record for record in rs if record['id']==ref['id']),None)
     if not original: continue
     field=ref.get('field','')
     rows=(*range(10,23),*range(24,40))
     candidates=[n for n in rows if field==f'B{n}'] if field else [
      n for n in rows if str(original['fields'].get(f'B{n}','')).strip()==item['事项'].strip()
     ]
     if len(candidates)==1: origins.append((original,str(candidates[0])))
    known={record.get('tasks',{}).get(n) for record,n in origins}-{None}
    task=next(iter(known)) if len(known)==1 else secrets.token_hex(12)
    if len(known)<=1:
     for original,n in origins:
      links=original.setdefault('tasks',{})
      if n not in links:
       links[n]=task
       original['version']+=1
   r['fields'][f'B{row}']=item['事项']
   if item['负责人']!='未注明': r['fields'][f'E{row}']=item['负责人']
   r.setdefault('tasks',{})[str(row)]=task or secrets.token_hex(12)
   r['rows'][str(first)]=max(r['rows'].get(str(first),2),row-first+1)
   r['version']+=1
   result['row']=row
  elif op=='field':
   if lease and not owned: return self.reply({'error':lease['guest']['name']+' 正在编辑'},423)
   k=d['field']; value=str(r['fields'].get(k,'') or '')
   if value!=d['base'] and value!=d['value']: return self.reply({'value':value},409)
   r['fields'][k]=d['value'];r['version']+=1
   if k.startswith('B') and k[1:].isdigit() and int(k[1:]) in (*range(10,23),*range(24,40)):
    linked=r.setdefault('tasks',{})
    if str(d['value']).strip():
     if k[1:] not in linked: linked[k[1:]]=secrets.token_hex(12)
    else: linked.pop(k[1:],None)
  elif op in ('copy_yesterday','copy_preview'):
   yesterday=(date.fromisoformat(r['date'])-timedelta(days=1)).isoformat()
   def row_values(record, row):
    return tuple(str(record['fields'].get(f'{col}{row}') or '') for col in 'BEF')
   previous=max((rec for rec in rs if rec['date']<=yesterday and
                 any(row_values(rec,i)[0].strip() for i in range(24,40))),
                key=lambda rec:(rec['date'],rec['id']),default=None)
   if previous is None: return self.reply({'error':'没有可复制的历史工作安排'},404)
   fallback=previous['date']!=yesterday
   source={k:previous[k] for k in ('id','date','version')}
   if op=='copy_preview':
    return self.reply({'fallback':fallback,'source':source})
   if (fallback or 'source' in d) and d.get('source')!=source:
    return self.reply({'error':'来源记录已更新，请重新确认'},409)
   occupied={row:row_values(r,row) for row in range(10,23)}
   seen={(work.strip(),owner.strip()) for work,owner,_ in occupied.values() if work.strip()}
   seen_tasks={r.get('tasks',{}).get(str(n)) for n in occupied}-{None}
   pending=[]
   for row in range(24,40):
    work,owner,_=row_values(previous,row)
    pair=(work.strip(),owner.strip())
    linked=previous.get('tasks',{}).get(str(row))
    if pair[0] and pair not in seen and linked not in seen_tasks:
     if linked: seen_tasks.add(linked)
     pending.append((work,owner,row))
     seen.add(pair)
   if not pending: return self.reply({'state':self.snapshot(),'count':0})
   free=[row for row,values in occupied.items() if not any(value.strip() for value in values)
         and all((r['id'],f'{col}{row}') not in leases for col in 'BEF')]
   if len(pending)>len(free): return self.reply({'error':'可用的空行不足，或有空行正在编辑。现有内容已保留。'},409)
   for row,(work,owner,source_row) in zip(free,pending):
    source_tasks=previous.setdefault('tasks',{})
    if str(source_row) not in source_tasks:
     source_tasks[str(source_row)]=secrets.token_hex(12)
     previous['version']+=1
    r.setdefault('tasks',{})[str(row)]=source_tasks[str(source_row)]
    r['fields'][f'B{row}']=work
    r['fields'][f'E{row}']=owner
   r['rows']['10']=max(r['rows'].get('10',2),free[len(pending)-1]-9)
   r['version']+=1
   result['count']=len(pending)
  elif op=='row':
   k=str(d['group']); limits={'10':13,'24':16}
   count=r['rows'].get(k,2)
   if count>=limits[k]: return self.reply({'error':'已达到模板行数上限'},400)
   r['rows'][k]=count+1;r['version']+=1;result['count']=count+1
  elif op=='delete':
   if any(k[0]==r['id'] for k in leases): return self.reply({'error':'有人正在编辑这条记录'},423)
   if r['version']!=d['version']: return self.reply({'error':'记录刚被修改，请刷新查看后再删除'},409)
   rs.remove(r)
   r['deleted_at']=datetime.now(ledger.TZ).isoformat(timespec='seconds')
   state['trash'].append(r)
  elif op=='people':
   if state['people']!=d['base']: return self.reply({'error':'名单刚被修改，请重新打开设置'},409)
   state['people']=d['value']
  else: raise ValueError()
  if op in ('new','field','row','delete','import','copy_yesterday'):
   self.guest.pop('cleared',None)
  state['rev']+=1;persist()
  self.reply({**result,'state':self.snapshot()})
if __name__=='__main__':
 import sys
 def ledger_records():
  with lock: return json.loads(json.dumps(state['records']))
 threading.Thread(target=schedule_workday,daemon=True).start()
 threading.Thread(target=recent.scheduled,args=(ledger_records,is_workday),daemon=True).start()
 threading.Thread(target=ledger.scheduled,args=(ledger_records,),daemon=True).start()
 ThreadingHTTPServer((os.environ.get('MORNING_NOTES_BIND','0.0.0.0'),int(sys.argv[1]) if len(sys.argv)>1 else 8765),partial(Handler,directory=root/'dist')).serve_forever()



