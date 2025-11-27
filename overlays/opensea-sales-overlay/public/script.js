// ==== CONFIG ====
const COLLECTION_SLUG = "off-the-grid";   // OpenSea collection slug
const POLL_INTERVAL_MS = 15000;           // 15 seconds
const MAX_ITEMS = 10;
const API_PATH = "/api/opensea-sales.js"; // Vercel function route

// Cache rarity per NFT to avoid refetching metadata
const rarityCache = new Map(); // key: metadata_url or collection:id -> { label, className } | null

// ==== CORE LOGIC ====

async function fetchEvents() {
  const errorEl = document.getElementById("error");
  errorEl.textContent = "";

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
    errorEl.textContent = "Error loading sales feed";
  }
}

async function renderEvents(events) {
  const ul = document.getElementById("events");
  const highEl = document.getElementById("high-sale");
  ul.innerHTML = "";

  const slice = events.slice(0, MAX_ITEMS);

  // ----- Session high (within this batch) -----
  const maxEvent = getMaxEventByPrice(slice);
  if (maxEvent) {
    const nft = maxEvent.nft || {};
    const name = nft.name || `#${nft.identifier || "?"}`;
    const priceInfo = getPaymentInfo(maxEvent);
    const priceStr = priceInfo.str || "";
    highEl.style.display = "";
    highEl.innerHTML = `
      <div class="label">SESSION HIGH</div>
      <div class="value">
        ${priceStr ? sanitize(priceStr) + " • " : ""}${sanitize(name)}
      </div>
    `;
  } else {
    highEl.textContent = "";
    highEl.style.display = "none";
  }

  if (!slice.length) {
    const li = document.createElement("li");
    li.innerHTML =
      '<span class="item-name">No recent sales</span><span class="datetime-line">Waiting for activity…</span>';
    ul.appendChild(li);
    return;
  }

  // ----- Individual items -----
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

// ==== PAYMENT / SESSION HIGH HELPERS ====

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

function sanitize(str) {
  if (!str && str !== 0) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Initial load + polling
fetchEvents();
setInterval(fetchEvents, POLL_INTERVAL_MS);
