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

// Hard-coded all-time high for this collection.
const ALL_TIME_HIGH = {
  amount: 250000.0,
  symbol: "GUN",
  name: "APE-FOOL'S GOLD MASK",
  timestamp: 1764263173,
  thumbUrl:
    "https://i2c.seadn.io/gunzilla/0x9ed98e159be43a8d42b64053831fcae5e4d7d271/632fcd41d3343ffee3bc0d14057449/77632fcd41d3343ffee3bc0d14057449.png?w=1000"
};

// Cache rarity per NFT to avoid refetching metadata
const rarityCache = new Map();

// GUN metrics state
let gunMetrics = {
  priceUsd: null,
  marketCapUsd: null,
  vol1dUsd: null,
  marketCap1dUsd: null,
  marketCap7dUsd: null,
  change4hPct: null, // 24H change
  sparkline7d: null
};

// Live 5-minute sparkline state (session-local)
const LIVE_SPARK_MAX_POINTS = 24; // last ~2h at 5-min interval
let liveSpark = [];
let lastMetricsUpdateMs = 0;

// Cache last rendered price string so we can animate price flips only on change.
let lastPriceStr = null;

// Track SALE animation window (per event)
const SALE_ANIMATION_MS = 5000; // 5 seconds
const saleAnimationState = new Map(); // eventKey -> endTimeMs

// ==== CORE BOOTSTRAP ====

async function initOverlay() {
  // GUN price + sparklines
  await fetchGunMetrics();
  setInterval(fetchGunMetrics, 300000); // 5 min

  // Marketplace events
  await fetchEvents();
  setInterval(fetchEvents, POLL_INTERVAL_MS);
}

// ==== MARKETPLACE (OPENSEA) ====

async function fetchEvents() {
  const errorEl = document.getElementById("error");
  if (errorEl) errorEl.textContent = "";

  try {
    const params = new URLSearchParams({
      collection: COLLECTION_SLUG,
      limit: String(MAX_ITEMS)
    });

    const res = await fetch(`${API_PATH}?${params.toString()}`, {
      headers: { Accept: "application/json" }
    });

    if (!res.ok) {
      console.error("Proxy error HTTP", res.status);
      if (errorEl) errorEl.textContent = "Error loading sales feed";
      return;
    }

    const data = await res.json();

    const events = Array.isArray(data.asset_events)
      ? data.asset_events
      : Array.isArray(data.events)
      ? data.events
      : [];

    console.log("Proxy events:", events);
    await renderEvents(events);
  } catch (err) {
    console.error("Error fetching via proxy:", err);
    if (errorEl) errorEl.textContent = "Error loading sales feed";
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
  const cutoff24h = nowSec - DAY_SECONDS;

  const events24h = (events || []).filter((ev) => {
    const tsRaw =
      ev.event_timestamp || ev.closing_date || ev.created_date || ev.occurred_at;
    const ts = toUnixSeconds(tsRaw);
    return typeof ts === "number" && ts >= cutoff24h;
  });

  const sessionHighEvent = getMaxEventByPrice(events24h);

  // Top row: session high 24H + all-time high
  if (sessionHighEvent || ALL_TIME_HIGH) {
    highEl.style.display = "flex";
    highEl.innerHTML = `
      ${renderSessionHighCard(sessionHighEvent)}
      ${renderAllTimeHighCard(ALL_TIME_HIGH)}
    `;
  } else {
    highEl.textContent = "";
    highEl.style.display = "none";
  }

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

    const nft = ev?.nft || ev?.asset || {};
    const name = nft.name || `#${nft.identifier || "?"}`;

    const rarityInfo = await getRarityForEvent(ev);
    const rarityClass = rarityInfo ? rarityInfo.className : "other";

    const paymentInfo = getPaymentInfo(ev);
    const priceStr = paymentInfo.str;

    const tsRaw =
      ev.event_timestamp || ev.closing_date || ev.created_date || ev.occurred_at;
    const ts = toUnixSeconds(tsRaw);
    const dateStr = ts ? formatDateUnixSeconds(ts) : "";
    const timeStr = ts ? formatUnixSeconds(ts) : "";

    const sellerStr = formatAddress(ev.seller);
    const buyerStr = formatAddress(ev.buyer);
    const directionStr =
      sellerStr && buyerStr ? `${sellerStr} → ${buyerStr}` : "";

    const thumbUrl = nft.display_image_url || nft.image_url || "";
    const thumbHtml = thumbUrl
      ? `<img class="thumb" src="${sanitize(thumbUrl)}" alt="${sanitize(
          name
        )}" />`
      : `<div class="thumb thumb-placeholder"></div>`;

    // SALE animation window handling
    const eventKey = getEventKey(ev);
    let endTime = saleAnimationState.get(eventKey);
    if (!endTime) {
      endTime = nowMs + SALE_ANIMATION_MS;
      saleAnimationState.set(eventKey, endTime);
    }
    const stillAnimating = nowMs < endTime;

    const saleLabelClass = `sale-label${
      stillAnimating ? " sale-animating" : ""
    }`;

    const priceClassBase = "sale-price";
    const priceClass = stillAnimating
      ? `${priceClassBase} sale-price-animating`
      : `${priceClassBase} sale-price-final`;

    const initialPriceText =
      stillAnimating && priceStr ? "…" : priceStr || "";

    li.className = `rarity-${sanitize(rarityClass)}`;

    li.innerHTML = `
      <div class="event-card">
        <div class="thumb-wrapper">
          ${thumbHtml}
        </div>
        <div class="event-main">
          <!-- Line 1: item name (+ optional rarity pill) -->
          <div class="event-header">
            <span class="item-name">${sanitize(name)}</span>
            ${
              rarityInfo
                ? `<span class="rarity-pill rarity-${sanitize(
                    rarityClass
                  )}">${sanitize(rarityInfo.label)}</span>`
                : ""
            }
          </div>

          <!-- Line 2: SALE + price (animated) -->
          <div class="sale-line">
            <span class="${saleLabelClass}">sale</span>
            <span class="${priceClass}">
              ${sanitize(initialPriceText)}
            </span>
          </div>

          <!-- Line 3: date + time -->
          <div class="datetime-line">
            ${
              dateStr
                ? sanitize(dateStr)
                : ""
            }${
      timeStr ? (dateStr ? " • " : "") + sanitize(timeStr) : ""
    }
          </div>

          <!-- Line 4: direction -->
          ${
            directionStr
              ? `<div class="direction-line">${sanitize(directionStr)}</div>`
              : ""
          }
        </div>
      </div>
    `;

    ul.appendChild(li);

    // Kick off price "calculating" animation for new/active events
    if (stillAnimating && priceStr) {
      const priceSpan = li.querySelector(".sale-price");
      if (priceSpan) {
        const remainingMs = endTime - nowMs;
        animateSalePrice(priceSpan, priceStr, remainingMs);
      }
    }
  }
}

// ==== HIGH CARDS ====

function renderSessionHighCard(ev) {
  if (!ev) {
    return `
      <div class="high-card">
        <div class="high-thumb-wrapper"></div>
        <div class="high-sale-text">
          <div class="high-label">SESSION HIGH 24H</div>
          <div class="high-value">—</div>
        </div>
      </div>
    `;
  }

  const nft = ev.nft || ev.asset || {};
  const name = nft.name || `#${nft.identifier || "?"}`;
  const priceInfo = getPaymentInfo(ev);
  const priceStr = priceInfo.str;

  const thumbUrl = nft.display_image_url || nft.image_url || "";

  return `
    <div class="high-card">
      <div class="high-thumb-wrapper">
        ${
          thumbUrl
            ? `<img class="high-thumb" src="${sanitize(thumbUrl)}" alt="" />`
            : ""
        }
      </div>
      <div class="high-sale-text">
        <div class="high-label">SESSION HIGH 24H</div>
        <div class="high-value">${sanitize(name)}</div>
        <div class="high-value">${priceStr ? sanitize(priceStr) : ""}</div>
      </div>
    </div>
  `;
}

function renderAllTimeHighCard(config) {
  if (!config || config.amount == null || !config.symbol || !config.name) {
    return `
      <div class="high-card">
        <div class="high-thumb-wrapper"></div>
        <div class="high-sale-text">
          <div class="high-label">ALL-TIME HIGH</div>
          <div class="high-value">—</div>
        </div>
      </div>
    `;
  }

  const priceStr = `${config.amount.toFixed(2)} ${config.symbol}`;
  const thumbUrl = config.thumbUrl || "";

  return `
    <div class="high-card">
      <div class="high-thumb-wrapper">
        ${
          thumbUrl
            ? `<img class="high-thumb" src="${sanitize(thumbUrl)}" alt="" />`
            : ""
        }
      </div>
      <div class="high-sale-text">
        <div class="high-label">ALL-TIME HIGH</div>
        <div class="high-value">${sanitize(config.name)}</div>
        <div class="high-value">${sanitize(priceStr)}</div>
      </div>
    </div>
  `;
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

    // Update live 5-minute sparkline series
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

  const priceStr =
    priceUsd != null
      ? priceUsd < 1
        ? `$${priceUsd.toFixed(4)}`
        : `$${priceUsd.toFixed(3)}`
      : "—";

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

  // Flip-clock style animation: only when price actually changes
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

  // ---- Build 24H series once so both charts can reuse it ----
  let series24h = [];
  if (Array.isArray(sparkline7d) && sparkline7d.length >= 2) {
    const len = sparkline7d.length;
    const windowSize = Math.max(2, Math.floor(len / 7)); // ≈ last 24h
    series24h = sparkline7d.slice(len - windowSize);
  }

  // ---- Live 5-minute sparkline (left) with fallback to 24H ----
  if (liveEl) {
    const now = Date.now();
    const isFresh = now - lastMetricsUpdateMs < 5000; // blink end for 5s

    if (liveSpark.length >= 2) {
      // Use true live series once we have enough points
      liveEl.innerHTML = renderSparkline(liveSpark, trendClass, {
        showEndDot: isFresh
      });
    } else if (series24h.length >= 2) {
      // Before we have 2 live points, fall back to 24H view
      liveEl.innerHTML = renderSparkline(series24h, trendClass, {
        showEndDot: false
      });
    } else {
      liveEl.innerHTML = "";
    }
  }

  // ---- 24H sparkline (right) ----
  if (spark24El) {
    if (series24h.length >= 2) {
      spark24El.innerHTML = renderSparkline(series24h, trendClass, {
        showEndDot: false
      });
    } else {
      spark24El.innerHTML = "";
    }
  } else if (
    sparkContainer &&
    !document.getElementById("gun-sparkline-live")
  ) {
    // Fallback: single sparkline container – render 24H view only
    if (series24h.length >= 2) {
      sparkContainer.innerHTML = renderSparkline(series24h, trendClass, {
        showEndDot: false
      });
    } else {
      sparkContainer.innerHTML = "";
    }
  }
}

function renderSparkline(values, trendClass, opts = {}) {
  const width = 140;
  const height = 32;
  const margin = 2;
  const showEndDot = opts.showEndDot === true;

  const filtered = values.filter(
    (v) => typeof v === "number" && !Number.isNaN(v)
  );
  if (filtered.length < 2) return "";

  const min = Math.min(...filtered);
  const max = Math.max(...filtered);
  const range = max - min || 1;

  const stepX = (width - margin * 2) / (filtered.length - 1);
  const innerHeight = height - margin * 2;

  let d = "";
  let lastX = null;
  let lastY = null;

  filtered.forEach((v, i) => {
    const x = margin + i * stepX;
    const norm = (v - min) / range;
    const y = height - margin - norm * innerHeight;
    d += (i === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2) + " ";
    if (i === filtered.length - 1) {
      lastX = x;
      lastY = y;
    }
  });

  const cls = trendClass ? `sparkline-path ${trendClass}` : "sparkline-path";

  const endDot =
    showEndDot && lastX != null && lastY != null
      ? `<circle class="sparkline-end-dot" cx="${lastX.toFixed(
          2
        )}" cy="${lastY.toFixed(2)}" r="1.8" />`
      : "";

  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <path class="${cls}" d="${d.trim()}" pathLength="100" />
      ${endDot}
    </svg>
  `;
}

// ==== SALE KEY + PRICE ANIMATION HELPERS ====

function getEventKey(ev) {
  const nft = ev?.nft || ev?.asset || {};
  const id =
    ev.id ||
    ev.event_id ||
    ev.order_hash ||
    ev.transaction_hash ||
    ev.tx_hash ||
    "";
  const contract =
    nft.contract ||
    nft.contract_address ||
    nft.asset_contract_address ||
    "";
  const tokenId = nft.identifier || nft.token_id || "";
  const ts =
    ev.event_timestamp ||
    ev.closing_date ||
    ev.created_date ||
    ev.occurred_at ||
    "";
  return [id, contract, tokenId, ts].filter(Boolean).join("|");
}

// Animate the sale price so it looks like it's "calculating" before settling
function animateSalePrice(span, finalStr, maxMs) {
  if (!span || !finalStr) return;

  const match = finalStr.match(/([\d.,]+)/);
  const baseNum = match ? parseFloat(match[1].replace(/,/g, "")) : null;
  const decimals = match && match[1].includes(".")
    ? match[1].split(".")[1].length
    : 2;

  // Animate for up to 5s, or the remaining animation window if shorter
  const duration = Math.min(maxMs || 5000, 5000);
  const start = performance.now();

  function frame(now) {
    if (!span.isConnected) return;

    const t = (now - start) / duration;
    if (t >= 1 || baseNum == null) {
      span.textContent = finalStr;
      span.classList.remove("sale-price-animating");
      span.classList.add("sale-price-final");
      return;
    }

    // Generate a jittered interim price
    const jitter = baseNum * (0.6 + Math.random() * 0.8);
    const interim = jitter.toFixed(decimals);
    if (match) {
      span.textContent = finalStr.replace(match[1], interim);
    } else {
      span.textContent = finalStr;
    }

    requestAnimationFrame(frame);
  }

  span.classList.add("sale-price-animating");
  span.classList.remove("sale-price-final");
  span.textContent = "…";
  requestAnimationFrame(frame);
}

// ==== PAYMENT / RARITY / FORMATTING HELPERS ====

function getPaymentInfo(ev) {
  const payment = ev?.payment || {};
  const quantityRaw = payment.quantity;
  const decimals = Number(payment.decimals ?? 18);
  const symbol = payment.symbol || "";

  if (!quantityRaw) return { amount: null, str: "" };

  const qtyNum = Number(quantityRaw) / Math.pow(10, decimals);
  if (Number.isNaN(qtyNum)) return { amount: null, str: "" };

  return {
    amount: qtyNum,
    str: `${qtyNum.toFixed(2)} ${symbol}`.trim()
  };
}

function getMaxEventByPrice(events) {
  let best = null;
  let bestAmount = -Infinity;
  for (const ev of events || []) {
    const { amount } = getPaymentInfo(ev);
    if (amount != null && amount > bestAmount) {
      bestAmount = amount;
      best = ev;
    }
  }
  return best;
}

async function getRarityForEvent(ev) {
  const nft = ev?.nft || ev?.asset;
  if (!nft) return null;

  const key =
    nft.metadata_url ||
    (nft.collection && nft.identifier
      ? `${nft.collection}:${nft.identifier}`
      : null);

  if (!key) return null;
  if (rarityCache.has(key)) return rarityCache.get(key);
  if (!nft.metadata_url) {
    rarityCache.set(key, null);
    return null;
  }

  try {
    const res = await fetch(nft.metadata_url, {
      headers: { Accept: "application/json" }
    });

    if (!res.ok) throw new Error(`metadata HTTP ${res.status}`);

    const json = await res.json();
    const attrsSource =
      json.attributes ||
      json.traits ||
      (json.properties && json.properties.attributes) ||
      [];
    const attrs = Array.isArray(attrsSource) ? attrsSource : [];

    if (!attrs.length) {
      rarityCache.set(key, null);
      return null;
    }

    const rarityAttr = attrs.find((attr) => {
      const traitKey = (
        attr.trait_type ||
        attr.type ||
        attr.name ||
        ""
      )
        .toString()
        .toLowerCase();

      return (
        traitKey.includes("rarity") ||
        traitKey.includes("tier") ||
        traitKey.includes("grade") ||
        traitKey.includes("quality")
      );
    });

    if (!rarityAttr) {
      rarityCache.set(key, null);
      return null;
    }

    const raw = String(
      rarityAttr.value ?? rarityAttr.trait_type ?? rarityAttr.name ?? ""
    ).trim();
    if (!raw) {
      rarityCache.set(key, null);
      return null;
    }

    const lower = raw.toLowerCase();
    let className = "other";

    if (lower.includes("common") && !lower.includes("uncommon"))
      className = "common";
    else if (lower.includes("uncommon")) className = "uncommon";
    else if (lower.includes("epic")) className = "epic";
    else if (lower.includes("rare")) className = "rare";

    const result = { label: raw, className };
    rarityCache.set(key, result);
    return result;
  } catch (err) {
    console.error("Error fetching metadata for rarity", err);
    rarityCache.set(key, null);
    return null;
  }
}

function formatAddress(addr) {
  if (!addr || typeof addr !== "string") return "";
  const clean = addr.toLowerCase();
  const last4 = clean.slice(-4);
  return `…${last4}`;
}

function toUnixSeconds(value) {
  if (value == null) return null;
  if (typeof value === "number") return value;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

function formatUnixSeconds(sec) {
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDateUnixSeconds(sec) {
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return "";

  const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
  const month = d.toLocaleDateString(undefined, { month: "long" });
  const day = d.getDate();
  const suffix = getOrdinalSuffix(day);

  return `${weekday}, ${month} ${day}${suffix}`;
}

function getOrdinalSuffix(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
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

// ==== START ====
initOverlay();
