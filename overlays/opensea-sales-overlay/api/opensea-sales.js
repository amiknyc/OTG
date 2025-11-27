const OPENSEA_BASE = "https://api.opensea.io/api/v2/events/collection";

module.exports = async (req, res) => {
  // CORS for OBS/browser
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENSEA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server misconfigured: no API key" });
  }

  const { collection, limit } = req.query || {};

  if (!collection) {
    return res.status(400).json({ error: "Missing collection parameter" });
  }

  const safeLimit = Math.min(parseInt(limit || "10", 10) || 10, 50);

  const url = `${OPENSEA_BASE}/${encodeURIComponent(
    collection
  )}?event_type=sale&limit=${safeLimit}`;

  try {
    const upstreamRes = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-API-KEY": apiKey
      }
    });

    if (!upstreamRes.ok) {
      const text = await upstreamRes.text();
      console.error("OpenSea error:", upstreamRes.status, text);
      return res
        .status(upstreamRes.status)
        .json({ error: "OpenSea API error", detail: text });
    }

    const data = await upstreamRes.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(502).json({ error: "Bad gateway", detail: err.message });
  }
};
