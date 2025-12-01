// ================================
// MULTI-COIN 1H SNAPSHOT LOGIC
// ================================

const COINS = [
  { id: "bitcoin", symbol: "BTC" },
  { id: "ethereum", symbol: "ETH" },
  { id: "solana", symbol: "SOL" },
  { id: "avalanche-2", symbol: "AVAX" },
  // TODO: Confirm the correct CoinGecko ID for your HYPE token
  { id: "hype", symbol: "HYPE" },
];

const VS_CURRENCY = "usd";

function buildApiUrl() {
  const ids = COINS.map((c) => c.id).join(",");
  // Includes 1H % change
  const params = new URLSearchParams({
    vs_currency: VS_CURRENCY,
    ids,
    price_change_percentage: "1h",
  });
  return `https://api.coingecko.com/api/v3/coins/markets?${params.toString()}`;
}

async function fetchCoinData() {
  try {
    const url = buildApiUrl();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const byId = new Map(data.map((d) => [d.id, d]));
    COINS.forEach((coin) => {
      const info = byId.get(coin.id);
      if (!info) return;
      updateCoinRow(coin.symbol, info);
    });
  } catch (err) {
    console.error("Error fetching coin list data:", err);
  }
}

function updateCoinRow(symbol, data) {
  const row = document.querySelector(
    `.coin-row[data-coin-symbol="${symbol}"]`
  );
  if (!row) return;

  const priceEl = row.querySelector(".coin-price");
  const changeEl = row.querySelector(".coin-change");
  const volEl = row.querySelector(".coin-volume");

  if (priceEl) {
    priceEl.textContent = formatUsd(data.current_price);
  }

  if (changeEl) {
    const change =
      data.price_change_percentage_1h_in_currency ??
      data.price_change_percentage_24h; // fallback if 1H not present

    if (typeof change === "number") {
      const rounded = change.toFixed(2);
      changeEl.textContent = `${rounded}%`;
      changeEl.classList.remove("is-up", "is-down");
      if (change > 0) {
        changeEl.classList.add("is-up");
      } else if (change < 0) {
        changeEl.classList.add("is-down");
      }
    } else {
      changeEl.textContent = "--";
      changeEl.classList.remove("is-up", "is-down");
    }
  }

  if (volEl) {
    const vol24h = data.total_volume;
    if (typeof vol24h === "number") {
      const vol1hApprox = vol24h / 24; // rough approximation
      volEl.textContent = formatCompact(vol1hApprox);
    } else {
      volEl.textContent = "--";
    }
  }
}

function formatUsd(value) {
  if (value == null || isNaN(value)) return "--";
  let decimals = 2;
  if (value < 1) decimals = 4;
  if (value < 0.01) decimals = 6;
  return `$${value.toFixed(decimals)}`;
}

function formatCompact(value) {
  if (value == null || isNaN(value)) return "--";
  const abs = Math.abs(value);
  if (abs >= 1e9) return (value / 1e9).toFixed(1) + "B";
  if (abs >= 1e6) return (value / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return (value / 1e3).toFixed(1) + "K";
  return value.toFixed(0);
}

// Kick off and refresh every minute
document.addEventListener("DOMContentLoaded", () => {
  fetchCoinData();
  setInterval(fetchCoinData, 60_000);
});
