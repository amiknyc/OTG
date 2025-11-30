// ==== CONFIG (GUN METRICS ONLY) ====

const GUN_METRICS_URL = "/api/coingecko-gun-metrics.js";
const LIVE_SPARK_MAX_POINTS = 24; // last ~2h at 5-min interval

// GUN metrics state
let gunMetrics = nullMetrics();
let liveSpark = [];
let lastMetricsUpdateMs = 0;
let lastPriceStr = null;

// ==== BOOTSTRAP ====

async function initGunPriceOverlay() {
  await fetchGunMetrics();
  // Refresh every 5 minutes
  setInterval(fetchGunMetrics, 300000);
}

// ==== GUN METRICS (COINGECKO) ====

async function fetchGunMetrics() {
  try {
    const res = await fetch(GUN_METRICS_URL, {
      headers: { Accept: "application/json" }
    });

    if (!res.ok) {
      console.error("gun-metrics error HTTP", res.status);
      gunMetrics = nullMetrics();
      renderGunMetrics();
      return;
    }

    const data = await res.json();
    console.log("gun-metrics data", data);

    gunMetrics = {
      priceUsd: data.priceUsd ?? null,
      marketCapUsd: data.marketCapUsd ?? null,
      vol1dUsd: data.vol1dUsd ?? null,
      marketCap1dUsd: data.marketCap1dUsd ?? null,
      marketCap7dUsd: data.marketCap7dUsd ?? null,
      change4hPct: data.change4hPct ?? null,
      sparkline7d: Array.isArray(data.sparkline7d) ? data.sparkline7d : null
    };

    const priceForSpark = gunMetrics.priceUsd;
    if (priceForSpark != null && !Number.isNaN(priceForSpark)) {
      liveSpark.push(Number(priceForSpark));
      if (liveSpark.length > LIVE_SPARK_MAX_POINTS) {
        liveSpark = liveSpark.slice(-LIVE_SPARK_MAX_POINTS);
      }
    }
    lastMetricsUpdateMs = Date.now();

    renderGunMetrics();
  } catch (err) {
    console.error("Error fetching gun-metrics", err);
    gunMetrics = nullMetrics();
    renderGunMetrics();
  }
}

function nullMetrics() {
  return {
    priceUsd: null,
    marketCapUsd: null,
    vol1dUsd: null,
    marketCap1dUsd: null,
    marketCap7dUsd: null,
    change4hPct: null,
    sparkline7d: null
  };
}

function renderGunMetrics() {
  const priceEl = document.getElementById("gun-price");
  const sparkContainer = document.getElementById("gun-sparkline");
  const liveEl =
    document.getElementById("gun-sparkline-live") || sparkContainer;
  const spark24El = document.getElementById("gun-sparkline-24h");
  if (!priceEl) return;

  const { priceUsd, marketCapUsd, vol1dUsd, change4hPct, sparkline7d } =
    gunMetrics;

  const priceStr = formatGunPrice(priceUsd);
  const capStr = formatUsdShort(marketCapUsd);
  const volStr = formatUsdShort(vol1dUsd);
  const changeStr = formatPct(change4hPct);

  const changeClass =
    change4hPct == null
      ? "gun-change"
      : change4hPct > 0
      ? "gun-change positive"
      : change4hPct < 0
      ? "gun-change negative"
      : "gun-change";

  const trendClass =
    change4hPct == null
      ? ""
      : change4hPct > 0
      ? "positive"
      : change4hPct < 0
      ? "negative"
      : "";

  const shouldFlip = lastPriceStr !== null && priceStr !== lastPriceStr;
  lastPriceStr = priceStr;

  const priceSpanClass = `gun-price${shouldFlip ? " flip-animate" : ""}`;

  priceEl.innerHTML = `
    <div class="gun-metrics">
      <div class="gun-metric-main">
        <span class="gun-label">GUN</span>
        <span class="${priceSpanClass}">
          ${sanitize(priceStr)}
        </span>
        <span class="${changeClass}">${sanitize(changeStr)} (24H)</span>
      </div>
      <div class="gun-metric-grid">
        <div class="metric">
          <span class="metric-label">Mkt Cap</span>
          <span class="metric-value">${sanitize(capStr)}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Vol 24H</span>
          <span class="metric-value">${sanitize(volStr)}</span>
        </div>
      </div>
    </div>
  `;

  // Build 24H window from 7d sparkline (last ≈1/7th of data)
  let series24h = [];
  let series24hPct = [];
  let delta24hPct = null;
  let high24h = null;
  let low24h = null;

  if (Array.isArray(sparkline7d) && sparkline7d.length >= 2) {
    const len = sparkline7d.length;
    const windowSize = Math.max(2, Math.floor(len / 7));
    const sliced = sparkline7d.slice(len - windowSize);
    series24h = sliced.filter(
      (v) => typeof v === "number" && !Number.isNaN(v)
    );

    if (series24h.length >= 2) {
      const open = series24h[0];
      const close = series24h[series24h.length - 1];

      if (open && !Number.isNaN(open) && open !== 0) {
        delta24hPct = ((close / open) - 1) * 100;
      }

      high24h = Math.max(...series24h);
      low24h = Math.min(...series24h);

      if (open && !Number.isNaN(open) && open !== 0) {
        series24hPct = series24h.map((v) => ((v / open) - 1) * 100);
      }
    }
  }

  // 1H change using last ~12 live points
  let delta1hPct = null;
  const ONE_H_POINTS = 12;

  if (liveSpark.length >= 2) {
    const slice1h =
      liveSpark.length > ONE_H_POINTS
        ? liveSpark.slice(liveSpark.length - ONE_H_POINTS)
        : liveSpark.slice();

    const first = slice1h[0];
    const last = slice1h[slice1h.length - 1];

    if (
      typeof first === "number" &&
      typeof last === "number" &&
      !Number.isNaN(first) &&
      !Number.isNaN(last) &&
      first !== 0
    ) {
      delta1hPct = ((last / first) - 1) * 100;
    }
  }

  const delta1hStr =
    delta1hPct == null ? "Δ1H: —" : `Δ1H: ${formatPct(delta1hPct)}`;
  const delta24hStatStr =
    delta24hPct == null ? "Δ24H: —" : `Δ24H: ${formatPct(delta24hPct)}`;

  const highStr = high24h == null ? "—" : formatGunPrice(high24h);
  const lowStr = low24h == null ? "—" : formatGunPrice(low24h);

  const stat24hLines = [delta24hStatStr];
  if (highStr !== "—") stat24hLines.push(`High: ${highStr}`);
  if (lowStr !== "—") stat24hLines.push(`Low: ${lowStr}`);

  const stat24hHtml = stat24hLines
    .map((line) => `<div class="sparkline-stat-line">${line}</div>`)
    .join("");

  // Live sparkline
  if (liveEl) {
    const now = Date.now();
    const isFresh = now - lastMetricsUpdateMs < 5000;

    if (liveSpark.length >= 2) {
      liveEl.innerHTML = renderSparkline(liveSpark, trendClass, {
        showEndDot: isFresh
      });
    } else {
      liveEl.innerHTML = "";
    }
  }

  // 24H sparkline (normalized %)
  if (spark24El) {
    if (series24hPct.length >= 2) {
      spark24El.innerHTML = renderSparkline(series24hPct, trendClass, {
        showEndDot: false,
        asArea: true,
        showZeroLine: true,
        isPercent: true
      });
    } else {
      spark24El.innerHTML = "";
    }
  } else if (
    sparkContainer &&
    !document.getElementById("gun-sparkline-live")
  ) {
    if (series24hPct.length >= 2) {
      sparkContainer.innerHTML = renderSparkline(series24hPct, trendClass, {
        showEndDot: false,
        asArea: true,
        showZeroLine: true,
        isPercent: true
      });
    } else {
      sparkContainer.innerHTML = "";
    }
  }

  if (liveEl && liveEl.parentElement) {
    let liveStatEl = document.getElementById("gun-sparkline-live-stat");
    if (!liveStatEl) {
      liveStatEl = document.createElement("div");
      liveStatEl.id = "gun-sparkline-live-stat";
      liveStatEl.className = "sparkline-stat";
      liveEl.parentElement.appendChild(liveStatEl);
    }
    liveStatEl.textContent = delta1hStr;
  }

  if (spark24El && spark24El.parentElement) {
    let stat24El = document.getElementById("gun-sparkline-24h-stat");
    if (!stat24El) {
      stat24El = document.createElement("div");
      stat24El.id = "gun-sparkline-24h-stat";
      stat24El.className = "sparkline-stat";
      spark24El.parentElement.appendChild(stat24El);
    }
    stat24El.innerHTML = stat24hHtml;
  }
}

function renderSparkline(values, trendClass, opts = {}) {
  const width = opts.width || 140;
  const height = opts.height || 32;
  const marginX = opts.marginX ?? 2;
  const marginY = opts.marginY ?? 2;
  const showEndDot = opts.showEndDot === true;
  const asArea = opts.asArea === true;
  const showZeroLine = opts.showZeroLine === true;

  const filtered = values.filter(
    (v) => typeof v === "number" && !Number.isNaN(v)
  );
  if (filtered.length < 2) return "";

  const min = Math.min(...filtered);
  const max = Math.max(...filtered);
  const range = max - min || 1;

  const stepX = (width - marginX * 2) / (filtered.length - 1);
  const innerHeight = height - marginY * 2;

  const points = [];
  filtered.forEach((v, i) => {
    const x = marginX + i * stepX;
    const norm = (v - min) / range;
    const y = height - marginY - norm * innerHeight;
    points.push({ x, y });
  });

  let d = "";
  points.forEach((pt, i) => {
    d += (i === 0 ? "M" : "L") + pt.x.toFixed(2) + " " + pt.y.toFixed(2) + " ";
  });

  const first = points[0];
  const last = points[points.length - 1];

  let dArea = "";
  if (asArea && first && last) {
    const bottomY = (height - marginY).toFixed(2);
    dArea = `M ${first.x.toFixed(2)} ${bottomY} `;
    points.forEach((pt) => {
      dArea += `L ${pt.x.toFixed(2)} ${pt.y.toFixed(2)} `;
    });
    dArea += `L ${last.x.toFixed(2)} ${bottomY} Z`;
  }

  const baseLineClass =
    trendClass ? `sparkline-path ${trendClass}` : "sparkline-path";
  const areaClass =
    trendClass ? `sparkline-area ${trendClass}` : "sparkline-area";

  const endDot =
    showEndDot && last
      ? `<circle class="sparkline-end-dot" cx="${last.x.toFixed(
          2
        )}" cy="${last.y.toFixed(2)}" r="1.8" />`
      : "";

  let zeroLineSvg = "";
  if (showZeroLine) {
    const zeroNorm = (0 - min) / range;
    let yZero = height - marginY - zeroNorm * innerHeight;
    if (yZero < marginY) yZero = marginY;
    if (yZero > height - marginY) yZero = height - marginY;

    zeroLineSvg = `<line class="sparkline-zero-line"
      x1="${marginX.toFixed(2)}"
      y1="${yZero.toFixed(2)}"
      x2="${(width - marginX).toFixed(2)}"
      y2="${yZero.toFixed(2)}"
    />`;
  }

  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      ${
        asArea && dArea
          ? `<path class="${areaClass}" d="${dArea.trim()}" />`
          : ""
      }
      <path class="${baseLineClass}" d="${d.trim()}" pathLength="100" />
      ${zeroLineSvg}
      ${endDot}
    </svg>
  `;
}

// ==== Formatting helpers ====

function formatGunPrice(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`;
}

function formatUsdShort(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function formatPct(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function sanitize(str) {
  if (!str && str !== 0) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ==== START GUN MODULE ====
initGunPriceOverlay();
