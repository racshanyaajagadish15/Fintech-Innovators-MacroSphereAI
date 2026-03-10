"""Connection Agent: knowledge graph of themes, entities, regions; supports map overlay."""
from __future__ import annotations

try:
    import networkx as nx
    _NX_AVAILABLE = True
except ImportError:
    nx = None
    _NX_AVAILABLE = False

from typing import Any
from schemas.themes import ThemeWithCriticality
from schemas.investigation import InvestigationOutput

_DEPS_MSG = "networkx is required for the knowledge graph. Install with: pip install networkx"


class ConnectionAgent:
    """Builds and queries a knowledge graph linking themes, entities, regions, and signals."""

    def __init__(self):
        if not _NX_AVAILABLE:
            raise ValueError(_DEPS_MSG)
        self.g: nx.DiGraph = nx.DiGraph()

    def add_theme(self, theme: str, criticality: float, theme_id: str = "") -> None:
        self.g.add_node(f"theme:{theme_id or theme}", node_type="theme", label=theme, criticality=criticality)

    def add_entity(self, entity: str, theme: str) -> None:
        nid = f"entity:{entity}"
        self.g.add_node(nid, node_type="entity", label=entity)
        theme_nid = f"theme:{theme}"
        if self.g.has_node(theme_nid):
            self.g.add_edge(theme_nid, nid, relation="involves")
        else:
            self.g.add_node(theme_nid, node_type="theme", label=theme)
            self.g.add_edge(theme_nid, nid, relation="involves")

    def add_region(self, region: str, theme: str) -> None:
        nid = f"region:{region}"
        self.g.add_node(nid, node_type="region", label=region)
        theme_nid = f"theme:{theme}"
        if self.g.has_node(theme_nid):
            self.g.add_edge(theme_nid, nid, relation="affects")
        else:
            self.g.add_node(theme_nid, node_type="theme", label=theme)
            self.g.add_edge(theme_nid, nid, relation="affects")

    def add_signal(self, signal_type: str, description: str, theme: str, regions: list[str], confidence: float) -> None:
        nid = f"signal:{signal_type}:{hash(description) % 10**6}"
        self.g.add_node(nid, node_type="signal", signal_type=signal_type, description=description, confidence=confidence)
        theme_nid = f"theme:{theme}"
        if not self.g.has_node(theme_nid):
            self.g.add_node(theme_nid, node_type="theme", label=theme)
        self.g.add_edge(theme_nid, nid, relation="signal")
        for r in regions:
            rnid = f"region:{r}"
            if not self.g.has_node(rnid):
                self.g.add_node(rnid, node_type="region", label=r)
            self.g.add_edge(nid, rnid, relation="in_region")

    def ingest_themes(self, theme_output: ThemeWithCriticality) -> None:
        for i, (t, c) in enumerate(zip(theme_output.themes, theme_output.criticality)):
            self.add_theme(t, c, theme_id=f"t{i}")

    def ingest_investigation(self, inv: InvestigationOutput) -> None:
        self.add_theme(inv.theme, inv.metadata.get("criticality", 0.5))
        for e in inv.involved_entities:
            self.add_entity(e, inv.theme)
        for r in inv.involved_regions:
            self.add_region(r, inv.theme)
        for s in inv.signals:
            self.add_signal(s.signal_type, s.description, inv.theme, s.regions, s.confidence)

    def to_map_data(self) -> dict[str, Any]:
        """Export structure for map overlay: regions with heat (criticality) and themes."""
        regions: dict[str, float] = {}
        themes_by_region: dict[str, list[str]] = {}
        for n, attrs in self.g.nodes(data=True):
            if attrs.get("node_type") == "region":
                label = attrs.get("label", n)
                regions[label] = regions.get(label, 0.0)
            if attrs.get("node_type") == "theme":
                crit = attrs.get("criticality", 0)
                for _, succ, e in self.g.out_edges(n, data=True):
                    if e.get("relation") == "affects":
                        rnode = self.g.nodes[succ]
                        rlabel = rnode.get("label", succ)
                        regions[rlabel] = regions.get(rlabel, 0.0) + crit
                        themes_by_region.setdefault(rlabel, []).append(attrs.get("label", ""))
        return {"regions": regions, "themes_by_region": themes_by_region, "nodes": list(self.g.nodes()), "edges": list(self.g.edges())}

    def get_graph(self) -> nx.DiGraph:
        return self.g
