import io, re, zipfile
from pathlib import Path

PATTERNS={
 'opening':r'(?:开启方式|开窗方式)\s*[:：]?\s*(内开|外开|推拉|固定)',
 'tempered':r'(?:钢化玻璃|玻璃钢化)\s*[:：]?\s*(是|否)',
 'sound_rw':r'(?:隔声量|隔音量|Rw)\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*dB',
 'air_grade':r'(?:气密(?:性)?等级)\s*[:：=]?\s*([1-8])\s*级?',
 'seal_count':r'(?:密封道数|密封)\s*[:：=]?\s*([1-6])\s*道',
 'thickness':r'(?:铝材|型材|壁厚|公称壁厚)[^\d\n]{0,12}(\d+(?:\.\d+)?)\s*(?:mm|毫米)',
 'strip_width':r'(?:隔热条宽度|隔热条)[^\d\n]{0,8}(\d+(?:\.\d+)?)\s*(?:mm|毫米)',
 'uw':r'(?:整窗\s*(?:Uw|U值|K值)|Uw)\s*[:：=]?\s*(\d+(?:\.\d+)?)',
 'shgc':r'(?:SHGC|太阳得热系数)\s*[:：=]?\s*(0(?:\.\d+)?|1(?:\.0+)?)',
 'wind':r'(?:抗风压|P3)[^\d\n]{0,8}(\d+(?:\.\d+)?)\s*kPa',
 'water':r'(?:水密)[^\d\n]{0,8}(\d+(?:\.\d+)?)\s*Pa',
 'price':r'(?:单价|报价)[^\d\n]{0,8}(\d+(?:\.\d+)?)\s*元',
 'thermal':r'\b(PA66(?:\s*[-+]?\s*GF25)?|PVC)\b',
 'seal':r'\b(EPDM|TPE|TPV)\b|(?:三元乙丙)',
 'glass':r'(\d+(?:\.\d+)?(?:\s*\+\s*\d+(?:\.\d+)?\s*(?:Ar|A)?){2,}(?:\s*Low[- ]?E)?)',
 'hardware':r'五金\s*[:：]\s*([^\n，,；;]{2,60})'}

CATEGORIES=(('合同与计价',r'合同|报价|单价|总价|付款|质保|售后|增项|面积'),
            ('性能与检测',r'水密|气密|抗风压|隔声|隔音|传热|K值|Uw|SHGC|报告|检测'),
            ('玻璃与安全',r'玻璃|钢化|夹胶|Low.?E|中空|承重块'),
            ('型材与构造',r'型材|铝材|隔热条|胶条|密封|五金|排水|开启'),
            ('安装与验收',r'安装|副框|主框|打胶|锚固|验收|淋水'))

def classify(pages):
    observations=[]
    for page in pages:
        for line in page['text'].splitlines():
            line=line.strip()
            if not line: continue
            category=next((name for name,pattern in CATEGORIES if re.search(pattern,line,re.I)),'其他资料')
            observations.append({'category':category,'page':page['page'],'text':line[:500]})
    return observations

def candidates(pages):
    out=[]
    for page in pages:
        for key,pattern in PATTERNS.items():
            for match in re.finditer(pattern,page['text'],re.I):
                raw=match.group(1) if match.lastindex and match.group(1) else match.group()
                value=float(raw) if key in ('thickness','strip_width','uw','shgc','wind','water','price','sound_rw') else int(raw) if key in ('air_grade','seal_count') else raw
                out.append(dict(field=key,value=value,page=page['page'],quote=page['text'][max(0,match.start()-30):match.end()+40],confirmed=False))
    return out[:150]

def extract(path):
    suffix=path.suffix.lower(); pages=[]; mode='TEXT'
    if suffix in ('.docx','.xlsx'):
        with zipfile.ZipFile(path) as z:
            if sum(x.file_size for x in z.infolist())>100*1024*1024: raise ValueError('解压后的文件过大')
    if suffix=='.pdf':
        from pypdf import PdfReader
        reader=PdfReader(path)
        if len(reader.pages)>100: raise ValueError('PDF 最多 100 页，请拆分')
        for i,page in enumerate(reader.pages): pages.append({'page':i+1,'text':(page.extract_text() or '')[:30000]})
        empty=[i for i,p in enumerate(pages) if not p['text'].strip()]
        if empty:
            import pypdfium2 as pdfium
            import numpy as np
            from rapidocr_onnxruntime import RapidOCR
            engine=RapidOCR(); pdf=pdfium.PdfDocument(str(path))
            try:
                for i in empty[:20]:
                    page=pdf[i]
                    w,h=page.get_size(); scale=min(2,2200/max(w,h))
                    bitmap=page.render(scale=scale)
                    try: result,_=engine(np.array(bitmap.to_pil().convert('RGB')))
                    finally: bitmap.close();page.close()
                    pages[i]['text']='\n'.join(x[1] for x in result or [])
                    pages[i]['ocr']=True
            finally: pdf.close()
            mode='PARTIAL_OCR' if len(empty)>20 else 'TEXT_AND_OCR_CANDIDATES'
    elif suffix=='.docx':
        from docx import Document
        d=Document(path)
        text='\n'.join(p.text for p in d.paragraphs)+'\n'+'\n'.join(' | '.join(c.text for c in row.cells) for table in d.tables for row in table.rows)
        pages=[{'page':'文档文本（非原始页码）','text':text[:100000]}]
    elif suffix=='.xlsx':
        from openpyxl import load_workbook
        w=load_workbook(path,read_only=True,data_only=True)
        for sheet in w:
            rows=[]
            for row in sheet.iter_rows(max_row=min(sheet.max_row or 0,10000),max_col=min(sheet.max_column or 0,60),values_only=True):
                rows.append(' | '.join('' if x is None else str(x) for x in row))
            pages.append({'page':sheet.title,'text':'\n'.join(rows)[:100000]})
        w.close()
    elif suffix in ('.png','.jpg','.jpeg','.webp'):
        from PIL import Image
        with Image.open(path) as im:
            if im.width*im.height>30_000_000: raise ValueError('图片像素过大')
        from rapidocr_onnxruntime import RapidOCR
        result,_=RapidOCR()(str(path))
        pages=[{'page':1,'text':'\n'.join(x[1] for x in result or [])}]; mode='OCR_CANDIDATES'
    else:
        raw=path.read_bytes()
        try: text=raw.decode('utf-8-sig')
        except UnicodeDecodeError: text=raw.decode('gb18030')
        pages=[{'page':1,'text':text[:100000]}]
    return dict(mode=mode,pages=pages,candidates=candidates(pages),observations=classify(pages),warning='提取结果需人工确认；图形尺寸、连接关系和检测真伪未自动验证。扫描 PDF 每份最多 OCR 20 页，其余页需拆分后上传。')
