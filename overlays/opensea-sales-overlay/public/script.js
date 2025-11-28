// ==== CONFIG ====

// OpenSea collection slug
const COLLECTION_SLUG = "off-the-grid";

// Polling / display
const POLL_INTERVAL_MS = 15000; // 15 seconds
const MAX_ITEMS = 10;

// Backend proxy route
const API_PATH = "/api/opensea-sales.js";

// Time constants
const DAY_SECONDS = 24 * 60 * 60;
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// ---- Coingecko config ----

// Set this to the actual Coingecko ID for the token you want to display.
const COINGECKO_ID = "gunz"; //

// We call:
//   https://api.coingecko.com/api/v3/coins/{id}/market_chart?vs_currency=usd&days=7&interval=hourly
// and derive all metrics from that single response.
const GUN_METRICS_POLL_MS = 300000; // 5 minutes

// Hard-coded all-time high for this collection.
// EDIT THESE VALUES once you know the true ATH.
const ALL_TIME_HIGH = {
  amount: 14444.0, // numeric amount
  symbol: "GUN",   // token symbol
  name: "Hitori Yubi Mask", // item name
  timestamp: 1764263173,    // optional: Unix seconds; or null
  thumbUrl: ""              // optional: direct image URL for the ATH item
};

// Cache rarity per NFT to avoid refetching metadata
const rarityCache = new Map(); // key: metadata_url or collection:id -> { label, className } | null

// GUN metrics state
let gunMetrics = {
  priceUsd: null,
  marketCapUsd: null,
  vol1dUsd: null,
  marketCap1dUsd: null,
  marketCap7dUsd: null,
  change4hPct: null
};

// ==== CORE LOGIC (BOOTSTRAP) ====

async function initOverlay() {
  // Start GUN metrics polling
  if (COINGECKO_ID) {
    fetchGunMetrics();
    setInterval(fetchGunMetrics, GUN_METRICS_POLL_MS);
  } else {
    renderGunMetrics();
  }

  // Start events polling
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

  // ----- 24H SESSION HIGH -----
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoff24h = nowSec - DAY_SECONDS;

  const events24h = events.filter((ev) => {
    const ts = ev.event_timestamp || ev.closing_date;
    return typeof ts === "number" && ts >= cutoff24h;
  });

  const sessionHighEvent = getMaxEventByPrice(events24h);

  // ----- TOP ROW: SESSION HIGH 24H (from events) + ALL-TIME HIGH (from config) -----
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

  // ----- LIST RENDER -----
  if (!slice.length) {
    const li = document.createElement("li");
    li.innerHTML =
      '<span class="item-name">No recent sales</span><span class="datetime-line">Waiting for activity…</span>';
    ul.appendChild(li);
    return;
  }

  for (const ev of slice) {
    const li = document.createElement("li");

    // Name
    const nft = ev?.nft || {};
    const name =
      nft.name ||
      `#${nft.identifier || "?"}`;

    // Rarity (metadata_url, cached)
    const rarityInfo = await getRarityForEvent(ev);
    const rarityClass = rarityInfo ? rarityInfo.className : "other";

    // Price (2 decimals)
    const paymentInfo = getPaymentInfo(ev);
    const priceStr = paymentInfo.str;

    // Timestamp -> date + time
    const ts = ev.event_timestamp || ev.closing_date;
    const dateStr = ts ? formatDateUnixSeconds(ts) : "";
    const timeStr = ts ? formatUnixSeconds(ts) : "";

    // Direction: seller -> buyer (addresses only)
    const sellerStr = formatAddress(ev.seller);
    const buyerStr = formatAddress(ev.buyer);
    const directionStr =
      sellerStr && buyerStr ? `${sellerStr} → ${buyerStr}` : "";

    // Thumbnail
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

// ==== TOP ROW RENDERING (SESSION HIGH / ALL-TIME HIGH) ====

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

// ==== GUN METRICS (Coingecko) ====

async function fetchGunMetrics() {
  try {
    if (!COINGECKO_ID) {
      renderGunMetrics();
      return;
    }

    const url = `https://api.coingecko.com/api/v3/coins/${COINGECKO_ID}/market_chart?vs_currency=usd&days=7&interval=hourly`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Coingecko HTTP ${res.status}`);

    const data = await res.json();
    const prices = data.prices || [];
    const caps = data.market_caps || [];
    const vols = data.total_volumes || [];

    if (!prices.length) {
      gunMetrics = {
        priceUsd: null,
        marketCapUsd: null,
        vol1dUsd: null,
        marketCap1dUsd: null,
        marketCap7dUsd: null,
        change4hPct: null
      };
      renderGunMetrics();
      return;
    }

    const lastIdx = prices.length - 1;
    const [tNowMs, priceNow] = prices[lastIdx];
    const marketCapNow = (caps[lastIdx] && caps[lastIdx][1]) || null;
    const volNow = (vols[lastIdx] && vols[lastIdx][1]) || null;

    const t4hAgo = tNowMs - FOUR_HOURS_MS;
    const t1dAgo = tNowMs - ONE_DAY_MS;
    const t7dAgo = tNowMs - SEVEN_DAYS_MS;

    const price4h = findValueAtOrAfter(prices, t4hAgo)?.[1] ?? null;
    const cap1d = findValueAtOrAfter(caps, t1dAgo)?.[1] ?? null;
    const cap7d = findValueAtOrAfter(caps, t7dAgo)?.[1] ?? (caps[0]?.[1] ?? null);

    let change4hPct = null;
    if (price4h && price4h > 0) {
      change4hPct = ((priceNow - price4h) / price4h) * 100;
    }

    gunMetrics = {
      priceUsd: priceNow ?? null,
      marketCapUsd: marketCapNow ?? null,
      vol1dUsd: volNow ?? null,
      marketCap1dUsd: cap1d ?? null,
      marketCap7dUsd: cap7d ?? null,
      change4hPct
    };

    renderGunMetrics();
  } catch (err) {
    console.error("Error fetching GUN metrics", err);
    gunMetrics = {
      priceUsd: null,
      marketCapUsd: null,
      vol1dUsd: null,
      marketCap1dUsd: null,
      marketCap7dUsd: null,
      change4hPct: null
    };
    renderGunMetrics();
  }
}

function renderGunMetrics() {
  const el = document.getElementById("gun-price");
  if (!el) return;

  const {
    priceUsd,
    marketCapUsd,
    vol1dUsd,
    marketCap1dUsd,
    marketCap7dUsd,
    change4hPct
  } = gunMetrics;

  const priceStr = priceUsd != null
    ? (priceUsd < 1 ? `$${priceUsd.toFixed(4)}` : `$${priceUsd.toFixed(2)}`)
    : "—";

  const capStr = formatUsdShort(marketCapUsd);
  const volStr = formatUsdShort(vol1dUsd);
  const cap1dStr = formatUsdShort(marketCap1dUsd);
  const cap7dStr = formatUsdShort(marketCap7dUsd);
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
        <span class="${changeClass}">${sanitize(changeStr)} (4H)</span>
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
        <div class="metric">
          <span class="metric-label">Mkt Cap 24H</span>
          <span class="metric-value">${sanitize(cap1dStr)}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Mkt Cap 7D</span>
          <span class="metric-value">${sanitize(cap7dStr)}</span>
        </div>
      </div>
    </div>
  `;
}

// ==== PAYMENT / HIGH HELPERS ====

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

function findValueAtOrAfter(arr, targetMs) {
  if (!arr || !arr.length) return null;
  for (let i = 0; i < arr.length; i++) {
    const [t, v] = arr[i];
    if (t >= targetMs) return arr[i];
  }
  return arr[arr.length - 1];
}

// ==== RARITY VIA METADATA ====

async function getRarityForEvent(ev) {
  const nft = ev?.nft;
  if (!nft) return null;

  const key =
    nft.metadata_url ||
    (nft.collection && nft.identifier
      ? `${nft.collection}:${nft.identifier}`
      : null);

  if (!key) return null;

  if (rarityCache.has(key)) {
    return rarityCache.get(key);
  }

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

// ==== MISC HELPERS ====

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

// ==== BOOTSTRAP ====
initOverlay();
