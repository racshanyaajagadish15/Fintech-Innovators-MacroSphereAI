const apiBase = window.location.origin;
// [lat, lng] for Leaflet — comprehensive region/country names from pipeline
const geoLookup = {
  "US": [39.8283, -98.5795],
  "USA": [39.8283, -98.5795],
  "United States": [39.8283, -98.5795],
  "United States of America": [39.8283, -98.5795],
  "EU": [50.4501, 4.4699],
  "European Union": [50.4501, 4.4699],
  "Europe": [54.526, 15.2551],
  "Eurozone": [50.4501, 4.4699],
  "UK": [55.3781, -3.436],
  "United Kingdom": [55.3781, -3.436],
  "China": [35.8617, 104.1954],
  "Japan": [36.2048, 138.2529],
  "India": [20.5937, 78.9629],
  "Pakistan": [30.3753, 69.3451],
  "Qatar": [25.3548, 51.1839],
  "Middle East": [31.7683, 35.2137],
  "Saudi Arabia": [23.8859, 45.0792],
  "UAE": [23.4241, 53.8478],
  "United Arab Emirates": [23.4241, 53.8478],
  "Israel": [31.0461, 34.8516],
  "Iran": [32.4279, 53.688],
  "Iraq": [33.2232, 43.6793],
  "Turkey": [38.9637, 35.2433],
  "Egypt": [26.8206, 30.8025],
  "Russia": [61.524, 105.3188],
  "Ukraine": [48.3794, 31.1656],
  "Germany": [51.1657, 10.4515],
  "France": [46.2276, 2.2137],
  "Italy": [41.8719, 12.5674],
  "Spain": [40.4637, -3.7492],
  "Netherlands": [52.1326, 5.2913],
  "Brazil": [-14.235, -51.9253],
  "Mexico": [23.6345, -102.5528],
  "Canada": [56.1304, -106.3468],
  "Australia": [-25.2744, 133.7751],
  "South Korea": [35.9078, 127.7669],
  "Korea": [35.9078, 127.7669],
  "Indonesia": [-0.7893, 113.9213],
  "Singapore": [1.3521, 103.8198],
  "Hong Kong": [22.3193, 114.1694],
  "Taiwan": [23.6978, 120.9605],
  "South Africa": [-30.5595, 22.9375],
  "Nigeria": [9.082, 8.6753],
  "Argentina": [-38.4161, -63.6167],
  "Chile": [-35.6751, -71.543],
  "Asia": [34.0479, 100.6197],
  "Asia Pacific": [20.0, 120.0],
  "Africa": [9.1021, 18.2812],
  "Latin America": [-14.235, -51.9253],
  "North America": [54.526, -105.2551],
  "Global": [20, 0],
  "Global markets": [20, 0]
};
function getCoordsForRegion(regionName) {
  if (!regionName || typeof regionName !== "string") return geoLookup.Global;
  const key = regionName.trim();
  if (geoLookup[key]) return geoLookup[key];
  const lower = key.toLowerCase();
  for (const [name, coords] of Object.entries(geoLookup)) {
    if (name.toLowerCase() === lower) return coords;
  }
  if (lower.includes("states") || lower.includes("america")) return geoLookup["United States"];
  if (lower.includes("europe") || lower.includes("eu ")) return geoLookup.Europe;
  if (lower.includes("asia")) return geoLookup.Asia;
  if (lower.includes("middle east") || lower.includes("gulf")) return geoLookup["Middle East"];
  if (lower.includes("uk") || lower.includes("britain")) return geoLookup.UK;
  return geoLookup.Global;
}

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
  const latest = getLatestState();
  const hasData = (latest?.themes || []).length > 0 || (getExtractedItems().length > 0);
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

const DUMMY_EXTRACTED_ITEMS = [
  { headline: "US inflation rates higher than expected", event: "US inflation rises", summary: "CPI data shows persistent price pressures.", entities: ["Federal Reserve", "US Treasury"], regions: ["US"], publishing_date: "09/03/2026", platform: "Bloomberg", source_name: "Bloomberg", source_topic: "macrosphere-news-bloomberg", sentiment_score: 0.6, key_facts: [] },
  { headline: "Fed signals potential rate hold in March meeting", event: "Fed holds rates", summary: "Federal Reserve officials indicate patience on cuts.", entities: ["Federal Reserve"], regions: ["US"], publishing_date: "09/03/2026", platform: "Reuters", source_name: "Reuters", source_topic: "macrosphere-news-reuters", sentiment_score: 0.5, key_facts: [] },
  { headline: "Oil prices rise on Middle East supply concerns", event: "Oil supply risk from Middle East", summary: "Geopolitical tensions weigh on energy markets.", entities: ["OPEC"], regions: ["Middle East"], publishing_date: "08/03/2026", platform: "Reuters", source_name: "Reuters", source_topic: "macrosphere-news-reuters", sentiment_score: 0.55, key_facts: [] },
  { headline: "European Central Bank keeps rates unchanged", event: "ECB holds rates steady", summary: "ECB holds policy steady amid growth concerns.", entities: ["European Central Bank"], regions: ["EU"], publishing_date: "08/03/2026", platform: "Reuters", source_name: "Reuters", source_topic: "macrosphere-news-reuters", sentiment_score: 0.5, key_facts: [] },
  { headline: "Banking sector stress in regional lenders", event: "Regional bank stress", summary: "Regional banks face funding pressures.", entities: ["Federal Reserve"], regions: ["US"], publishing_date: "08/03/2026", platform: "Bloomberg", source_name: "Bloomberg", source_topic: "macrosphere-news-bloomberg", sentiment_score: 0.65, key_facts: [] },
  { headline: "Interest rate expectations shift after payrolls", event: "Rates repriced after jobs data", summary: "Markets price fewer cuts this year.", entities: ["Federal Reserve"], regions: ["US"], publishing_date: "05/03/2026", platform: "Reuters", source_name: "Reuters", source_topic: "macrosphere-news-reuters", sentiment_score: 0.52, key_facts: [] },
  { headline: "Inflation expectations edge higher in survey", event: "Inflation expectations rise", summary: "Consumers see prices rising.", entities: [], regions: ["US"], publishing_date: "04/03/2026", platform: "Reuters", source_name: "Reuters", source_topic: "macrosphere-news-reuters", sentiment_score: 0.58, key_facts: [] },
  { headline: "Geopolitical risk premium in commodity markets", event: "Commodity risk premium", summary: "Oil and gold rally on uncertainty.", entities: [], regions: ["Global"], publishing_date: "06/03/2026", platform: "Reuters", source_name: "Reuters", source_topic: "macrosphere-news-reuters", sentiment_score: 0.55, key_facts: [] },
  { headline: "Sovereign debt sustainability in emerging markets", event: "EM sovereign stress", summary: "Borrowing costs rise for EM issuers.", entities: [], regions: ["Global"], publishing_date: "01/03/2026", platform: "Reuters", source_name: "Reuters", source_topic: "macrosphere-news-reuters", sentiment_score: 0.62, key_facts: [] },
  { headline: "Trade tensions and tariffs in focus", event: "Trade policy in spotlight", summary: "Cross-border trade policy in focus.", entities: [], regions: ["US", "China"], publishing_date: "03/03/2026", platform: "Bloomberg", source_name: "Bloomberg", source_topic: "macrosphere-news-bloomberg", sentiment_score: 0.53, key_facts: [] },
];

const DUMMY_STATE = {
  extracted_items: DUMMY_EXTRACTED_ITEMS,
  extracted_count: DUMMY_EXTRACTED_ITEMS.length,
  themes: ["Inflation and rates", "Geopolitical risk", "Banking and credit"],
  criticality: [0.4, 0.35, 0.25],
  theme_details: [
    { label: "Inflation and rates", article_count: 4, mention_count: 8, trend: "stable", source_topics: [], representative_events: [], regions: ["US"], article_indices: [0, 1, 5, 6] },
    { label: "Geopolitical risk", article_count: 3, mention_count: 5, trend: "increasing", source_topics: [], representative_events: [], regions: ["Middle East", "Global"], article_indices: [2, 7, 9] },
    { label: "Banking and credit", article_count: 3, mention_count: 6, trend: "stable", source_topics: [], representative_events: [], regions: ["US", "EU"], article_indices: [3, 4, 8] },
  ],
  investigations: [],
  risk_analyses: [],
};

function getLatestState() {
  const latest = state.latest;
  if (latest && (latest.extracted_items?.length > 0 || latest.themes?.length > 0)) return latest;
  return DUMMY_STATE;
}

function getExtractedItems() {
  const latest = getLatestState();
  const items = latest?.extracted_items || [];
  return items.length ? items : DUMMY_EXTRACTED_ITEMS;
}

function getNewsArticles() {
  const latest = state.latest || DUMMY_STATE;
  const standardized = latest?.standardized_news || [];
  const extracted = latest?.extracted_items || [];
  if (standardized.length === 0) return getExtractedItems();
  const byKey = {};
  extracted.forEach((e) => {
    const k = (e.source_id || e.headline || "").toString();
    if (k) byKey[k] = e;
  });
  return standardized.map((s) => {
    const k = (s.source_id || s.headline || "").toString();
    const ex = k ? byKey[k] : null;
    if (ex) return { ...s, summary: ex.summary || s.metadata, entities: ex.entities || [], regions: ex.regions || [], sentiment_score: ex.sentiment_score ?? 0.5, key_facts: ex.key_facts || [] };
    return { ...s, summary: s.metadata || "", entities: [], regions: [], sentiment_score: 0.5, key_facts: [] };
  });
}

function findThemeDetail(theme) {
  return (getLatestState()?.theme_details || []).find((item) => item.label === theme);
}

function articlesForTheme(theme) {
  const items = getExtractedItems();
  const detail = findThemeDetail(theme);
  if (detail && (detail.article_indices || []).length > 0) {
    return detail.article_indices
      .map((i) => items[i])
      .filter(Boolean);
  }
  const lower = theme.toLowerCase();
  return items.filter((item) =>
    (item.event || "").toLowerCase().includes(lower) ||
    (item.entities || []).some((entity) => (entity || "").toLowerCase().includes(lower) || lower.includes((entity || "").toLowerCase()))
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
  const latest = getLatestState();
  const themes = latest?.themes || [];
  const criticality = latest?.criticality || [];
  const details = latest?.theme_details || [];
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
  const latest = getLatestState();
  const themes = (latest?.themes || []).length;
  const alerts = (latest?.investigations || []).length;
  const articles = latest?.extracted_count ?? (getExtractedItems().length);
  const lastRun = $("lastRefresh") ? $("lastRefresh").textContent : "—";
  const el = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  el("overviewNumThemes", themes);
  el("overviewNumAlerts", alerts);
  el("overviewNumArticles", articles);
  el("overviewLastRun", lastRun === "No recent run" ? "—" : lastRun);
}

function renderOverview() {
  renderOverviewSummary();
  const latest = getLatestState();
  const themes = latest?.themes || [];
  const criticality = latest?.criticality || [];
  const details = latest?.theme_details || [];
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

  const investigations = getLatestState()?.investigations || [];
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

  const risks = getLatestState()?.risk_analyses || [];
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
  const items = getNewsArticles();
  const selected = state.selectedTheme;
  const filtered = items.filter((item) => {
    const haystack = [
      item.headline,
      item.summary || item.metadata,
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

  $("newsFeed").innerHTML = filtered.length ? filtered.map((item) => {
    const raw = item.url || item.source_id || "";
    const url = (typeof raw === "string" && raw.startsWith("http")) ? raw : "";
    const linkHtml = url ? `<a href="${escapeHtml(url)}" class="feed-card__link" target="_blank" rel="noopener noreferrer">Read article →</a>` : "";
    return `
    <article class="feed-card ${selected && articlesForTheme(selected).includes(item) ? "selected" : ""}">
      <div class="card-top">
        <div class="feed-title">${escapeHtml(item.headline)}</div>
        <span class="badge">${escapeHtml(item.platform || item.source_name)}</span>
      </div>
      <div class="feed-meta">${escapeHtml((item.summary || item.metadata || "").slice(0, 500))}${(item.summary || item.metadata || "").length > 500 ? "…" : ""}</div>
      <div class="metric-line"><span>Date</span><strong>${escapeHtml(item.publishing_date || "")}</strong></div>
      <div class="metric-line"><span>Source</span><strong>${escapeHtml(item.platform || item.source_name || "")}</strong></div>
      <div class="metric-line"><span>Sentiment</span><strong>${pct(item.sentiment_score != null ? item.sentiment_score : 0.5)}</strong></div>
      <div class="tag-list">
        ${(item.entities || []).slice(0, 4).map((entity) => `<span class="tag">${escapeHtml(entity)}</span>`).join("")}
        ${(item.regions || []).slice(0, 3).map((region) => `<span class="tag">${escapeHtml(region)}</span>`).join("")}
      </div>
      ${linkHtml}
    </article>
  `;
  }).join("") : `<div class="empty">No feed items match the current filter.</div>`;
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
    const latest = getLatestState();
    const idx = (latest?.themes || []).indexOf(theme);
    return idx >= 0 ? Number(latest?.criticality?.[idx] || 0) : 0;
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
  $("themeArticles").innerHTML = articles.length ? articles.map((item) => {
    const raw = item.url || item.source_id || "";
    const url = (typeof raw === "string" && raw.startsWith("http")) ? raw : "";
    const linkHtml = url ? `<a href="${escapeHtml(url)}" class="feed-card__link" target="_blank" rel="noopener noreferrer">Read article →</a>` : "";
    return `
    <article class="feed-card">
      <div class="feed-title">${escapeHtml(item.headline)}</div>
      <div class="feed-meta">${escapeHtml(item.summary || "")}</div>
      <div class="tag-list">
        ${(item.key_facts || []).slice(0, 3).map((fact) => `<span class="tag">${escapeHtml(fact)}</span>`).join("")}
      </div>
      ${linkHtml}
    </article>
  `;
  }).join("") : `<div class="empty">No articles linked to this theme in the latest batch.</div>`;

  const risks = getLatestState()?.risk_analyses || [];
  let risk = risks.find((item) => item.macro_theme === theme);
  if (!risk && risks.length) risk = risks[0];
  const riskNote = risk && risk.macro_theme !== theme ? `<p class="risk-panel__note">Showing risk for: ${escapeHtml(risk.macro_theme)}. Run pipeline to get theme-specific risk for all themes.</p>` : "";
  $("themeRiskPanel").innerHTML = risk ? `
    <article class="risk-card risk-pulse-card--highlight">
      ${riskNote}
      <div class="card-meta">${escapeHtml(risk.narrative || "")}</div>
      <div class="tag-list">
        ${(risk.market_implications || []).map((item) => `<span class="tag tag--risk">${escapeHtml(item.implication)}</span>`).join("")}
      </div>
    </article>
  ` : `<div class="empty">No risk data yet. Run the pipeline to generate risk analysis for all themes.</div>`;

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
    state.mapInstance = L.map("worldMap", { worldCopyJump: true }).setView([25, 10], 2);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; CARTO, &copy; OpenStreetMap",
      subdomains: "abcd",
      maxZoom: 19
    }).addTo(state.mapInstance);
  }

  state.mapLayers.forEach((layer) => layer.remove());
  state.mapLayers = [];
  const entries = Object.entries(state.map?.regions || {});
  $("mapLegend").innerHTML = entries.length ? entries.sort((a, b) => Number(b[1]) - Number(a[1])).map(([region, heat]) => {
    const themes = state.map?.themes_by_region?.[region] || [];
    const coords = getCoordsForRegion(region);
    const radius = 400000 + Math.max(Number(heat || 0), 0.05) * 1500000;
    const circle = L.circle(coords, {
      color: "#00d4aa",
      fillColor: "#00d4aa",
      fillOpacity: 0.35,
      weight: 2,
      radius
    }).addTo(state.mapInstance);
    circle.bindPopup(`<strong>${escapeHtml(region)}</strong><br>Impact: ${pct(heat)}<br>Themes: ${escapeHtml(themes.join(", ") || "None")}`);
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
  const latest = getLatestState();
  const articles = latest?.extracted_count ?? (getExtractedItems().length);
  const themes = (latest?.themes || []).length;
  const alerts = (latest?.investigations || []).length;
  const overviewEl = $("pipelineRunOverview");
  if (overviewEl) {
    const statusEl = $("pipelineStatus");
    const timeEl = $("lastRefresh");
    const status = statusEl ? statusEl.textContent : "Idle";
    const timeStr = timeEl && timeEl.textContent !== "No recent run" ? timeEl.textContent : "";
    if (themes > 0 || articles > 0) {
      const parts = [status, `${articles} articles`, `${themes} themes`, `${alerts} alerts`];
      if (timeStr) parts.push(timeStr);
      overviewEl.textContent = parts.join(" · ");
    } else {
      overviewEl.textContent = timeStr ? `${status} · ${timeStr}` : "No run yet. Use the controls below to run.";
    }
  }
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
  const latest = getLatestState();
  if (!state.selectedTheme && (latest?.themes || []).length) {
    state.selectedTheme = latest.themes[0];
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
        max_news: Math.min(150, Math.max(1, Number($("maxNews").value) || 100)),
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

const scenarioPresets = {
  iran_iraq_escalation: {
    name: "Iran–Iraq regional escalation",
    events: [
      { event_type: "war_escalation", description: "Military escalation between Iran and Iraq", region: "Middle East", magnitude: 1.5 },
      { event_type: "supply_shock", description: "Strait of Hormuz supply risk", region: "Iran", magnitude: 1.3 }
    ]
  },
  gulf_supply: {
    name: "Gulf oil supply disruption",
    events: [
      { event_type: "supply_shock", description: "Gulf oil exports disrupted by regional conflict", region: "Middle East", magnitude: 1.4 }
    ]
  },
  iran_iraq_conflict: {
    name: "Iran–Iraq conflict spillover",
    events: [
      { event_type: "war_escalation", description: "Iran–Iraq conflict spillover into energy and trade", region: "Iran", magnitude: 1.4 },
      { event_type: "custom", description: "Regional sovereign and FX stress", region: "Middle East", magnitude: 1.2 }
    ]
  },
  rate_hike: {
    name: "Rate hike shock",
    events: [
      { event_type: "rate_hike", description: "Central bank raises rates more than expected", region: "US", magnitude: 1.2 }
    ]
  },
  oil_supply: {
    name: "Oil supply shock",
    events: [
      { event_type: "supply_shock", description: "Major oil supply disruption", region: "Middle East", magnitude: 1.5 }
    ]
  },
  geopolitical: {
    name: "Geopolitical escalation",
    events: [
      { event_type: "war_escalation", description: "Escalation of regional conflict affecting energy and trade", region: "Europe", magnitude: 1.3 }
    ]
  },
  banking_stress: {
    name: "Banking stress",
    events: [
      { event_type: "banking_stress", description: "Stress in regional banks and funding markets", region: "US", magnitude: 1.2 }
    ]
  },
  inflation_surprise: {
    name: "Inflation surprise",
    events: [
      { event_type: "inflation_surprise", description: "CPI print significantly above consensus", region: "US", magnitude: 1.4 }
    ]
  },
  combined: {
    name: "Combined macro shock",
    events: [
      { event_type: "rate_hike", description: "Aggressive Fed tightening", region: "US", magnitude: 1.1 },
      { event_type: "supply_shock", description: "Commodity supply disruption", region: "Middle East", magnitude: 1.2 },
      { event_type: "inflation_surprise", description: "Persistent inflation above target", region: "EU", magnitude: 1.2 }
    ]
  }
};

function applyPreset(presetKey) {
  const preset = scenarioPresets[presetKey];
  if (!preset) return;
  const nameEl = $("scenarioName");
  const builder = $("eventBuilder");
  if (nameEl) nameEl.value = preset.name;
  if (!builder) return;
  builder.innerHTML = "";
  (preset.events || []).forEach((ev) => addEventRow(ev));
}

function suggestScenarioFromThemes() {
  const latest = getLatestState();
  const themes = latest?.themes || [];
  const investigations = latest?.investigations || [];
  const criticality = latest?.criticality || [];
  if (!themes.length) {
    showToast("Run the pipeline first to suggest scenarios from current themes.");
    return;
  }
  const builder = $("eventBuilder");
  const nameEl = $("scenarioName");
  if (!builder || !nameEl) return;
  builder.innerHTML = "";
  const topThemes = themes
    .map((t, i) => ({ theme: t, score: Number(criticality[i] || 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const events = [];
  for (const { theme } of topThemes) {
    const inv = investigations.find((i) => i.theme === theme);
    const region = (inv?.involved_regions && inv.involved_regions[0]) || "Global";
    let eventType = "custom";
    const lower = (theme || "").toLowerCase();
    if (lower.includes("rate") || lower.includes("fed") || lower.includes("central bank")) eventType = "rate_hike";
    else if (lower.includes("oil") || lower.includes("supply") || lower.includes("commodity")) eventType = "supply_shock";
    else if (lower.includes("war") || lower.includes("conflict") || lower.includes("geopolitic")) eventType = "war_escalation";
    else if (lower.includes("bank") || lower.includes("stress") || lower.includes("credit")) eventType = "banking_stress";
    else if (lower.includes("inflation") || lower.includes("cpi")) eventType = "inflation_surprise";
    events.push({ event_type: eventType, description: theme, region, magnitude: 1.0 });
  }
  if (events.length) {
    nameEl.value = "Scenario from current themes";
    events.forEach((ev) => addEventRow(ev));
    showToast("Suggested " + events.length + " events from top themes.");
  } else {
    addEventRow({ event_type: "custom", description: themes[0] || "Key theme development", region: "Global", magnitude: 1.0 });
    nameEl.value = "Scenario from current themes";
    showToast("Added one event from top theme.");
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

const SAMPLE_SCENARIO_RESULTS = [
  { name: "Iran–Iraq regional escalation", confidence: 0.72, narrative: "Regional military escalation between Iran and Iraq raises oil supply risks and sovereign stress in the Gulf. Strait of Hormuz transit concerns and energy volatility are likely to persist. Markets price higher geopolitical risk premium in oil and EM assets.", impacts: ["Oil prices ↑ on supply risk", "EM sovereign spreads widen", "USD safe-haven bid", "Defense sector outperforms", "Gulf FX volatility ↑"] },
  { name: "Gulf oil supply disruption", confidence: 0.68, narrative: "Gulf oil export disruption from regional conflict would tighten global crude balances and lift prices. Inflation expectations and central bank rhetoric could shift; risk-off in equities and credit likely in the short run.", impacts: ["Brent/WTI volatility ↑", "Inflation expectations rise", "Rates path repriced", "High yield spreads widen", "Commodity currencies supported"] }
];

function renderSampleSimulationResults() {
  const el = $("simulationResult");
  if (!el) return;
  if (el.querySelector(".sim-result__confidence-wrap")) return;
  const placeholder = el.querySelector(".sim-result__placeholder");
  if (!placeholder && el.children.length > 1) return;
  el.innerHTML = SAMPLE_SCENARIO_RESULTS.map((s) => {
    const confPct = Math.round((s.confidence || 0) * 100);
    return `
      <div class="sim-result sim-result--sample">
        <h4 class="sim-result__sample-title">${escapeHtml(s.name)}</h4>
        <div class="sim-result__confidence-wrap">
          <span class="sim-result__confidence">${confPct}%</span>
          <span class="sim-result__confidence-label">Confidence</span>
        </div>
        <div class="sim-result__narrative">
          <h4 class="sim-result__heading">Narrative</h4>
          <p>${escapeHtml(s.narrative || "")}</p>
        </div>
        <div class="sim-result__impacts">
          <h4 class="sim-result__heading">Market impacts</h4>
          <div class="tag-list sim-result__tags">
            ${(s.impacts || []).map((i) => `<span class="tag tag--sim">${escapeHtml(i)}</span>`).join("")}
          </div>
        </div>
      </div>
    `;
  }).join("");
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
  const latest = getLatestState();
  const idx = (latest?.themes || []).indexOf(theme);
  const score = idx >= 0 ? Number(latest?.criticality?.[idx] || 0) : 0;
  const { detail, articleCount } = computeThemeStats(theme);
  const inv = (latest?.investigations || []).find((i) => i.theme === theme);
  const risk = (latest?.risk_analyses || []).find((r) => r.macro_theme === theme);
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
  const latest = getLatestState();
  const themes = latest?.themes || [];
  const criticality = latest?.criticality || [];
  const details = latest?.theme_details || [];
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
  const investigations = getLatestState()?.investigations || [];
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
  const risks = getLatestState()?.risk_analyses || [];
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
      if (button.dataset.view === "news") {
        renderNewsFeed();
        refreshState().then(() => renderNewsFeed()).catch(() => {});
      }
      if (button.dataset.view === "themes") {
        const latest = getLatestState();
        if (latest?.themes?.length && !state.selectedTheme) state.selectedTheme = latest.themes[0];
        renderThemeSelector();
        renderThemeDetail();
      }
      if (button.dataset.view === "simulation") renderSampleSimulationResults();
    });
  });
}

function initHeroParticles() {
  const canvas = document.getElementById("heroParticles");
  const hero = document.getElementById("hero");
  if (!canvas || !hero) return;
  const ctx = canvas.getContext("2d");
  let particles = [];
  const particleCount = 100;
  const accentRgb = "0, 212, 170";

  function resize() {
    const w = hero.offsetWidth;
    const h = hero.offsetHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    particles = [];
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 1.5 + 0.4,
        opacity: Math.random() * 0.4 + 0.15,
      });
    }
  }

  function draw() {
    if (hero.classList.contains("hero--hidden")) {
      requestAnimationFrame(draw);
      return;
    }
    const w = hero.offsetWidth;
    const h = hero.offsetHeight;
    ctx.clearRect(0, 0, w, h);
    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${accentRgb}, ${p.opacity})`;
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener("resize", resize);
  draw();
}

async function init() {
  initHeroParticles();
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
  const presetSelect = document.getElementById("scenarioPreset");
  if (presetSelect) presetSelect.addEventListener("change", function () {
    const v = this.value;
    if (v) applyPreset(v);
  });
  const suggestBtn = document.getElementById("suggestScenarioBtn");
  if (suggestBtn) suggestBtn.addEventListener("click", suggestScenarioFromThemes);

  const emptyRunBtn = document.getElementById("emptyStateRunBtn");
  if (emptyRunBtn) emptyRunBtn.addEventListener("click", runPipeline);

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

  try {
    await Promise.all([refreshState(), refreshHistory()]);
    renderAll();
    renderSampleSimulationResults();
  } catch (error) {
    setError(error.message);
  }
}

init();
