"""
Pydantic v2 schemas for all mutating API routes.
Each schema matches exactly the JSON body expected by its route.
"""
from __future__ import annotations

import re
from datetime import date as _Date
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

# ── Shared constants ────────────────────────────────────────────────────────
VALID_TYPES = [
    'coppa', 'lonzo', 'pancetta', 'guanciale', 'bresaola', 'jambon',
    'saucisson', 'magret', 'filet_mignon', 'boeuf_seche', 'jerky',
    'lomo', 'pastrami', 'autre',
]

_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def _check_date(v: str) -> str:
    if not _DATE_RE.match(v):
        raise ValueError('format invalide — attendu YYYY-MM-DD')
    try:
        _Date.fromisoformat(v)
    except ValueError:
        raise ValueError('date calendrier invalide')
    return v


def _check_meat_type(v: str) -> str:
    if v not in VALID_TYPES:
        raise ValueError(f'type inconnu — valeurs acceptées : {", ".join(VALID_TYPES)}')
    return v


# ── Weight entries ───────────────────────────────────────────────────────────
class WeightBody(BaseModel):
    weight: float = Field(gt=0, le=50_000, description='Poids en grammes')
    date: str

    @field_validator('date')
    @classmethod
    def check_date(cls, v: str) -> str:
        return _check_date(v)


# ── Meats ────────────────────────────────────────────────────────────────────
class MeatCreate(BaseModel):
    id: str          = Field(min_length=1, max_length=100)
    name: str        = Field(min_length=1, max_length=100)
    type: str
    initialWeight: float = Field(gt=0, le=50_000)
    startDate: str
    targetDays: int  = Field(default=60,   ge=1,   le=730)
    targetLoss: float = Field(default=30.0, ge=0.1, le=70.0)
    salt: Optional[float]  = Field(default=None, ge=0, le=5_000)
    sugar: Optional[float] = Field(default=None, ge=0, le=5_000)
    spices: Optional[str]  = Field(default=None, max_length=500)
    notes: Optional[str]   = Field(default=None, max_length=1_000)
    price: Optional[float] = Field(default=None, ge=0, le=100_000)
    archived: int = Field(default=0, ge=0, le=1)
    smoked: int   = Field(default=0, ge=0, le=1)
    weights: Optional[List[WeightBody]] = None

    @field_validator('type')
    @classmethod
    def check_type(cls, v: str) -> str:
        return _check_meat_type(v)

    @field_validator('startDate')
    @classmethod
    def check_start_date(cls, v: str) -> str:
        return _check_date(v)


class MeatUpdate(BaseModel):
    name: str         = Field(min_length=1, max_length=100)
    type: str
    initialWeight: float = Field(gt=0, le=50_000)
    startDate: str
    targetDays: int   = Field(ge=1, le=730)
    targetLoss: float = Field(ge=0.1, le=70.0)
    salt: Optional[float]  = Field(default=None, ge=0, le=5_000)
    sugar: Optional[float] = Field(default=None, ge=0, le=5_000)
    spices: Optional[str]  = Field(default=None, max_length=500)
    notes: Optional[str]   = Field(default=None, max_length=1_000)
    price: Optional[float] = Field(default=None, ge=0, le=100_000)
    archived: int = Field(default=0, ge=0, le=1)
    smoked: int   = Field(default=0, ge=0, le=1)

    @field_validator('type')
    @classmethod
    def check_type(cls, v: str) -> str:
        return _check_meat_type(v)

    @field_validator('startDate')
    @classmethod
    def check_start_date(cls, v: str) -> str:
        return _check_date(v)


# ── Sensors ──────────────────────────────────────────────────────────────────
class SensorUpdate(BaseModel):
    temperature: Optional[float] = Field(default=None, ge=-50, le=60)
    humidity: Optional[float]    = Field(default=None, ge=0,   le=100)


class SensorSettings(BaseModel):
    temp_min: float = Field(ge=-20, le=40)
    temp_max: float = Field(ge=-20, le=40)
    hum_min: float  = Field(ge=0,   le=100)
    hum_max: float  = Field(ge=0,   le=100)
    alerts_enabled: int = Field(default=0, ge=0, le=1)

    @model_validator(mode='after')
    def check_ranges(self) -> 'SensorSettings':
        if self.temp_min >= self.temp_max:
            raise ValueError('temp_min doit être strictement inférieure à temp_max')
        if self.hum_min >= self.hum_max:
            raise ValueError('hum_min doit être strictement inférieure à hum_max')
        return self


# ── Integrations ─────────────────────────────────────────────────────────────
class TelegramSettings(BaseModel):
    token: Optional[str]    = Field(default=None, max_length=300)
    chat_id: Optional[str]  = Field(default=None, max_length=100)
    interval_days: int       = Field(default=7, ge=1, le=365)
    enabled: int             = Field(default=0, ge=0, le=1)
    report_frequency: Optional[str] = Field(default=None, max_length=20)


class GitHubSettings(BaseModel):
    token: Optional[str] = Field(default=None, max_length=500)
    repo: Optional[str]  = Field(default=None, max_length=200)
    path: str            = Field(default='backup.json', min_length=1, max_length=200)
    enabled: int         = Field(default=0, ge=0, le=1)
    auto_backup_enabled: int = Field(default=0, ge=0, le=1)
    auto_backup_hour: int    = Field(default=2, ge=0, le=23)


# ── App settings ─────────────────────────────────────────────────────────────
class AppSettings(BaseModel):
    producer_name: Optional[str] = Field(default=None, max_length=100)


# ── Recipes ───────────────────────────────────────────────────────────────────
class RecipeBody(BaseModel):
    name: str              = Field(min_length=1, max_length=100)
    type: Optional[str]    = None
    salt_pct: Optional[float]  = Field(default=None, ge=0, le=20)
    sugar_pct: Optional[float] = Field(default=None, ge=0, le=10)
    spices: Optional[str]  = Field(default=None, max_length=500)
    notes: Optional[str]   = Field(default=None, max_length=1_000)

    @field_validator('type')
    @classmethod
    def check_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_TYPES:
            raise ValueError(f'type inconnu — valeurs acceptées : {", ".join(VALID_TYPES)}')
        return v
