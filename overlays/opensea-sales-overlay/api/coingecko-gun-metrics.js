// api/coingecko-gun-metrics.js

// For the overlay we really just need spot metrics,
// so we hit /coins/gunz instead of /market_chart,
// which avoids the "coin not found" issues.

module.exports = async (req, res) => {
  try {
    const id = "gunz"; // CoinGecko API ID for Gunz (GUN)

    const url =
      `https://api.coingecko.com/api/v3/coins/${id}` +
      `?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`;

    const cgRes = await fetch(url, {
      headers: { Accept: "application/json" }
    });

    if (!cgRes.ok) {
      const body = await cgRes.text();
      console.error("Coingecko /coins error:", cgRes.status, body);
      res
        .status(cgRes.status)
        .json({ error: "Coingecko error", status: cgRes.status, body });
      return;
    }

    const data = await cgRes.json();
    const md = data.market_data || {};

    const priceUsd =
      md.current_price && typeof md.current_price.usd === "number"
        ? md.current_price.usd
        : null;

    const marketCapUsd =
      md.market_cap && typeof md.market_cap.usd === "number"
        ? md.market_cap.usd
        : null;

    const vol1dUsd =
      md.total_volume && typeof md.total_volume.usd === "number"
        ? md.total_volume.usd
        : null;

    // We no longer have 4H data; use 24H change as our "change" metric.
    const change24hPct =
      typeof md.price_change_percentage_24h === "number"
        ? md.price_change_percentage_24h
        : null;

    // Keep the same response shape the front-end already expects.
    res.status(200).json({
      priceUsd,
      marketCapUsd,
      vol1dUsd,
      marketCap1dUsd: null,   // not available from this endpoint
      marketCap7dUsd: null,   // not available from this endpoint
      change4hPct: change24hPct  // we’ll label it 24H on the UI
    });
  } catch (err) {
    console.error("coingecko-gun-metrics handler error:", err);
    res.status(500).json({
      error: "Internal error",
      detail: String(err && err.message ? err.message : err)
    });
  }
};
