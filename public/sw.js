/* Service worker: mở app nhanh và vẫn mở được khi mất mạng.
   - File của trang (index.html, config.js, icon…): lấy bản mới từ mạng trước, mất mạng mới dùng bản đã lưu
     → mỗi lần upload index.html mới, người dùng có mạng luôn nhận bản mới ngay.
   - Thư viện CDN và font: dùng bản đã lưu cho nhanh, đồng thời tải bản mới ở nền.
   - Dữ liệu Supabase KHÔNG đi qua cache (luôn lấy trực tiếp). */
var V = "tc-0.0.9";
var SHELL = ["./", "index.html", "config.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(V).then(function (c) { return c.addAll(SHELL); }).catch(function () {}));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== V; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

function put(req, res) {
  var cp = res.clone();
  caches.open(V).then(function (c) { c.put(req, cp); });
}

self.addEventListener("fetch", function (e) {
  var r = e.request, u = new URL(r.url);
  if (r.method !== "GET") return;

  if (u.origin === location.origin) {
    e.respondWith(
      fetch(r).then(function (res) { if (res.ok) put(r, res); return res; })
        .catch(function () {
          return caches.match(r, { ignoreSearch: true }).then(function (m) {
            return m || (r.mode === "navigate" ? caches.match("index.html") : Response.error());
          });
        })
    );
    return;
  }

  if (/(^|\.)cdnjs\.cloudflare\.com$|(^|\.)cdn\.jsdelivr\.net$|(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) {
    e.respondWith(
      caches.match(r).then(function (m) {
        var f = fetch(r).then(function (res) { if (res.ok || res.type === "opaque") put(r, res); return res; })
          .catch(function () { return m; });
        return m || f;
      })
    );
  }
});
