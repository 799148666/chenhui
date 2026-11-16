import glob,io,json,zipfile
from openpyxl import load_workbook
from openpyxl.styles import PatternFill,Font,Alignment
w=load_workbook(glob.glob('C:/Users/Administrator/Desktop/[!~]*11.09(1).xlsx')[0])
s=w.active
defaults={c.coordinate:c.value for row in s for c in row if c.fill.fgColor.value=='FFFFFF00' and c.value is not None}
keys=['A1',*defaults,'A41','A44','A47']
for start,end in [(10,22),(24,39)]:
 for r in range(start,end+1):
  keys.extend(f'{col}{r}' for col in 'ABEF')
for row in s:
 for c in row:
  c.fill=PatternFill()
  if c.value is not None: c.font=Font(name='Microsoft YaHei',size=16 if c.coordinate=='A1' else 11,bold=c.coordinate not in keys or c.coordinate=='A1')
for k in keys:
 s[k]='__FIELD_'+k+'__'
 s[k].alignment=Alignment(horizontal='center' if k=='A1' else 'left',vertical='center',wrap_text=True)
for r in [9,23]:
 s[f'E{r}']='负责人'
 s[f'F{r}']='完成情况' if r==9 else '完成要求'
b=io.BytesIO()
w.save(b)
with zipfile.ZipFile(b) as z:
 parts={k:z.read(k).decode() for k in z.namelist()}
with open('template.js','w',encoding='utf8') as f:
 f.write('const defaults='+json.dumps(defaults,ensure_ascii=False)+';\nconst parts='+json.dumps(parts,ensure_ascii=False)+';')
