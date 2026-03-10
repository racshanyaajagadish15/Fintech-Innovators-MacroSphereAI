"""Simulator - user-defined events and scenario results."""
from typing import Any
from pydantic import BaseModel, Field


class SimulatorEvent(BaseModel):
    """User drag-and-drop or selected event for what-if."""
    event_type: str = Field(..., description="e.g. rate_hike, supply_shock, war_escalation")
    description: str = ""
    region: str | None = None
    magnitude: float = 1.0
    params: dict[str, Any] = Field(default_factory=dict)


class SimulatorScenario(BaseModel):
    """Scenario to simulate (list of events + base state)."""
    name: str = ""
    events: list[SimulatorEvent] = Field(default_factory=list)
    horizon_days: int = 30
    base_state: dict[str, Any] = Field(default_factory=dict)


class SimulatorResult(BaseModel):
    """Outcome of a simulation run."""
    scenario_name: str = ""
    outcomes: list[str] = Field(default_factory=list)
    market_impacts: list[str] = Field(default_factory=list)
    confidence: float = 0.0
    monte_carlo_stats: dict[str, Any] = Field(default_factory=dict)
    llm_narrative: str = ""
