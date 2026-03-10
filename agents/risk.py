"""Risk Analysis Engine: market implications per macro theme using LLM + knowledge context."""
import json

from schemas.risk import RiskAnalysisOutput, RiskImplication
from .llm import get_llm


RISK_SYSTEM = """You are a macro risk analyst. For the given macro theme and context, list specific market implications.
Output valid JSON only:
{
  "macro_theme": "theme name",
  "market_implications": [
    {"implication": "e.g. Probability of Fed rate hike ↑", "direction": "up|down|neutral", "confidence": 0.0-1.0}
  ],
  "narrative": "Short paragraph tying implications together."
}
Be concrete: rates, bond yields, equity sectors, FX, commodities. Use ↑/↓ in implication text where relevant."""


class RiskAnalysisEngine:
    """Generates risk implications for macro themes using Groq."""

    def __init__(self):
        self.llm = get_llm(temperature=0.2)

    def run(
        self,
        macro_theme: str,
        investigation_narrative: str = "",
        context: str = "",
    ) -> RiskAnalysisOutput:
        """Produce market implications for one macro theme."""
        prompt = f"Macro theme: {macro_theme}\n"
        if investigation_narrative:
            prompt += f"Context/narrative: {investigation_narrative}\n"
        if context:
            prompt += f"Additional context: {context}\n"
        prompt += "List market implications as JSON."
        msg = [
            {"role": "system", "content": RISK_SYSTEM},
            {"role": "user", "content": prompt},
        ]
        out = self.llm.invoke(msg)
        text = out.content.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            data = {"macro_theme": macro_theme, "market_implications": [], "narrative": text[:400]}
        implications = [
            RiskImplication(
                implication=imp.get("implication", ""),
                direction=imp.get("direction", "neutral"),
                confidence=float(imp.get("confidence", 0.5)),
            )
            for imp in data.get("market_implications", [])
        ]
        return RiskAnalysisOutput(
            macro_theme=data.get("macro_theme", macro_theme),
            market_implications=implications,
            narrative=data.get("narrative", ""),
        )
