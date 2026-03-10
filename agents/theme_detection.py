"""Theme Detection Agent: cluster extracted news into macro themes and assign criticality."""
from __future__ import annotations

import numpy as np
from collections import Counter
from typing import Optional

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

    def _label_clusters(self, items: list[ExtractedEntitiesItem], labels: np.ndarray) -> list[ThemeOutput]:
        """Assign a theme label per cluster (most common entity/event terms)."""
        from collections import defaultdict
        clusters: dict[int, list[ExtractedEntitiesItem]] = defaultdict(list)
        for i, item in enumerate(items):
            clusters[int(labels[i])].append(item)
        theme_details = []
        for cid in sorted(clusters.keys()):
            group = clusters[cid]
            if len(group) < self.min_cluster_size:
                continue
            all_entities = []
            events = []
            for it in group:
                all_entities.extend(it.entities)
                events.append(it.event)
            counter = Counter(all_entities)
            label = counter.most_common(1)[0][0] if counter else (events[0][:50] if events else f"theme_{cid}")
            theme_details.append(ThemeOutput(
                theme_id=f"theme_{cid}",
                label=label,
                article_count=len(group),
                trend="increasing" if len(group) >= 3 else "stable",
            ))
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
        embeddings = self._embed(texts).astype(np.float32)
        # Cosine distance = 1 - cosine_sim; threshold 0.65 -> merge if sim > ~0.35
        labels = _cluster_agglomerative(embeddings, n_clusters=None, distance_threshold=self.distance_threshold)
        n_clusters = int(labels.max()) + 1
        theme_details = self._label_clusters(items, labels)

        themes: list[str] = [t.label for t in theme_details]
        counts = [t.article_count for t in theme_details]
        total = sum(counts) or 1
        criticality = [c / total for c in counts]
        if sentiment_weights and len(sentiment_weights) == len(items):
            # optional: weight by sentiment (e.g. more negative -> higher criticality)
            for i, t in enumerate(theme_details):
                idx_in_cluster = [j for j, lab in enumerate(labels) if lab == i]
                w = sum(sentiment_weights[j] for j in idx_in_cluster) / max(len(idx_in_cluster), 1)
                criticality[i] = 0.7 * criticality[i] + 0.3 * min(1.0, max(0, w))
        total_c = sum(criticality) or 1
        criticality = [x / total_c for x in criticality]

        return ThemeWithCriticality(themes=themes, criticality=criticality, theme_details=theme_details)
