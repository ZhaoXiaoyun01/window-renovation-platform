"""Shared optional procurement and quote contracts; old snapshots remain valid."""
from datetime import date
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False)

class PurchaseRule(Strict):
    reservePercent: float = Field(ge=0, le=100)
    piecesPerBox: int = Field(ge=1, le=10000)
    fullBoxes: bool
    @field_validator('reservePercent')
    @classmethod
    def precision(cls, value):
        if Decimal(str(value))*100 != (Decimal(str(value))*100).to_integral_value():
            raise ValueError('预留比例最多两位小数')
        return value

class GlassUpgrade(Strict):
    spec: Literal['5', '6', '8', '10']
    pricePerM2: float = Field(ge=0, le=1000000)

class QuoteConfiguration(Strict):
    openingId: str = Field(min_length=1, max_length=100)
    widthMm: float = Field(gt=0, le=20000)
    heightMm: float = Field(gt=0, le=20000)
    frameColor: str = Field(pattern=r'^#[0-9a-fA-F]{6}$')
    glassType: Literal['low', 'medium', 'high']
    mode: str = Field(min_length=1, max_length=40)
    sashCount: int = Field(ge=0, le=100)
    pricePerM2: float = Field(ge=0, le=1000000)
    sashPrice: float = Field(ge=0, le=1000000)
    glassUpgrade: GlassUpgrade | None = None

class WindowQuote(Strict):
    id: str = Field(min_length=1, max_length=100)
    status: Literal['estimate', 'merchant', 'confirmed']
    source: str = Field(min_length=1, max_length=300)
    date: str = Field(min_length=10, max_length=10)
    checked: bool
    configuration: QuoteConfiguration
    @model_validator(mode='after')
    def valid_record(self):
        date.fromisoformat(self.date)
        if not self.source.strip() or self.status == 'confirmed' and not self.checked:
            raise ValueError('报价来源及配置确认无效')
        return self

class DeliveryMetadata(Strict):
    applicationVersion: str = Field(pattern=r'^\d+\.\d+$')
    schemaVersion: Literal[1]
    faceGroupingVersion: int = Field(ge=1, le=50)
    basePlanId: str = Field(max_length=100)
    source: str = Field(max_length=2000)
    measurementBasis: str = Field(min_length=1, max_length=2000)
    dimensionNote: str = Field(min_length=1, max_length=2000)
    snapshotType: str = Field(min_length=1, max_length=1000)

class MaterialIndex(Strict):
    code: str = Field(pattern=r'^M\d{2,4}$')
    materialId: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=80)
    color: str = Field(pattern=r'^#[0-9a-fA-F]{6}$')
    kind: Literal['tile','paint']
    widthMm: float = Field(ge=0, le=2400)
    heightMm: float = Field(ge=0, le=2400)
    direction: Literal['horizontal','vertical']
    alignment: Literal['edge','center']
    groutMm: float = Field(ge=0, le=20)
    groutColor: str = Field(pattern=r'^#[0-9a-fA-F]{6}$')
