"""Investigation Agent: deep-dive on high-criticality themes; find related signals and build narrative."""
import json
try:
    from langchain_core.messages import HumanMessage, SystemMessage
    _LANGCORE_AVAILABLE = True
except ImportError:
    HumanMessage = SystemMessage = None
    _LANGCORE_AVAILABLE = False

from schemas.news import ExtractedEntitiesItem
from schemas.themes import ThemeWithCriticality
from schemas.investigation import InvestigationOutput, SignalItem
from .llm import get_llm

_DEPS_MSG = "LangChain (langchain-core) is required. Install with: pip install langchain-core"


INVESTIGATION_SYSTEM = """You are a macro research analyst. Given a macro theme and related news items (events + entities), produce a structured investigation.
Output valid JSON only with this exact structure:
{
  "narrative": "2-4 sentence macro narrative summarizing the theme and why it matters for markets",
  "signals": [
    {"signal_type": "e.g. geopolitical_tension | commodity_effect | rate_expectations | banking_stress", "description": "short description", "regions": ["US", "EU"], "confidence": 0.0-1.0}
  ],
  "involved_entities": ["entity1", "entity2"],
  "involved_regions": ["region1", "region2"],
  "market_impact_areas": ["bonds", "commodities", "fx", "equities", "credit", ...]
}
Be specific and factual. Only include signals you can infer from the context."""


class InvestigationAgent:
    """Investigates themes above criticality threshold; uses Groq for narrative and signals."""

    def __init__(self, criticality_threshold: float = 0.25):
        if not _LANGCORE_AVAILABLE:
            raise ValueError(_DEPS_MSG)
        self.llm = get_llm(temperature=0.2)
        self.criticality_threshold = criticality_threshold

    def _items_for_theme(
        self,
        theme_label: str,
        theme_output: ThemeWithCriticality,
        items: list[ExtractedEntitiesItem],
    ) -> list[ExtractedEntitiesItem]:
        """Return items that belong to this theme (by matching entities/event to theme label)."""
        theme_lower = theme_label.lower()
        out = []
        for it in items:
            if theme_lower in it.event.lower():
                out.append(it)
                continue
            for e in it.entities:
                if theme_lower in e.lower() or e.lower() in theme_lower:
                    out.append(it)
                    break
        if not out:
            out = items[:5]
        return out

    def run(
        self,
        theme_label: str,
        criticality: float,
        items: list[ExtractedEntitiesItem],
        theme_output: ThemeWithCriticality | None = None,
    ) -> InvestigationOutput:
        """Run investigation for one theme. Trigger when criticality > threshold or spike."""
        relevant = self._items_for_theme(theme_label, theme_output or ThemeWithCriticality(themes=[], criticality=[], theme_details=[]), items)
        context = "\n".join(
            f"- Event: {it.event} | Entities: {', '.join(it.entities)}"
            for it in relevant[:15]
        )
        prompt = f"Theme: {theme_label}\nCriticality score: {criticality}\n\nRelated news items:\n{context}"
        msg = [SystemMessage(content=INVESTIGATION_SYSTEM), HumanMessage(content=prompt)]
        out = self.llm.invoke(msg)
        text = out.content.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            data = {"narrative": text[:500], "signals": [], "involved_entities": [], "involved_regions": [], "market_impact_areas": []}
        signals = [
            SignalItem(
                signal_type=s.get("signal_type", "unknown"),
                description=s.get("description", ""),
                regions=s.get("regions", []),
                confidence=float(s.get("confidence", 0.5)),
            )
            for s in data.get("signals", [])
        ]
        return InvestigationOutput(
            theme=theme_label,
            narrative=data.get("narrative", ""),
            signals=signals,
            involved_entities=data.get("involved_entities", []),
            involved_regions=data.get("involved_regions", []),
            market_impact_areas=data.get("market_impact_areas", []),
            related_article_ids=[getattr(it, "source_id", None) or str(i) for i, it in enumerate(relevant) if getattr(it, "source_id", None)],
            metadata={"criticality": criticality},
        )
