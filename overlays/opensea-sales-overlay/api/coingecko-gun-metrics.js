// api/gun-metrics.js

const DAY_MS = 24 * 60 * 60 * 1000;
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * DAY_MS;

export default async function handler(req, res) {
  try {
    const id = process.env.COINGECKO_ID || "gunz"; // fallback
    const apiKey = process.env.COINGECKO_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "COINGECKO_API_KEY not set" });
    }

    // Coingecko Pro base; if you’re using the free one, change to api.coingecko.com
    const url = `https://pro-api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=7&interval=hourly`;

    const cgRes = await fetch(url, {
      headers: {
        Accept: "application/json",
        "x-cg-pro-api-key": apiKey
      }
    });

    if (!cgRes.ok) {
      const text = await cgRes.text();
      console.error("Coingecko error:", cgRes.status, text);
      return res.status(cgRes.status).json({ error: "Coingecko error", status: cgRes.status });
    }

    const data = await cgRes.json();
    const prices = data.prices || [];
    const caps = data.market_caps || [];
    const vols = data.total_volumes || [];

    if (!prices.length) {
      return res.status(200).json({
        priceUsd: null,
        marketCapUsd: null,
        vol1dUsd: null,
        marketCap1dUsd: null,
        marketCap7dUsd: null,
        change4hPct: null
      });
    }

    const lastIdx = prices.length - 1;
    const [tNowMs, priceNow] = prices[lastIdx];
    const marketCapNow = (caps[lastIdx] && caps[lastIdx][1]) || null;
    const volNow = (vols[lastIdx] && vols[lastIdx][1]) || null;

    const t4hAgo = tNowMs - FOUR_HOURS_MS;
    const t1dAgo = tNowMs - DAY_MS;
    const t7dAgo = tNowMs - SEVEN_DAYS_MS;

    const price4h = findValueAtOrAfter(prices, t4hAgo)?.[1] ?? null;
    const cap1d = findValueAtOrAfter(caps, t1dAgo)?.[1] ?? null;
    const cap7d = findValueAtOrAfter(caps, t7dAgo)?.[1] ?? (caps[0]?.[1] ?? null);

    let change4hPct = null;
    if (price4h && price4h > 0) {
      change4hPct = ((priceNow - price4h) / price4h) * 100;
    }

    return res.status(200).json({
      priceUsd: priceNow ?? null,
      marketCapUsd: marketCapNow ?? null,
      vol1dUsd: volNow ?? null,
      marketCap1dUsd: cap1d ?? null,
      marketCap7dUsd: cap7d ?? null,
      change4hPct
    });
  } catch (err) {
    console.error("gun-metrics handler error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}

function findValueAtOrAfter(arr, targetMs) {
  if (!arr || !arr.length) return null;
  for (let i = 0; i < arr.length; i++) {
    const [t, v] = arr[i];
    if (t >= targetMs) return arr[i];
  }
  return arr[arr.length - 1];
}
