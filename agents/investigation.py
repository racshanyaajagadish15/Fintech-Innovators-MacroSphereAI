"""Investigation Agent: deep-dive on high-criticality themes; find related signals and build narrative."""
import json

from schemas.news import ExtractedEntitiesItem
from schemas.themes import ThemeWithCriticality
from schemas.investigation import InvestigationOutput, SignalItem
from .llm import get_llm


INVESTIGATION_SYSTEM = """You are a macro research analyst. Given a macro theme and related news items (events + entities), produce a structured investigation that synthesizes MANY of the articles provided.
Your narrative and signals must be grounded in the full set of related news items—reference and draw from as many of them as possible, not just one or two.
Output valid JSON only with this exact structure:
{
  "narrative": "2-5 sentence macro narrative that synthesizes the theme across multiple articles; cite the breadth of sources and why it matters for markets",
  "signals": [
    {"signal_type": "e.g. geopolitical_tension | commodity_effect | rate_expectations | banking_stress", "description": "short description", "regions": ["US", "EU"], "confidence": 0.0-1.0}
  ],
  "involved_entities": ["entity1", "entity2"],
  "involved_regions": ["region1", "region2"],
  "market_impact_areas": ["bonds", "commodities", "fx", "equities", "credit", ...],
  "trigger_reasons": ["high_criticality", "spike_in_article_volume"],
  "related_events": ["event 1", "event 2", ...]
}
Be specific and factual. Include multiple related_events (at least 5-10 when many articles support the theme). Only include signals you can infer from the context."""


class InvestigationAgent:
    """Investigates themes above criticality threshold; uses Groq for narrative and signals."""

    def __init__(self, criticality_threshold: float = 0.25):
        self.llm = get_llm(temperature=0.2)
        self.criticality_threshold = criticality_threshold

    def _items_for_theme(
        self,
        theme_label: str,
        theme_output: ThemeWithCriticality,
        items: list[ExtractedEntitiesItem],
    ) -> list[ExtractedEntitiesItem]:
        """Return items that belong to this theme (label match + cluster representative_events)."""
        theme_lower = theme_label.lower()
        out = []
        seen_ids = set()
        for it in items:
            if theme_lower in it.event.lower():
                out.append(it)
                seen_ids.add(id(it))
                continue
            for e in it.entities:
                if theme_lower in e.lower() or e.lower() in theme_lower:
                    out.append(it)
                    seen_ids.add(id(it))
                    break
        if theme_output and theme_output.theme_details:
            for td in theme_output.theme_details:
                if (td.label or "").lower() != theme_lower:
                    continue
                rep_set = {r.strip()[:120] for r in (td.representative_events or [])[:25] if r and r.strip()}
                for it in items:
                    if id(it) in seen_ids:
                        continue
                    ev = (it.event or "").strip()[:120]
                    if ev and (ev in rep_set or any(ev in r or r in ev for r in rep_set)):
                        out.append(it)
                        seen_ids.add(id(it))
                break
        if not out:
            out = items[:15]
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
        trigger_reasons = []
        if criticality >= self.criticality_threshold:
            trigger_reasons.append("high_criticality")
        if len(relevant) >= 3:
            trigger_reasons.append("spike_in_article_volume")
        avg_sentiment = sum(it.sentiment_score for it in relevant) / max(len(relevant), 1)
        if avg_sentiment >= 0.65:
            trigger_reasons.append("negative_or_urgent_sentiment_shift")
        context = "\n".join(
            f"- Event: {it.event} | Entities: {', '.join(it.entities)} | Regions: {', '.join(it.regions)} | Asset classes: {', '.join(it.asset_classes)} | Sentiment: {it.sentiment_score:.2f}"
            for it in relevant[:40]
        )
        prompt = (
            f"Theme: {theme_label}\n"
            f"Criticality score: {criticality}\n"
            f"Number of related articles: {len(relevant)} (use many in your narrative)\n"
            f"Trigger reasons: {', '.join(trigger_reasons) or 'manual_review'}\n\n"
            f"Related news items:\n{context}"
        )
        msg = [
            {"role": "system", "content": INVESTIGATION_SYSTEM},
            {"role": "user", "content": prompt},
        ]
        out = self.llm.invoke(msg)
        text = out.content.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            data = {"narrative": text[:500], "signals": [], "involved_entities": [], "involved_regions": [], "market_impact_areas": [], "trigger_reasons": trigger_reasons, "related_events": [it.event for it in relevant[:15]]}
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
            trigger_reasons=data.get("trigger_reasons", trigger_reasons),
            related_events=data.get("related_events", [it.event for it in relevant[:15]]),
            related_article_ids=[getattr(it, "source_id", None) or str(i) for i, it in enumerate(relevant) if getattr(it, "source_id", None)],
            metadata={"criticality": criticality, "avg_sentiment": avg_sentiment, "item_count": len(relevant)},
        )
