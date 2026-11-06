from pydantic import BaseModel, Field, ConfigDict
from typing import Literal

class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)

class Specs(Strict):
    opening: Literal['未确定','内开','外开','推拉','固定'] = '未确定'
    tempered: Literal['未确定','是','否'] = '未确定'
    sound_rw: float | None = Field(None, ge=0, le=80)
    air_grade: int | None = Field(None, ge=1, le=8)
    seal_count: int | None = Field(None, ge=0, le=6)
    thickness: float | None = Field(None, gt=0, le=20)
    thermal: str = Field('', max_length=100)
    strip_width: float | None = Field(None, gt=0, le=150)
    glass: str = Field('', max_length=200)
    seal: str = Field('', max_length=100)
    hardware: str = Field('', max_length=150)
    uw: float | None = Field(None, gt=0, le=15)
    shgc: float | None = Field(None, ge=0, le=1)
    wind: float | None = Field(None, gt=0, le=30)
    water: float | None = Field(None, gt=0, le=10000)
    price: float | None = Field(None, ge=0, le=100000)
    report: str = Field('', max_length=300)
    seal_compatible: Literal['未确定','是','否'] = '未确定'
    hardware_match: Literal['未确定','是','否'] = '未确定'

class Targets(Strict):
    opening: Literal['','内开','外开','推拉','固定'] = ''
    tempered: Literal['','是','否'] = ''
    sound_rw: float | None = Field(None, ge=0, le=80)
    air_grade: int | None = Field(None, ge=1, le=8)
    seal_count: int | None = Field(None, ge=0, le=6)
    thickness: float | None = Field(None, gt=0, le=20)
    thermal: str = Field('', max_length=100)
    strip_width: float | None = Field(None, gt=0, le=150)
    glass: str = Field('', max_length=200)
    seal: str = Field('', max_length=100)
    hardware: str = Field('', max_length=150)
    uw: float | None = Field(None, gt=0, le=15)
    shgc: float | None = Field(None, ge=0, le=1)
    wind: float | None = Field(None, gt=0, le=30)
    water: float | None = Field(None, gt=0, le=10000)
    price: float | None = Field(None, ge=0, le=100000)

class Project(Strict):
    id: str | None = None
    version: int = Field(0, ge=0)
    name: str = Field('我的门窗项目', min_length=1, max_length=100)
    city: str = Field('广州', max_length=20)
    scene: Literal['住宅装修','自建住宅','新建住宅'] = '住宅装修'
    product: Literal['铝合金外窗','铝合金外门','其他/未确定'] = '铝合金外窗'
    exposure: Literal['一般','沿海/迎风','未确定'] = '未确定'
    orientation: Literal['东','南','西','北','未确定'] = '未确定'
    height: float | None = Field(None, gt=0, le=500)
    specs: Specs = Field(default_factory=Specs)
    targets: Targets = Field(default_factory=Targets)
    documents: list[str] = Field(default_factory=list, max_length=50)
    reviewed_documents: list[str] = Field(default_factory=list, max_length=50)
    evidence: dict[str,str] = Field(default_factory=dict)

class Question(Strict):
    question: str = Field(min_length=1, max_length=1000)
    search: bool = True

class VisualRequest(Strict):
    page: int = Field(1, ge=1, le=100)
    consent: Literal[True]
    document_type: Literal['自动识别','样角','报价单','合同','其他'] = '自动识别'

class CheckReview(Strict):
    decision: Literal['confirmed','rejected','uncertain','manual_risk']
    note: str = Field('', max_length=500)
    region: dict[str,float] | None = None

class ProviderConfig(Strict):
    provider: Literal['pollinations','gemini','qwen','openai','pi'] = 'pollinations'
    pi_provider: Literal['openai','openai-codex','anthropic','github-copilot'] = 'openai'
    model: str = Field('openai',min_length=1,max_length=100)
    vision_model: str = Field('',max_length=100)
    base_url: str = Field('',max_length=300)
    api_key: str = Field('',max_length=300)
    clear_key: bool = False

