// ==== CONFIG ====
const COLLECTION_SLUG = "off-the-grid";       // OpenSea collection slug
const POLL_INTERVAL_MS = 15000;               // 15 seconds
const MAX_ITEMS = 5;
const API_PATH = "/api/opensea-sales.js";     // IMPORTANT: .js route

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

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    // OpenSea v2 returns an `asset_events` array for collection events
    const events = data.asset_events || data.events || [];

    console.log("Proxy events:", events);
    renderEvents(events);
  } catch (err) {
    console.error("Error fetching via proxy:", err);
    errorEl.textContent = "Error loading sales feed";
  }
}

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

    // Try to pull a readable name
    const name =
      ev?.nft?.metadata?.name ||
      ev?.nft?.name ||
      ev?.asset?.name ||
      "Unknown item";

    // Payment / price
    const quantityRaw = ev?.payment?.quantity;
    const decimals = Number(ev?.payment?.token?.decimals ?? 18);
    const symbol = ev?.payment?.token?.symbol || "";
    let priceStr = "";

    if (quantityRaw) {
      // quantityRaw is usually a string of the smallest unit
      const qty = Number(quantityRaw) / Math.pow(10, decimals);
      if (!Number.isNaN(qty)) {
        priceStr = `${qty.toFixed(4)} ${symbol}`.trim();
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

    li.innerHTML = `
      <span class="item-name">${sanitize(name)}</span>
      <span class="meta">
        ${sanitize(type)}${priceStr ? " • " + sanitize(priceStr) : ""}${
      timeStr ? " • " + sanitize(timeStr) : ""
    }
      </span>
    `;

    ul.appendChild(li);
  });
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