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
    source_name: str = Field(default="", description="Concrete upstream source or feed name")
    source_topic: str = Field(default="", description="Kafka/in-memory topic mapped to this source")
    headline: str
    publishing_date: str = Field(..., description="ISO or DD/MM/YYYY")
    metadata: str = Field(..., description="Full article text or excerpt")
    source_id: str | None = None
    url: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class SummarizedNewsItem(BaseModel):
    """After summarization step."""
    platform: str
    source_name: str = ""
    source_topic: str = ""
    headline: str
    publishing_date: str
    summary: str = Field(..., description="AI-generated concise summary")
    key_facts: list[str] = Field(default_factory=list)
    metadata: str = ""
    source_id: str | None = None


class ExtractedEntitiesItem(BaseModel):
    """After entity/event extraction - final output from News Monitoring Agent."""
    event: str = Field(..., description="Key event description")
    entities: list[str] = Field(..., description="e.g. Federal Reserve, US Treasury, Inflation")
    regions: list[str] = Field(default_factory=list, description="Regions/countries referenced in the article")
    asset_classes: list[str] = Field(default_factory=list, description="Asset classes likely impacted")
    sentiment_score: float = Field(default=0.5, description="0-1 urgency / negativity proxy for theme scoring")
    headline: str = ""
    platform: str = ""
    source_name: str = ""
    source_topic: str = ""
    publishing_date: str = ""
    summary: str = ""
    key_facts: list[str] = Field(default_factory=list)
    source_id: str | None = None
