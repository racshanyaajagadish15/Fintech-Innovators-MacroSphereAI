"""Risk analysis engine output."""
from pydantic import BaseModel, Field


class RiskImplication(BaseModel):
    """Single market implication."""
    implication: str = Field(..., description="e.g. Probability of Fed rate hike ↑")
    direction: str = Field(default="up", description="up | down | neutral")
    confidence: float = 0.0


class RiskAnalysisOutput(BaseModel):
    """Risk implications for a macro theme."""
    macro_theme: str
    market_implications: list[RiskImplication] = Field(default_factory=list)
    narrative: str = ""
