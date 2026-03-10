"""News pipeline schemas - raw, standardized, summarized, entities."""
from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class RawNewsItem(BaseModel):
    """Raw item from any news API before standardization."""
    source: str
    raw: dict[str, Any]


class StandardizedNewsItem(BaseModel):
    """Standardized format for all news sources (Kafka/stream output)."""
    platform: str = Field(..., description="e.g. Bloomberg, Reuters, Alpha Vantage")
    headline: str
    publishing_date: str = Field(..., description="ISO or DD/MM/YYYY")
    metadata: str = Field(..., description="Full article text or excerpt")
    source_id: str | None = None
    url: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class SummarizedNewsItem(BaseModel):
    """After summarization step."""
    platform: str
    headline: str
    publishing_date: str
    summary: str = Field(..., description="AI-generated concise summary")
    metadata: str = ""
    source_id: str | None = None


class ExtractedEntitiesItem(BaseModel):
    """After entity/event extraction - final output from News Monitoring Agent."""
    event: str = Field(..., description="Key event description")
    entities: list[str] = Field(..., description="e.g. Federal Reserve, US Treasury, Inflation")
    headline: str = ""
    platform: str = ""
    publishing_date: str = ""
    summary: str = ""
    source_id: str | None = None
