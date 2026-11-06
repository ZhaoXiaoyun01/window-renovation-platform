import json, urllib.request, urllib.parse, pathlib, concurrent.futures
from html.parser import HTMLParser
ROOT = pathlib.Path(__file__).parent
class Text(HTMLParser):
    def __init__(self): super().__init__(); self.parts=[]; self.skip=0
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style'): self.skip+=1
        if tag=='a':
            self.parts.extend(v for k,v in attrs if k=='href')
    def handle_endtag(self,tag):
        if tag in ('script','style'): self.skip=max(0,self.skip-1)
    def handle_data(self,data):
        if not self.skip and data.strip(): self.parts.append(data.strip())
def fetch(item):
    name,url=item
    try:
        raw=urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=25).read().decode('utf-8','replace')
        (ROOT/(name+'.raw')).write_text(raw,encoding='utf-8')
        p=Text(); p.feed(raw); text='\n'.join(p.parts) if '<html' in raw.lower() else raw
        (ROOT/(name+'.txt')).write_text(url+'\n'+text,encoding='utf-8')
        print(name,'OK',len(raw))
    except Exception as e: print(name,type(e).__name__)
if __name__=='__main__':
    jobs=[('video1','https://api.bilibili.com/x/web-interface/view?bvid=BV1FiPTz2EBr'),('video2','https://api.bilibili.com/x/web-interface/view?bvid=BV1RJ4meUEK7'),('hc521','https://raw.githubusercontent.com/HC521/zhuangxiu/master/README.md'),('skills','https://raw.githubusercontent.com/zx029w/zhuangxiu-skills/main/README.md'),('pywincalc','https://raw.githubusercontent.com/LBNL-ETA/pyWinCalc/master/README.md')]
    for i,q in enumerate(['GB/T 8478-2020 铝合金门窗 1.8 2.2','广东 居住建筑节能设计标准 DBJ 15 133 现行','GB 55015 2021 门窗 广东 传热','GB/T 8478 2025 2026 铝合金门窗']):
        jobs.append(('search'+str(i),'https://www.bing.com/search?q='+urllib.parse.quote(q)))
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex: list(ex.map(fetch,jobs))
