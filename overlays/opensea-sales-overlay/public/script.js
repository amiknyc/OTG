// ==== CONFIG ====

// OpenSea collection slug
const COLLECTION_SLUG = "off-the-grid";

// Polling / display
const POLL_INTERVAL_MS = 15000; // 15 seconds
const MAX_ITEMS = 10;

// Backend routes
const API_PATH = "/api/opensea-sales.js";
const GUN_METRICS_URL = "/api/coingecko-gun-metrics.js";

// Time constants for sales
const DAY_SECONDS = 24 * 60 * 60;

// Hard-coded all-time high for this collection.
const ALL_TIME_HIGH = {
  amount: 250000.00,
  symbol: "GUN",
  name: "APE-FOOL'S GOLD MASK",
  timestamp: 1764263173,
  const ALL_TIME_HIGH = {
  amount: 14444.0,
  symbol: "GUN",
  name: "Hitori Yubi Mask",
  timestamp: 1764263173,
  thumbUrl: "https://i2c.seadn.io/gunzilla/0x9ed98e159be43a8d42b64053831fcae5e4d7d271/632fcd41d3343ffee3bc0d14057449/77632fcd41d3343ffee3bc0d14057449.png?w=1000"
};

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
  change4hPct: null,   // we use this as 24H change
  sparkline7d: null
};

// ==== CORE BOOTSTRAP ====

async function initOverlay() {
  fetchGunMetrics();
  setInterval(fetchGunMetrics, 300000); // 5 min

  fetchEvents();
  setInterval(fetchEvents, POLL_INTERVAL_MS);
}

// ==== EVENTS (SALES) ====

async function fetchEvents() {
  const errorEl = document.getElementById("error");
  if (errorEl) errorEl.textContent = "";

  const url = `${API_PATH}?collection=${encodeURIComponent(
    COLLECTION_SLUG
  )}&limit=${MAX_ITEMS}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const events = data.asset_events || data.events || [];

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

  const slice = events.slice(0, MAX_ITEMS);

  // 24H session high
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoff24h = nowSec - DAY_SECONDS;

  const events24h = events.filter((ev) => {
    const ts = ev.event_timestamp || ev.closing_date;
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

  // List
  if (!slice.length) {
    const li = document.createElement("li");
    li.innerHTML =
      '<span class="item-name">No recent sales</span><span class="datetime-line">Waiting for activity…</span>';
    ul.appendChild(li);
    return;
  }

  for (const ev of slice) {
    const li = document.createElement("li");

    const nft = ev?.nft || {};
    const name = nft.name || `#${nft.identifier || "?"}`;

    const rarityInfo = await getRarityForEvent(ev);
    const rarityClass = rarityInfo ? rarityInfo.className : "other";

    const paymentInfo = getPaymentInfo(ev);
    const priceStr = paymentInfo.str;

    const ts = ev.event_timestamp || ev.closing_date;
    const dateStr = ts ? formatDateUnixSeconds(ts) : "";
    const timeStr = ts ? formatUnixSeconds(ts) : "";

    const sellerStr = formatAddress(ev.seller);
    const buyerStr = formatAddress(ev.buyer);
    const directionStr =
      sellerStr && buyerStr ? `${sellerStr} → ${buyerStr}` : "";

    const thumbUrl =
      nft.display_image_url ||
      nft.image_url ||
      "";

    const type = ev.event_type || "sale";

    li.className = `rarity-${sanitize(rarityClass)}`;

    li.innerHTML = `
      <div class="item-row">
        <div class="thumb-wrapper">
          ${
            thumbUrl
              ? `<img class="thumb" src="${sanitize(thumbUrl)}" alt="" />`
              : ""
          }
        </div>
        <div class="item-content">
          <div class="item-header">
            <span class="item-name">${sanitize(name)}</span>
            ${
              rarityInfo
                ? `<span class="rarity-pill rarity-${sanitize(
                    rarityClass
                  )}">${sanitize(rarityInfo.label)}</span>`
                : ""
            }
          </div>
          <span class="meta-line">
            ${sanitize(type)}${
      priceStr ? " • " + sanitize(priceStr) : ""
    }
          </span>
          <span class="datetime-line">
            ${
              dateStr
                ? sanitize(dateStr)
                : ""
            }${
      timeStr ? (dateStr ? " • " : "") + sanitize(timeStr) : ""
    }
          </span>
          ${
            directionStr
              ? `<span class="direction-line">${sanitize(directionStr)}</span>`
              : ""
          }
        </div>
      </div>
    `;

    ul.appendChild(li);
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

  const nft = ev.nft || {};
  const name = nft.name || `#${nft.identifier || "?"}`;
  const priceInfo = getPaymentInfo(ev);
  const priceStr = priceInfo.str || "";
  const thumbUrl =
    nft.display_image_url ||
    nft.image_url ||
    "";

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
  const el = document.getElementById("gun-price");
  const sparkEl = document.getElementById("gun-sparkline");
  if (!el) return;

  const {
    priceUsd,
    marketCapUsd,
    vol1dUsd,
    change4hPct,
    sparkline7d
  } = gunMetrics;

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
      ? ""
      : change4hPct > 0
      ? "gun-change positive"
      : change4hPct < 0
      ? "gun-change negative"
      : "gun-change";

  el.innerHTML = `
    <div class="gun-metrics">
      <div class="gun-metric-main">
        <span class="gun-label">GUN</span>
        <span class="gun-price">${sanitize(priceStr)}</span>
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

  if (sparkEl) {
    if (sparkline7d && sparkline7d.length >= 2) {
      sparkEl.innerHTML = renderSparkline(sparkline7d);
    } else {
      sparkEl.innerHTML = "";
    }
  }
}

function renderSparkline(values) {
  const width = 140;
  const height = 32;
  const margin = 2;

  const filtered = values.filter((v) => typeof v === "number" && !Number.isNaN(v));
  if (filtered.length < 2) return "";

  const min = Math.min(...filtered);
  const max = Math.max(...filtered);
  const range = max - min || 1;

  const stepX = (width - margin * 2) / (filtered.length - 1);
  const innerHeight = height - margin * 2;

  let d = "";
  filtered.forEach((v, i) => {
    const x = margin + i * stepX;
    const norm = (v - min) / range;
    const y = height - margin - norm * innerHeight;
    d += (i === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2) + " ";
  });

  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <path class="sparkline-path" d="${d.trim()}" />
    </svg>
  `;
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
  for (const ev of events) {
    const info = getPaymentInfo(ev);
    if (info.amount != null && info.amount > bestAmount) {
      bestAmount = info.amount;
      best = ev;
    }
  }
  return best;
}

async function getRarityForEvent(ev) {
  const nft = ev?.nft;
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

    const meta = await res.json();
    const attrs = []
      .concat(meta.attributes || [])
      .concat(meta.traits || []);

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

    if (lower.includes("common") && !lower.includes("uncommon")) className = "common";
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
