// ==== CONFIG ====

// OpenSea collection slug
const COLLECTION_SLUG = "off-the-grid";

// Polling / display
const POLL_INTERVAL_MS = 60000; // 60 seconds for marketplace
const MAX_ITEMS = 10;

// Backend routes (proxied by your Vercel / API layer)
const API_PATH = "/api/opensea-sales.js";
const GUN_METRICS_URL = "/api/coingecko-gun-metrics.js";

// Time constants for sales
const DAY_SECONDS = 24 * 60 * 60;

// ==== OPENSEA FLUID MESH BACKGROUND ====
function initOpenSeaMesh() {
  const canvas = document.getElementById("opensea-mesh-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  let width = 0;
  let height = 0;
  let dpr = window.devicePixelRatio || 1;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener("resize", resize);
  resize();

  const COLS = 26; // grid resolution horizontally
  const ROWS = 26; // grid resolution vertically

  function point(ix, iy, t) {
    const gx = (ix / (COLS - 1)) * width;
    const gy = (iy / (ROWS - 1)) * height;

    // normalize around center [-1, 1]
    const u = (gx / width - 0.5) * 2;
    const v = (gy / height - 0.5) * 2;

    // multi-wave height field
    const wave1 = Math.sin(u * 3.0 + t * 1.3) + Math.cos(v * 3.0 - t * 1.1);
    const wave2 = Math.sin((u + v) * 4.0 - t * 0.8);
    const wave = (wave1 + wave2) * 0.5;

    const amp = Math.min(width, height) * 0.06; // displacement amplitude

    // displace along "height" gradient radially
    const r = Math.sqrt(u * u + v * v) || 1;
    const nx = u / r;
    const ny = v / r;

    const dx = nx * wave * amp;
    const dy = ny * wave * amp;

    return {
      x: gx + dx,
      y: gy + dy,
    };
  }

  function draw(timestamp) {
    if (!canvas.isConnected) return; // safety if overlay is removed

    const t = timestamp / 1000; // seconds
    ctx.clearRect(0, 0, width, height);

    // gradient stroke for some depth/color
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0.0, "rgba(56, 189, 248, 0.8)"); // cyan
    gradient.addColorStop(1.0, "rgba(236, 72, 153, 0.8)"); // fuchsia

    ctx.lineWidth = 1;
    ctx.strokeStyle = gradient;

    // draw horizontal lines
    for (let iy = 0; iy < ROWS; iy++) {
      ctx.beginPath();
      for (let ix = 0; ix < COLS; ix++) {
        const p = point(ix, iy, t);
        if (ix === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }

    // draw vertical lines
    for (let ix = 0; ix < COLS; ix++) {
      ctx.beginPath();
      for (let iy = 0; iy < ROWS; iy++) {
        const p = point(ix, iy, t);
        if (iy === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
}

// Hard-coded all-time high for this collection.
const ALL_TIME_HIGH = {
  amount: 250000.0,
  token_symbol: "GUN",
  name: "APE-FOOL'S GOLD MASK",
  image:
    "https://i.seadn.io/gae/HJEYeGP3JTOSU7XmCw6pN6Ko9ztCG_uG6mrtHLyIprRK8su2Tmeah7HKBWqYNmO4PNl5me5ItcwdfBKDmYQjoeeg5V1LJS_K_gankg?auto=format&dpr=1&w=1000",
};

// ==== UTILITIES ====

function formatShortAddress(addr) {
  if (!addr || typeof addr !== "string") return "";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function fromNowShort(timestampMs) {
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - timestampMs) / 1000));

  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function formatDateTime(tsMs) {
  const date = new Date(tsMs);
  const options = {
    weekday: "long",
    month: "long",
    day: "numeric",
  };
  const dateStr = date.toLocaleDateString(undefined, options);
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = ((hours + 11) % 12) + 1; // 0-23 to 1-12
  return `${dateStr} · ${hours}:${minutes} ${ampm}`;
}

function formatGunAmount(amount) {
  if (amount == null || Number.isNaN(amount)) return "—";
  const n = Number(amount);
  return `${n.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })} GUN`;
}

function formatUsdAmount(amount) {
  if (amount == null || Number.isNaN(amount)) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })}`;
}

// ==== OVERLAY INIT ====

async function initOverlay() {
  // Animated OpenSea mesh background
  initOpenSeaMesh();

  // GUN price + sparklines
  await fetchGunMetrics();
  setInterval(fetchGunMetrics, 300000); // 5 min

  // Marketplace events
  await fetchEvents();
  setInterval(fetchEvents, POLL_INTERVAL_MS);
}

// ==== MARKETPLACE (OPENSEA) ====

// Basic in-memory cache
let cachedEvents = [];
let lastFetchedAt = 0;
let isFetching = false;

async function fetchEvents() {
  if (isFetching) return;
  isFetching = true;

  const errorEl = document.getElementById("error");
  if (errorEl) errorEl.textContent = "";

  try {
    const url = `${API_PATH}?collectionSlug=${encodeURIComponent(
      COLLECTION_SLUG
    )}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    const events = data?.events || [];

    cachedEvents = events;
    lastFetchedAt = Date.now();

    renderEvents(events);
  } catch (err) {
    console.error("Error fetching events:", err);
    if (errorEl) errorEl.textContent = "Error loading sales feed";
  } finally {
    isFetching = false;
  }
}

async function renderEvents(events) {
  const ul = document.getElementById("events");
  const highEl = document.getElementById("high-sale");
  if (!ul || !highEl) return;

  ul.innerHTML = "";

  const slice = (events || []).slice(0, MAX_ITEMS);

  // 24H session high
  const nowSec = Math.floor(Date.now() / 1000);
  const dayAgo = nowSec - DAY_SECONDS;

  let sessionHigh = null;

  for (const ev of events || []) {
    if (!ev?.event_timestamp) continue;
    const evSec = Math.floor(new Date(ev.event_timestamp).getTime() / 1000);
    if (evSec >= dayAgo) {
      if (
        !sessionHigh ||
        Number(ev.payment_token?.usd_price || 0) >
          Number(sessionHigh.payment_token?.usd_price || 0)
      ) {
        sessionHigh = ev;
      }
    }
  }

  // Render 24H session high + all-time high
  highEl.innerHTML = renderHighCards(sessionHigh, ALL_TIME_HIGH);

  // Empty state
  if (!slice.length) {
    const li = document.createElement("li");
    li.innerHTML =
      '<div class="empty-state">No recent sales. Waiting for activity…</div>';
    ul.appendChild(li);
    return;
  }

  const nowMs = Date.now();

  for (const ev of slice) {
    const li = document.createElement("li");

    // Basic fields
    const itemName =
      ev?.asset?.name || ev?.asset_bundle?.name || "Unknown item";
    const imageUrl = ev?.asset?.image_url || ev?.asset_bundle?.asset?.image_url;

    const paymentToken = ev?.payment_token;
    const totalPriceStr = ev?.total_price;
    const decimals = paymentToken?.decimals ?? 18;

    let amountToken = null;
    if (totalPriceStr != null) {
      amountToken = Number(totalPriceStr) / 10 ** decimals;
    }

    const tokenSymbol = paymentToken?.symbol || "GUN";
    const usdPrice = paymentToken?.usd_price
      ? Number(paymentToken.usd_price) * amountToken
      : null;

    const seller = ev?.seller?.address || ev?.seller?.user?.username || null;
    const buyer = ev?.winner_account?.address || null;

    const createdDateStr = ev?.event_timestamp;
    const createdMs = createdDateStr
      ? new Date(createdDateStr).getTime()
      : null;

    const shortFromNow = createdMs ? fromNowShort(createdMs) : "recently";

    // Primary & secondary lines
    const priceStr =
      amountToken != null
        ? `${amountToken.toLocaleString(undefined, {
            maximumFractionDigits: 2,
          })} ${tokenSymbol}`
        : "—";

    const usdStr = usdPrice != null ? formatUsdAmount(usdPrice) : "—";

    const subtitleTime = createdMs ? formatDateTime(createdMs) : "";

    const walletStr =
      seller || buyer
        ? [seller ? `Seller: ${formatShortAddress(seller)}` : null,
          buyer ? `Buyer: ${formatShortAddress(buyer)}` : null]
            .filter(Boolean)
            .join(" · ")
        : "";

    li.innerHTML = `
      <div class="event-card">
        ${
          imageUrl
            ? `<div class="event-image">
                 <img src="${sanitize(imageUrl)}" alt="${sanitize(
                itemName
              )}" loading="lazy" />
               </div>`
            : ""
        }
        <div class="event-body">
          <div class="event-title-row">
            <span class="event-title">${sanitize(itemName)}</span>
            <span class="event-time-ago">${sanitize(shortFromNow)}</span>
          </div>
          <div class="event-price-line">
            <span class="event-price-token">Sale <span class="accent">${sanitize(
              priceStr
            )}</span></span>
            <span class="event-price-usd">${sanitize(usdStr)}</span>
          </div>
          ${
            subtitleTime
              ? `<div class="event-subtitle">${sanitize(
                  subtitleTime
                )}</div>`
              : ""
          }
          ${
            walletStr
              ? `<div class="event-wallets">${sanitize(walletStr)}</div>`
              : ""
          }
        </div>
      </div>
    `;

    ul.appendChild(li);
  }
}

function renderHighCards(sessionHigh, allTimeHigh) {
  const sessionAmount =
    sessionHigh && sessionHigh.payment_token && sessionHigh.total_price
      ? Number(sessionHigh.total_price) /
        10 ** (sessionHigh.payment_token.decimals ?? 18)
      : null;

  const sessionName =
    sessionHigh?.asset?.name ||
    sessionHigh?.asset_bundle?.name ||
    "No high sale yet";

  const sessionAmountStr =
    sessionAmount != null
      ? `${sessionAmount.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })} GUN`
      : "—";

  const sessionImage =
    sessionHigh?.asset?.image_url ||
    sessionHigh?.asset_bundle?.asset?.image_url ||
    "";

  const athAmountStr =
    allTimeHigh?.amount != null
      ? `${allTimeHigh.amount.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })} ${allTimeHigh.token_symbol || "GUN"}`
      : "—";

  const athName = allTimeHigh?.name || "All-Time High";
  const athImage = allTimeHigh?.image || "";

  return `
    <div class="high-cards">
      <div class="high-card">
        <div class="high-card-label">Session High 24H</div>
        ${
          sessionImage
            ? `<div class="high-card-image">
                 <img src="${sanitize(sessionImage)}" alt="${sanitize(
                sessionName
              )}" loading="lazy" />
               </div>`
            : ""
        }
        <div class="high-card-body">
          <div class="high-card-name">${sanitize(sessionName)}</div>
          <div class="high-card-amount">${sanitize(sessionAmountStr)}</div>
        </div>
      </div>
      <div class="high-card">
        <div class="high-card-label">All-Time High</div>
        ${
          athImage
            ? `<div class="high-card-image">
                 <img src="${sanitize(athImage)}" alt="${sanitize(
                athName
              )}" loading="lazy" />
               </div>`
            : ""
        }
        <div class="high-card-body">
          <div class="high-card-name">${sanitize(athName)}</div>
          <div class="high-card-amount">${sanitize(athAmountStr)}</div>
        </div>
      </div>
    </div>
  `;
}

// ==== GUN TOKEN METRICS + SPARKLINES ====

// In-memory cache for sparkline data
let gunPriceSeriesLive = [];
let gunPriceSeries24h = [];
let gunLastUpdatedAt = 0;

async function fetchGunMetrics() {
  try {
    const res = await fetch(GUN_METRICS_URL);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data) return;

    renderGunMetrics(data);
    updateSparklineData(data);
    renderSparklines();
  } catch (err) {
    console.error("Error fetching GUN metrics:", err);
  }
}

function renderGunMetrics(metrics) {
  const priceEl = document.getElementById("gun-price");
  if (!priceEl) return;

  const price = metrics?.market_data?.current_price?.usd ?? null;
  const marketCap = metrics?.market_data?.market_cap?.usd ?? null;
  const volume24h = metrics?.market_data?.total_volume?.usd ?? null;
  const change24h = metrics?.market_data?.price_change_percentage_24h ?? null;

  const priceStr =
    price != null
      ? `$${price.toLocaleString(undefined, {
          minimumFractionDigits: 4,
          maximumFractionDigits: 6,
        })}`
      : "—";

  const marketCapStr = marketCap != null ? formatDollarsShort(marketCap) : "—";
  const volumeStr = volume24h != null ? formatDollarsShort(volume24h) : "—";
  const changeStr = change24h != null ? `${change24h.toFixed(2)}%` : "—";

  const changeClass =
    change24h == null
      ? "metric-change neutral"
      : change24h > 0
      ? "metric-change positive"
      : change24h < 0
      ? "metric-change negative"
      : "metric-change neutral";

  const priceSpanClass =
    change24h == null
      ? "gun-price neutral"
      : change24h > 0
      ? "gun-price positive"
      : change24h < 0
      ? "gun-price negative"
      : "gun-price neutral";

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
          <span class="metric-value">${sanitize(marketCapStr)}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Vol 24H</span>
          <span class="metric-value">${sanitize(volumeStr)}</span>
        </div>
      </div>
    </div>
  `;
}

function updateSparklineData(metrics) {
  const now = Date.now();

  const liveSeries = metrics?.sparkline_in_5min?.map((p) => ({
    t: p[0],
    v: p[1],
  }));
  const series24h = metrics?.sparkline_24h?.map((p) => ({
    t: p[0],
    v: p[1],
  }));

  if (Array.isArray(liveSeries) && liveSeries.length > 0) {
    gunPriceSeriesLive = liveSeries;
  }
  if (Array.isArray(series24h) && series24h.length > 0) {
    gunPriceSeries24h = series24h;
  }

  gunLastUpdatedAt = now;
}

function renderSparklines() {
  const liveEl = document.getElementById("gun-sparkline-live");
  const h24El = document.getElementById("gun-sparkline-24h");
  const summaryEl = document.getElementById("gun-sparkline-summary");
  if (!liveEl || !h24El) return;

  const liveSeries = gunPriceSeriesLive || [];
  const series24h = gunPriceSeries24h || [];

  liveEl.innerHTML = "";
  h24El.innerHTML = "";

  const drawSpark = (
    container,
    series,
    options = { isArea: false, color: "#f472b6" }
  ) => {
    if (!series.length) return;

    const width = container.clientWidth || 140;
    const height = container.clientHeight || 48;
    const padding = 2;

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.classList.add("sparkline-svg");

    const values = series.map((p) => p.v);
    const min = Math.min(...values);
    const max = Math.max(...values);

    const span = max - min || 1;
    const innerWidth = width - padding * 2;
    const innerHeight = height - padding * 2;

    const lastIndex = series.length - 1;

    let d = "";
    series.forEach((p, idx) => {
      const x = padding + (innerWidth * idx) / lastIndex;
      const y = padding + innerHeight - ((p.v - min) / span) * innerHeight;
      d += idx === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });

    if (options.isArea) {
      const areaPath = document.createElementNS(svgNS, "path");
      let areaD = d;
      const firstY =
        padding +
        innerHeight -
        ((series[0].v - min) / span) * innerHeight;
      const lastX = padding + innerWidth;
      const lastY =
        padding +
        innerHeight -
        ((series[lastIndex].v - min) / span) * innerHeight;

      areaD += ` L ${lastX} ${padding + innerHeight}`;
      areaD += ` L ${padding} ${padding + innerHeight}`;
      areaD += " Z";

      areaPath.setAttribute("d", areaD);
      areaPath.setAttribute("fill", "rgba(236, 72, 153, 0.15)");
      areaPath.setAttribute("stroke", "none");
      svg.appendChild(areaPath);
    }

    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-width", options.isArea ? "1" : "1.4");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.classList.add(
      options.isArea ? "sparkline-path-24h" : "sparkline-path-live"
    );
    path.setAttribute("stroke", options.color);

    svg.appendChild(path);

    const last = series[lastIndex];
    const lastX = padding + innerWidth;
    const lastY =
      padding + innerHeight - ((last.v - min) / span) * innerHeight;

    const dot = document.createElementNS(svgNS, "circle");
    dot.setAttribute("cx", lastX);
    dot.setAttribute("cy", lastY);
    dot.setAttribute("r", "2.1");
    dot.classList.add("sparkline-dot");
    svg.appendChild(dot);

    container.appendChild(svg);
  };

  drawSpark(liveEl, liveSeries, {
    isArea: false,
    color: "#f472b6",
  });

  drawSpark(h24El, series24h, {
    isArea: true,
    color: "#22d3ee",
  });

  if (summaryEl && series24h.length) {
    const first = series24h[0].v;
    const last = series24h[series24h.length - 1].v;
    const changePct = ((last - first) / first) * 100;

    const labelEl = summaryEl.querySelector(".sparkline-summary-label");
    const valueEl = summaryEl.querySelector(".sparkline-summary-value");

    if (labelEl && valueEl) {
      const sign = changePct > 0 ? "+" : "";
      labelEl.textContent = "Δ24H";
      valueEl.textContent = `${sign}${changePct.toFixed(2)}%`;
      valueEl.className =
        "sparkline-summary-value " +
        (changePct > 0
          ? "positive"
          : changePct < 0
          ? "negative"
          : "neutral");
    }
  }
}

// Short dollar format like 17.1M, 4.5K, etc.
function formatDollarsShort(n) {
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

// ==== START ====
initOverlay();
