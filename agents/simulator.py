"""Simulator Agent: what-if scenarios via LLM + optional Monte Carlo; user-defined events."""
import json
import random
from typing import Any

try:
    from langchain_core.messages import HumanMessage, SystemMessage
    _LANGCORE_AVAILABLE = True
except ImportError:
    HumanMessage = SystemMessage = None
    _LANGCORE_AVAILABLE = False

from schemas.simulator import SimulatorEvent, SimulatorScenario, SimulatorResult
from .llm import get_llm

_DEPS_MSG = "LangChain (langchain-core) is required. Install with: pip install langchain-core"


SIMULATOR_SYSTEM = """You are a macro scenario analyst. Given a set of hypothetical events (e.g. rate hike, supply shock, war escalation), simulate likely outcomes.
Output valid JSON:
{
  "outcomes": ["Outcome 1", "Outcome 2", ...],
  "market_impacts": ["Impact on bonds", "Impact on equities", ...],
  "confidence": 0.0-1.0,
  "narrative": "2-4 sentence scenario narrative."
}
Be specific about asset classes, regions, and time horizon. Acknowledge uncertainty."""


class SimulatorAgent:
    """Runs what-if scenarios: LLM narrative + optional Monte Carlo stats."""

    def __init__(self, monte_carlo_runs: int = 100):
        if not _LANGCORE_AVAILABLE:
            raise ValueError(_DEPS_MSG)
        self.llm = get_llm(temperature=0.3)
        self.monte_carlo_runs = monte_carlo_runs

    def _monte_carlo_stats(self, scenario: SimulatorScenario) -> dict[str, Any]:
        """Simple Monte Carlo: random outcomes for demo; can plug in proper economic model."""
        impacts = []
        for _ in range(min(self.monte_carlo_runs, 50)):
            # Placeholder: sample random impact directions from events
            n = len(scenario.events)
            if n == 0:
                impacts.append(0.0)
                continue
            base = sum(e.magnitude for e in scenario.events) / max(n, 1)
            impacts.append(base * (0.8 + 0.4 * random.random()))
        if not impacts:
            return {}
        return {
            "mean_impact": sum(impacts) / len(impacts),
            "min": min(impacts),
            "max": max(impacts),
            "runs": len(impacts),
        }

    def run(self, scenario: SimulatorScenario) -> SimulatorResult:
        """Run one scenario: LLM narrative + optional Monte Carlo."""
        events_desc = "\n".join(
            f"- {e.event_type}: {e.description or 'N/A'} (magnitude: {e.magnitude})"
            for e in scenario.events
        )
        prompt = f"Scenario: {scenario.name or 'Unnamed'}\nHorizon: {scenario.horizon_days} days\n\nEvents:\n{events_desc}\n\nSimulate outcomes as JSON."
        msg = [SystemMessage(content=SIMULATOR_SYSTEM), HumanMessage(content=prompt)]
        out = self.llm.invoke(msg)
        text = out.content.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            data = {"outcomes": [], "market_impacts": [], "confidence": 0.5, "narrative": text[:400]}
        mc = self._monte_carlo_stats(scenario)
        return SimulatorResult(
            scenario_name=scenario.name or "Scenario",
            outcomes=data.get("outcomes", []),
            market_impacts=data.get("market_impacts", []),
            confidence=float(data.get("confidence", 0.5)),
            monte_carlo_stats=mc,
            llm_narrative=data.get("narrative", ""),
        )
