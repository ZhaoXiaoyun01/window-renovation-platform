"""Independent local snapshots for the renovation module."""
import json
import os
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from fastapi.responses import Response
from .renovation_report import ReportExport, create_workbook
from .renovation_windows import WindowExport, create_window_workbook
from .renovation_styles import style_fingerprint
from .renovation_contracts import PurchaseRule, WindowQuote, GlassUpgrade

MAX_BYTES = 20 * 1024 * 1024
COLOR = r'^#[0-9a-fA-F]{6}$'
router = APIRouter(prefix='/api/renovation3d')


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False)


class Material(Strict):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=80)
    color: str = Field(pattern=COLOR)
    texture: Literal['plain', 'stone', 'concrete', 'custom']
    kind: Literal['tile', 'paint'] | None = None
    image: str | None = Field(None, max_length=1500000)
    pricePerM2: float | None = Field(None, ge=0, le=1000000)

    @model_validator(mode='after')
    def valid_image(self):
        if self.kind == 'paint' and (self.texture != 'plain' or self.image):
            raise ValueError('漆面须使用纯色材质')
        if self.texture == 'custom' and (not self.image or not re.fullmatch(r'data:image/jpeg;base64,[A-Za-z0-9+/=]+', self.image)):
            raise ValueError('自定义瓷砖图片无效')
        return self


class Finish(Strict):
    materialId: str = Field(min_length=1, max_length=100)
    widthMm: float = Field(ge=20, le=2400)
    heightMm: float = Field(ge=20, le=2400)
    direction: Literal['horizontal', 'vertical']
    groutMm: float = Field(ge=0, le=20)
    groutColor: str = Field(pattern=COLOR)
    alignment: Literal['edge', 'center']
    preserveZoning: bool | None = None


class WindowFinish(Strict):
    frameColor: str = Field(pattern=COLOR)
    glassType: Literal['low', 'medium', 'high']
    name: str | None = Field(None, min_length=1, max_length=80)
    pricePerM2: float | None = Field(None, ge=0, le=1000000)
    sashPrice: float | None = Field(None, ge=0, le=1000000)
    sashCount: int | None = Field(None, ge=0, le=100)
    quotes: list[WindowQuote] | None = None
    glassUpgrade: GlassUpgrade | None = None

    @field_validator('name')
    @classmethod
    def valid_name(cls, value):
        if value is not None and not value.strip():
            raise ValueError('窗户名称不能为空')
        return value.strip() if value is not None else None


class ModelReview(Strict):
    status: Literal['reviewed', 'pending']
    note: str = Field(max_length=1000)
    evidence: str = Field(max_length=4096)
    reviewedAt: str = Field(min_length=1, max_length=80)

    @field_validator('reviewedAt')
    @classmethod
    def valid_date(cls, value):
        datetime.fromisoformat(value.replace('Z', '+00:00'))
        return value


class PlanState(Strict):
    schemaVersion: Literal[1]
    buildingId: Literal['pdf-residence-1']
    materials: list[Material] = Field(min_length=1, max_length=32)
    finishes: dict[str, Finish] = Field(min_length=1, max_length=2000)
    faceFinishes: dict[str, Finish] | None = Field(None, max_length=2000)
    faceRegionFinishes: dict[str, Finish] | None = Field(None, max_length=2000)
    windowFinishes: dict[str, WindowFinish] | None = Field(None, max_length=2000)
    partColors: dict[str, str] | None = Field(None, max_length=2000)
    modelReviews: dict[str, ModelReview] | None = Field(None, max_length=2000)
    purchaseRules: dict[str, PurchaseRule] | None = Field(None, max_length=32)
    hiddenFloors: list[Literal['f1', 'f2', 'f3', 'f4']] = Field(max_length=4)
    hiddenGroups: list[Literal['terrace', 'base']] | None = Field(None, max_length=2)
    exploded: bool
    background: Literal['studio', 'sunny'] | None = None
    faceGroupingVersion: Literal[2, 3, 4, 5, 6, 7, 8, 9, 10, 11] | None = None
    sunHour: float | None = Field(None, ge=6, le=18)

    @field_validator('schemaVersion', mode='before')
    @classmethod
    def valid_version(cls, value):
        if type(value) is not int:
            raise ValueError('方案版本类型无效')
        return value

    @model_validator(mode='after')
    def valid_references(self):
        ids = {material.id for material in self.materials}
        if len(ids) != len(self.materials) or len(set(self.hiddenFloors)) != len(self.hiddenFloors) or len(set(self.hiddenGroups or [])) != len(self.hiddenGroups or []):
            raise ValueError('材质或楼层存在重复标识')
        if any(key not in ids for key in (self.purchaseRules or {})):
            raise ValueError('采购规则材料不存在')
        for key, finish in (self.windowFinishes or {}).items():
            if any(q.configuration.openingId != key for q in finish.quotes or []) or len({q.id for q in finish.quotes or []}) != len(finish.quotes or []):
                raise ValueError('窗户报价配置或标识不匹配')
        for entries in (self.finishes, self.faceFinishes or {}, self.faceRegionFinishes or {}, self.windowFinishes or {}, self.partColors or {}):
            if any(not key or len(key) > 200 for key in entries):
                raise ValueError('装修对象标识无效')
        if any(not re.fullmatch(COLOR, color) for color in (self.partColors or {}).values()):
            raise ValueError('格栅颜色数据无效')
        if any(finish.materialId not in ids for finish in [*self.finishes.values(), *(self.faceFinishes or {}).values(), *(self.faceRegionFinishes or {}).values()]):
            raise ValueError('瓷砖材质不存在')
        return self


class PlanName(Strict):
    name: str = Field(min_length=1, max_length=80)

    @field_validator('name')
    @classmethod
    def valid_name(cls, value):
        if not value.strip():
            raise ValueError('请输入方案名称')
        return value.strip()


class PlanCreate(PlanName):
    state: PlanState


class StyleCreate(PlanName):
    material: Material
    finish: Finish

    @model_validator(mode='after')
    def valid_material(self):
        if self.finish.materialId != self.material.id:
            raise ValueError('样式材质与铺贴引用不匹配')
        return self


@contextmanager
def connect():
    data = Path(os.getenv('WINDOW_DATA_DIR', str(Path(__file__).resolve().parents[1] / 'data')))
    data.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(data / 'renovation3d.sqlite3', timeout=5)
    con.row_factory = sqlite3.Row
    try:
        con.execute('CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, state TEXT NOT NULL)')
        con.execute('CREATE TABLE IF NOT EXISTS tile_styles(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, material TEXT NOT NULL, finish TEXT NOT NULL)')
        with con:
            yield con
    except sqlite3.Error as exc:
        raise HTTPException(503, '本地装修方案数据库暂不可用') from exc
    finally:
        con.close()


def metadata(row):
    return {'id': row['id'], 'name': row['name'], 'createdAt': row['created_at'], 'updatedAt': row['updated_at']}


async def check_size(request: Request):
    if len(await request.body()) > MAX_BYTES:
        raise HTTPException(413, '装修方案上限20MB')


@router.post('/material-report/export', dependencies=[Depends(check_size)])
def export_material_report(report: ReportExport):
    return Response(create_workbook(report), media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    headers={'Content-Disposition': 'attachment; filename="materials-price.xlsx"', 'Cache-Control': 'no-store'})


@router.post('/window-report/export', dependencies=[Depends(check_size)])
def export_window_report(report: WindowExport):
    return Response(create_window_workbook(report), media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    headers={'Content-Disposition': 'attachment; filename="windows-price.xlsx"', 'Cache-Control': 'no-store'})


@router.get('/plans')
def list_plans():
    with connect() as con:
        return [metadata(row) for row in con.execute('SELECT id,name,created_at,updated_at FROM plans ORDER BY created_at DESC,rowid DESC')]


@router.post('/plans', status_code=201, dependencies=[Depends(check_size)])
def save_plan(value: PlanCreate):
    state = value.state.model_dump(exclude_none=True)
    body = json.dumps(state, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    if len(body.encode('utf-8')) > MAX_BYTES:
        raise HTTPException(413, '装修方案上限20MB')
    plan_id, timestamp = uuid.uuid4().hex, datetime.now(timezone.utc).isoformat()
    with connect() as con:
        con.execute('INSERT INTO plans VALUES(?,?,?,?,?)', (plan_id, value.name, timestamp, timestamp, body))
    return {'id': plan_id, 'name': value.name, 'createdAt': timestamp, 'updatedAt': timestamp, 'state': state}


@router.get('/plans/{plan_id}')
def read_plan(plan_id: str):
    with connect() as con:
        row = con.execute('SELECT * FROM plans WHERE id=?', (plan_id,)).fetchone()
    if not row:
        raise HTTPException(404, '装修方案不存在')
    return {**metadata(row), 'state': json.loads(row['state'])}


@router.patch('/plans/{plan_id}', dependencies=[Depends(check_size)])
def rename_plan(plan_id: str, value: PlanName):
    with connect() as con:
        con.execute('BEGIN IMMEDIATE')
        if not con.execute('SELECT id FROM plans WHERE id=?', (plan_id,)).fetchone():
            raise HTTPException(404, '装修方案不存在')
        con.execute('UPDATE plans SET name=?,updated_at=? WHERE id=?', (value.name, datetime.now(timezone.utc).isoformat(), plan_id))
        row = con.execute('SELECT * FROM plans WHERE id=?', (plan_id,)).fetchone()
    return {**metadata(row), 'state': json.loads(row['state'])}


def tile_style(row):
    return {**metadata(row), 'material': json.loads(row['material']), 'finish': json.loads(row['finish'])}


@router.get('/tile-styles')
def list_tile_styles():
    with connect() as con:
        return [tile_style(row) for row in con.execute('SELECT * FROM tile_styles ORDER BY created_at DESC,rowid DESC')]


@router.post('/tile-styles', status_code=201, dependencies=[Depends(check_size)])
def create_tile_style(value: StyleCreate):
    material = json.dumps(value.material.model_dump(exclude_none=True), ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    finish = json.dumps(value.finish.model_dump(exclude_none=True), ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    style_id, timestamp = uuid.uuid4().hex, datetime.now(timezone.utc).isoformat()
    with connect() as con:
        con.execute('BEGIN IMMEDIATE')
        fingerprint = style_fingerprint(json.loads(material), json.loads(finish))
        for existing in con.execute('SELECT * FROM tile_styles ORDER BY created_at,rowid'):
            if style_fingerprint(json.loads(existing['material']), json.loads(existing['finish'])) == fingerprint:
                return tile_style(existing)
        con.execute('INSERT INTO tile_styles VALUES(?,?,?,?,?,?)', (style_id, value.name, timestamp, timestamp, material, finish))
        row = con.execute('SELECT * FROM tile_styles WHERE id=?', (style_id,)).fetchone()
    return tile_style(row)


@router.patch('/tile-styles/{style_id}', dependencies=[Depends(check_size)])
def rename_tile_style(style_id: str, value: PlanName):
    with connect() as con:
        con.execute('BEGIN IMMEDIATE')
        if not con.execute('SELECT id FROM tile_styles WHERE id=?', (style_id,)).fetchone():
            raise HTTPException(404, '瓷砖样式不存在')
        con.execute('UPDATE tile_styles SET name=?,updated_at=? WHERE id=?', (value.name, datetime.now(timezone.utc).isoformat(), style_id))
        row = con.execute('SELECT * FROM tile_styles WHERE id=?', (style_id,)).fetchone()
    return tile_style(row)
