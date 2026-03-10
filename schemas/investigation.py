"""Investigation agent output - deep-dive on high-criticality themes."""
from pydantic import BaseModel, Field
from typing import Any


class SignalItem(BaseModel):
    """A related signal (e.g. geopolitical tension, oil transport impact)."""
    signal_type: str = Field(..., description="e.g. geopolitical_tension, commodity_effect")
    description: str
    regions: list[str] = Field(default_factory=list)
    confidence: float = 0.0


class InvestigationOutput(BaseModel):
    """Final output from Investigation Agent for a theme."""
    theme: str
    narrative: str = Field(..., description="Macro narrative summary")
    signals: list[SignalItem] = Field(default_factory=list)
    involved_entities: list[str] = Field(default_factory=list)
    involved_regions: list[str] = Field(default_factory=list)
    market_impact_areas: list[str] = Field(default_factory=list)
    related_article_ids: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
