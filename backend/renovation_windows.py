"""Independent, read-only window estimate export. Does not open a database."""
from decimal import Decimal, ROUND_HALF_UP
from io import BytesIO
from math import ceil
from typing import Literal
from unicodedata import east_asian_width

from pydantic import BaseModel, ConfigDict, Field, model_validator
from .renovation_contracts import WindowQuote,DeliveryMetadata,GlassUpgrade
from .renovation_delivery import add_delivery_sheets,format_delivery_sheet

FLOORS = {'f1': '一层', 'f2': '二层', 'f3': '三层', 'f4': '四层'}
HEADERS = ['楼层', '窗户名称', '宽度 mm', '高度 mm', '面积 m²', '窗框颜色', '玻璃', '开启方式', '开口扇数', '单价 元/m²', '开口扇单价 元/扇', '玻璃升级规格', '升级单价 元/m²', '升级金额 元', '总价 元']
WIDTHS = (12, 32, 15, 15, 16, 18, 20, 20, 15, 20, 24, 36, 22, 22, 22)
def upgrade_label(upgrade):
    return f'{upgrade.spec}+(6-27)A+{upgrade.spec}离线LOWE' if upgrade else '无升级'


class WindowRow(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=100)
    floorId: Literal['f1', 'f2', 'f3', 'f4']
    name: str = Field(min_length=1, max_length=80)
    widthMm: float = Field(gt=0, le=20000)
    heightMm: float = Field(gt=0, le=20000)
    frameColor: str = Field(pattern=r'^#[0-9a-fA-F]{6}$')
    glassType: Literal['low', 'medium', 'high'] = 'medium'
    mode: str = Field(min_length=1, max_length=40)
    sashCount: int = Field(ge=0, le=100)
    pricePerM2: float | None = Field(None, ge=0, le=1000000)
    sashPrice: float | None = Field(None, ge=0, le=1000000)
    glassUpgrade: GlassUpgrade | None = None
    quotes: list[WindowQuote] | None = None
    code: str | None = Field(None,pattern=r'^W\d{2,4}$')
    dimensionStatus: str | None = Field(None,max_length=80)
    dimensionNote: str | None = Field(None,max_length=2000)


class WindowExport(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False)
    name: str = Field(min_length=1, max_length=80)
    generatedAt: str = Field(min_length=1, max_length=80)
    rows: list[WindowRow] = Field(min_length=1, max_length=2000)
    metadata: DeliveryMetadata | None = None

    @model_validator(mode='after')
    def valid_rows(self):
        if not self.name.strip() or any(not row.name.strip() for row in self.rows) or len({row.id for row in self.rows}) != len(self.rows):
            raise ValueError('窗户名称无效或标识重复')
        if any(q.configuration.openingId != row.id for row in self.rows for q in row.quotes or []):
            raise ValueError('报价配置对应窗户不匹配')
        return self


def create_window_workbook(report: WindowExport) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
    from openpyxl.utils import get_column_letter

    book = Workbook(); sheet = book.active; sheet.title = '窗户统计'
    sheet.append(['窗户统计表'])
    sheet.append([f'方案：{report.name.strip()}    导出时间：{report.generatedAt}    当前筛选快照'+(f' · 软件{report.metadata.applicationVersion}/方案格式1/分面{report.metadata.faceGroupingVersion}' if report.metadata else '')])
    sheet.append(['总价=宽×高换算面积×（窗户单价+玻璃升级单价）+开口扇数×每扇加价；玻璃升级按窗户总面积另计，非玻璃净面积。未选择升级不加价；未设置基础价格显示待报价。'])
    sheet.append(['开口扇数来自示意窗格或手动修正，开启方式与尺寸仍须现场核实。本表独立于粘贴用料，不含门、阳台敞口和格栅。'])
    sheet.append([]); sheet.append(HEADERS)
    for row in range(1, 5):
        sheet.merge_cells(start_row=row, start_column=1, end_row=row, end_column=len(HEADERS))
    area_total = Decimal(0); amount_total = Decimal(0); upgrade_total = Decimal(0); sashes = 0; unpriced = 0
    for row in report.rows:
        area = Decimal(str(row.widthMm)) * Decimal(str(row.heightMm)) / 1000000
        priced = row.pricePerM2 is not None and (row.sashCount == 0 or row.sashPrice is not None)
        upgrade_price = Decimal(str(row.glassUpgrade.pricePerM2)) if row.glassUpgrade else Decimal(0)
        upgrade_amount = (area * upgrade_price).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
        amount = (area * (Decimal(str(row.pricePerM2)) + upgrade_price) + row.sashCount * Decimal(str(row.sashPrice or 0))).quantize(Decimal('.01'), rounding=ROUND_HALF_UP) if priced else None
        sheet.append([FLOORS[row.floorId], row.name, row.widthMm, row.heightMm, float(area), row.frameColor.upper(), {'low': '低透 Low-E', 'medium': '中透 Low-E', 'high': '高透 Low-E'}[row.glassType], row.mode, row.sashCount,
                      row.pricePerM2 if row.pricePerM2 is not None else '未设置', row.sashPrice if row.sashPrice is not None else '未设置', upgrade_label(row.glassUpgrade), float(upgrade_price), float(upgrade_amount), float(amount) if amount is not None else '待报价'])
        area_total += area; sashes += row.sashCount; unpriced += int(not priced); amount_total += amount or Decimal(0); upgrade_total += upgrade_amount
    sheet.append([f'筛选合计 {len(report.rows)}樘', '', '', '', float(area_total), '', '', '', sashes, '', f'{unpriced}樘待报价' if unpriced else '已全部报价', '', '', float(upgrade_total), float(amount_total)])
    for row in sheet:
        height = 29
        for cell in row:
            if isinstance(cell.value, str):
                cell.value = ILLEGAL_CHARACTERS_RE.sub('', cell.value); cell.data_type = 's'
                width = sum(WIDTHS) - 2 if cell.row <= 4 else WIDTHS[cell.column - 1] - 2
                height = max(height, ceil(sum(2 if east_asian_width(c) in 'WF' else 1 for c in cell.value) / width) * 15 + 8)
            cell.font = Font(name='Microsoft YaHei', size=11, color='303A34')
            cell.alignment = Alignment(vertical='center', wrap_text=True, horizontal='center')
            if cell.row >= 7:
                cell.number_format = '#,##0.000' if cell.column == 5 else '#,##0.00' if cell.column in (10, 11, 13, 14, 15) else '#,##0' if cell.column in (3, 4, 9) else 'General'
        sheet.row_dimensions[row[0].row].height = height
    for row in (6, sheet.max_row):
        for cell in sheet[row]:
            cell.fill = PatternFill('solid', fgColor='41594B' if row == 6 else 'EDF1E9')
            cell.font = Font(name='Microsoft YaHei', size=11, bold=True, color='FFFFFF' if row == 6 else '303A34')
    sheet['A1'].font = Font(name='Microsoft YaHei', size=17, bold=True, color='41594B')
    sheet.row_dimensions[1].height = 38; sheet.row_dimensions[6].height = 40
    for index, width in enumerate(WIDTHS, 1):
        sheet.column_dimensions[get_column_letter(index)].width = width
    sheet.freeze_panes = 'C7'; sheet.auto_filter.ref = f'A6:O{sheet.max_row - 1}'
    sheet.sheet_view.showGridLines = False; sheet.print_title_rows = '1:6'
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_setup.orientation = 'landscape'; sheet.page_setup.paperSize = sheet.PAPERSIZE_A3
    sheet.page_setup.fitToWidth = 1; sheet.page_setup.fitToHeight = 0
    sheet.print_area = f'A1:O{sheet.max_row}'
    if any(row.quotes for row in report.rows):
        evidence=book.create_sheet('报价记录')
        evidence.append(['窗号','窗户名称','报价类别','来源','日期','已核对配置','宽 mm','高 mm','窗框颜色','玻璃','开启方式','开启扇数','面积单价','每扇单价','玻璃升级规格','升级单价 元/m²'])
        for row in report.rows:
            for q in row.quotes or []:
                c=q.configuration;evidence.append([row.id,row.name,{'estimate':'估价','merchant':'商家报价','confirmed':'已确认报价'}[q.status],q.source,q.date,'是' if q.checked else '否',c.widthMm,c.heightMm,c.frameColor,c.glassType,c.mode,c.sashCount,c.pricePerM2,c.sashPrice,upgrade_label(c.glassUpgrade),c.glassUpgrade.pricePerM2 if c.glassUpgrade else 0])
        for row in evidence:
            for cell in row:
                if isinstance(cell.value,str):cell.value=ILLEGAL_CHARACTERS_RE.sub('',cell.value);cell.data_type='s'
                cell.alignment=Alignment(horizontal='center',vertical='center',wrap_text=True)
        evidence.freeze_panes='C2'
        format_delivery_sheet(evidence,(22,30,20,36,18,18,18,18,18,18,26,18,18,18,36,22))
    if report.metadata:
        evidence=book.create_sheet('窗户配置与依据');evidence.append(['窗号','模型ID','楼层','名称','尺寸状态','尺寸依据','报价状态','价格来源','报价日期','当前配置核对'])
        for row in report.rows:
            q=row.quotes[-1] if row.quotes else None
            matches=False
            if q:
                c=q.configuration
                matches=(c.widthMm==row.widthMm and c.heightMm==row.heightMm and c.frameColor.lower()==row.frameColor.lower() and c.glassType==row.glassType and c.mode==row.mode and c.sashCount==row.sashCount and c.pricePerM2==row.pricePerM2 and c.sashPrice==row.sashPrice and c.glassUpgrade==row.glassUpgrade)
            status='默认/历史估价（来源未核实）' if q is None else {'estimate':'估价','merchant':'商家报价','confirmed':'已确认报价'}[q.status] if matches else '配置或价格已变更 · 待重核'
            evidence.append([row.code or '未编号',row.id,FLOORS[row.floorId],row.name,row.dimensionStatus or '尺寸待核实',row.dimensionNote or '尺寸依据未记录',status,q.source if q else '来源未记录',q.date if q else '未记录','一致' if matches else '需核对'])
        format_delivery_sheet(evidence,(14,25,12,30,28,65,32,36,18,18))
    add_delivery_sheets(book,report.metadata,report.name.strip(),report.generatedAt)
    output = BytesIO(); book.save(output); return output.getvalue()
