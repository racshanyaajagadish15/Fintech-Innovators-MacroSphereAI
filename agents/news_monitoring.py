"""News Monitoring Agent: summarize articles and extract entities/events using Groq."""
import json

from pydantic import BaseModel, Field

from schemas.news import StandardizedNewsItem, SummarizedNewsItem, ExtractedEntitiesItem
from .llm import get_llm


class SummaryOutput(BaseModel):
    summary: str = Field(description="Concise 2-4 sentence summary of the article for macro/finance context")
    key_facts: list[str] = Field(default_factory=list, description="2-5 key facts")


class EntitiesOutput(BaseModel):
    event: str = Field(description="One clear sentence describing the key macro/financial event")
    entities: list[str] = Field(description="List of entities: central banks, countries, companies, indicators (e.g. Federal Reserve, US Treasury, Inflation)")
    regions: list[str] = Field(default_factory=list)
    asset_classes: list[str] = Field(default_factory=list)
    sentiment_score: float = Field(default=0.5)


SUMMARY_SYSTEM = """You are a financial news analyst. Convert one standardized news JSON item into a macro-focused summary.
Return valid JSON only with this exact shape:
{"summary": "...", "key_facts": ["...", "...", "..."]}.
Rules:
- Summary must be 2-4 sentences.
- Focus on why the development matters for inflation, growth, rates, commodities, FX, credit, equities, regulation, or geopolitics.
- key_facts must contain concise factual bullets drawn from the article."""

ENTITIES_SYSTEM = """You are an expert at extracting structured information from financial news.
Given a headline and summary, output valid JSON only:
{"event": "One sentence describing the key macro/financial event", "entities": ["Entity1", "Entity2", ...], "regions": ["Region1"], "asset_classes": ["rates"], "sentiment_score": 0.0}.
Entities must be: central banks, governments, regions, companies, economic indicators, or market terms. Use canonical names (e.g. Federal Reserve, not Fed)."""


class NewsMonitoringAgent:
    """Summarizes news and extracts entities/events using Groq."""

    def __init__(self):
        self.llm = get_llm(temperature=0.2)

    def summarize(self, item: StandardizedNewsItem) -> SummarizedNewsItem:
        """Summarize one article; returns SummarizedNewsItem."""
        prompt = (
            f"Standardized item JSON:\n"
            f'{{"platform":"{item.platform}","source_name":"{item.source_name}","source_topic":"{item.source_topic}",'
            f'"headline":"{item.headline}","publishing_date":"{item.publishing_date}","metadata":"{item.metadata[:3500]}"}}'
        )
        msg = [
            {"role": "system", "content": SUMMARY_SYSTEM},
            {"role": "user", "content": prompt},
        ]
        out = self.llm.invoke(msg)
        text = out.content.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            data = {"summary": text[:500], "key_facts": []}
        return SummarizedNewsItem(
            platform=item.platform,
            source_name=item.source_name,
            source_topic=item.source_topic,
            headline=item.headline,
            publishing_date=item.publishing_date,
            summary=data.get("summary", item.metadata[:500]),
            key_facts=data.get("key_facts", []),
            metadata=item.metadata,
            source_id=item.source_id,
        )

    def extract_entities(self, item: SummarizedNewsItem) -> ExtractedEntitiesItem:
        """Extract event + entities from summarized item."""
        prompt = f"Headline: {item.headline}\nSummary: {item.summary}"
        msg = [
            {"role": "system", "content": ENTITIES_SYSTEM},
            {"role": "user", "content": prompt},
        ]
        out = self.llm.invoke(msg)
        text = out.content.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            data = {"event": item.headline, "entities": [], "regions": [], "asset_classes": [], "sentiment_score": 0.5}
        return ExtractedEntitiesItem(
            event=data.get("event", item.headline),
            entities=data.get("entities", []),
            regions=data.get("regions", []),
            asset_classes=data.get("asset_classes", []),
            sentiment_score=float(data.get("sentiment_score", 0.5)),
            headline=item.headline,
            platform=item.platform,
            source_name=item.source_name,
            source_topic=item.source_topic,
            publishing_date=item.publishing_date,
            summary=item.summary,
            key_facts=item.key_facts,
            source_id=item.source_id,
        )

    def process(self, item: StandardizedNewsItem) -> ExtractedEntitiesItem:
        """Full pipeline: summarize then extract entities."""
        summarized = self.summarize(item)
        return self.extract_entities(summarized)
