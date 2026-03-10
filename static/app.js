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
  if (!message) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.style.display = "block";
  el.textContent = message;
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `${response.status} ${response.statusText}`);
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

function renderOverview() {
  const themes = state.latest?.themes || [];
  const criticality = state.latest?.criticality || [];
  const details = state.latest?.theme_details || [];
  $("themeSummaryGrid").innerHTML = themes.length ? themes.map((theme, index) => {
    const detail = details[index] || {};
    const score = Number(criticality[index] || 0);
    return `
      <article class="theme-card ${score >= 0.2 ? "hot" : ""} clickable" data-theme="${escapeHtml(theme)}">
        <div class="theme-top">
          <div>
            <div class="section-kicker">Theme</div>
            <h3>${escapeHtml(theme)}</h3>
          </div>
          <div class="score-row">
            <div class="score">${pct(score)}</div>
            <button class="ghost-btn explain-btn" data-theme="${escapeHtml(theme)}">Explain why</button>
          </div>
        </div>
        <div class="mini-bar"><span style="width:${Math.max(score * 100, 6)}%"></span></div>
        <div class="metric-line"><span>Article volume</span><strong>${detail.article_count || 0}</strong></div>
        <div class="metric-line"><span>Mention rate</span><strong>${(detail.mention_count || 0)}/${Math.max(detail.article_count || 1, 1)}</strong></div>
        <div class="metric-line"><span>Trend</span><strong>${escapeHtml(detail.trend || "stable")}</strong></div>
        <div class="tag-list">
          ${(detail.asset_classes || []).slice(0, 4).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
        </div>
      </article>
    `;
  }).join("") : `<div class="empty">Run the pipeline to populate the dashboard.</div>`;

  const investigations = state.latest?.investigations || [];
  $("alertBoard").innerHTML = investigations.length ? investigations.map((item) => `
    <article class="alert-card clickable" data-theme="${escapeHtml(item.theme)}">
      <div class="card-top">
        <div>
          <div class="section-kicker">Alert</div>
          <h3>${escapeHtml(item.theme)}</h3>
        </div>
        <span class="badge alert">${pct(item.metadata?.criticality || 0)}</span>
      </div>
      <div class="card-meta">${escapeHtml(item.narrative || "No narrative returned.")}</div>
      <div class="tag-list">
        ${(item.trigger_reasons || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
    </article>
  `).join("") : `<div class="empty">No investigations yet. Lower the threshold or run a broader scan.</div>`;

  $("historyBoard").innerHTML = state.history.themeRuns.length || state.history.insights.length
    ? [
        ...state.history.themeRuns.slice(0, 3).map((run) => `
          <article class="history-card">
            <div class="card-top"><h3>Theme run</h3><span class="badge">${run.article_count} articles</span></div>
            <div class="card-meta">${new Date(run.created_at).toLocaleString()}</div>
            <div class="tag-list">${(run.themes || []).slice(0, 4).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
          </article>
        `),
        ...state.history.insights.slice(0, 3).map((item) => `
          <article class="history-card clickable" data-theme="${escapeHtml(item.theme)}">
            <div class="card-top"><h3>${escapeHtml(item.theme)}</h3><span class="badge alert">${pct(item.criticality || 0)}</span></div>
            <div class="card-meta">${escapeHtml(item.investigation?.narrative || "Stored investigation available.")}</div>
          </article>
        `)
      ].join("")
    : `<div class="empty">No history stored yet.</div>`;

  const risks = state.latest?.risk_analyses || [];
  $("riskPulseBoard").innerHTML = risks.length ? risks.map((risk) => `
    <article class="risk-card">
      <div class="card-top"><h3>${escapeHtml(risk.macro_theme)}</h3></div>
      <div class="card-meta">${escapeHtml(risk.narrative || "No risk narrative returned.")}</div>
      <div class="tag-list">
        ${(risk.market_implications || []).slice(0, 4).map((item) => `<span class="tag">${escapeHtml(item.implication)}</span>`).join("")}
      </div>
    </article>
  `).join("") : `<div class="empty">Risk implications will show here when the risk engine returns output.</div>`;
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
  $("selectedThemeStats").innerHTML = `
    <div class="detail-card"><span>Criticality</span><strong>${pct(score)}</strong></div>
    <div class="detail-card"><span>Article volume</span><strong>${articleCount}</strong></div>
    <div class="detail-card"><span>Mention rate</span><strong>${mentionRate.toFixed(2)}</strong></div>
    <div class="detail-card"><span>Average sentiment</span><strong>${pct(avgSentiment)}</strong></div>
    <div class="detail-card"><span>Trend</span><strong>${escapeHtml(detail.trend || "stable")}</strong></div>
    <div class="detail-card"><span>Source topics</span><strong>${(detail.source_topics || []).length}</strong></div>
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
    <article class="risk-card">
      <div class="card-meta">${escapeHtml(risk.narrative || "")}</div>
      <div class="tag-list">
        ${(risk.market_implications || []).map((item) => `<span class="tag">${escapeHtml(item.implication)}</span>`).join("")}
      </div>
    </article>
  ` : `<div class="empty">No risk analysis currently stored for this theme.</div>`;

  if (state.selectedExplanation && state.selectedExplanation.theme === theme) {
    const inv = state.selectedExplanation.investigation || {};
    $("explainOutput").innerHTML = `
      <div><strong>Why this score:</strong> ${escapeHtml((inv.trigger_reasons || []).join(", ") || "No explicit trigger reasons returned.")}</div>
      <div class="card-meta" style="margin-top:8px;">${escapeHtml(inv.narrative || "")}</div>
      <div class="tag-list">
        ${(inv.related_events || []).slice(0, 4).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
      </div>
    `;
  } else {
    $("explainOutput").textContent = "Click 'Explain why' to run the investigation agent on this theme and explain the criticality score.";
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
      color: "#b24531",
      fillColor: "#d69438",
      fillOpacity: 0.28,
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
  $("metricArticles").textContent = state.latest?.extracted_count || 0;
  $("metricThemes").textContent = (state.latest?.themes || []).length;
  $("metricAlerts").textContent = (state.latest?.investigations || []).length;
  $("metricScenario").textContent = state.history.simulations[0] ? pct(state.history.simulations[0].result?.confidence || 0) : "-";
}

function renderAll() {
  renderMetrics();
  renderOverview();
  renderNewsFeed();
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
  setLoading(button, "Running...");
  $("pipelineStatus").textContent = "Pipeline running";
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
    $("pipelineStatus").textContent = "Pipeline complete";
    $("lastRefresh").textContent = new Date().toLocaleString();
    renderAll();
  } catch (error) {
    $("pipelineStatus").textContent = "Pipeline failed";
    setError(error.message);
  } finally {
    clearLoading(button);
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
    $("simulationResult").innerHTML = `
      <div><strong>Confidence:</strong> ${pct(result.confidence || 0)}</div>
      <div class="card-meta" style="margin-top:8px;">${escapeHtml(result.llm_narrative || "")}</div>
      <div class="tag-list">
        ${(result.market_impacts || []).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
      </div>
    `;
    renderMetrics();
  } catch (error) {
    setError(error.message);
  } finally {
    clearLoading(button);
  }
}

function bindThemeSelection() {
  document.body.addEventListener("click", (event) => {
    const themeEl = event.target.closest("[data-theme]");
    if (themeEl) {
      state.selectedTheme = themeEl.dataset.theme;
      state.selectedExplanation = null;
      document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
      document.querySelector('.nav-link[data-view="themes"]').classList.add("active");
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
  });
}

function initNav() {
  document.querySelectorAll(".nav-link").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      document.querySelectorAll(".view").forEach((view) => {
        view.classList.toggle("active", view.dataset.view === button.dataset.view);
      });
      if (button.dataset.view === "map" && state.mapInstance) {
        setTimeout(() => state.mapInstance.invalidateSize(), 50);
      }
    });
  });
}

async function init() {
  initNav();
  bindThemeSelection();
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

  addEventRow({ event_type: "rate_hike", description: "Central bank surprises with 50 bps hike", region: "US", magnitude: 1.0 });
  addEventRow({ event_type: "supply_shock", description: "Energy shipping disruption lifts freight and oil costs", region: "Middle East", magnitude: 1.1 });

  try {
    await Promise.all([refreshState(), refreshHistory()]);
    renderAll();
  } catch (error) {
    setError(error.message);
  }
}

init();
