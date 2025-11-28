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

    // NOTE: interval=hourly removed to avoid Enterprise-only restriction
    const url = `https://pro-api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=7`;

    const cgRes = await fetch(url, {
      headers: {
        Accept: "application/json",
        "x-cg-pro-api-key": apiKey
      }
    });

    if (!cgRes.ok) {
      const text = await cgRes.text();
      console.error("Coingecko error:", cgRes.status, text);
      return res.status(cgR
