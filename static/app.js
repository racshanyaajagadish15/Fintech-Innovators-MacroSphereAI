const apiBase = window.location.origin;
const geoLookup = {
  "US": [37.0902, -95.7129],
  "United States": [37.0902, -95.7129],
  "EU": [50.1109, 8.6821],
  "Europe": [54.526, 15.2551],
  "UK": [55.3781, -3.436],
  "China": [35.8617, 104.1954],
  "Japan": [36.2048, 138.2529],
  "India": [20.5937, 78.9629],
  "Pakistan": [30.3753, 69.3451],
  "Qatar": [25.3548, 51.1839],
  "Middle East": [29.2985, 42.551],
  "Russia": [61.524, 105.3188],
  "Ukraine": [48.3794, 31.1656],
  "Global": [20, 0]
};

const state = {
  latest: null,
  history: { themeRuns: [], insights: [], simulations: [] },
  selectedTheme: null,
  selectedExplanation: null,
  map: null,
  mapInstance: null,
  mapLayers: []
};

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function pct(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function setError(message = "") {
  const el = $("pipelineError");
  if (!el) return;
  if (!message) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.style.display = "block";
  el.textContent = message;
}

function setLoadingOverlay(visible, text = "Running pipeline…") {
  const el = document.getElementById("loadingOverlay");
  const textEl = document.getElementById("loadingOverlayText");
  if (!el) return;
  el.setAttribute("aria-hidden", visible ? "false" : "true");
  if (textEl) textEl.textContent = text;
}

function showToast(message, durationMs = 3500) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("toast--visible");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    el.classList.remove("toast--visible");
  }, durationMs);
}

function toggleEmptyState() {
  const hasData = state.latest && (state.latest.themes || []).length > 0;
  const emptyEl = document.getElementById("emptyState");
  const contentEl = document.getElementById("overviewContent");
  if (emptyEl) {
    emptyEl.setAttribute("aria-hidden", hasData ? "true" : "false");
    emptyEl.style.display = hasData ? "none" : "block";
  }
  if (contentEl) contentEl.style.display = hasData ? "block" : "none";
}

function parseApiDetail(data) {
  const d = data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d[0]?.msg) return d[0].msg;
  return null;
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = parseApiDetail(data) || data.detail || `${response.status} ${response.statusText}`;
    throw new Error(msg);
  }
  return data;
}

function setLoading(button, text) {
  button.dataset.prev = button.textContent;
  button.textContent = text;
  button.disabled = true;
}

function clearLoading(button) {
  button.textContent = button.dataset.prev || button.textContent;
  button.disabled = false;
}

function parseDate(value) {
  if (!value) return null;
  const parts = value.split("/");
  if (parts.length === 3) {
    return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function findThemeDetail(theme) {
  return (state.latest?.theme_details || []).find((item) => item.label === theme);
}

function articlesForTheme(theme) {
  const lower = theme.toLowerCase();
  return (state.latest?.extracted_items || []).filter((item) =>
    item.event.toLowerCase().includes(lower) ||
    (item.entities || []).some((entity) => entity.toLowerCase().includes(lower) || lower.includes(entity.toLowerCase()))
  );
}

function computeThemeStats(theme) {
  const detail = findThemeDetail(theme) || {};
  const articles = articlesForTheme(theme);
  const articleCount = detail.article_count || articles.length;
  const mentionRate = articleCount ? (detail.mention_count || 0) / articleCount : 0;
  const avgSentiment = articles.length
    ? articles.reduce((sum, item) => sum + Number(item.sentiment_score || 0), 0) / articles.length
    : 0;
  const dates = articles.map((item) => parseDate(item.publishing_date)).filter(Boolean).sort((a, b) => a - b);
  let trendDelta = 0;
  if (dates.length >= 2) {
    trendDelta = dates[dates.length - 1].getTime() - dates[0].getTime();
  }
  return { detail, articles, articleCount, mentionRate, avgSentiment, trendDelta };
}

function criticalityLevel(score) {
  if (score >= 0.4) return "Critical";
  if (score >= 0.25) return "High";
  if (score >= 0.15) return "Elevated";
  return "Watch";
}

function trendIcon(trend) {
  const t = (trend || "stable").toLowerCase();
  if (t === "increasing") return "↑";
  if (t === "decreasing") return "↓";
  return "→";
}

function trendLabel(trend) {
  const t = (trend || "stable").toLowerCase();
  if (t === "increasing") return "Rising";
  if (t === "decreasing") return "Falling";
  return "Stable";
}

function renderThemeSelector() {
  const list = document.getElementById("themeSelectorList");
  if (!list) return;
  const themes = state.latest?.themes || [];
  const criticality = state.latest?.criticality || [];
  const details = state.latest?.theme_details || [];
  if (!themes.length) {
    list.innerHTML = '<p class="overview-empty">Run the pipeline to see themes.</p>';
    return;
  }
  const indexed = themes.map((t, i) => ({
    theme: t,
    score: Number(criticality[i] || 0),
    detail: details[i] || {},
  }));
  indexed.sort((a, b) => b.score - a.score);
  list.innerHTML = indexed.map((row) => {
    const level = criticalityLevel(row.score);
    const levelClass = " theme-selector-item--" + level.toLowerCase().replace(/\s/g, "-");
    const selected = state.selectedTheme === row.theme ? " theme-selector-item--selected" : "";
    const trend = row.detail.trend || "stable";
    return (
      '<button type="button" class="theme-selector-item' + levelClass + selected + '" data-theme="' + escapeHtml(row.theme) + '" data-select-theme="1">' +
        '<span class="theme-selector-item__icon" title="' + trendLabel(trend) + '">' + trendIcon(trend) + '</span>' +
        '<span class="theme-selector-item__name">' + escapeHtml(row.theme) + '</span>' +
        '<span class="theme-selector-item__pct">' + pct(row.score) + '</span>' +
      '</button>'
    );
  }).join("");
}

const OVERVIEW_THEMES_SHOW = 6;
const OVERVIEW_ALERTS_SHOW = 3;

function renderOverviewSummary() {
  const themes = (state.latest?.themes || []).length;
  const alerts = (state.latest?.investigations || []).length;
  const articles = state.latest?.extracted_count || 0;
  const lastRun = $("lastRefresh") ? $("lastRefresh").textContent : "—";
  const el = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  el("overviewNumThemes", themes);
  el("overviewNumAlerts", alerts);
  el("overviewNumArticles", articles);
  el("overviewLastRun", lastRun === "No recent run" ? "—" : lastRun);
}

function renderOverview() {
  renderOverviewSummary();
  const themes = state.latest?.themes || [];
  const criticality = state.latest?.criticality || [];
  const details = state.latest?.theme_details || [];
  const themeGrid = $("themeSummaryGrid");
  if (themeGrid) {
    if (!themes.length) {
      themeGrid.innerHTML = '<p class="overview-empty">Run the pipeline to see themes.</p>';
    } else {
      var indexed = themes.map(function (theme, i) {
        return { theme: theme, score: Number(criticality[i] || 0), detail: details[i] || {} };
      });
      indexed.sort(function (a, b) { return b.score - a.score; });
      var rows = indexed.slice(0, OVERVIEW_THEMES_SHOW);
      themeGrid.innerHTML = rows.map(function (row, rank) {
        var rankNum = rank + 1;
        var score = row.score;
        var detail = row.detail;
        var level = criticalityLevel(score);
        var levelClass = " theme-chip--" + level.toLowerCase().replace(/\s/g, "-");
        return (
          '<button type="button" class="theme-chip' + levelClass + ' clickable" data-theme="' + escapeHtml(row.theme) + '" data-open-modal="theme">' +
            '<span class="theme-chip__rank">#' + rankNum + '</span>' +
            '<span class="theme-chip__name">' + escapeHtml(row.theme) + '</span>' +
            '<span class="theme-chip__pct">' + pct(score) + '</span>' +
          '</button>'
        );
      }).join("");
    }
  }

  const investigations = state.latest?.investigations || [];
  const alertBoard = $("alertBoard");
  if (alertBoard) {
    if (!investigations.length) {
      alertBoard.innerHTML = '<p class="overview-empty">No alerts yet.</p>';
    } else {
      const items = investigations.slice(0, OVERVIEW_ALERTS_SHOW);
      alertBoard.innerHTML = items.map((item) => `
        <button type="button" class="overview-alert-item clickable" data-theme="${escapeHtml(item.theme)}" data-open-modal="theme">
          <span class="overview-alert-item__title">${escapeHtml(item.theme)}</span>
          <span class="badge alert">${pct(item.metadata?.criticality || 0)}</span>
        </button>
      `).join("");
    }
  }

  const risks = state.latest?.risk_analyses || [];
  const riskBoard = $("riskPulseBoard");
  if (riskBoard) {
    if (!risks.length) {
      riskBoard.innerHTML = '<p class="overview-empty">No risk data yet. Run the pipeline.</p>';
    } else {
      riskBoard.innerHTML = risks.map((risk) => `
        <div class="risk-pulse-card risk-pulse-card--highlight">
          <h3 class="risk-pulse-card__title">${escapeHtml(risk.macro_theme)}</h3>
          <p class="risk-pulse-card__narrative">${escapeHtml(risk.narrative || "")}</p>
          <div class="risk-pulse-card__impacts">
            <span class="risk-pulse-card__label">Market implications</span>
            <div class="tag-list">
              ${(risk.market_implications || []).map((m) => `<span class="tag tag--risk">${escapeHtml(m.implication)}</span>`).join("")}
            </div>
          </div>
        </div>
      `).join("");
    }
  }
}

function renderNewsFeed() {
  const query = $("newsSearch").value.trim().toLowerCase();
  const items = state.latest?.extracted_items || [];
  const selected = state.selectedTheme;
  const filtered = items.filter((item) => {
    const haystack = [
      item.headline,
      item.summary,
      item.source_name,
      ...(item.entities || []),
      ...(item.regions || [])
    ].join(" ").toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const matchesTheme = !selected || articlesForTheme(selected).some((match) => match.source_id === item.source_id && match.headline === item.headline);
    return matchesQuery && matchesTheme;
  });

  const countEl = document.getElementById("newsCountLabel");
  if (countEl) countEl.textContent = filtered.length === 0 ? "No articles" : `All articles (${filtered.length})`;

  $("newsFeed").innerHTML = filtered.length ? filtered.map((item) => `
    <article class="feed-card ${selected && articlesForTheme(selected).includes(item) ? "selected" : ""}">
      <div class="card-top">
        <div class="feed-title">${escapeHtml(item.headline)}</div>
        <span class="badge">${escapeHtml(item.platform || item.source_name)}</span>
      </div>
      <div class="feed-meta">${escapeHtml(item.summary || "")}</div>
      <div class="metric-line"><span>Date</span><strong>${escapeHtml(item.publishing_date || "")}</strong></div>
      <div class="metric-line"><span>Source topic</span><strong>${escapeHtml(item.source_topic || "")}</strong></div>
      <div class="metric-line"><span>Sentiment</span><strong>${pct(item.sentiment_score || 0)}</strong></div>
      <div class="tag-list">
        ${(item.entities || []).slice(0, 4).map((entity) => `<span class="tag">${escapeHtml(entity)}</span>`).join("")}
        ${(item.regions || []).slice(0, 3).map((region) => `<span class="tag">${escapeHtml(region)}</span>`).join("")}
      </div>
    </article>
  `).join("") : `<div class="empty">No feed items match the current filter.</div>`;
}

function renderThemeDetail() {
  const theme = state.selectedTheme;
  if (!theme) {
    $("selectedThemeTitle").textContent = "Select a theme";
    $("selectedThemeStats").innerHTML = `<div class="empty">Choose a theme from the Overview cards or the alert board.</div>`;
    $("themeArticles").innerHTML = `<div class="empty">No theme selected.</div>`;
    $("themeRiskPanel").innerHTML = `<div class="empty">No theme selected.</div>`;
    $("explainOutput").textContent = "Pick a theme to inspect volume, trend, mention rate, sentiment, risk, and investigation output.";
    $("explainThemeBtn").disabled = true;
    return;
  }

  $("selectedThemeTitle").textContent = theme;
  $("explainThemeBtn").disabled = false;
  const { detail, articles, articleCount, mentionRate, avgSentiment } = computeThemeStats(theme);
  const score = (() => {
    const idx = (state.latest?.themes || []).indexOf(theme);
    return idx >= 0 ? Number(state.latest?.criticality?.[idx] || 0) : 0;
  })();
  const trend = detail.trend || "stable";
  $("selectedThemeStats").innerHTML = `
    <div class="detail-card detail-card--icon"><span>Criticality</span><strong>${pct(score)}</strong></div>
    <div class="detail-card detail-card--icon"><span>Articles</span><strong>${articleCount}</strong></div>
    <div class="detail-card detail-card--icon"><span>Mention rate</span><strong>${mentionRate.toFixed(2)}</strong></div>
    <div class="detail-card detail-card--icon"><span>Sentiment</span><strong>${pct(avgSentiment)}</strong></div>
    <div class="detail-card detail-card--icon"><span>Trend</span><strong class="detail-card__trend" title="${trendLabel(trend)}">${trendIcon(trend)} ${trendLabel(trend)}</strong></div>
    <div class="detail-card detail-card--icon"><span>Source topics</span><strong>${(detail.source_topics || []).length}</strong></div>
  `;
  $("themeArticles").innerHTML = articles.length ? articles.map((item) => `
    <article class="feed-card">
      <div class="feed-title">${escapeHtml(item.headline)}</div>
      <div class="feed-meta">${escapeHtml(item.summary || "")}</div>
      <div class="tag-list">
        ${(item.key_facts || []).slice(0, 3).map((fact) => `<span class="tag">${escapeHtml(fact)}</span>`).join("")}
      </div>
    </article>
  `).join("") : `<div class="empty">No articles linked to this theme in the latest batch.</div>`;

  const risk = (state.latest?.risk_analyses || []).find((item) => item.macro_theme === theme);
  $("themeRiskPanel").innerHTML = risk ? `
    <article class="risk-card risk-pulse-card--highlight">
      <div class="card-meta">${escapeHtml(risk.narrative || "")}</div>
      <div class="tag-list">
        ${(risk.market_implications || []).map((item) => `<span class="tag tag--risk">${escapeHtml(item.implication)}</span>`).join("")}
      </div>
    </article>
  ` : `<div class="empty">No risk analysis currently stored for this theme.</div>`;

  if (state.selectedExplanation && state.selectedExplanation.theme === theme) {
    const inv = state.selectedExplanation.investigation || {};
    const narrative = (inv.narrative || "").trim();
    const reasons = (inv.trigger_reasons || []).filter(Boolean);
    const signals = (inv.related_events || []).filter(Boolean);
    var parts = [];
    if (narrative) parts.push('<div class="explain-narrative">' + escapeHtml(narrative) + '</div>');
    if (reasons.length) parts.push('<div class="explain-section"><strong>Key factors</strong><p>' + escapeHtml(reasons.join(" · ")) + '</p></div>');
    if (signals.length) parts.push('<div class="explain-section"><strong>Related signals</strong><div class="tag-list">' + signals.slice(0, 6).map(function (s) { return '<span class="tag">' + escapeHtml(String(s)) + '</span>'; }).join("") + '</div></div>');
    $("explainOutput").innerHTML = parts.length ? parts.join("") : '<div class="explain-narrative">Investigation complete. Narrative and signals are summarized above in the theme and risk panels.</div>';
  } else {
    $("explainOutput").textContent = "Click \"Explain why\" to run the investigation for this theme.";
  }
}

function renderMap() {
  if (!window.L) {
    $("mapLegend").innerHTML = `<div class="empty">Leaflet failed to load.</div>`;
    return;
  }
  if (!state.mapInstance) {
    state.mapInstance = L.map("worldMap", { worldCopyJump: true }).setView([22, 5], 2);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(state.mapInstance);
  }

  state.mapLayers.forEach((layer) => layer.remove());
  state.mapLayers = [];
  const entries = Object.entries(state.map?.regions || {});
  $("mapLegend").innerHTML = entries.length ? entries.sort((a, b) => Number(b[1]) - Number(a[1])).map(([region, heat]) => {
    const themes = state.map?.themes_by_region?.[region] || [];
    const coords = geoLookup[region] || geoLookup.Global;
    const radius = 200000 + Math.max(Number(heat || 0), 0.05) * 1200000;
    const circle = L.circle(coords, {
      color: "#00d4aa",
      fillColor: "#00d4aa",
      fillOpacity: 0.2,
      radius
    }).addTo(state.mapInstance);
    circle.bindPopup(`<strong>${escapeHtml(region)}</strong><br>Heat: ${pct(heat)}<br>Themes: ${escapeHtml(themes.join(", ") || "None")}`);
    state.mapLayers.push(circle);
    return `
      <article class="map-card">
        <div class="card-top"><h3>${escapeHtml(region)}</h3><span class="badge alert">${pct(heat)}</span></div>
        <div class="card-meta">${escapeHtml(themes.join(", ") || "No linked themes")}</div>
      </article>
    `;
  }).join("") : `<div class="empty">Run the pipeline to generate regional heat zones.</div>`;
}

function renderMetrics() {
  const articles = state.latest?.extracted_count || 0;
  const themes = (state.latest?.themes || []).length;
  const alerts = (state.latest?.investigations || []).length;
  const scenario = state.history.simulations[0] ? pct(state.history.simulations[0].result?.confidence || 0) : "—";
  const prev = state._prevMetrics || {};
  state._prevMetrics = { articles, themes, alerts, scenario };
  function setKpi(id, value, prevVal) {
    const el = $(id);
    if (!el) return;
    el.textContent = value;
    if (prevVal !== undefined && String(prevVal) !== String(value)) {
      el.classList.add("kpi__value--updated");
      clearTimeout(el._kpiT);
      el._kpiT = setTimeout(() => el.classList.remove("kpi__value--updated"), 600);
    }
  }
  setKpi("metricArticles", articles, prev.articles);
  setKpi("metricThemes", themes, prev.themes);
  setKpi("metricAlerts", alerts, prev.alerts);
  setKpi("metricScenario", scenario, prev.scenario);
  if ($("heroMetric1")) $("heroMetric1").textContent = themes || "—";
  if ($("heroMetric2")) $("heroMetric2").textContent = articles || "—";
  if ($("heroMetric3")) $("heroMetric3").textContent = alerts || "—";
}

function renderAll() {
  renderMetrics();
  toggleEmptyState();
  renderOverview();
  renderNewsFeed();
  renderThemeSelector();
  renderThemeDetail();
  renderMap();
}

async function refreshHistory() {
  const [themeRuns, insights, simulations] = await Promise.all([
    requestJson("/api/history/theme-runs?limit=6"),
    requestJson("/api/history/insights?limit=6"),
    requestJson("/api/history/simulations?limit=6")
  ]);
  state.history = {
    themeRuns: themeRuns.items || [],
    insights: insights.items || [],
    simulations: simulations.items || []
  };
}

async function refreshState() {
  state.latest = await requestJson("/api/state/latest");
  state.map = await requestJson("/api/map");
  if (!state.selectedTheme && (state.latest?.themes || []).length) {
    state.selectedTheme = state.latest.themes[0];
  }
}

async function runPipeline() {
  setError("");
  const button = $("runPipelineBtn");
  const emptyBtn = document.getElementById("emptyStateRunBtn");
  setLoading(button, "Running…");
  if (emptyBtn) emptyBtn.disabled = true;
  $("pipelineStatus").textContent = "Pipeline running";
  setLoadingOverlay(true, "Running pipeline…");
  try {
    state.latest = await requestJson("/api/pipeline/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        max_news: Number($("maxNews").value || 15),
        criticality_threshold: Number($("criticalityThreshold").value || 0.2),
        persist: $("persistRun").value === "true"
      })
    });
    state.map = state.latest.knowledge_graph_map || null;
    state.selectedTheme = state.latest.themes?.[0] || null;
    state.selectedExplanation = null;
    await refreshHistory();
    $("pipelineStatus").textContent = "Complete";
    $("lastRefresh").textContent = new Date().toLocaleString();
    setLoadingOverlay(false);
    clearLoading(button);
    if (emptyBtn) emptyBtn.disabled = false;
    renderAll();
    toggleEmptyState();
    showToast("Pipeline complete. Themes and alerts updated.");
    document.getElementById("pipeline")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setLoadingOverlay(false);
    clearLoading(button);
    if (emptyBtn) emptyBtn.disabled = false;
    $("pipelineStatus").textContent = "Failed";
    setError(error.message);
  }
}

async function explainTheme() {
  if (!state.selectedTheme) return;
  setError("");
  const button = $("explainThemeBtn");
  setLoading(button, "Explaining...");
  try {
    state.selectedExplanation = await requestJson("/api/theme/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        theme: state.selectedTheme,
        criticality_threshold: Number($("criticalityThreshold").value || 0.2)
      })
    });
    renderThemeDetail();
    showToast("Explanation ready.");
  } catch (error) {
    setError(error.message);
  } finally {
    clearLoading(button);
  }
}

function addEventRow(defaults = {}) {
  const wrap = document.createElement("div");
  wrap.className = "event-row";
  wrap.innerHTML = `
    <select>
      <option value="rate_hike">rate_hike</option>
      <option value="supply_shock">supply_shock</option>
      <option value="war_escalation">war_escalation</option>
      <option value="banking_stress">banking_stress</option>
      <option value="inflation_surprise">inflation_surprise</option>
      <option value="custom">custom</option>
    </select>
    <input type="text" placeholder="Description">
    <input type="text" placeholder="Region">
    <input type="number" min="0.1" step="0.1" value="1.0">
    <button class="ghost-btn" type="button">Remove</button>
  `;
  const [type, description, region, magnitude, removeBtn] = wrap.children;
  type.value = defaults.event_type || "custom";
  description.value = defaults.description || "";
  region.value = defaults.region || "";
  magnitude.value = defaults.magnitude || 1.0;
  removeBtn.addEventListener("click", () => wrap.remove());
  $("eventBuilder").appendChild(wrap);
}

function currentEvents() {
  return [...document.querySelectorAll("#eventBuilder .event-row")].map((row) => {
    const [type, description, region, magnitude] = row.children;
    return {
      event_type: type.value,
      description: description.value,
      region: region.value || null,
      magnitude: Number(magnitude.value || 1)
    };
  }).filter((item) => item.description || item.event_type);
}

async function runScenario() {
  setError("");
  const button = $("runScenarioBtn");
  setLoading(button, "Simulating...");
  try {
    const result = await requestJson("/api/simulator/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenario_name: $("scenarioName").value || "Scenario",
        events: currentEvents(),
        horizon_days: Number($("horizonDays").value || 30)
      })
    });
    await refreshHistory();
    const conf = result.confidence != null ? result.confidence : 0;
    const confPct = Math.round(conf * 100);
    $("simulationResult").innerHTML = `
      <div class="sim-result__confidence-wrap">
        <span class="sim-result__confidence" aria-label="Confidence ${confPct}%">${confPct}%</span>
        <span class="sim-result__confidence-label">Confidence</span>
      </div>
      <div class="sim-result__narrative">
        <h4 class="sim-result__heading">Narrative</h4>
        <p>${escapeHtml(result.llm_narrative || "")}</p>
      </div>
      <div class="sim-result__impacts">
        <h4 class="sim-result__heading">Market impacts</h4>
        <div class="tag-list sim-result__tags">
          ${(result.market_impacts || []).map((item) => `<span class="tag tag--sim">${escapeHtml(item)}</span>`).join("")}
        </div>
      </div>
    `;
    renderMetrics();
    showToast("Scenario complete.");
  } catch (error) {
    setError(error.message);
  } finally {
    clearLoading(button);
  }
}

function bindSectionToggles() {
  document.body.addEventListener("click", function (event) {
    var toggle = event.target.closest(".card__head--clickable[data-toggle]");
    if (!toggle) return;
    var panel = toggle.closest(".card--collapsible");
    if (!panel) return;
    var isCollapsed = panel.classList.contains("card--collapsed");
    panel.classList.toggle("card--collapsed", !isCollapsed);
    toggle.setAttribute("aria-expanded", isCollapsed);
    var btn = toggle.querySelector(".card__toggle");
    if (btn) btn.setAttribute("aria-label", isCollapsed ? "Collapse section" : "Expand section");
  });
}

function openModal(title, bodyHtml) {
  const modal = document.getElementById("overviewModal");
  const titleEl = document.getElementById("modalTitle");
  const bodyEl = document.getElementById("modalBody");
  if (!modal || !titleEl || !bodyEl) return;
  titleEl.textContent = title;
  bodyEl.innerHTML = bodyHtml;
  modal.setAttribute("aria-hidden", "false");
  modal.classList.add("modal--open");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  const modal = document.getElementById("overviewModal");
  if (!modal) return;
  modal.setAttribute("aria-hidden", "true");
  modal.classList.remove("modal--open");
  document.body.style.overflow = "";
}

function buildThemeDetailModalContent(theme) {
  const idx = (state.latest?.themes || []).indexOf(theme);
  const score = idx >= 0 ? Number(state.latest?.criticality?.[idx] || 0) : 0;
  const { detail, articleCount } = computeThemeStats(theme);
  const inv = (state.latest?.investigations || []).find((i) => i.theme === theme);
  const risk = (state.latest?.risk_analyses || []).find((r) => r.macro_theme === theme);
  let html = `
    <div class="modal-theme-stats">
      <span><strong>Criticality</strong> ${pct(score)}</span>
      <span><strong>Articles</strong> ${articleCount}</span>
      <span><strong>Trend</strong> ${escapeHtml(detail.trend || "stable")}</span>
    </div>
  `;
  if (inv?.narrative) html += `<p class="modal-p">${escapeHtml(inv.narrative)}</p>`;
  if (risk?.narrative) html += `<p class="modal-p"><strong>Risk:</strong> ${escapeHtml(risk.narrative)}</p>`;
  if (risk?.market_implications?.length) {
    html += '<div class="tag-list">' + risk.market_implications.map((m) => `<span class="tag">${escapeHtml(m.implication)}</span>`).join("") + "</div>";
  }
  html += `
    <div class="modal-actions">
      <button type="button" class="btn btn--primary" data-modal-action="open-lab" data-theme="${escapeHtml(theme)}">Open in Theme Lab</button>
    </div>
  `;
  return html;
}

function buildAllThemesModalContent() {
  const themes = state.latest?.themes || [];
  const criticality = state.latest?.criticality || [];
  const details = state.latest?.theme_details || [];
  if (!themes.length) return "<p class=\"overview-empty\">No themes yet.</p>";
  const indexed = themes.map((t, i) => ({ theme: t, score: Number(criticality[i] || 0), detail: details[i] || {} }));
  indexed.sort((a, b) => b.score - a.score);
  return indexed.map((row, rank) => {
    const level = criticalityLevel(row.score);
    const levelClass = " theme-chip--" + level.toLowerCase().replace(/\s/g, "-");
    return (
      '<button type="button" class="theme-chip' + levelClass + ' theme-chip--full clickable" data-theme="' + escapeHtml(row.theme) + '" data-open-modal="theme">' +
        '<span class="theme-chip__rank">#' + (rank + 1) + '</span>' +
        '<span class="theme-chip__name">' + escapeHtml(row.theme) + '</span>' +
        '<span class="theme-chip__pct">' + pct(row.score) + '</span>' +
      '</button>'
    );
  }).join("");
}

function buildAllAlertsModalContent() {
  const investigations = state.latest?.investigations || [];
  if (!investigations.length) return "<p class=\"overview-empty\">No alerts yet.</p>";
  return investigations.map((item) => `
    <button type="button" class="overview-alert-item overview-alert-item--full clickable" data-theme="${escapeHtml(item.theme)}" data-open-modal="theme">
      <span class="overview-alert-item__title">${escapeHtml(item.theme)}</span>
      <span class="badge alert">${pct(item.metadata?.criticality || 0)}</span>
      <p class="overview-alert-item__narrative">${escapeHtml((item.narrative || "").slice(0, 120))}${(item.narrative || "").length > 120 ? "…" : ""}</p>
    </button>
  `).join("");
}

function buildAllHistoryModalContent() {
  const runs = state.history.themeRuns || [];
  const insights = state.history.insights || [];
  if (!runs.length && !insights.length) return "<p class=\"overview-empty\">No history yet.</p>";
  let html = "";
  runs.slice(0, 10).forEach((run) => {
    html += `<div class="overview-list-item"><span class="overview-list-item__title">Run</span><span class="overview-list-item__meta">${run.article_count} articles · ${new Date(run.created_at).toLocaleString()}</span><div class="tag-list">${(run.themes || []).slice(0, 5).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div></div>`;
  });
  insights.slice(0, 10).forEach((item) => {
    html += `<button type="button" class="overview-list-item clickable" data-theme="${escapeHtml(item.theme)}" data-open-modal="theme"><span class="overview-list-item__title">${escapeHtml(item.theme)}</span><span class="badge alert">${pct(item.criticality || 0)}</span></button>`;
  });
  return html || "<p class=\"overview-empty\">No history yet.</p>";
}

function buildAllRiskModalContent() {
  const risks = state.latest?.risk_analyses || [];
  if (!risks.length) return "<p class=\"overview-empty\">No risk data yet.</p>";
  return risks.map((risk) => `
    <div class="modal-risk-item">
      <span class="modal-risk-item__badge">Risk</span>
      <h4>${escapeHtml(risk.macro_theme)}</h4>
      <p class="modal-p">${escapeHtml(risk.narrative || "")}</p>
      <div class="tag-list">${(risk.market_implications || []).map((m) => `<span class="tag">${escapeHtml(m.implication)}</span>`).join("")}</div>
    </div>
  `).join("");
}

function bindThemeSelection() {
  document.body.addEventListener("click", (event) => {
    const selectThemeBtn = event.target.closest("[data-select-theme]");
    if (selectThemeBtn && selectThemeBtn.dataset.theme) {
      state.selectedTheme = selectThemeBtn.dataset.theme;
      state.selectedExplanation = null;
      renderThemeSelector();
      renderThemeDetail();
      return;
    }
    const openModalBtn = event.target.closest("[data-open-modal]");
    if (openModalBtn && openModalBtn.dataset.openModal === "theme" && openModalBtn.dataset.theme) {
      event.preventDefault();
      const theme = openModalBtn.dataset.theme;
      openModal(theme, buildThemeDetailModalContent(theme));
      return;
    }
    const themeEl = event.target.closest("[data-theme]");
    if (themeEl && !themeEl.dataset.openModal) {
      state.selectedTheme = themeEl.dataset.theme;
      state.selectedExplanation = null;
      document.querySelectorAll(".app-nav__item").forEach((item) => item.classList.remove("active"));
      document.querySelector('.app-nav__item[data-view="themes"]').classList.add("active");
      document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
      document.querySelector('.view[data-view="themes"]').classList.add("active");
      renderAll();
    }
    if (event.target.classList.contains("explain-btn")) {
      event.stopPropagation();
      state.selectedTheme = event.target.dataset.theme;
      renderThemeDetail();
      explainTheme();
    }
    if (event.target.closest("[data-modal-action=open-lab]")) {
      const btn = event.target.closest("[data-modal-action=open-lab]");
      if (btn && btn.dataset.theme) {
        state.selectedTheme = btn.dataset.theme;
        state.selectedExplanation = null;
        closeModal();
        document.querySelectorAll(".app-nav__item").forEach((item) => item.classList.remove("active"));
        document.querySelector('.app-nav__item[data-view="themes"]').classList.add("active");
        document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
        document.querySelector('.view[data-view="themes"]').classList.add("active");
        renderAll();
      }
    }
  });
}

function initNav() {
  document.querySelectorAll(".app-nav__item").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".app-nav__item").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      document.querySelectorAll(".view").forEach((view) => {
        view.classList.toggle("active", view.dataset.view === button.dataset.view);
      });
      if (button.dataset.view === "map" && state.mapInstance) {
        setTimeout(() => state.mapInstance.invalidateSize(), 50);
      }
      if (button.dataset.view === "news") renderNewsFeed();
      if (button.dataset.view === "themes") {
        if (state.latest?.themes?.length && !state.selectedTheme) state.selectedTheme = state.latest.themes[0];
        renderThemeSelector();
        renderThemeDetail();
      }
    });
  });
}

async function init() {
  initNav();
  bindThemeSelection();
  bindSectionToggles();
  $("runPipelineBtn").addEventListener("click", runPipeline);
  $("refreshStateBtn").addEventListener("click", async () => {
    setError("");
    try {
      await Promise.all([refreshState(), refreshHistory()]);
      renderAll();
    } catch (error) {
      setError(error.message);
    }
  });
  $("explainThemeBtn").addEventListener("click", explainTheme);
  $("addEventBtn").addEventListener("click", () => addEventRow());
  $("runScenarioBtn").addEventListener("click", runScenario);
  $("newsSearch").addEventListener("input", renderNewsFeed);

  const emptyRunBtn = document.getElementById("emptyStateRunBtn");
  if (emptyRunBtn) emptyRunBtn.addEventListener("click", runPipeline);
  const heroEnterBtn = document.getElementById("heroEnterBtn");
  if (heroEnterBtn) heroEnterBtn.addEventListener("click", () => setTimeout(runPipeline, 400));

  const modalCloseBtn = document.getElementById("modalClose");
  const modalBackdrop = document.getElementById("modalBackdrop");
  if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeModal);
  if (modalBackdrop) modalBackdrop.addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  const openThemesModal = document.getElementById("openThemesModal");
  const openAlertsModal = document.getElementById("openAlertsModal");
  const openHistoryModal = document.getElementById("openHistoryModal");
  const openRiskModal = document.getElementById("openRiskModal");
  if (openThemesModal) openThemesModal.addEventListener("click", () => openModal("All themes", buildAllThemesModalContent()));
  if (openAlertsModal) openAlertsModal.addEventListener("click", () => openModal("All alerts", buildAllAlertsModalContent()));

  try {
    const health = await requestJson("/health").catch(() => ({}));
    const banner = document.getElementById("pipelineNotReadyBanner");
    if (banner && health && health.pipeline_ready === false) banner.style.display = "block";
  } catch (_) {}

  const dashboard = document.getElementById("dashboard");
  const runOnLoad = dashboard && dashboard.classList.contains("app--visible");
  try {
    if (runOnLoad) {
      await runPipeline();
    } else {
      await Promise.all([refreshState(), refreshHistory()]);
      renderAll();
    }
  } catch (error) {
    setError(error.message);
  }
}

init();
