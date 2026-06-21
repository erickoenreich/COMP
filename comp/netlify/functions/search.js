const https = require("https");

function cardApiRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "thecardapi.com",
      port: 443,
      path,
      method: "GET",
      headers: {
        "x-market-api-key": process.env.CARD_API_KEY,
        "Content-Type": "application/json",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { reject(new Error("Parse error: " + data.slice(0, 200))); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function trimmedPrices(sales) {
  const prices = sales.map(s => s.price).filter(p => p > 0).sort((a, b) => a - b);
  if (prices.length <= 4) return prices;
  const trim = Math.max(1, Math.floor(prices.length * 0.1));
  return prices.slice(trim, prices.length - trim);
}

function trend(sales) {
  if (sales.length < 4) return null;
  const sorted = [...sales].sort((a, b) => new Date(b.sale_date) - new Date(a.sale_date));
  const recent = sorted.slice(0, 3).map(s => s.price);
  const older = sorted.slice(3, 6).map(s => s.price);
  if (!older.length) return null;
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  const pct = ((recentAvg - olderAvg) / olderAvg) * 100;
  return Math.round(pct * 10) / 10;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };

  try {
    const { query, grade } = JSON.parse(event.body || "{}");
    if (!query || query.length < 3) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Query too short" }) };
    }

    let searchQ = query;
    if (grade && grade !== "raw") searchQ += ` psa ${grade}`;
    else if (grade === "raw") searchQ += " -(psa,bgs,sgc,cgc)";

    const params = new URLSearchParams({ q: searchQ, limit: "50" });
    const res = await cardApiRequest(`/api/v1/market/sales?${params.toString()}`);

    if (res.status === 401) return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid API key — check CARD_API_KEY in Netlify env vars" }) };
    if (res.status !== 200) return { statusCode: 400, headers, body: JSON.stringify({ error: "API error " + res.status }) };

    let sales = res.body.data || [];

    if (grade && grade !== "raw") {
      sales = sales.filter(s => s.grader === "PSA" && String(s.grade) === String(grade));
    }

    const prices = trimmedPrices(sales);
    const sorted = [...sales].sort((a, b) => new Date(b.sale_date) - new Date(a.sale_date));
    const lastSale = sorted[0] || null;
    const priceTrend = trend(sales);

    const recentSales = sorted.slice(0, 12).map(s => ({
      title: s.title,
      price: s.price,
      date: s.sale_date,
      url: s.listing_url,
      grade: s.grade,
      grader: s.grader,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        query,
        grade,
        totalSales: sales.length,
        lastSalePrice: lastSale?.price || null,
        lastSaleDate: lastSale?.sale_date || null,
        avg: prices.length ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100 : null,
        median: median(prices) !== null ? Math.round(median(prices) * 100) / 100 : null,
        low: prices.length ? prices[0] : null,
        high: prices.length ? prices[prices.length - 1] : null,
        trend: priceTrend,
        recentSales,
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
