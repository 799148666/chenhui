"""Daily working summary, using the same DeepSeek configuration as the ledger."""
import threading
from copy import deepcopy
from datetime import datetime, timedelta
import ledger

running = False
last_failure = None

def current():
    return ledger.data.get('recent', {})

def snapshot(admin):
    with ledger.mutex:
        result = deepcopy(current())
        result.pop('corrections', None)
        if admin:
            result.update(running=running, error=last_failure[1] if last_failure else '')
        else:
            result.pop('automatic', None)
        return result

def generate(key, source, previous, version, today, auto):
    global running, last_failure
    try:
        rows = ledger.validate(ledger.deepseek(key, source, previous), source)
        rows.sort(key=lambda row: row['状态']=='已完成')
        with ledger.mutex:
            if current().get('version',0)!=version:
                raise ValueError('生成期间事项已被修改，已保留管理员的修改，请重新更新')
            ledger.data['recent']={
                'rows':rows,'generated':datetime.now(ledger.TZ).isoformat(timespec='seconds'),
                'start':(today-timedelta(days=29)).isoformat(),'end':today.isoformat(),
                'version':version+1,'corrections':previous,
                'automatic':today.isoformat() if auto else current().get('automatic',''),
            }
            ledger.persist()
    except Exception as error:
        with ledger.mutex:
            reason=(f'DeepSeek 返回 HTTP {error.code}' if hasattr(error,'code') else
                    str(error) if type(error) is ValueError else 'DeepSeek 请求超时或返回格式无效')
            last_failure=(datetime.now(ledger.TZ),reason)
    finally:
        with ledger.mutex:
            running=False

def start(records, now, auto=False):
    global running, last_failure
    today=now.date()
    with ledger.mutex:
        previous_summary=current()
        if running:
            if auto: return
            raise ValueError('正在生成最近事项，请稍候')
        if auto and (previous_summary.get('automatic')==today.isoformat() or
                     last_failure and now-last_failure[0]<timedelta(minutes=15)):
            return
        key=ledger.data.get('key')
        if not key:
            if auto: return
            raise ValueError('请先在 AI 工作台账配置 DeepSeek API Key')
        source=ledger.sources(records,today-timedelta(days=29),today)
        if not source:
            if auto: return
            raise ValueError('最近一个月没有可汇总的工作条目')
        source_ids={record['id'] for record in source}
        previous=[row for row in previous_summary.get('corrections',[])
                  if any(ref['id'] in source_ids for ref in row['来源'])]
        running=True
        last_failure=None
        threading.Thread(target=generate,args=(key,source,previous,previous_summary.get('version',0),today,auto),daemon=True).start()

def item(version,index):
    with ledger.mutex:
        report=current()
        if version!=report.get('version') or type(index) is not int or not 0<=index<len(report.get('rows',[])):
            raise ValueError('事项已更新，请重新打开侧栏后再带入')
        return deepcopy(report['rows'][index])

def action(form, records):
    if form['op']=='generate':
        start(records,datetime.now(ledger.TZ))
        return {'queued':True}
    if form['op']!='edit':
        raise ValueError('操作无效')
    kind=form.get('kind','fact')
    if kind not in ('fact','wording'):
        raise ValueError('请选择修订类型')
    with ledger.mutex:
        report=current()
        if form['version']!=report.get('version',0):
            raise ValueError('事项已更新，请刷新后再修改')
        index=form['index']
        if type(index) is not int or not 0<=index<len(report.get('rows',[])):
            raise ValueError('事项不存在')
        old=report['rows'][index]
        refs=old['来源']
        submitted={k:form['row'].get(k) for k in ledger.COLUMNS}
        updated=ledger.validate([{**submitted,'来源':[ref['id'] for ref in refs]}],refs)[0]
        updated['来源']=refs
        if old.get('task_id'): updated['task_id']=old['task_id']
        if kind=='wording' and any(updated[k]!=old[k] for k in ('负责人','状态','截止日期')):
            raise ValueError('文字润色不能修改负责人、状态或截止日期，请选择纠正事实')
        report['rows'][index]=updated
        report['rows'].sort(key=lambda row:row['状态']=='已完成')
        corrections=report.setdefault('corrections',[])
        matches={old['事项'],updated['事项']}
        if kind=='fact':
            corrections[:]=[row for row in corrections if not (
                row['事项'] in matches and row['来源']==refs
            )]
            corrections.append(updated)
        else:
            for previous in corrections:
                if previous['来源']==refs and previous['事项']==old['事项']:
                    previous['事项']=updated['事项']
        report['version']+=1
        ledger.persist()
        return {'saved':True}

def scheduled(records_getter, is_workday):
    while True:
        try:
            now=datetime.now(ledger.TZ)
            if (now.hour,now.minute)>=(0,2) and is_workday(now.date()):
                start(records_getter(),now,auto=True)
        except Exception:
            import traceback
            traceback.print_exc()
        threading.Event().wait(30)

