// ========== CONFIG ==========

// How many points in the sparkline
const SPARKLINE_POINTS = 40;

// How often to simulate a new price tick (ms)
const UPDATE_INTERVAL_MS = 15000; // 15 seconds

// ========== DOM REFERENCES ==========

const priceEl = document.getElementById("gun-price");
// Expecting something like: <span id="gun-change" class="gun-change"></span>
const changeEl = document.getElementById("gun-change");
const trendEl = document.getElementById("gun-trend");
// Expecting: <path id="gun-sparkline-path" class="sparkline-path" ... />
const pathEl = document.getElementById("gun-sparkline-path");

let priceSeries = [];

// ========== UTILITIES ==========

function formatPrice(value) {
  if (!isFinite(value)) return "$0.0000";
  if (value >= 1) return "$" + value.toFixed(4);
  // For tiny tokens, show more precision
  return "$" + value.toFixed(6);
}

function formatPercent(value) {
  if (!isFinite(value)) return "0.00%";
  const sign = value > 0 ? "+" : "";
  return sign + value.toFixed(2) + "%";
}

// Map a value from one range to another
function mapRange(value, inMin, inMax, outMin, outMax) {
  if (inMax === inMin) return (outMin + outMax) / 2;
  return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}

// Build SVG path for sparkline from an array of prices
function buildSparklinePath(points) {
  if (!points || points.length === 0) return "";

  let min = Math.min(...points);
  let max = Math.max(...points);

  // Avoid flat-line if min == max
  if (max === min) {
    max = min + 1;
  }

  const len = points.length;
  const xStep = 100 / (len - 1 || 1);

  let d = "";
  points.forEach((p, i) => {
    const x = i * xStep;
    // SVG Y origin is top; higher price should be lower Y
    const y = 30 - mapRange(p, min, max, 2, 28);
    d += i === 0 ? `M ${x},${y}` : ` L ${x},${y}`;
  });

  return d;
}

// Trigger animation classes on the sparkline path
function animateSparkline(isUp) {
  if (!pathEl) return;

  // Clear prior animation + pulse
  pathEl.classList.remove(
    "sparkline-animate",
    "sparkline-pulse-up",
    "sparkline-pulse-down"
  );

  // Force reflow so re-adding class retriggers CSS animation
  // eslint-disable-next-line no-unused-expressions
  pathEl.offsetWidth;

  // Always run draw-in animation
  pathEl.classList.add("sparkline-animate");

  // Pulse based on direction
  if (isUp > 0) {
    pathEl.classList.add("sparkline-pulse-up");
  } else if (isUp < 0) {
    pathEl.classList.add("sparkline-pulse-down");
  }
}

// ========== MAIN OVERLAY UPDATE ==========

/**
 * Update price text, 24h change, trend text, and sparkline.
 * `prices` should be an array of numbers from oldest → newest.
 */
function updateGunOverlay(prices) {
  if (!prices || prices.length === 0) return;
  priceSeries = prices.slice();

  const latest = priceSeries[priceSeries.length - 1];
  const first = priceSeries[0];

  const changePct = ((latest - first) / first) * 100;
  const isUp = changePct > 0 ? 1 : changePct < 0 ? -1 : 0;

  // Text: price
  if (priceEl) {
    priceEl.textContent = formatPrice(latest);
  }

  // Text: 24h change + color (CSS: .gun-change.positive / .gun-change.negative)
  if (changeEl) {
    changeEl.textContent = formatPercent(changePct);
    changeEl.classList.remove("positive", "negative");
    if (isUp > 0) {
      changeEl.classList.add("positive");
    } else if (isUp < 0) {
      changeEl.classList.add("negative");
    }
  }

  // Text: trend sentence (optional element)
  if (trendEl) {
    if (isUp > 0) {
      trendEl.textContent = "Price grinding up — look for smart entries.";
    } else if (isUp < 0) {
      trendEl.textContent =
        "Pullback — play for information, not revenge trades.";
    } else {
      trendEl.textContent = "Flat — stay patient and watch the flow.";
    }
  }

  // Sparkline path + color classes
  if (pathEl) {
    const d = buildSparklinePath(priceSeries);
    pathEl.setAttribute("d", d);

    // Color via CSS: .sparkline-path.positive / .sparkline-path.negative
    pathEl.classList.remove("positive", "negative");
    if (isUp > 0) {
      pathEl.classList.add("positive");
    } else if (isUp < 0) {
      pathEl.classList.add("negative");
    }

    // Animate line + pulse
    animateSparkline(isUp);
  }
}

// ========== MOCK PRICE FEED (RANDOM WALK) ==========

function createInitialSeries() {
  const series = [];
  let value = 0.003; // starting pseudo price

  for (let i = 0; i < SPARKLINE_POINTS; i++) {
    const delta = (Math.random() - 0.5) * 0.0002;
    value = Math.max(0.00001, value + delta);
    series.push(value);
  }
  return series;
}

function nextTickSeries(series) {
  const updated = series.slice();
  let last = updated[updated.length - 1];

  const delta = (Math.random() - 0.5) * 0.00025;
  last = Math.max(0.00001, last + delta);

  updated.push(last);
  if (updated.length > SPARKLINE_POINTS) {
    updated.shift();
  }
  return updated;
}

function startMockPriceFeed() {
  priceSeries = createInitialSeries();
  updateGunOverlay(priceSeries);

  setInterval(() => {
    priceSeries = nextTickSeries(priceSeries);
    updateGunOverlay(priceSeries);
  }, UPDATE_INTERVAL_MS);
}

// ========== MOCK MARKETPLACE (OPTIONAL PLACEHOLDER) ==========

function populateMockMarketplace() {
  const highSaleEl = document.getElementById("high-sale");
  const eventsEl = document.getElementById("events");
  const errorEl = document.getElementById("error");

  if (highSaleEl) {
    highSaleEl.textContent =
      "Highest sale (mock): 12,345 GUN – Legendary Skin #042";
  }

  if (eventsEl) {
    const mock = [
      { name: "Epic AR Skin", price: "3,200 GUN" },
      { name: "Operator Suit – Delta", price: "1,850 GUN" },
      { name: "Emote: Tactical Flex", price: "420 GUN" },
      { name: "Rare SMG Skin", price: "980 GUN" },
    ];

    eventsEl.innerHTML = "";
    mock.forEach((e) => {
      const li = document.createElement("li");

      const nameSpan = document.createElement("span");
      nameSpan.className = "event-item-name";
      nameSpan.textContent = e.name;

      const priceSpan = document.createElement("span");
      priceSpan.className = "event-item-price";
      priceSpan.textContent = e.price;

      li.appendChild(nameSpan);
      li.appendChild(priceSpan);
      eventsEl.appendChild(li);
    });
  }

  if (errorEl) {
    errorEl.textContent = ""; // no error in mock
  }
}

// ========== ENTRY POINT ==========

window.addEventListener("DOMContentLoaded", () => {
  // Start mock price feed so you immediately see the animation in OBS
  startMockPriceFeed();

  // Populate placeholder marketplace data
  populateMockMarketplace();

  // Expose a hook so you can plug in real price history later:
  // window.updateGunOverlay(realPriceArrayOfNumbersFromOldestToNewest);
  window.updateGunOverlay = updateGunOverlay;
});
