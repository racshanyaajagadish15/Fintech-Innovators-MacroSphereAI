"""News Monitoring Agent: summarize articles and extract entities/events using Groq."""
import json
try:
    from langchain_core.messages import HumanMessage, SystemMessage
    _LANGCORE_AVAILABLE = True
except ImportError:
    HumanMessage = SystemMessage = None
    _LANGCORE_AVAILABLE = False

from pydantic import BaseModel, Field

from schemas.news import StandardizedNewsItem, SummarizedNewsItem, ExtractedEntitiesItem
from .llm import get_llm

_DEPS_MSG = "LangChain (langchain-core) is required. Install with: pip install langchain-core"


class SummaryOutput(BaseModel):
    summary: str = Field(description="Concise 2-4 sentence summary of the article for macro/finance context")
    key_facts: list[str] = Field(default_factory=list, description="2-5 key facts")


class EntitiesOutput(BaseModel):
    event: str = Field(description="One clear sentence describing the key macro/financial event")
    entities: list[str] = Field(description="List of entities: central banks, countries, companies, indicators (e.g. Federal Reserve, US Treasury, Inflation)")


SUMMARY_SYSTEM = """You are a financial news analyst. Summarize the given news article for a macroeconomics and markets context.
Output valid JSON only: {"summary": "...", "key_facts": ["...", "..."]}.
Be concise and focus on implications for interest rates, inflation, growth, commodities, or geopolitics."""

ENTITIES_SYSTEM = """You are an expert at extracting structured information from financial news.
Given a headline and summary, output valid JSON only:
{"event": "One sentence describing the key macro/financial event", "entities": ["Entity1", "Entity2", ...]}.
Entities must be: central banks, governments, regions, companies, economic indicators, or market terms. Use canonical names (e.g. Federal Reserve, not Fed)."""


class NewsMonitoringAgent:
    """Summarizes news and extracts entities/events; uses Groq via LangChain."""

    def __init__(self):
        if not _LANGCORE_AVAILABLE:
            raise ValueError(_DEPS_MSG)
        self.llm = get_llm(temperature=0.2)

    def summarize(self, item: StandardizedNewsItem) -> SummarizedNewsItem:
        """Summarize one article; returns SummarizedNewsItem."""
        if not _LANGCORE_AVAILABLE:
            raise ValueError(_DEPS_MSG)
        prompt = f"Headline: {item.headline}\nDate: {item.publishing_date}\nArticle/metadata:\n{item.metadata[:4000]}"
        msg = [SystemMessage(content=SUMMARY_SYSTEM), HumanMessage(content=prompt)]
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
            headline=item.headline,
            publishing_date=item.publishing_date,
            summary=data.get("summary", item.metadata[:500]),
            metadata=item.metadata,
            source_id=item.source_id,
        )

    def extract_entities(self, item: SummarizedNewsItem) -> ExtractedEntitiesItem:
        """Extract event + entities from summarized item."""
        if not _LANGCORE_AVAILABLE:
            raise ValueError(_DEPS_MSG)
        prompt = f"Headline: {item.headline}\nSummary: {item.summary}"
        msg = [SystemMessage(content=ENTITIES_SYSTEM), HumanMessage(content=prompt)]
        out = self.llm.invoke(msg)
        text = out.content.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            data = {"event": item.headline, "entities": []}
        return ExtractedEntitiesItem(
            event=data.get("event", item.headline),
            entities=data.get("entities", []),
            headline=item.headline,
            platform=item.platform,
            publishing_date=item.publishing_date,
            summary=item.summary,
            source_id=item.source_id,
        )

    def process(self, item: StandardizedNewsItem) -> ExtractedEntitiesItem:
        """Full pipeline: summarize then extract entities."""
        summarized = self.summarize(item)
        return self.extract_entities(summarized)
