// Shared helpers for the account, rider and admin pages.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (v) => +v || 0;
const rm = (n) => "RM" + (Math.round(num(n) * 100) / 100).toLocaleString("en-MY", { minimumFractionDigits: num(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
const kgf = (n) => Math.round(num(n) * 10) / 10 + "kg";

const PRODUCTS = [
  { k: "mixed", label: "Mixed size", bm: "Campur" },
  { k: "big", label: "Big", bm: "Besar" },
  { k: "white", label: "White", bm: "Putih" },
];
const STATUS = { new: ["Confirmed", ""], out: ["Out for delivery", "a"], delivered: ["Delivered", "g"], nothome: ["Not home", "r"], cancelled: ["Cancelled", "r"] };
const PAY = { qr: "QR on delivery", cash: "Cash on delivery", online: "Paid online" };

function parseISO(s) { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); }
function isoDate(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function fmtDate(s, long) { return parseISO(s).toLocaleDateString("en-GB", long ? { weekday: "long", day: "numeric", month: "short" } : { weekday: "short", day: "numeric", month: "short" }); }
function fmtDateBM(s) { const d = parseISO(s); return ["Ahad", "Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu"][d.getDay()] + " " + d.getDate() + "/" + (d.getMonth() + 1); }
function cutoffText(date, s) { const d = parseISO(date); d.setDate(d.getDate() - (s ? s.cutoff_days_before : 2)); const h = s ? s.cutoff_hour : 22; return fmtDate(isoDate(d), true) + ", " + (h % 12 || 12) + (h < 12 ? "am" : "pm"); }
// The delivery date nearest today in Malaysia (for riders and admin default views)
function todayMY() { const d = new Date(Date.now() + 8 * 3600e3); return d.toISOString().slice(0, 10); }
function nearestDeliveryDay(s) {
  const days = (s && s.delivery_days) || [3]; const d = parseISO(todayMY());
  for (let i = 0; i < 8; i++) { if (days.includes(d.getDay())) return isoDate(d); d.setDate(d.getDate() + 1); }
  return todayMY();
}

const orderKg = (o) => num(o.mixed) + num(o.big) + num(o.white);
function priceOf(o, s) {
  const sub = num(o.mixed) * s.price_mixed + num(o.big) * s.price_big + num(o.white) * 2 * s.price_white;
  const k = orderKg(o), fee = k > 0 && k < s.free_from_kg - 1e-9 ? num(s.fee) : 0;
  return { sub, fee, total: sub + fee, kg: k };
}
function validateQty(o) {
  const e = [], half = (v) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9;
  for (const p of PRODUCTS) if (num(o[p.k]) < 0 || !half(num(o[p.k]))) e.push(p.label + " must be in 500g steps.");
  if (num(o.mixed) > 0 && num(o.mixed) < 1) e.push("Mixed size starts at 1kg.");
  if (num(o.big) > 0 && num(o.big) < 1) e.push("Big starts at 1kg.");
  if (orderKg(o) === 0) e.push("Add at least one product.");
  return e;
}
function packing(o) {
  const out = [];
  for (const k of ["mixed", "big"]) { const v = num(o[k]), box = Math.floor(v / 2 + 1e-9), packs = Math.round((v - box * 2) / 0.5); if (box || packs) out.push({ k, box, packs }); }
  const w = num(o.white); if (w) out.push({ k: "white", box: 0, packs: Math.round(w / 0.5) });
  return out;
}
function packText(o, bm) {
  return packing(o).map((p) => {
    const name = PRODUCTS.find((x) => x.k === p.k)[bm ? "bm" : "label"], parts = [];
    if (p.box) parts.push(p.box + (bm ? " kotak 2kg" : " × 2kg box" + (p.box > 1 ? "es" : "")));
    if (p.packs) parts.push(p.packs + (bm ? " pek 500g" : " × 500g pack" + (p.packs > 1 ? "s" : "")));
    return name + ": " + parts.join(" + ");
  }).join("; ");
}
const itemsText = (o) => PRODUCTS.filter((p) => num(o[p.k])).map((p) => p.label + " " + kgf(o[p.k])).join(", ");
const digits = (p) => String(p || "").replace(/\D/g, "").replace(/^60/, "0");
const waPhone = (p) => { const d = digits(p); return d ? "6" + d : ""; };
const mapQ = (a) => (/kuala lumpur|selangor|petaling|subang|putrajaya|cyberjaya|\bkl\b/i.test(a) ? a : a + ", Kuala Lumpur");
const mapsSearch = (a) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(mapQ(a));

// Orders at the same building become one stop; Google Maps links of up to N stops, starting from TBS.
function stopGroups(orders) {
  const g = [];
  for (const o of orders) { const k = (o.address || "").trim().toLowerCase(), last = g.at(-1); if (last && k && last.key === k) last.orders.push(o); else g.push({ key: k, orders: [o] }); }
  return g;
}
function routeLinks(groups, s) {
  const per = Math.max(2, Math.min(9, num(s.stops_per_link) || 9)), links = [];
  const pts = groups.map((g, n) => ({ n: n + 1, q: g.key ? mapQ(g.orders[0].address.trim()) : "" })).filter((x) => x.q);
  let origin = s.start_point;
  for (let k = 0; k < pts.length; k += per) {
    const c = pts.slice(k, k + per), dest = c.at(-1).q, wp = c.slice(0, -1).map((x) => x.q);
    links.push({ from: c[0].n, to: c.at(-1).n, url: "https://www.google.com/maps/dir/?api=1&origin=" + encodeURIComponent(origin) + "&destination=" + encodeURIComponent(dest) + (wp.length ? "&waypoints=" + encodeURIComponent(wp.join("|")) : "") + "&travelmode=driving" });
    origin = dest;
  }
  return { links, missing: groups.length - pts.length };
}

const chip = (t, c = "") => `<span class="chip ${c}">${esc(t)}</span>`;
const statusChip = (o) => { const [t, c] = STATUS[o.status] || STATUS.new; return chip(t, c); };
const payChip = (o) => (o.paid ? chip("Paid", "g") : chip(o.pay === "cash" ? "Collect cash" : o.pay === "qr" ? "Collect by QR" : "Unpaid", "a"));

function toast(t) { let el = $("#toast"); if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); document.body.append(el); } el.textContent = t; el.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2600); }
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); toast("Copied. Paste it into WhatsApp."); }
  catch (e) { const ta = btn && btn.closest("[data-copybox]") ? $("textarea", btn.closest("[data-copybox]")) : null; if (ta) { ta.focus(); ta.select(); } toast("Press and hold to copy the text."); }
}

const HOME = { admin: "admin.html", rider: "rider.html", customer: "account.html" };
const MARK = `<svg class="mark" viewBox="0 0 64 72" aria-hidden="true"><path d="M3 3 L13 7.5 L23 3 L23 22 L3 22 Z" fill="#8AC45C" stroke="#000" stroke-width="4"/><rect x="3" y="20" width="58" height="49" rx="9" fill="#F0585F" stroke="#000" stroke-width="4.5"/><rect x="23.7" y="36" width="16.6" height="17" fill="#fff"/><path d="M22.3 20v49M41.7 20v49M3 36.3h58M3 52.7h58" stroke="#000" stroke-width="4.5"/></svg>`;

function appHeader(me, title) {
  const h = $("#apphead");
  const links = me && me.role === "admin" ? `<a href="admin.html">Admin</a><a href="rider.html">Rider view</a><a href="account.html">My orders</a>` : "";
  h.innerHTML = `<a class="brand" href="index.html">${MARK}<span>cameron<br>strawberry</span></a>
    <span class="where">${esc(title)}</span>
    <nav class="appnav">${links}</nav>
    ${me ? `<button class="btn btn-small btn-quiet" id="signout">Log out</button>` : ""}`;
  const so = $("#signout"); if (so) so.onclick = async () => { await API.signOut(); location.href = "login.html"; };
}

// Make sure someone is logged in with one of the allowed roles; send them to the right page otherwise.
async function guard(roles) {
  let me;
  try { me = await API.me(); } catch (e) { showFatal("We could not reach the order system. Check your connection and refresh the page."); throw e; }
  if (!me) { location.replace("login.html?next=" + encodeURIComponent(location.pathname.split("/").pop() || "account.html")); throw new Error("not signed in"); }
  if (!roles.includes(me.role)) { location.replace(HOME[me.role] || "account.html"); throw new Error("wrong role"); }
  return me;
}
function showFatal(msg) { const m = $("#main") || document.body; m.innerHTML = `<div class="panel"><p>${esc(msg)}</p></div>`; }
function configured() { const c = window.CS_CONFIG; return window.API && (window.API.mock || (c && !/YOUR-/.test(c.SUPABASE_URL + c.SUPABASE_ANON_KEY))); }
