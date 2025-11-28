// api/coingecko-gun-metrics.js
// Uses CoinGecko /coins endpoint to get spot stats + 7D sparkline

module.exports = async (req, res) => {
  try {
    const id = "gunz"; // CoinGecko API ID for Gunz (GUN)

    const url =
      `https://api.coingecko.com/api/v3/coins/${id}` +
      `?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=true`;

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

    const change24hPct =
      typeof md.price_change_percentage_24h === "number"
        ? md.price_change_percentage_24h
        : null;

    const sparkline7d =
      md.sparkline_7d &&
      Array.isArray(md.sparkline_7d.price)
        ? md.sparkline_7d.price
        : null;

    // Keep shape consistent with front-end expectations
    res.status(200).json({
      priceUsd,
      marketCapUsd,
      vol1dUsd,
      marketCap1dUsd: null,  // not used in UI now
      marketCap7dUsd: null,  // not used in UI now
      change4hPct: change24hPct, // we display as 24H
      sparkline7d
    });
  } catch (err) {
    console.error("coingecko-gun-metrics handler error:", err);
    res.status(500).json({
      error: "Internal error",
      detail: String(err && err.message ? err.message : err)
    });
  }
};
