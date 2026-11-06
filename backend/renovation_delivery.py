"""Delivery worksheet formatting. All names and evidence remain literal text."""
def format_delivery_sheet(sheet, widths):
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
    from math import ceil
    from unicodedata import east_asian_width
    for row in sheet:
        height=30
        for cell in row:
            if isinstance(cell.value,str):
                cell.value=ILLEGAL_CHARACTERS_RE.sub('',cell.value);cell.data_type='s'
                units=sum(2 if east_asian_width(c) in 'WF' else 1 for c in cell.value)
                height=max(height,ceil(units/max(1,widths[cell.column-1]-2))*15+10)
            cell.font=Font(name='Microsoft YaHei',size=11,color='FFFFFF' if cell.row==1 else '303A34',bold=cell.row==1)
            cell.alignment=Alignment(horizontal='center',vertical='center',wrap_text=True)
            if cell.row==1:cell.fill=PatternFill('solid',fgColor='41594B')
        sheet.row_dimensions[row[0].row].height=height
    for index,width in enumerate(widths,1):sheet.column_dimensions[get_column_letter(index)].width=width
    sheet.freeze_panes='A2';sheet.auto_filter.ref=f'A1:{get_column_letter(len(widths))}{sheet.max_row}'
    sheet.sheet_view.showGridLines=False;sheet.sheet_properties.pageSetUpPr.fitToPage=True
    sheet.page_setup.orientation='landscape';sheet.page_setup.paperSize=sheet.PAPERSIZE_A3;sheet.page_setup.fitToWidth=1;sheet.page_setup.fitToHeight=0
    sheet.print_title_rows='1:1';sheet.print_area=f'A1:{get_column_letter(len(widths))}{sheet.max_row}'

def add_delivery_sheets(book,metadata,name,generated_at,catalog=None):
    if metadata is None:return
    sheet=book.create_sheet('交付说明');sheet.append(['字段','内容'])
    for key,value in [('方案',name),('软件版本',metadata.applicationVersion),('方案格式',metadata.schemaVersion),('分面修订',metadata.faceGroupingVersion),('来源保存方案ID',metadata.basePlanId or '未关联保存ID'),('日期/时区',generated_at+'（Asia/Shanghai）'),('快照性质',metadata.snapshotType),('尺寸来源',metadata.source),('尺寸状态',metadata.dimensionNote),('计量口径',metadata.measurementBasis),('价格口径','默认价格及来源未记录的历史价格均为估价；开启扇按扇额外加价，人工/辅料/运输未计。'),('施工用途','未完成现场核实，立面图片与预算不作为施工放样或工程鉴定结论。')]:sheet.append([key,value])
    format_delivery_sheet(sheet,(28,115))
    if catalog:
        sheet=book.create_sheet('材料编号');sheet.append(['编号','材料','类型','颜色','规格 mm（设定值·待核实）','铺贴方向','起铺方式','砖缝 mm','砖缝颜色'])
        for entry in catalog:sheet.append([entry.code,entry.name,'漆面' if entry.kind=='paint' else '瓷砖',entry.color,'—' if entry.kind=='paint' else f'{entry.widthMm:g}×{entry.heightMm:g}','—' if entry.kind=='paint' else '长边横铺' if entry.direction=='horizontal' else '长边竖铺','—' if entry.kind=='paint' else '墙角起铺' if entry.alignment=='edge' else '两侧均分',entry.groutMm if entry.kind!='paint' else '—',entry.groutColor if entry.kind!='paint' else '—'])
        format_delivery_sheet(sheet,(12,32,12,18,24,20,20,15,18))
