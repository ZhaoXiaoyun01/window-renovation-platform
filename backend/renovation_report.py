"""Read-only Excel export of the current renovation material report."""
from collections import defaultdict
from decimal import Decimal, ROUND_CEILING, ROUND_HALF_UP
from io import BytesIO
from math import ceil
from typing import Literal
from unicodedata import east_asian_width

from pydantic import BaseModel, ConfigDict, Field, model_validator
from .renovation_contracts import PurchaseRule,DeliveryMetadata,MaterialIndex
from .renovation_delivery import add_delivery_sheets,format_delivery_sheet

REGIONS = {'base': '底座', 'f1': '一层', 'f2': '二层', 'f3': '三层', 'f4': '四层', 'terrace': '露台 / 屋顶'}
TEXTURES = {'plain': '纯色', 'stone': '石纹', 'concrete': '水泥纹', 'custom': '上传图片'}
HEADERS = ['楼层／区域', '材料名称', '材料类型', '纹理／规格', '净铺贴面积 m²', '排版片数', '预购片数', '预购面积 m²', '单价 元/m²', '预估材料费 元']
WIDTHS = (24, 32, 12, 28, 18, 14, 14, 18, 18, 21)


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False)


class ReportMaterial(Strict):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=80)
    kind: Literal['tile', 'paint']
    texture: Literal['plain', 'stone', 'concrete', 'custom']
    pricePerM2: float = Field(ge=0, le=1000000)
    purchaseRule: PurchaseRule | None = None


class ReportRow(Strict):
    regionId: Literal['base', 'f1', 'f2', 'f3', 'f4', 'terrace']
    materialId: str = Field(min_length=1, max_length=100)
    widthMm: float = Field(ge=0, le=2400)
    heightMm: float = Field(ge=0, le=2400)
    tiles: int = Field(ge=0, le=250000)
    areaMm2: float = Field(gt=0, le=1000000000000)
    codes: list[str] | None = Field(None,max_length=2000)


class ReportExport(Strict):
    name: str = Field(min_length=1, max_length=80)
    generatedAt: str = Field(min_length=1, max_length=80)
    materials: list[ReportMaterial] = Field(min_length=1, max_length=32)
    rows: list[ReportRow] = Field(min_length=1, max_length=2000)
    metadata: DeliveryMetadata | None = None
    catalog: list[MaterialIndex] | None = Field(None,max_length=2000)

    @model_validator(mode='after')
    def valid_rows(self):
        materials = {m.id: m for m in self.materials}
        seen = set()
        if len(materials) != len(self.materials) or not self.name.strip():
            raise ValueError('报表名称或材质无效')
        for row in self.rows:
            material = materials.get(row.materialId)
            key = (row.regionId, row.materialId, min(row.widthMm, row.heightMm), max(row.widthMm, row.heightMm))
            if material is None or key in seen:
                raise ValueError('报表存在未知或重复材料行')
            seen.add(key)
            if material.kind == 'paint':
                if row.tiles or row.widthMm or row.heightMm:
                    raise ValueError('漆面不能包含砖格数量或规格')
            elif min(row.widthMm, row.heightMm) < 20:
                raise ValueError('瓷砖规格无效')
        if sum(row.tiles for row in self.rows) > 250000:
            raise ValueError('报表砖格数量超限')
        if len({entry.code for entry in self.catalog or []})!=len(self.catalog or []):
            raise ValueError('材料编号重复')
        for entry in self.catalog or []:
            material=materials.get(entry.materialId)
            if material is None or material.kind!=entry.kind or not any(row.materialId==entry.materialId and (entry.kind=='paint' or sorted([entry.widthMm,entry.heightMm])==sorted([row.widthMm,row.heightMm])) for row in self.rows):
                raise ValueError('材料编号与用量行不匹配')
        catalog={entry.code:entry for entry in self.catalog or []}
        for row in self.rows:
            if row.codes is not None and (len(set(row.codes))!=len(row.codes) or any(code not in catalog or catalog[code].materialId!=row.materialId or sorted([catalog[code].widthMm,catalog[code].heightMm])!=sorted([row.widthMm,row.heightMm]) for code in row.codes)):
                raise ValueError('用量行材料编号不匹配')
        return self


def create_workbook(report: ReportExport) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
    from openpyxl.utils import get_column_letter
    from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE

    materials = {m.id: m for m in report.materials}
    modern=bool(report.metadata and tuple(map(int,report.metadata.applicationVersion.split('.'))) >= (3,6))
    headers=HEADERS+['材料编号','颜色','箱数'] if modern else HEADERS
    widths=WIDTHS+(24,20,12) if modern else WIDTHS
    last_column='M' if modern else 'J'
    calculations=[]

    def values(row, region):
        material = materials[row.materialId]
        paint = material.kind == 'paint'
        rule = material.purchaseRule
        ratio = Decimal(1) + Decimal(str(rule.reservePercent if rule else 0 if paint else 5))/100
        reserved = int((Decimal(row.tiles) * ratio).to_integral_value(rounding=ROUND_CEILING))
        purchase = reserved
        if rule and rule.fullBoxes and not paint:
            purchase = ((purchase + rule.piecesPerBox - 1)//rule.piecesPerBox)*rule.piecesPerBox
        size = Decimal(str(row.widthMm)) * Decimal(str(row.heightMm)) / 1000000
        net = Decimal(str(row.areaMm2)) / 1000000
        basis = net*ratio if paint else purchase * size
        amount = (basis * Decimal(str(material.pricePerM2))).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
        spec = TEXTURES[material.texture] + ('' if paint else f' / {min(row.widthMm, row.heightMm):g} × {max(row.widthMm, row.heightMm):g} mm')
        data=[region, material.name, '漆面' if paint else '瓷砖', spec, float(net), '—' if paint else row.tiles,
                '—' if paint else purchase, float(basis), material.pricePerM2, float(amount)]
        if modern:
            entries=[c for c in report.catalog or [] if c.materialId==row.materialId and sorted([c.widthMm,c.heightMm])==sorted([row.widthMm,row.heightMm]) and (row.codes is None or c.code in row.codes)]
            codes=' / '.join(sorted(c.code for c in entries));color=entries[0].color.upper() if entries else '未记录'
            boxes=purchase//rule.piecesPerBox if rule and rule.fullBoxes and not paint else '—'
            data.extend([codes,color,boxes])
            percent=rule.reservePercent if rule else 0 if paint else 5
            process=f'{net}㎡ × (1＋{percent:g}%) = {basis}㎡；不推定桶数' if paint else f'{row.tiles}片 × (1＋{percent:g}%) = {Decimal(row.tiles)*ratio}片 → 向上取整{reserved}片；'+(f'每箱{rule.piecesPerBox}片，{reserved}÷{rule.piecesPerBox}向上取整{boxes}箱 → 采购{purchase}片' if rule and rule.fullBoxes else f'散片采购{purchase}片（箱规{rule.piecesPerBox if rule else 1}片/箱，未启用整箱）')
            calculations.append([region,codes,material.name,process])
        return data

    def total(rows, label):
        result = [label, '', '', '', *[round(sum(row[index] for row in rows if isinstance(row[index], (int, float))), 8) for index in (4, 5, 6, 7)], '—',
                round(sum(row[9] for row in rows), 2)]
        return result+['','',sum(r[12] for r in rows if isinstance(r[12],int))] if modern else result

    grouped = defaultdict(list)
    combined = {}
    for row in report.rows:
        grouped[row.regionId].append(row)
        key = (row.materialId, min(row.widthMm, row.heightMm), max(row.widthMm, row.heightMm))
        if key not in combined:
            combined[key] = row.model_copy()
        else:
            combined[key].tiles += row.tiles
            combined[key].areaMm2 += row.areaMm2
            if row.codes is not None:combined[key].codes=sorted(set((combined[key].codes or [])+row.codes))
    book = Workbook()
    book.remove(book.active)
    for title in ('分层明细', '整楼汇总'):
        sheet = book.create_sheet(title)
        sheet.sheet_view.showGridLines = False
        sheet.append([f'材料与价格表 · {title}'])
        sheet.append([f'方案：{report.name.strip()}    导出时间：{report.generatedAt}    当前筛选的编辑方案快照'+(f' · 软件{report.metadata.applicationVersion}/方案格式1/分面{report.metadata.faceGroupingVersion}' if report.metadata else '')])
        sheet.append(['瓷砖按各材料预留比例向上取整，再按启用的整箱规则进位；实际预留比例、箱规及进位过程见附表。预购面积=采购片数×单片面积；漆面按面积及其预留比例，不推算桶数。余料不跨面复用。不含人工、辅料及运费。'])
        sheet.append(['分层按各分区分别采购；整楼按同材同规格合并采购，预留量可能小于各分区之和。跨楼层/露台的同一砖格按覆盖面积最大区域归属，只计一次。箱数仅计启用整箱的材料，散片与漆面为—。尺寸及材料规格为图纸/方案值，须现场或实物复核。'])
        sheet.append([])
        sheet.append(headers)
        for index in range(1, 5):
            sheet.merge_cells(start_row=index, start_column=1, end_row=index, end_column=len(headers))
        subtotals = set()
        all_values = []
        if title == '分层明细':
            for region, label in REGIONS.items():
                entries = sorted(grouped[region], key=lambda row: (row.materialId, min(row.widthMm, row.heightMm), max(row.widthMm, row.heightMm)))
                data = [values(row, label) for row in entries]
                if not data:
                    continue
                for row in data:
                    sheet.append(row)
                sheet.append(total(data, f'{label}小计'))
                subtotals.add(sheet.max_row)
                all_values.extend(data)
            sheet.append(total(all_values, '分区分别采购合计'))
        else:
            all_values = [values(combined[key], '全楼') for key in sorted(combined)]
            for row in all_values:
                sheet.append(row)
            sheet.append(total(all_values, '整楼合并采购合计'))
        subtotals.add(sheet.max_row)
        for row in sheet:
            height = 29
            for cell in row:
                if isinstance(cell.value, str):
                    cell.value = ILLEGAL_CHARACTERS_RE.sub('', cell.value)
                    cell.data_type = 's'  # User names remain literal text, including leading '='.
                    width = sum(widths) - 2 if cell.row <= 4 else widths[cell.column - 1] - 2
                    lines = sum(max(1, ceil(sum(2 if east_asian_width(ch) in 'WF' else 1 for ch in line) / width)) for line in cell.value.split('\n'))
                    height = max(height, lines * 15 + 8)
                cell.font = Font(name='Microsoft YaHei', size=11, color='303A34')
                cell.alignment = Alignment(vertical='center', wrap_text=True, horizontal='right' if cell.column >= 5 and cell.row >= 7 else 'left')
                if cell.row >= 7:
                    cell.border = Border(bottom=Side(style='hair', color='E4E7E0'))
                    if cell.column in (5, 8):
                        cell.number_format = '#,##0.000'
                    elif cell.column in (9, 10):
                        cell.number_format = '#,##0.00'
                    elif cell.column in (6, 7):
                        cell.number_format = '#,##0'
            sheet.row_dimensions[row[0].row].height = height
        sheet['A1'].font = Font(name='Microsoft YaHei', size=17, bold=True, color='41594B')
        sheet.row_dimensions[1].height = 38
        for index in (3, 4):
            sheet.row_dimensions[index].height = max(sheet.row_dimensions[index].height, 34)
        sheet.row_dimensions[6].height = 38
        for row in (6, *subtotals):
            for cell in sheet[row]:
                cell.fill = PatternFill('solid', fgColor='41594B' if row == 6 else 'EDF1E9')
                cell.font = Font(name='Microsoft YaHei', size=11, bold=True, color='FFFFFF' if row == 6 else '303A34')
        for index, width in enumerate(widths, 1):
            sheet.column_dimensions[get_column_letter(index)].width = width
        if modern:
            for row in sheet.iter_rows(min_row=7):
                cell=row[11]
                if isinstance(cell.value,str) and len(cell.value)==7 and cell.value.startswith('#'):
                    cell.fill=PatternFill('solid',fgColor=cell.value[1:]);cell.font=Font(name='Microsoft YaHei',size=11,color='FFFFFF' if sum(int(cell.value[i:i+2],16) for i in (1,3,5))<384 else '303A34')
        sheet.freeze_panes = 'E7'
        sheet.auto_filter.ref = f'A6:{last_column}{sheet.max_row - 1}'
        sheet.print_title_rows = '1:6'
        sheet.print_options.horizontalCentered = True
        sheet.sheet_properties.pageSetUpPr.fitToPage = True
        sheet.page_setup.orientation = 'landscape'
        sheet.page_setup.paperSize = sheet.PAPERSIZE_A3
        sheet.page_setup.fitToWidth = 1
        sheet.page_setup.fitToHeight = 0
        sheet.print_area = f'A1:{last_column}{sheet.max_row}'
    if report.metadata or any(m.purchaseRule for m in report.materials):
        sheet=book.create_sheet('采购规则')
        sheet.append(['材料','预留比例 %','每箱片数','整箱采购','余料口径'])
        for material in report.materials:
            rule=material.purchaseRule
            sheet.append([material.name,rule.reservePercent if rule else 0 if material.kind=='paint' else 5,rule.piecesPerBox if rule and material.kind!='paint' else '—','是' if rule and rule.fullBoxes and material.kind!='paint' else '否','各面裁切余料不复用；同材同规格合并后预留/整箱'])
        for row in sheet:
            for cell in row:
                if isinstance(cell.value,str): cell.value=ILLEGAL_CHARACTERS_RE.sub('',cell.value);cell.data_type='s'
                cell.alignment=Alignment(horizontal='center',vertical='center',wrap_text=True)
        for col,width in zip('ABCDE',(32,18,18,18,80)):sheet.column_dimensions[col].width=width
        sheet.freeze_panes='A2';sheet.auto_filter.ref=f'A1:E{sheet.max_row}'
        format_delivery_sheet(sheet,(32,18,18,18,80))
    if modern:
        sheet=book.create_sheet('采购计算过程');sheet.append(['采购范围','材料编号','材料','实际计算过程']);
        for row in calculations:sheet.append(row)
        format_delivery_sheet(sheet,(24,24,32,130))
    add_delivery_sheets(book,report.metadata,report.name.strip(),report.generatedAt,report.catalog)
    output = BytesIO()
    book.save(output)
    return output.getvalue()
