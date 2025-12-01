// ==== CONFIG (OPENSEA ONLY) ====

const COLLECTION_SLUG = "off-the-grid";
const POLL_INTERVAL_MS = 60000;
const MAX_ITEMS = 6;
const API_PATH = "/api/opensea-sales.js";

const DAY_SECONDS = 24 * 60 * 60;

const ALL_TIME_HIGH = {
  amount: 250000.0,
  symbol: "GUN",
  name: "APE-FOOL'S GOLD MASK",
  timestamp: 1764263173,
  thumbUrl:
    "https://i2c.seadn.io/gunzilla/0x9ed98e159be43a8d42b64053831fcae5e4d7d271/632fcd41d3343ffee3bc0d14057449/77632fcd41d3343ffee3bc0d14057449.png?w=1000"
};

// Cache rarity + sale animation windows
const rarityCache = new Map();
const SALE_ANIMATION_MS = 5000;
const saleAnimationState = new Map();

// ==== BOOTSTRAP ====

async function initMarketplaceOverlay() {
  initOpenSeaMesh();

  await fetchEvents();
  setInterval(fetchEvents, POLL_INTERVAL_MS);
}

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

  const COLS = 40;
  const ROWS = 40;

  function point(ix, iy, t) {
    const u = ix / (COLS - 1);
    const v = iy / (ROWS - 1);

    const x0 = u * width;
    const y0 = v * height;

    const nx = (u - 0.5) * 2;
    const ny = (v - 0.5) * 2;

    const waveA = Math.sin(nx * 3.0 + t * 1.2);
    const waveB = Math.cos(ny * 3.4 - t * 0.9);
    const waveC = Math.sin((nx + ny) * 2.6 - t * 0.7);
    const h = (waveA + waveB + waveC) / 3;

    const amp = Math.min(width, height) * 0.1;

    const dx = h * amp * nx;
    const dy = h * amp * ny;

    return { x: x0 + dx, y: y0 + dy };
  }

  const SPEED = 0.45;

  function draw(timestamp) {
    if (!canvas.isConnected) return;

    const t = (timestamp / 1000) * SPEED;
    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0.0, "rgba(56, 189, 248, 0.95)");
    gradient.addColorStop(0.5, "rgba(129, 140, 248, 0.95)");
    gradient.addColorStop(1.0, "rgba(236, 72, 153, 0.95)");

    ctx.lineWidth = 1.8;
    ctx.strokeStyle = gradient;
    ctx.globalCompositeOperation = "source-over";

    for (let iy = 0; iy < ROWS; iy++) {
      ctx.beginPath();
      for (let ix = 0; ix < COLS; ix++) {
        const p = point(ix, iy, t);
        if (ix === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }

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

// ==== MARKETPLACE FETCH + RENDER ====

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

  const nowSec = Math.floor(Date.now() / 1000);
  const cutoff24h = nowSec - DAY_SECONDS;

  const events24h = (events || []).filter((ev) => {
    const tsRaw =
      ev.event_timestamp || ev.closing_date || ev.created_date || ev.occurred_at;
    const ts = toUnixSeconds(tsRaw);
    return typeof ts === "number" && ts >= cutoff24h;
  });

  const sessionHighEvent = getMaxEventByPrice(events24h);

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
          <div class="sale-line">
            <span class="${saleLabelClass}">sale</span>
            <span class="${priceClass}">
              ${sanitize(initialPriceText)}
            </span>
          </div>
          <div class="datetime-line">
            ${
              dateStr
                ? sanitize(dateStr)
                : ""
            }${
      timeStr ? (dateStr ? " • " : "") + sanitize(timeStr) : ""
    }
          </div>
          ${
            directionStr
              ? `<div class="direction-line">${sanitize(directionStr)}</div>`
              : ""
          }
        </div>
      </div>
    `;

    ul.appendChild(li);

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

// ==== PAYMENT / RARITY / FORMAT HELPERS ====

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

function sanitize(str) {
  if (!str && str !== 0) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ==== SALE KEY + PRICE ANIMATION ====

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

function animateSalePrice(span, finalStr, maxMs) {
  if (!span || !finalStr) return;

  const match = finalStr.match(/([\d.,]+)/);
  const baseNum = match ? parseFloat(match[1].replace(/,/g, "")) : null;
  const decimals = match && match[1].includes(".")
    ? match[1].split(".")[1].length
    : 2;

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

// ==== START MARKET MODULE ====
initMarketplaceOverlay();
