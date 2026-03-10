"""Theme detection output schemas."""
from pydantic import BaseModel, Field


class ThemeOutput(BaseModel):
    """Single theme from clustering."""
    theme_id: str
    label: str = Field(..., description="e.g. inflation, ai domination, iran/iraq war")
    article_count: int = 0
    mention_count: int = 0
    trend: str = Field(default="stable", description="increasing | decreasing | stable")
    source_topics: list[str] = Field(default_factory=list)
    representative_events: list[str] = Field(default_factory=list)
    regions: list[str] = Field(default_factory=list)
    asset_classes: list[str] = Field(default_factory=list)


class ThemeWithCriticality(BaseModel):
    """Full theme detection agent output."""
    themes: list[str] = Field(..., description="Identified macro themes")
    criticality: list[float] = Field(..., description="Scores per theme, can sum to ~1")
    theme_details: list[ThemeOutput] = Field(default_factory=list)
