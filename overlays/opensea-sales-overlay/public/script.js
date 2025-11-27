// ==== CONFIG ====
const COLLECTION_SLUG = "off-the-grid"; // OpenSea collection slug
const POLL_INTERVAL_MS = 15000; // 15 seconds
const MAX_ITEMS = 10;

// ==== CORE LOGIC ====

async function fetchEvents() {
  const errorEl = document.getElementById("error");
  errorEl.textContent = "";

  const url = `/api/opensea-sales?collection=${encodeURIComponent(
    COLLECTION_SLUG
  )}&limit=${MAX_ITEMS}`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json"
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
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

    const name =
      ev?.asset?.name ||
      ev?.nft?.metadata?.name ||
      ev?.payload?.item?.metadata?.name ||
      "Unknown item";

    const ts =
      ev.event_timestamp ||
      ev?.transaction?.timestamp ||
      ev?.payload?.event_timestamp;

    const timeStr = ts ? formatTime(ts) : "";

    const type = ev.event_type || ev?.payload?.event_type || "sale";

    li.innerHTML = `
      <span class="item-name">${sanitize(name)}</span>
      <span class="meta">${sanitize(type)} • ${sanitize(timeStr)}</span>
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
