"""Theme Detection Agent: cluster extracted news into macro themes and assign criticality."""
from __future__ import annotations

import numpy as np
from collections import Counter
from typing import Optional
import re
from datetime import datetime

from schemas.news import ExtractedEntitiesItem
from schemas.themes import ThemeWithCriticality, ThemeOutput


def _get_embedder():
    """Lazy load sentence-transformers (can be heavy)."""
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer("all-MiniLM-L6-v2")


def _cluster_agglomerative(embeddings: np.ndarray, n_clusters: Optional[int] = None, distance_threshold: float = 0.7):
    """Agglomerative clustering; if n_clusters None, use distance_threshold to merge."""
    from sklearn.cluster import AgglomerativeClustering
    if n_clusters is not None:
        c = AgglomerativeClustering(n_clusters=n_clusters, metric="cosine", linkage="average")
    else:
        c = AgglomerativeClustering(n_clusters=None, distance_threshold=distance_threshold, metric="cosine", linkage="average")
    c.fit(embeddings)
    return c.labels_


class ThemeDetectionAgent:
    """Aggregates extracted items, clusters by semantic similarity, computes criticality."""

    def __init__(self, distance_threshold: float = 0.65, min_cluster_size: int = 1):
        self.distance_threshold = distance_threshold
        self.min_cluster_size = min_cluster_size
        self._model = None

    def _embed(self, texts: list[str]) -> np.ndarray:
        if self._model is None:
            self._model = _get_embedder()
        return self._model.encode(texts, convert_to_numpy=True)

    def _run_fallback(self, items: list[ExtractedEntitiesItem]) -> ThemeWithCriticality:
        """Fallback clustering when sentence-transformers/torch is unavailable."""
        bucketed: dict[str, list[tuple[int, ExtractedEntitiesItem]]] = {}
        for i, item in enumerate(items):
            if item.entities:
                label = item.entities[0]
            else:
                tokens = re.findall(r"[A-Za-z][A-Za-z0-9_-]+", item.event)
                label = " ".join(tokens[:3]) if tokens else item.event[:50] or "uncategorized"
            bucketed.setdefault(label, []).append((i, item))

        theme_details = []
        grouped_for_crit: dict[str, list[ExtractedEntitiesItem]] = {}
        for idx, (label, group_pairs) in enumerate(bucketed.items()):
            if len(group_pairs) < self.min_cluster_size:
                continue
            indices = [i for i, _ in group_pairs]
            group = [it for _, it in group_pairs]
            grouped_for_crit[label] = group
            theme_details.append(self._build_theme_output(f"theme_{idx}", label, group, article_indices=indices))
        theme_details = self._relabel_as_macro_themes(theme_details)
        counts = [t.article_count for t in theme_details]
        total = sum(counts) or 1
        criticality = self._criticality(theme_details, grouped_for_crit)
        return ThemeWithCriticality(
            themes=[t.label for t in theme_details],
            criticality=criticality,
            theme_details=theme_details,
        )

    def _parse_day(self, value: str) -> str:
        for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
            try:
                return datetime.strptime(value[:19], fmt).strftime("%Y-%m-%d")
            except Exception:
                continue
        return value[:10] if value else "unknown"

    def _trend_for_group(self, group: list[ExtractedEntitiesItem]) -> str:
        counts: Counter[str] = Counter(self._parse_day(it.publishing_date) for it in group)
        if len(counts) <= 1:
            return "increasing" if len(group) >= 3 else "stable"
        ordered = [counts[day] for day in sorted(counts.keys())]
        if len(ordered) >= 2 and ordered[-1] > ordered[0]:
            return "increasing"
        if len(ordered) >= 2 and ordered[-1] < ordered[0]:
            return "decreasing"
        return "stable"

    def _build_theme_output(
        self,
        theme_id: str,
        label: str,
        group: list[ExtractedEntitiesItem],
        article_indices: Optional[list[int]] = None,
    ) -> ThemeOutput:
        mention_count = sum(1 + len(it.entities) for it in group)
        source_topics = sorted({it.source_topic for it in group if it.source_topic})
        regions = sorted({region for it in group for region in it.regions})
        asset_classes = sorted({asset for it in group for asset in it.asset_classes})
        representative_events = [it.event for it in group[:20]]
        return ThemeOutput(
            theme_id=theme_id,
            label=label,
            article_count=len(group),
            mention_count=mention_count,
            trend=self._trend_for_group(group),
            source_topics=source_topics,
            representative_events=representative_events,
            regions=regions,
            asset_classes=asset_classes,
            article_indices=article_indices or [],
        )

    def _criticality(self, theme_details: list[ThemeOutput], grouped: dict[str, list[ExtractedEntitiesItem]] | dict[int, list[ExtractedEntitiesItem]]) -> list[float]:
        article_total = sum(t.article_count for t in theme_details) or 1
        mention_total = sum(t.mention_count for t in theme_details) or 1
        scores: list[float] = []
        for detail in theme_details:
            group = grouped.get(detail.label) or grouped.get(int(detail.theme_id.split("_")[-1])) or []
            article_share = detail.article_count / article_total
            mention_share = detail.mention_count / mention_total
            sentiment = sum(it.sentiment_score for it in group) / max(len(group), 1) if group else 0.5
            trend_bonus = 0.15 if detail.trend == "increasing" else (0.05 if detail.trend == "stable" else 0.0)
            raw = 0.5 * article_share + 0.25 * mention_share + 0.15 * sentiment + trend_bonus
            scores.append(raw)
        total = sum(scores) or 1
        return [score / total for score in scores]

    def _label_clusters(self, items: list[ExtractedEntitiesItem], labels: np.ndarray) -> list[ThemeOutput]:
        """Assign a theme label per cluster (most common entity/event terms). Store article indices for linking."""
        from collections import defaultdict
        clusters: dict[int, list[tuple[int, ExtractedEntitiesItem]]] = defaultdict(list)
        for i, item in enumerate(items):
            clusters[int(labels[i])].append((i, item))
        theme_details = []
        for cid in sorted(clusters.keys()):
            group_pairs = clusters[cid]
            if len(group_pairs) < self.min_cluster_size:
                continue
            indices = [i for i, _ in group_pairs]
            group = [it for _, it in group_pairs]
            all_entities = []
            events = []
            for it in group:
                all_entities.extend(it.entities)
                events.append(it.event)
            counter = Counter(all_entities)
            label = counter.most_common(1)[0][0] if counter else (events[0][:50] if events else f"theme_{cid}")
            theme_details.append(self._build_theme_output(f"theme_{cid}", label, group, article_indices=indices))
        return theme_details

    def _relabel_as_macro_themes(self, theme_details: list[ThemeOutput]) -> list[ThemeOutput]:
        """Use LLM to convert entity-based labels into short macro themes (e.g. Interest rates, Inflation)."""
        if not theme_details:
            return theme_details
        try:
            from .llm import get_llm
            llm = get_llm(temperature=0.2)
            prompts = []
            for t in theme_details:
                sample = " | ".join((t.representative_events or [t.label])[:6])
                prompts.append(f"Cluster: {sample}")
            user_content = "For each cluster below, output ONE short macro theme (2-4 words). Use topics like: Interest rates, Inflation, Geopolitical risk, Energy prices, Banking stress, Supply chain, Labor market, Fiscal policy, etc. Do NOT use company or person names. Output only a JSON array of strings, one per line, in the same order.\n\n" + "\n".join(prompts)
            msg = [
                {"role": "system", "content": "You are a macro economist. Reply only with a valid JSON array of strings, no other text."},
                {"role": "user", "content": user_content},
            ]
            out = llm.invoke(msg)
            text = out.content.strip()
            if "```" in text:
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:].strip()
            import json
            text = text.strip().strip("`").strip()
            names = json.loads(text)
            if isinstance(names, dict) and "themes" in names:
                names = names["themes"]
            if isinstance(names, list) and len(names) >= len(theme_details):
                return [
                    ThemeOutput(
                        theme_id=t.theme_id,
                        label=(names[i].strip() if isinstance(names[i], str) else t.label)[:80],
                        article_count=t.article_count,
                        mention_count=t.mention_count,
                        trend=t.trend,
                        source_topics=t.source_topics,
                        representative_events=t.representative_events,
                        regions=t.regions,
                        asset_classes=t.asset_classes,
                        article_indices=getattr(t, "article_indices", []) or [],
                    )
                    for i, t in enumerate(theme_details)
                ]
        except Exception:
            pass
        return theme_details

    def run(
        self,
        items: list[ExtractedEntitiesItem],
        sentiment_weights: Optional[list[float]] = None,
    ) -> ThemeWithCriticality:
        """Cluster items into themes; criticality from share of articles and optional sentiment."""
        if not items:
            return ThemeWithCriticality(themes=[], criticality=[], theme_details=[])

        texts = [f"{it.event} {' '.join(it.entities)}" for it in items]
        try:
            embeddings = self._embed(texts).astype(np.float32)
        except Exception:
            return self._run_fallback(items)
        # Cosine distance = 1 - cosine_sim; threshold 0.65 -> merge if sim > ~0.35
        labels = _cluster_agglomerative(embeddings, n_clusters=None, distance_threshold=self.distance_threshold)
        theme_details = self._label_clusters(items, labels)
        theme_details = self._relabel_as_macro_themes(theme_details)

        themes: list[str] = [t.label for t in theme_details]
        from collections import defaultdict
        grouped: dict[int, list[ExtractedEntitiesItem]] = defaultdict(list)
        for idx, label in enumerate(labels):
            grouped[int(label)].append(items[idx])
        criticality = self._criticality(theme_details, grouped)
        if sentiment_weights and len(sentiment_weights) == len(items):
            # optional: weight by sentiment (e.g. more negative -> higher criticality)
            for i, t in enumerate(theme_details):
                idx_in_cluster = [j for j, lab in enumerate(labels) if lab == i]
                w = sum(sentiment_weights[j] for j in idx_in_cluster) / max(len(idx_in_cluster), 1)
                criticality[i] = 0.7 * criticality[i] + 0.3 * min(1.0, max(0, w))
        total_c = sum(criticality) or 1
        criticality = [x / total_c for x in criticality]

        return ThemeWithCriticality(themes=themes, criticality=criticality, theme_details=theme_details)
