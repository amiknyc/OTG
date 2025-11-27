// ==== CONFIG ====
const COLLECTION_SLUG = "off-the-grid";      // OpenSea collection slug
const POLL_INTERVAL_MS = 15000;              // 15 seconds
const MAX_ITEMS = 10;
const API_PATH = "/api/opensea-sales.js";    // Vercel function route

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
    renderEvents(events);
  } catch (err) {
    console.error("Error fetching via proxy:", err);
    errorEl.textContent = "Error loading sales feed";
  }
}

window.__lastEvents = events;

function renderEvents(events) {
  const ul = document.getElementById("events");
  ul.innerHTML = "";

  if (!events || events.length === 0) {
    const li = document.createElement("li");
    li.innerHTML =
      '<span class="item-name">No recent sales</span><span class="meta">Waiting for activity…</span>';
    ul.appendChild(li);
    return;
  }

  events.slice(0, MAX_ITEMS).forEach((ev) => {
    const li = document.createElement("li");

    // Name
    const name =
      ev?.nft?.metadata?.name ||
      ev?.nft?.name ||
      ev?.asset?.name ||
      `#${ev?.nft?.identifier || "?"}`;

    // Rarity
    const rarityInfo = extractRarity(ev);

    // Price (2 decimals)
    const quantityRaw = ev?.payment?.quantity;
    const decimals = Number(ev?.payment?.token?.decimals ?? 18);
    const symbol = ev?.payment?.token?.symbol || "";
    let priceStr = "";

    if (quantityRaw) {
      const qtyNum = Number(quantityRaw) / Math.pow(10, decimals);
      if (!Number.isNaN(qtyNum)) {
        priceStr = `${qtyNum.toFixed(2)} ${symbol}`.trim();
      }
    }

    // Timestamp
    const ts =
      ev.event_timestamp ||
      ev?.transaction?.timestamp ||
      ev?.transaction?.created_date ||
      ev?.created_date;
    const timeStr = ts ? formatTime(ts) : "";

    const type = ev.event_type || "sale";

    // Direction: seller -> buyer
    const sellerStr = formatAccount(ev?.seller || ev?.from_account);
    const buyerStr = formatAccount(ev?.buyer || ev?.to_account);
    const directionStr =
      sellerStr && buyerStr ? `${sellerStr} → ${buyerStr}` : "";

    // Thumbnail
    const thumbUrl =
      ev?.nft?.display_image_url ||
      ev?.nft?.image_url ||
      ev?.asset?.image_url ||
      "";

    const rarityClass = rarityInfo ? rarityInfo.className : "other";

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
          <span class="meta">
            ${sanitize(type)}${
      priceStr ? " • " + sanitize(priceStr) : ""
    }${timeStr ? " • " + sanitize(timeStr) : ""}
          </span>
          ${
            directionStr
              ? `<span class="direction">${sanitize(directionStr)}</span>`
              : ""
          }
        </div>
      </div>
    `;

    ul.appendChild(li);
  });
}

// ==== HELPERS ====

// Rarity: read from metadata attributes/traits, normalize to 4 tiers
function extractRarity(ev) {
  const sources = [
    ev?.nft?.metadata?.attributes,
    ev?.nft?.metadata?.traits,
    ev?.nft?.traits,
    ev?.asset?.traits
  ].filter(Array.isArray);

  const attrs = sources.flat();
  if (!attrs.length) return null;

  const rarityAttr = attrs.find((attr) => {
    const key = (
      attr.trait_type ||
      attr.type ||
      attr.name ||
      ""
    )
      .toString()
      .toLowerCase();
    return (
      key.includes("rarity") ||
      key.includes("tier") ||
      key.includes("grade") ||
      key.includes("quality")
    );
  });

  if (!rarityAttr) return null;

  const raw = String(
    rarityAttr.value ?? rarityAttr.trait_type ?? rarityAttr.name ?? ""
  ).trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  let className = "other";

  if (lower.includes("common") && !lower.includes("uncommon")) className = "common";
  else if (lower.includes("uncommon")) className = "uncommon";
  else if (lower.includes("epic")) className = "epic";
  else if (lower.includes("rare")) className = "rare";

  return {
    label: raw,
    className
  };
}

function formatAccount(entity) {
  if (!entity) return "";

  const username =
    entity.user?.username ||
    entity.display_name ||
    entity.profile_name ||
    "";

  if (username && username.trim().length > 0) {
    return username.trim();
  }

  const addr = entity.address || entity.wallet_address;
  if (!addr || typeof addr !== "string") return "";

  const trimmed = addr.replace(/^0x/, "");
  const last4 = trimmed.slice(-4);
  return `…${last4}`;
}

function formatTime(timestamp) {
  let d;
  if (typeof timestamp === "number") {
    d = new Date(timestamp * 1000);
  } else {
    d = new Date(timestamp);
  }

  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  });
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
