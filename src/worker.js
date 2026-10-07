// Máy chủ giá cổ phiếu: GET /api/prices?symbols=VNM,FPT  (Authorization: Bearer <token đăng nhập Supabase>)
// Chỉ chạy cho đường dẫn /api/*; mọi đường dẫn khác do thư mục public phục vụ.
const UA = { "user-agent": "Mozilla/5.0 (compatible; TaiChinhGiaDinh/1.0)", accept: "application/json" };

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname !== "/api/prices") return env.ASSETS ? env.ASSETS.fetch(req) : new Response("Not found", { status: 404 });
    const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    if (req.method !== "GET") return J({ error: "Method not allowed" }, 405);

    // Chỉ người đã đăng nhập mới dùng được (tránh bị người lạ lợi dụng làm cổng lấy giá)
    const tk = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!tk) return J({ error: "Chưa đăng nhập" }, 401);
    const ur = await fetch(env.SUPABASE_URL + "/auth/v1/user", { headers: { authorization: "Bearer " + tk, apikey: env.SUPABASE_ANON_KEY } });
    if (!ur.ok) return J({ error: "Phiên đăng nhập không hợp lệ, hãy đăng nhập lại" }, 401);

    const syms = [...new Set((u.searchParams.get("symbols") || "").toUpperCase().split(",").map((s) => s.trim()).filter((s) => /^[A-Z0-9]{2,10}$/.test(s)))].slice(0, 40);
    if (!syms.length) return J({ error: "Thiếu mã cổ phiếu" }, 400);

    const prices = {}, errors = {};
    await Promise.all(syms.map(async (s) => { try { prices[s] = await quote(s); } catch (e) { errors[s] = String((e && e.message) || e); } }));
    return J({ prices, errors, source: "VNDirect" });
  },
};

// Lấy giá khớp gần nhất từ nến 1 giờ (hoặc nến ngày nếu không có). VNDirect trả giá theo nghìn đồng nên nhân 1000.
async function quote(sym) {
  const now = Math.floor(Date.now() / 1000);
  for (const res of ["60", "D"]) {
    let r;
    try {
      r = await fetch(`https://dchart-api.vndirect.com.vn/dchart/history?symbol=${sym}&resolution=${res}&from=${now - 10 * 86400}&to=${now + 3600}`, { headers: UA, cf: { cacheTtl: 60, cacheEverything: true } });
    } catch (e) { continue; }
    if (!r.ok) continue;
    let j;
    try { j = await r.json(); } catch (e) { continue; }
    if (j && j.s === "ok" && j.c && j.c.length) {
      const i = j.c.length - 1;
      let p = Number(j.c[i]);
      if (!(p > 0)) continue;
      if (p < 1000) p *= 1000;
      return { price: Math.round(p), at: new Date(j.t[i] * 1000).toISOString() };
    }
  }
  throw new Error("không có dữ liệu");
}
