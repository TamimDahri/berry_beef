// Admin dashboard: orders, customers, riders, farm order, money, team and settings.
let me, S, date, orders = [], customers = [], profiles = [], week = null, counts = [], farms = [], farmPrices = [], farmConf = null, carriers = [], trips = [];
const st = { tab: "orders", filter: "all", confirm: null };
const TABS = [["orders", "Orders"], ["customers", "Customers"], ["riders", "Riders"], ["farm", "Farm & packing"], ["carriers", "Carriers"], ["money", "Money"], ["team", "Team"], ["settings", "Settings"]];
const WEEK0 = { cost_mixed: 20, cost_big: 32, cost_white: 20, trip: false, trip_cost: 0, collector: "", extra_mixed: 0, extra_big: 0, extra_white: 0 };

(async () => {
  if (!configured()) return (location.href = "login.html");
  me = await guard(["admin"]);
  appHeader(me, "Admin");
  S = await API.settings();
  const q = new URLSearchParams(location.search);
  date = q.get("date") || nearestDeliveryDay(S);
  st.tab = TABS.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : "orders";
  await loadAll();
  window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (TABS.some((t) => t[0] === h)) { st.tab = h; render(); } });
})().catch((e) => { if (!/signed in|wrong role/.test(e.message)) showFatal("Something went wrong: " + e.message); });

async function loadAll() {
  [orders, customers, profiles, week, counts, farms] = await Promise.all([API.orders(date), API.customers(), API.profiles(), API.week(date), API.allOrderCounts(), API.farms().catch(() => [])]);
  [carriers, trips] = await Promise.all([API.carriers().catch(() => []), API.shipments(date).catch(() => [])]);
  await loadFarm();
  render();
}
async function loadDay() { [orders, week, trips] = await Promise.all([API.orders(date), API.week(date), API.shipments(date).catch(() => [])]); await loadFarm(); render(); }
async function loadFarm() {
  const f = farms.find((x) => x.active) || farms[0];
  if (!f) { farmPrices = []; farmConf = null; return; }
  try { [farmPrices, farmConf] = await Promise.all([API.farmPrices(f.id, 30), API.farmOrder(f.id, date)]); } catch (e) { farmPrices = []; farmConf = null; }
}
// Latest farm price on or before the day we order from the farm (the day before delivery).
function farmPriceFor(d) { const od = isoDate(new Date(parseISO(d).getTime() - 864e5)); return farmPrices.find((p) => p.price_date <= od) || farmPrices.find((p) => p.price_date <= d) || null; }

const W = () => { const fp = farmPriceFor(date); return { ...WEEK0, ...(fp ? { cost_mixed: num(fp.mixed), cost_big: num(fp.big), cost_white: num(fp.white) } : {}), delivery_date: date, collector: me.name || "Owner", ...(week || {}) }; };
const live = () => orders.filter((o) => o.status !== "cancelled");
const staff = () => profiles.filter((p) => p.role === "rider" || p.role === "admin");
const riders = () => profiles.filter((p) => p.role === "rider");
const staffName = (id) => { const p = profiles.find((x) => x.id === id); return p ? p.name || "Unnamed" : "Unassigned"; };
const staffUserIds = () => new Set(profiles.filter((p) => p.role !== "customer").map((p) => p.id));
const custCount = (cid) => counts.filter((o) => o.customer_id === cid && o.status !== "cancelled").length;
const collectable = (o) => !o.paid && o.pay !== "online";

function render() {
  const t = st.tab;
  $("#main").innerHTML = `
    <div class="toolbar"><div><h1>${t === "customers" || t === "team" || t === "settings" ? esc(TABS.find((x) => x[0] === t)[1].toLowerCase()) : fmtDate(date, true).toLowerCase()}</h1>
      ${["orders", "riders", "farm", "carriers", "money"].includes(t) ? `<p class="sub">Orders close ${cutoffText(date, S)}.</p>` : ""}</div>
      ${["orders", "riders", "farm", "carriers", "money"].includes(t) ? `<label class="f" style="margin-left:auto">Delivery day<input type="date" id="date" value="${date}"></label>` : ""}</div>
    <nav class="tabs" aria-label="Admin sections">${TABS.map(([k, l]) => `<a href="#${k}" class="${k === t ? "on" : ""}">${l}</a>`).join("")}</nav>
    <div id="view">${({ orders: vOrders, customers: vCustomers, riders: vRiders, farm: vFarm, carriers: vCarriers, money: vMoney, team: vTeam, settings: vSettings })[t]()}</div>`;
  const d = $("#date"); if (d) d.onchange = (e) => { if (e.target.value) { date = e.target.value; history.replaceState(null, "", "?date=" + date + location.hash); loadDay(); } };
}

/* ---------- orders ---------- */
function vOrders() {
  const l = live(), kg = l.reduce((a, o) => a + num(o.total_kg), 0), rev = l.reduce((a, o) => a + num(o.total), 0);
  const zones = (S.zones || []).map((z) => z.name), f = st.filter;
  const shown = orders.filter((o) => f === "all" || (f === "unpaid" ? !o.paid && o.status !== "cancelled" : f === "unassigned" ? !o.rider_id && o.status !== "cancelled" : o.zone === f));
  return `<div class="toolbar"><p><strong>${l.length} orders</strong>, ${kgf(kg)}, ${rm(rev)}</p><button class="btn" style="margin-left:auto" onclick="orderDialog()">New order</button></div>
    <div class="tabs" style="margin-top:0">${["all", "unpaid", "unassigned", ...zones].map((z) => `<a href="javascript:void 0" class="${f === z ? "on" : ""}" onclick="st.filter='${esc(z)}';render()">${z === "all" ? "All" : z === "unpaid" ? "Unpaid" : z === "unassigned" ? "No rider" : esc(z)}</a>`).join("")}</div>
    ${shown.length ? `<ul class="list">${shown.map(orderRow).join("")}</ul>` : `<p class="empty">No orders here yet. Customers who log in can order themselves, or add one with New order.</p>`}
    <div class="panel tint" style="margin-top:28px" data-copybox><h2>whatsapp announcement</h2><p class="sub">Post this in your group.</p>
      <textarea class="msg" readonly style="margin-top:12px">${esc(announcement())}</textarea>
      <button class="btn btn-quiet" style="margin-top:10px" onclick="copyText(this.parentNode.querySelector('textarea').value,this)">Copy message</button></div>`;
}
function orderRow(o) {
  const c = st.confirm === o.id;
  return `<li class="item"><div><div class="t">${esc(o.name || "No name")} ${o.created_by && customers.some((x) => x.id === o.customer_id && x.user_id === o.created_by) ? chip("Ordered online", "g") : ""}</div>
    <div class="m">${esc([o.zone, o.address + (o.unit ? " (" + o.unit + ")" : ""), o.phone].filter(Boolean).join(" · "))}</div>
    <div>${esc(itemsText(o))}</div><div class="m">${esc(packText(o))}${o.note ? " · " + esc(o.note) : ""}</div></div>
    <div><div class="amt">${rm(o.total)}</div><div class="m" style="text-align:right">${o.fee > 0 ? "incl. " + rm(o.fee) + " delivery" : "free delivery"}</div>
      <div style="text-align:right;margin-top:4px">${payChip(o)} ${statusChip(o)}</div><div class="m" style="text-align:right">${esc(o.rider_id ? staffName(o.rider_id) : "No rider")}</div></div>
    <div class="acts"><button class="btn btn-small btn-quiet" onclick="orderDialog('${o.id}')">Edit</button>
      <button class="btn btn-small btn-quiet" onclick="patchOrder('${o.id}',{paid:${!o.paid}})">${o.paid ? "Mark unpaid" : "Mark paid"}</button>
      ${o.status === "cancelled" ? `<button class="linkbtn" onclick="patchOrder('${o.id}',{status:'new'})">Restore</button>` : `<button class="linkbtn" onclick="patchOrder('${o.id}',{status:'cancelled'})">Cancel</button>`}
      ${c ? `<button class="linkbtn danger" onclick="delOrder('${o.id}')">Yes, delete for good</button><button class="linkbtn" onclick="st.confirm=null;render()">Keep</button>` : `<button class="linkbtn danger" onclick="st.confirm='${o.id}';render()">Delete</button>`}</div></li>`;
}
function announcement() {
  return `🍓 Cameron Strawberry – fresh Cameron Highlands strawberries
Delivery: ${fmtDate(date, true)}, 3pm–9pm (Damansara to Ampang)

Mixed size RM${S.price_mixed}/kg
Big RM${S.price_big}/kg
White RM${S.price_white}/500g

Minimum 1kg (white 500g), then in 500g steps.
Free delivery from ${S.free_from_kg}kg (any mix), RM${S.fee} below that.

Order by ${cutoffText(date, S)}:
cameronstrawberry.com/account
or reply here with your name, address and kilos.`;
}
async function patchOrder(id, patch) {
  const o = orders.find((x) => x.id === id);
  try { const n = await API.saveOrder({ id, ...patch }); Object.assign(o, n); render(); } catch (e) { toast(e.message); }
}
async function delOrder(id) { try { await API.deleteOrder(id); orders = orders.filter((o) => o.id !== id); st.confirm = null; render(); toast("Order deleted"); } catch (e) { toast(e.message); } }

function dialog(html, onSubmit) {
  let d = $("#dlg"); if (!d) { d = document.createElement("dialog"); d.id = "dlg"; document.body.append(d); }
  d.innerHTML = `<form method="dialog" id="dlgf" novalidate>${html}<div id="dmsg"></div><div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px"><button class="btn btn-quiet" value="cancel" formnovalidate>Close</button><button class="btn" value="ok">Save</button></div></form>`;
  d.showModal();
  $("#dlgf").onsubmit = async (e) => {
    if (e.submitter && e.submitter.value === "cancel") return;
    e.preventDefault();
    const btn = e.submitter; if (btn) btn.disabled = true;
    try { const r = await onSubmit(new FormData(e.target)); if (r !== false) d.close(); }
    catch (err) { $("#dmsg").innerHTML = `<div class="err">${esc(err.message)}</div>`; }
    finally { if (btn) btn.disabled = false; }
  };
  return d;
}
const fail = (m) => { $("#dmsg").innerHTML = `<div class="err">${esc(m)}</div>`; return false; };
const custLabel = (c) => `${c.name}${c.phone ? " – " + c.phone : ""}${c.address ? " – " + c.address : ""}`;

function orderDialog(id, custId) {
  const o = id ? orders.find((x) => x.id === id) : { delivery_date: date, mixed: 0, big: 0, white: 0, pay: "cash", paid: false, status: "new", rider_id: null, note: "", customer_id: custId || null };
  const c0 = customers.find((c) => c.id === o.customer_id);
  const base = c0 || o;
  const d = dialog(`<h2>${id ? "edit order" : "new order"}</h2><p class="sub">${fmtDate(o.delivery_date, true)}</p>
    <label class="f" style="margin-top:14px">Customer <small>(type to search; leave empty for a new customer)</small><input name="cust" list="custlist" value="${c0 ? esc(custLabel(c0)) : ""}" autocomplete="off"></label>
    <datalist id="custlist">${customers.filter((c) => !staffUserIds().has(c.user_id)).map((c) => `<option value="${esc(custLabel(c))}"></option>`).join("")}</datalist>
    <div class="row2"><label class="f">Name<input name="name" value="${esc(id ? o.name : base.name || "")}"></label><label class="f">Phone<input name="phone" value="${esc(id ? o.phone : base.phone || "")}"></label></div>
    <div class="row2"><label class="f">Building or street<input name="address" value="${esc(id ? o.address : base.address || "")}"></label><label class="f">Unit<input name="unit" value="${esc(id ? o.unit : base.unit || "")}"></label></div>
    <div class="row2"><label class="f">Area<select name="zone">${(S.zones || []).map((z) => `<option ${z.name === (id ? o.zone : base.zone) ? "selected" : ""}>${esc(z.name)}</option>`).join("")}</select></label>
      <label class="f">Rider<select name="rider_id"><option value="">No rider yet</option>${staff().map((p) => `<option value="${p.id}" ${p.id === o.rider_id ? "selected" : ""}>${esc(p.name || "Unnamed")}${p.role === "admin" ? " (admin)" : ""}</option>`).join("")}</select></label></div>
    <div class="row3"><label class="f">Mixed kg<input name="mixed" type="number" min="0" step="0.5" value="${num(o.mixed) || ""}"></label><label class="f">Big kg<input name="big" type="number" min="0" step="0.5" value="${num(o.big) || ""}"></label><label class="f">White kg<input name="white" type="number" min="0" step="0.5" value="${num(o.white) || ""}"></label></div>
    <p class="sub" id="osum"></p>
    <div class="row2"><label class="f">Payment<select name="pay">${Object.entries(PAY).map(([k, v]) => `<option value="${k}" ${o.pay === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="check" style="margin-top:30px"><input type="checkbox" name="paid" ${o.paid ? "checked" : ""}> Paid</label></div>
    <label class="f">Note for the rider<input name="note" value="${esc(id ? o.note : base.note || "")}"></label>
    ${id ? "" : `<label class="check"><input type="checkbox" name="savecust" checked> Save these details to the customer's profile</label>`}`, async (fd) => {
    const v = (k) => String(fd.get(k) || "").trim();
    const picked = customers.find((c) => custLabel(c) === v("cust"));
    const n = { name: v("name"), phone: v("phone"), address: v("address"), unit: v("unit"), zone: v("zone"), note: v("note"), mixed: num(v("mixed")), big: num(v("big")), white: num(v("white")), pay: v("pay"), paid: fd.get("paid") === "on", rider_id: v("rider_id") || null };
    if (!n.name) return fail("Add the customer's name.");
    const errs = validateQty(n); if (errs.length) return fail(errs.join(" "));
    let customer_id = id ? o.customer_id : picked ? picked.id : null;
    if (!id && fd.get("savecust") === "on") {
      const dup = !picked && customers.find((c) => digits(c.phone) && digits(c.phone) === digits(n.phone));
      const cid = picked ? picked.id : dup ? dup.id : null;
      const saved = await API.saveCustomer({ ...(cid ? { id: cid } : {}), name: n.name, phone: n.phone, address: n.address, unit: n.unit, zone: n.zone, note: n.note });
      customers = customers.filter((c) => c.id !== saved.id).concat(saved); customer_id = saved.id;
    }
    const saved = await API.saveOrder({ ...(id ? { id } : { delivery_date: date, status: "new" }), customer_id, ...n });
    orders = orders.filter((x) => x.id !== saved.id).concat(saved).sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (!id) counts.push(saved);
    render(); toast(id ? "Order updated" : "Order added");
  });
  const f = $("#dlgf");
  const sum = () => { const q = { mixed: f.mixed.value, big: f.big.value, white: f.white.value }, p = priceOf(q, S); $("#osum").textContent = p.kg ? `${kgf(p.kg)} · ${packText(q)} · ${rm(p.total)}${p.fee ? " incl. " + rm(p.fee) + " delivery" : " free delivery"}` : "Add kilos for at least one product."; };
  f.cust.oninput = () => { const c = customers.find((x) => custLabel(x) === f.cust.value); if (c) { ["name", "phone", "address", "unit", "note"].forEach((k) => (f[k].value = c[k] || "")); if (c.zone) f.zone.value = c.zone; } };
  ["mixed", "big", "white"].forEach((k) => (f[k].oninput = sum)); sum();
}

/* ---------- customers ---------- */
function vCustomers() {
  const staffIds = staffUserIds();
  const list = customers.filter((c) => !staffIds.has(c.user_id));
  return `<div class="toolbar"><label class="f" style="flex:1;max-width:420px">Search<input id="cs" placeholder="Name, phone, building or unit" oninput="filterCust(this.value)"></label>
      <button class="btn" style="margin-left:auto" onclick="custDialog()">Add customer</button></div>
    <p class="sub">${list.length} customers. Regulars you add here are linked to their account automatically when they sign up with the same phone number.</p>
    <ul class="list" style="margin-top:14px">${list.map((c) => `<li class="item" data-s="${esc([c.name, c.phone, c.address, c.unit, c.zone].join(" ").toLowerCase())}">
      <div><div class="t">${esc(c.name || "No name")} ${c.user_id ? chip("Has login", "g") : ""} ${c.zone ? chip(c.zone) : ""}</div>
      <div class="m">${esc(c.address || "No address")}${c.unit ? " · Unit " + esc(c.unit) : ""}${c.phone ? " · " + esc(c.phone) : ""}</div>
      ${c.note ? `<div class="m">${esc(c.note)}</div>` : ""}</div>
      <div class="m" style="text-align:right">${custCount(c.id)} order${custCount(c.id) === 1 ? "" : "s"}</div>
      <div class="acts"><button class="btn btn-small" onclick="orderDialog(null,'${c.id}')">New order for ${fmtDate(date)}</button>
        <button class="btn btn-small btn-quiet" onclick="custDialog('${c.id}')">Edit</button>
        ${st.confirm === c.id ? `<button class="linkbtn danger" onclick="delCust('${c.id}')">Yes, delete</button><button class="linkbtn" onclick="st.confirm=null;render()">Keep</button>` : `<button class="linkbtn danger" onclick="st.confirm='${c.id}';render()">Delete</button>`}</div></li>`).join("")}</ul>`;
}
function filterCust(q) { q = q.trim().toLowerCase(); $$("[data-s]").forEach((el) => (el.style.display = !q || el.dataset.s.includes(q) ? "" : "none")); }
function custDialog(id) {
  const c = id ? customers.find((x) => x.id === id) : { name: "", phone: "", address: "", unit: "", zone: (S.zones[0] || {}).name || "", note: "" };
  dialog(`<h2>${id ? "edit customer" : "add customer"}</h2>
    <div class="row2" style="margin-top:14px"><label class="f">Name<input name="name" value="${esc(c.name)}"></label><label class="f">WhatsApp number<input name="phone" value="${esc(c.phone)}"></label></div>
    <div class="row2"><label class="f">Building or street<input name="address" value="${esc(c.address)}"></label><label class="f">Unit<input name="unit" value="${esc(c.unit)}"></label></div>
    <label class="f">Area<select name="zone">${(S.zones || []).map((z) => `<option ${z.name === c.zone ? "selected" : ""}>${esc(z.name)}</option>`).join("")}</select></label>
    <label class="f">Delivery note for riders<input name="note" value="${esc(c.note)}"></label>`, async (fd) => {
    const v = (k) => String(fd.get(k) || "").trim();
    if (!v("name")) return fail("Add the customer's name.");
    const dup = customers.find((x) => x.id !== id && digits(x.phone) && digits(x.phone) === digits(v("phone")));
    if (dup) return fail(`${dup.name} already has this phone number.`);
    const saved = await API.saveCustomer({ ...(id ? { id } : {}), name: v("name"), phone: v("phone"), address: v("address"), unit: v("unit"), zone: v("zone"), note: v("note") });
    customers = customers.filter((x) => x.id !== saved.id).concat(saved).sort((a, b) => a.name.localeCompare(b.name));
    render(); toast("Customer saved");
  });
}
async function delCust(id) { try { await API.deleteCustomer(id); customers = customers.filter((c) => c.id !== id); st.confirm = null; render(); toast("Customer deleted. Past orders are kept."); } catch (e) { toast(e.message); } }

/* ---------- riders ---------- */
const riderStops = (rid) => live().filter((o) => o.rider_id === rid).sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999) || a.created_at.localeCompare(b.created_at));
function vRiders() {
  const w = W(), people = staff(), un = live().filter((o) => !o.rider_id || !people.some((p) => p.id === o.rider_id));
  if (!riders().length) return `<div class="panel tint"><h2>no riders yet</h2><p class="sub" style="margin-top:8px">Ask each rider to create an account on the log in page, then make them a rider in the Team tab.</p></div>`;
  return `<div class="toolbar"><p>Pickup at TBS: <strong>${esc(w.collector)}</strong>. Rider pay ${rm(S.rider_per_drop)} per drop.</p>
      <button class="btn" style="margin-left:auto" onclick="autoAssign()">Auto-assign by area</button></div>
    ${un.length ? `<div class="note">${un.length} order${un.length > 1 ? "s have" : " has"} no rider yet.</div>` : ""}
    <div class="grid2">${people.filter((p) => p.role === "rider" || riderStops(p.id).length).map(riderCard).join("")}</div>`;
}
function riderCard(p) {
  const stops = riderStops(p.id), groups = stopGroups(stops), { links } = routeLinks(groups, S);
  const collect = stops.filter(collectable).reduce((a, o) => a + num(o.total), 0);
  return `<section class="panel"><h2>${esc(p.name || "Unnamed")}</h2><p class="sub">${groups.length} stop${groups.length === 1 ? "" : "s"}, ${stops.length} drop${stops.length === 1 ? "" : "s"}, pay ${rm(stops.length * S.rider_per_drop)}, to collect ${rm(collect)}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">${links.map((l) => `<a class="btn btn-small btn-quiet" target="_blank" rel="noopener" href="${esc(l.url)}">${links.length === 1 ? "Open route in Google Maps" : `Maps: stops ${l.from} to ${l.to}`}</a>`).join("")}</div>
    ${groups.length ? `<ol class="list">${groups.map((g, j) => `<li class="stop ${g.orders.every((o) => o.status === "delivered") ? "done" : ""}"><div class="num">${j + 1}</div><div>
      <div class="addr">${esc(g.orders[0].address || g.orders[0].zone || "No address")}</div>
      ${g.orders.map((o) => `<div class="person">${esc(o.name)}${o.unit ? " (" + esc(o.unit) + ")" : ""} ${statusChip(o)} ${payChip(o)}<div class="m">${esc(packText(o))}</div>
        <label class="f" style="margin:6px 0 0;font-weight:400">Move to <select onchange="moveTo('${o.id}',this.value)" style="display:inline-block;width:auto;margin:0 0 0 6px;padding:4px 8px">${staff().map((x) => `<option value="${x.id}" ${x.id === p.id ? "selected" : ""}>${esc(x.name || "Unnamed")}</option>`).join("")}<option value="">No rider</option></select></label></div>`).join("")}
      </div><div class="updown"><button class="btn btn-small btn-quiet" aria-label="Move stop up" onclick="moveStop('${p.id}',${j},-1)">▲</button><button class="btn btn-small btn-quiet" aria-label="Move stop down" onclick="moveStop('${p.id}',${j},1)">▼</button></div></li>`).join("")}</ol>` : `<p class="empty">No stops.</p>`}
    <div data-copybox style="margin-top:14px"><textarea class="msg" readonly>${esc(riderMessage(p))}</textarea>
      <button class="btn btn-small btn-quiet" style="margin-top:8px" onclick="copyText(this.parentNode.querySelector('textarea').value,this)">Copy list for WhatsApp</button></div></section>`;
}
function riderMessage(p) {
  const stops = riderStops(p.id), groups = stopGroups(stops), { links } = routeLinks(groups, S);
  let m = `Cameron Strawberry – ${p.name || "Rider"} · ${fmtDateBM(date)} (${groups.length} stop)\nMula di TBS. Senarai juga ada di cameronstrawberry.com/rider\n`;
  links.forEach((l) => (m += `Route ${l.from}–${l.to}: ${l.url}\n`));
  const line = (o) => `${o.name}${o.phone ? " " + o.phone : ""} – ${packText(o, true)}` + (o.note ? `\n     Nota: ${o.note}` : "") + (collectable(o) ? `\n     Kutip ${rm(o.total)} (${o.pay === "cash" ? "tunai" : "QR"})` : "");
  groups.forEach((g, j) => {
    const f = g.orders[0];
    m += g.orders.length === 1 ? `\n${j + 1}. ${f.address || f.zone}${f.unit ? " (" + f.unit + ")" : ""} – ${line(f)}\n` : `\n${j + 1}. ${f.address}\n` + g.orders.map((o) => `   - ${o.unit ? "(" + o.unit + ") " : ""}${line(o)}\n`).join("");
  });
  return m + `\nJumlah perlu kutip: ${rm(stops.filter(collectable).reduce((a, o) => a + num(o.total), 0))}`;
}
async function moveTo(id, rid) { await patchOrder(id, { rider_id: rid || null, seq: rid ? riderStops(rid).length + 1 : null }); }
async function moveStop(rid, j, dir) {
  const groups = stopGroups(riderStops(rid)), k = j + dir; if (k < 0 || k >= groups.length) return;
  [groups[j], groups[k]] = [groups[k], groups[j]];
  const flat = groups.flatMap((g) => g.orders);
  try { for (let i = 0; i < flat.length; i++) if (flat[i].seq !== i + 1) { const n = await API.saveOrder({ id: flat[i].id, seq: i + 1 }); Object.assign(orders.find((o) => o.id === n.id), n); } render(); } catch (e) { toast(e.message); }
}
async function autoAssign() {
  const rs = riders(), l = live(); if (!rs.length) return toast("Add a rider in the Team tab first");
  const todo = l.filter((o) => !o.rider_id || !staff().some((p) => p.id === o.rider_id));
  if (!todo.length) return toast("Every order already has a rider");
  const load = rs.map((r) => l.filter((o) => o.rider_id === r.id).length), order = { West: 0, Central: 1, East: 2 };
  todo.sort((a, b) => (order[a.zone] ?? 3) - (order[b.zone] ?? 3) || (a.address || "").localeCompare(b.address || ""));
  try {
    for (const o of todo) {
      let i = o.zone === "West" ? 0 : o.zone === "East" ? rs.length - 1 : load.indexOf(Math.min(...load));
      load[i]++; const n = await API.saveOrder({ id: o.id, rider_id: rs[i].id, seq: load[i] }); Object.assign(o, n);
    }
    render(); toast(`Assigned ${todo.length} order${todo.length > 1 ? "s" : ""}`);
  } catch (e) { toast(e.message); }
}

/* ---------- farm ---------- */
function farmTotals() {
  const w = W(), t = { mixed: { kg: 0, box: 0, packs: 0 }, big: { kg: 0, box: 0, packs: 0 }, white: { kg: 0, box: 0, packs: 0 } };
  for (const o of live()) { for (const p of PRODUCTS) t[p.k].kg += num(o[p.k]); for (const p of packing(o)) { t[p.k].box += p.box; t[p.k].packs += p.packs; } }
  for (const p of PRODUCTS) t[p.k].packs += num(w["extra_" + p.k]);
  return t;
}
function vFarm() {
  const w = W(), t = farmTotals();
  const msg = `Salam, order Cameron Strawberry untuk penghantaran ${fmtDateBM(date)}:\n\n` + PRODUCTS.map((p) => { const x = t[p.k], s = []; if (x.box) s.push(x.box + " kotak 2kg"); if (x.packs) s.push(x.packs + " pek 500g"); return s.length ? `${p.bm}: ${s.join(" + ")}` : null; }).filter(Boolean).join("\n") + "\n\nMohon sahkan kuantiti dan harga. Terima kasih.";
  return `${farmSection(t)}<div class="grid2" style="margin-top:20px"><section class="panel"><h2>what to order</h2><p class="sub">The farm needs this one day before delivery. Every 2kg in an order is a box, the rest are 500g packs.</p>
      <table style="margin-top:12px"><thead><tr><th>Product</th><th class="n">Ordered</th><th class="n">2kg boxes</th><th class="n">500g packs</th><th class="n">Extra packs</th></tr></thead><tbody>
      ${PRODUCTS.map((p) => `<tr><td>${p.label}</td><td class="n">${kgf(t[p.k].kg)}</td><td class="n">${p.k === "white" ? "–" : t[p.k].box}</td><td class="n">${t[p.k].packs}</td><td class="n"><input type="number" min="0" step="1" value="${num(w["extra_" + p.k])}" style="width:70px;padding:6px;border:3px solid #000;border-radius:8px;text-align:right" aria-label="Extra ${p.label} packs" onchange="saveWeek({extra_${p.k}: Math.max(0, Math.round(+this.value||0))})"></td></tr>`).join("")}</tbody></table>
      <div data-copybox style="margin-top:16px"><textarea class="msg" readonly>${esc(msg)}</textarea><button class="btn btn-small btn-quiet" style="margin-top:8px" onclick="copyText(this.parentNode.querySelector('textarea').value,this)">Copy message for the farm</button></div></section>
    <section class="panel tint"><h2>this week's costs</h2>
      <div class="row3" style="margin-top:14px"><label class="f">Mixed RM/kg<input type="number" min="0" step="0.5" value="${w.cost_mixed}" onchange="saveWeek({cost_mixed:+this.value||0})"></label>
        <label class="f">Big RM/kg<input type="number" min="0" step="0.5" value="${w.cost_big}" onchange="saveWeek({cost_big:+this.value||0})"></label>
        <label class="f">White RM/500g<input type="number" min="0" step="0.5" value="${w.cost_white}" onchange="saveWeek({cost_white:+this.value||0})"></label></div>
      <label class="check"><input type="checkbox" ${w.trip ? "checked" : ""} onchange="saveWeek({trip:this.checked}).then(render)"> I drove to Cameron Highlands myself</label>
      ${w.trip ? `<label class="f">Trip cost: fuel, tolls, other (RM)<input type="number" min="0" step="1" value="${w.trip_cost}" onchange="saveWeek({trip_cost:+this.value||0})"></label>` : `<p class="sub" style="margin-bottom:14px">Runner ${rm(S.runner_per_kg)}/kg and bus ${rm(S.bus_per_kg)}/kg are added in Money.</p>`}
      <label class="f">Who collects at TBS<input value="${esc(w.collector)}" list="collectors" onchange="saveWeek({collector:this.value.trim()})"></label>
      <datalist id="collectors"><option value="${esc(me.name || "Owner")}"></option><option value="Both riders"></option>${riders().map((r) => `<option value="${esc(r.name)}"></option>`).join("")}</datalist></section></div>
    <section class="panel" style="margin-top:20px"><h2>packing list</h2>${live().length ? `<table style="margin-top:10px"><thead><tr><th>Customer</th><th>Area</th><th>Pack</th><th>Rider</th></tr></thead><tbody>${live().map((o) => `<tr><td>${esc(o.name)}${o.unit ? " (" + esc(o.unit) + ")" : ""}</td><td>${esc(o.zone)}</td><td>${esc(packText(o))}</td><td>${esc(o.rider_id ? staffName(o.rider_id) : "–")}</td></tr>`).join("")}</tbody></table>` : `<p class="empty">No orders yet.</p>`}</section>`;
}
function farmLink(f) { return location.origin + "/farm.html?k=" + f.token; }
function farmSection(t) {
  const f = farms.find((x) => x.active) || farms[0];
  if (!f) return `<section class="panel tint"><h2>your farm</h2><p class="sub">Add the farm to give the farmer a private link. She enters her prices and confirms your order there, and her price fills in this week's costs.</p>
    <form onsubmit="event.preventDefault();addFarm(new FormData(this))" style="margin-top:14px"><div class="row2"><label class="f">Farm name<input name="name" placeholder="e.g. Ladang Kak Ros"></label><label class="f">Farmer's WhatsApp<input name="phone" type="tel"></label></div>
    <button class="btn">Add farm</button></form></section>`;
  const p = farmPrices[0], fresh = p && p.price_date === todayMY();
  const now = { mixed_box: 0, mixed_pack: 0, big_box: 0, big_pack: 0, white_pack: 0 };
  for (const k of ["mixed", "big"]) { now[k + "_box"] = t[k].box; now[k + "_pack"] = t[k].packs; } now.white_pack = t.white.packs;
  const changed = farmConf && Object.keys(now).some((k) => num(farmConf.snapshot[k]) !== now[k]);
  const msg = `Salam ${f.name}, ini pautan untuk kemas kini harga strawberi dan sahkan pesanan Cameron Strawberry. Simpan pautan ini:\n${farmLink(f)}`;
  return `<section class="panel tint"><div class="toolbar" style="margin:0"><div><h2>${esc(f.name.toLowerCase())}</h2><p class="sub">${esc(f.phone || "No phone saved")}</p></div>
      <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">${f.phone ? `<a class="btn btn-small" target="_blank" rel="noopener" href="https://wa.me/${waPhone(f.phone)}?text=${encodeURIComponent(msg)}">Send her link on WhatsApp</a>` : ""}
      <button class="btn btn-small btn-quiet" onclick="copyText('${farmLink(f)}',this)">Copy link</button>
      ${st.confirm === "farmtoken" ? `<button class="linkbtn danger" onclick="newFarmLink()">Yes, make a new link</button><button class="linkbtn" onclick="st.confirm=null;render()">Keep</button>` : `<button class="linkbtn" onclick="st.confirm='farmtoken';render()">New link</button>`}</div></div>
    <div class="grid2" style="margin-top:16px">
      <div><h3>latest price</h3>${p ? `<p style="margin-top:6px"><strong>${fmtDate(p.price_date)}</strong>${fresh ? " " + chip("Today", "g") : p.price_date < isoDate(new Date(Date.now() - 2 * 864e5)) ? " " + chip("Not updated for a while", "a") : ""}</p>
        <table style="margin-top:6px"><tbody><tr><td>Mixed</td><td class="n">${rm(p.mixed)}/kg</td><td class="n">${p.stock_mixed != null ? kgf(p.stock_mixed) + " in stock" : ""}</td></tr>
        <tr><td>Big</td><td class="n">${rm(p.big)}/kg</td><td class="n">${p.stock_big != null ? kgf(p.stock_big) + " in stock" : ""}</td></tr>
        <tr><td>White</td><td class="n">${rm(p.white)}/500g</td><td class="n">${p.stock_white != null ? kgf(p.stock_white) + " in stock" : ""}</td></tr></tbody></table>
        ${p.note ? `<p class="note">${esc(p.note)}</p>` : ""}` : `<p class="sub">No prices yet. Send her the link.</p>`}</div>
      <div><h3>order for ${fmtDate(date).toLowerCase()}</h3>
        ${farmConf ? `<div class="${changed ? "note" : "ok"}">${changed ? "Orders changed after she confirmed. Ask her to check the link again." : "She confirmed on " + esc(new Date(farmConf.confirmed_at).toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", weekday: "short", hour: "numeric", minute: "2-digit" })) + "."}</div>
          ${farmConf.note ? `<p class="note">${esc(farmConf.note)}</p>` : ""}` : `<p class="sub" style="margin-top:6px">Not confirmed yet. She sees the boxes and packs on her link and taps confirm. Her price then becomes this week's cost.</p>`}</div></div>
    ${farmPrices.length > 1 ? priceChart() : ""}</section>`;
}
function priceChart() {
  const pts = [...farmPrices].reverse(), W0 = 640, H0 = 200, L = 44, R0 = 16, T = 16, B = 30;
  const max = Math.max(...pts.flatMap((p) => [num(p.mixed), num(p.big), num(p.white) * 2])) * 1.1 || 1;
  const x = (i) => L + (pts.length === 1 ? 0 : (i * (W0 - L - R0)) / (pts.length - 1)), y = (v) => T + (1 - v / max) * (H0 - T - B);
  const line = (k, mult, color) => `<polyline fill="none" stroke="${color}" stroke-width="3" points="${pts.map((p, i) => x(i) + "," + y(num(p[k]) * mult)).join(" ")}"/>` + pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(num(p[k]) * mult)}" r="3.5" fill="${color}"><title>${fmtDate(p.price_date)}: ${rm(num(p[k]) * mult)}/kg</title></circle>`).join("");
  const ticks = [0, max / 2, max].map((v) => `<line x1="${L}" x2="${W0 - R0}" y1="${y(v)}" y2="${y(v)}" stroke="#E7DCDA"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#5E5656">RM${Math.round(v)}</text>`).join("");
  return `<h3 style="margin-top:20px">farm price per kg, last ${pts.length} updates</h3>
    <svg viewBox="0 0 ${W0} ${H0}" style="width:100%;max-width:${W0}px;margin-top:8px" role="img" aria-label="Farm prices per kg over time">${ticks}
    ${line("big", 1, "#C9363F")}${line("mixed", 1, "#F0585F")}${line("white", 2, "#8AC45C")}
    <text x="${L}" y="${H0 - 8}" font-size="11" fill="#5E5656">${fmtDate(pts[0].price_date)}</text><text x="${W0 - R0}" y="${H0 - 8}" text-anchor="end" font-size="11" fill="#5E5656">${fmtDate(pts.at(-1).price_date)}</text></svg>
    <p class="sub"><span style="color:#C9363F;font-weight:700">Big</span>, <span style="color:#F0585F;font-weight:700">Mixed</span> and <span style="color:#3F7F22;font-weight:700">White</span> (white shown per kg, so double its 500g price).</p>`;
}
async function addFarm(fd) {
  const name = String(fd.get("name") || "").trim(); if (!name) return toast("Add the farm name");
  try { const f = await API.saveFarm({ name, phone: String(fd.get("phone") || "").trim() }); farms.push(f); await loadFarm(); render(); toast("Farm added"); } catch (e) { toast(e.message); }
}
async function newFarmLink() {
  const f = farms.find((x) => x.active) || farms[0], b = new Uint8Array(24); crypto.getRandomValues(b);
  const token = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  try { const n = await API.saveFarm({ id: f.id, token }); Object.assign(f, n); st.confirm = null; render(); toast("New link made. The old link no longer works."); } catch (e) { toast(e.message); }
}
async function saveWeek(patch) { try { week = await API.saveWeek({ ...W(), ...patch }); toast("Saved"); } catch (e) { toast(e.message); } }

/* ---------- money ---------- */
function vMoney() {
  const w = W(), l = live(), kg = l.reduce((a, o) => a + num(o.total_kg), 0);
  const sales = l.reduce((a, o) => a + num(o.subtotal), 0), fees = l.reduce((a, o) => a + num(o.fee), 0);
  const farm = (o) => num(o.mixed) * w.cost_mixed + num(o.big) * w.cost_big + num(o.white) * 2 * w.cost_white;
  const tr = liveTrips(), carriedKg = Math.min(kg, tr.reduce((a, x) => a + tripKg(x), 0)), carrierFees = tr.reduce((a, x) => a + num(x.fee), 0);
  const busKg = Math.max(0, kg - carriedKg);
  const farmT = l.reduce((a, o) => a + farm(o), 0), trans = (w.trip ? num(w.trip_cost) : busKg * (num(S.runner_per_kg) + num(S.bus_per_kg))) + carrierFees, ridersT = l.length * num(S.rider_per_drop);
  const rev = sales + fees, cost = farmT + trans + ridersT, profit = rev - cost;
  const per = l.map((o) => ({ o, p: num(o.total) - farm(o) - (kg ? trans * num(o.total_kg) / kg : 0) - num(S.rider_per_drop) }));
  const losing = per.filter((x) => x.p < 0);
  const by = { online: 0, qr: 0, cash: 0 }; let unpaid = 0; for (const o of l) { if (o.paid) by[o.pay] += num(o.total); else unpaid += num(o.total); }
  return `${losing.length ? `<div class="note">${losing.length} order${losing.length > 1 ? "s lose" : " loses"} money at this week's farm price: ${losing.map((x) => esc(x.o.name) + " (" + rm(x.p) + ")").join(", ")}.</div>` : ""}
    <div class="kpis"><div class="kpi"><div class="l">Revenue</div><div class="v">${rm(rev)}</div></div><div class="kpi"><div class="l">Costs</div><div class="v">${rm(cost)}</div></div>
      <div class="kpi"><div class="l">Profit</div><div class="v" style="color:${profit < 0 ? "var(--red-deep)" : "var(--leaf-deep)"}">${rm(profit)}</div></div><div class="kpi"><div class="l">Profit per kg</div><div class="v">${kg ? rm(profit / kg) : "–"}</div></div></div>
    <div class="grid2"><section class="panel"><h2>breakdown</h2><table style="margin-top:10px"><tbody>
      <tr><td>Strawberry sales (${kgf(kg)})</td><td class="n">${rm(sales)}</td></tr><tr><td>Delivery fees</td><td class="n">${rm(fees)}</td></tr>
      <tr><td>Farm cost</td><td class="n">−${rm(farmT)}</td></tr><tr><td>${w.trip ? "Cameron trip" : `Runner and bus (${kgf(busKg)})`}${carrierFees ? ` and carriers (${kgf(carriedKg)})` : ""}</td><td class="n">−${rm(trans)}</td></tr>
      <tr><td>Rider pay (${l.length} drops)</td><td class="n">−${rm(ridersT)}</td></tr></tbody><tfoot><tr><th>Profit</th><th class="n">${rm(profit)}</th></tr></tfoot></table></section>
    <section class="panel"><h2>payments</h2><table style="margin-top:10px"><tbody><tr><td>Paid online</td><td class="n">${rm(by.online)}</td></tr><tr><td>Paid by QR</td><td class="n">${rm(by.qr)}</td></tr><tr><td>Paid cash</td><td class="n">${rm(by.cash)}</td></tr></tbody>
      <tfoot><tr><th>Still unpaid</th><th class="n">${rm(unpaid)}</th></tr></tfoot></table>
      ${l.filter((o) => !o.paid).length ? `<p class="sub" style="margin-top:10px">Unpaid: ${l.filter((o) => !o.paid).map((o) => esc(o.name)).join(", ")}</p>` : ""}</section></div>
    <p class="sub" style="margin-top:14px">Farm prices come from Farm &amp; packing. Cancelled orders are left out.</p>`;
}

/* ---------- carriers ---------- */
const TRIP = { assigned: ["Waiting for reply", "a"], accepted: ["Accepted", "g"], declined: ["Declined", "r"], picked_up: ["Picked up at farm", "a"], delivered: ["Handed over", "g"], received: ["Received", "g"], cancelled: ["Cancelled", "r"] };
const liveTrips = () => trips.filter((x) => !["cancelled", "declined"].includes(x.status));
const tripKg = (x) => (num(x.mixed_box) + num(x.big_box)) * 2 + (num(x.mixed_pack) + num(x.big_pack) + num(x.white_pack)) * 0.5;
const tripLoad = (x) => [["Mixed", x.mixed_box, x.mixed_pack], ["Big", x.big_box, x.big_pack], ["White", 0, x.white_pack]].filter(([, b, p]) => b || p).map(([n, b, p]) => n + " " + [b ? b + " box" + (b > 1 ? "es" : "") : "", p ? p + " pack" + (p > 1 ? "s" : "") : ""].filter(Boolean).join(" + ")).join(", ") || "Nothing yet";
const carrierLink = (c) => location.origin + "/carry.html?k=" + c.token;
const at = (ts) => (ts ? new Date(ts).toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", weekday: "short", hour: "numeric", minute: "2-digit" }) : "");
function vCarriers() {
  return `<p class="sub" style="margin-bottom:16px">Drivers you know who can bring stock down when the bus is full or as a backup. Each driver gets a private link to accept a trip and mark it picked up and handed over. Use people you know personally, and keep the fee for a trip they are already making.</p>
    <section class="panel tint"><div class="toolbar" style="margin:0"><h2>trips for ${fmtDate(date).toLowerCase()}</h2>${carriers.some((c) => c.active) ? `<button class="btn" style="margin-left:auto" onclick="tripDialog()">Assign a trip</button>` : ""}</div>
      ${trips.length ? `<ul class="list" style="margin-top:12px">${trips.map(tripRow).join("")}</ul>` : `<p class="empty">${carriers.length ? "No trips for this day. Everything comes by bus." : "Add a driver below first."}</p>`}</section>
    <section class="panel"><div class="toolbar" style="margin:0"><h2>drivers</h2><button class="btn btn-quiet" style="margin-left:auto" onclick="carrierDialog()">Add driver</button></div>
      ${carriers.length ? `<ul class="list" style="margin-top:12px">${carriers.map(carrierRow).join("")}</ul>` : `<p class="empty">No drivers yet.</p>`}</section>`;
}
function carrierRow(c) {
  const msg = `Salam ${c.name}, ini pautan Cameron Strawberry untuk trip bawa strawberi dari Cameron Highlands. Simpan pautan ini:\n${carrierLink(c)}`;
  return `<li class="item"><div><div class="t">${esc(c.name)} ${c.active ? "" : chip("Not active", "r")}</div>
    <div class="m">${esc([c.phone, c.vehicle].filter(Boolean).join(" · "))}</div>${c.note ? `<div class="m">${esc(c.note)}</div>` : ""}</div><div></div>
    <div class="acts">${c.phone ? `<a class="btn btn-small" target="_blank" rel="noopener" href="https://wa.me/${waPhone(c.phone)}?text=${encodeURIComponent(msg)}">Send link on WhatsApp</a>` : ""}
      <button class="btn btn-small btn-quiet" onclick="copyText('${carrierLink(c)}',this)">Copy link</button>
      <button class="btn btn-small btn-quiet" onclick="carrierDialog('${c.id}')">Edit</button>
      ${st.confirm === "tok" + c.id ? `<button class="linkbtn danger" onclick="newCarrierLink('${c.id}')">Yes, make a new link</button><button class="linkbtn" onclick="st.confirm=null;render()">Keep</button>` : `<button class="linkbtn" onclick="st.confirm='tok${c.id}';render()">New link</button>`}</div></li>`;
}
function tripRow(x) {
  const [label, cls] = TRIP[x.status] || ["", ""], c = carriers.find((y) => y.id === x.carrier_id) || {};
  const msg = `Salam ${c.name}, boleh tolong bawa strawberi untuk ${fmtDateBM(x.delivery_date)}? Butiran dan butang terima di sini:\n${c.token ? carrierLink(c) : ""}`;
  const times = [x.accepted_at && "Accepted " + at(x.accepted_at), x.picked_at && "Picked up " + at(x.picked_at), x.delivered_at && "Handed over " + at(x.delivered_at), x.received_at && "Received " + at(x.received_at)].filter(Boolean);
  return `<li class="item"><div><div class="t">${esc(c.name || "Driver")} ${chip(label, cls)} ${x.paid ? chip("Paid", "g") : ""}</div>
      <div>${esc(tripLoad(x))} (${kgf(tripKg(x))})</div><div class="m">To ${esc(x.dropoff)}${x.meet_time ? ", " + esc(x.meet_time) : ""}</div>
      ${times.length ? `<div class="m">${times.map(esc).join(". ")}.</div>` : ""}
      ${x.carrier_note ? `<div class="note">Driver: ${esc(x.carrier_note)}</div>` : ""}</div>
    <div class="amt">${rm(x.fee)}</div>
    <div class="acts">${c.phone && ["assigned", "declined"].includes(x.status) ? `<a class="btn btn-small" target="_blank" rel="noopener" href="https://wa.me/${waPhone(c.phone)}?text=${encodeURIComponent(msg)}">Ask on WhatsApp</a>` : ""}
      ${["picked_up", "delivered"].includes(x.status) ? `<button class="btn btn-small btn-green" onclick="patchTrip('${x.id}',{status:'received',received_at:new Date().toISOString()})">Mark received</button>` : ""}
      <button class="btn btn-small btn-quiet" onclick="patchTrip('${x.id}',{paid:${!x.paid}})">${x.paid ? "Mark unpaid" : "Mark paid"}</button>
      <button class="btn btn-small btn-quiet" onclick="tripDialog('${x.id}')">Edit</button>
      ${x.status === "cancelled" ? `<button class="linkbtn" onclick="patchTrip('${x.id}',{status:'assigned'})">Restore</button>` : `<button class="linkbtn" onclick="patchTrip('${x.id}',{status:'cancelled'})">Cancel</button>`}</div></li>`;
}
async function patchTrip(id, patch) { try { const n = await API.saveShipment({ id, ...patch }); Object.assign(trips.find((x) => x.id === id), n); render(); } catch (e) { toast(e.message); } }
function tripDialog(id) {
  const t = farmTotals(), x = id ? trips.find((y) => y.id === id) : { carrier_id: (carriers.find((c) => c.active) || {}).id, mixed_box: t.mixed.box, mixed_pack: t.mixed.packs, big_box: t.big.box, big_pack: t.big.packs, white_pack: t.white.packs, fee: 0, dropoff: S.start_point, meet_time: "", admin_note: "" };
  const n = (label, k) => `<label class="f">${label}<input name="${k}" type="number" min="0" step="1" value="${num(x[k])}"></label>`;
  dialog(`<h2>${id ? "edit trip" : "assign a trip"}</h2><p class="sub">${fmtDate(date, true)}. ${id ? "" : "Filled in with this week's full farm order. Lower it if the driver only takes part and the rest comes by bus."}</p>
    <label class="f" style="margin-top:14px">Driver<select name="carrier_id">${carriers.filter((c) => c.active || c.id === x.carrier_id).map((c) => `<option value="${c.id}" ${c.id === x.carrier_id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
    <div class="row2">${n("Mixed 2kg boxes", "mixed_box")}${n("Mixed 500g packs", "mixed_pack")}</div>
    <div class="row3">${n("Big boxes", "big_box")}${n("Big packs", "big_pack")}${n("White packs", "white_pack")}</div>
    <div class="row2"><label class="f">Fee (RM)<input name="fee" type="number" min="0" step="1" value="${num(x.fee)}"></label><label class="f">Meet time<input name="meet_time" value="${esc(x.meet_time)}" placeholder="e.g. Rabu 3 petang"></label></div>
    <label class="f">Drop-off<input name="dropoff" value="${esc(x.dropoff)}"></label>
    <label class="f">Note for the driver<input name="admin_note" value="${esc(x.admin_note)}" placeholder="e.g. Call Tamim when you reach Rawang"></label>`, async (fd) => {
    const v = (k) => String(fd.get(k) || "").trim(), i = (k) => Math.max(0, Math.round(num(v(k))));
    const rec = { carrier_id: v("carrier_id"), mixed_box: i("mixed_box"), mixed_pack: i("mixed_pack"), big_box: i("big_box"), big_pack: i("big_pack"), white_pack: i("white_pack"), fee: Math.max(0, num(v("fee"))), meet_time: v("meet_time"), dropoff: v("dropoff") || S.start_point, admin_note: v("admin_note") };
    if (!rec.carrier_id) return fail("Choose a driver.");
    if (tripKg(rec) === 0) return fail("Add at least one box or pack.");
    const saved = await API.saveShipment(id ? { id, ...rec } : { ...rec, delivery_date: date, status: "assigned" });
    trips = trips.filter((y) => y.id !== saved.id).concat(saved); render(); toast(id ? "Trip updated" : "Trip assigned. Tap Ask on WhatsApp to let the driver know.");
  });
}
function carrierDialog(id) {
  const c = id ? carriers.find((x) => x.id === id) : { name: "", phone: "", vehicle: "", note: "", active: true };
  dialog(`<h2>${id ? "edit driver" : "add driver"}</h2>
    <div class="row2" style="margin-top:14px"><label class="f">Name<input name="name" value="${esc(c.name)}"></label><label class="f">WhatsApp number<input name="phone" type="tel" value="${esc(c.phone)}"></label></div>
    <label class="f">Car and plate number<input name="vehicle" value="${esc(c.vehicle)}" placeholder="e.g. Perodua Myvi, ABC 1234"></label>
    <label class="f">Note <small>(only you see this)</small><input name="note" value="${esc(c.note)}" placeholder="e.g. drives down every Wednesday morning"></label>
    ${id ? `<label class="check"><input type="checkbox" name="active" ${c.active ? "checked" : ""}> Active (can get trips and open the link)</label>` : ""}`, async (fd) => {
    const v = (k) => String(fd.get(k) || "").trim();
    if (!v("name")) return fail("Add the driver's name.");
    const saved = await API.saveCarrier({ ...(id ? { id, active: fd.get("active") === "on" } : {}), name: v("name"), phone: v("phone"), vehicle: v("vehicle"), note: v("note") });
    carriers = carriers.filter((x) => x.id !== saved.id).concat(saved); render(); toast("Driver saved");
  });
}
async function newCarrierLink(id) {
  const b = new Uint8Array(24); crypto.getRandomValues(b); const token = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  try { const n = await API.saveCarrier({ id, token }); Object.assign(carriers.find((c) => c.id === id), n); st.confirm = null; render(); toast("New link made. The old link no longer works."); } catch (e) { toast(e.message); }
}

/* ---------- team ---------- */
function vTeam() {
  return `<p class="sub">Everyone who has created an account. Make someone a rider so they can open the rider page and appear in Riders. Admins can see and change everything.</p>
    <ul class="list" style="margin-top:14px">${profiles.map((p) => `<li class="item"><div><div class="t">${esc(p.name || "No name")} ${p.id === me.id ? chip("You", "g") : ""}</div><div class="m">${esc(p.phone || "")}</div></div>
      <div><select aria-label="Role for ${esc(p.name)}" ${p.id === me.id ? "disabled" : ""} onchange="setRole('${p.id}',this.value)" style="font:inherit;padding:8px;border:3px solid #000;border-radius:10px">${["customer", "rider", "admin"].map((r) => `<option ${p.role === r ? "selected" : ""} value="${r}">${r[0].toUpperCase() + r.slice(1)}</option>`).join("")}</select></div></li>`).join("")}</ul>`;
}
async function setRole(id, role) { try { await API.setRole(id, role); profiles.find((p) => p.id === id).role = role; render(); toast("Role updated"); } catch (e) { toast(e.message); } }

/* ---------- settings ---------- */
function vSettings() {
  const n = (label, k, step = 1) => `<label class="f">${label}<input type="number" min="0" step="${step}" value="${S[k]}" onchange="saveSetting('${k}',+this.value||0)"></label>`;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `<div class="grid2"><section class="panel"><h2>prices</h2><div class="row3" style="margin-top:14px">${n("Mixed RM/kg", "price_mixed")}${n("Big RM/kg", "price_big")}${n("White RM/500g", "price_white")}</div>
      <div class="row2">${n("Delivery fee RM", "fee")}${n("Free delivery from kg", "free_from_kg", 0.5)}</div><p class="sub">New prices apply to new orders. Orders already placed keep their price.</p></section>
    <section class="panel"><h2>running costs</h2><div class="row3" style="margin-top:14px">${n("Runner RM/kg", "runner_per_kg", 0.5)}${n("Bus RM/kg", "bus_per_kg", 0.5)}${n("Rider RM/drop", "rider_per_drop")}</div></section>
    <section class="panel"><h2>delivery days and cutoff</h2><div style="display:flex;gap:14px;flex-wrap:wrap;margin:14px 0">${days.map((d, i) => `<label class="check" style="margin:0"><input type="checkbox" ${S.delivery_days.includes(i) ? "checked" : ""} onchange="toggleDay(${i},this.checked)"> ${d}</label>`).join("")}</div>
      <div class="row2">${n("Close orders days before", "cutoff_days_before")}<label class="f">At hour (0–23)<input type="number" min="0" max="23" value="${S.cutoff_hour}" onchange="saveSetting('cutoff_hour',Math.min(23,Math.max(0,+this.value||0)))"></label></div>
      <p class="sub">Now: a ${days[S.delivery_days[0]] || ""} delivery closes ${S.cutoff_days_before} days before at ${S.cutoff_hour}:00.</p></section>
    <section class="panel"><h2>routes</h2><label class="f" style="margin-top:14px">Routes start from<input value="${esc(S.start_point)}" onchange="saveSetting('start_point',this.value.trim())"></label>${n("Stops per Google Maps link (max 9)", "stops_per_link")}</section>
    <section class="panel"><h2>areas</h2><p class="sub">Customers pick one of these. West goes to your first rider, East to your last, the rest are balanced.</p>
      ${(S.zones || []).map((z, i) => `<div class="row2" style="grid-template-columns:1fr 2fr;margin-top:10px"><label class="f">Area<input value="${esc(z.name)}" onchange="saveZone(${i},'name',this.value)"></label><label class="f">Places<input value="${esc(z.areas)}" onchange="saveZone(${i},'areas',this.value)"></label></div>`).join("")}</section></div>`;
}
async function saveSetting(k, v) { try { S = await API.saveSettings({ ...S, [k]: v }); toast("Saved"); render(); } catch (e) { toast(e.message); } }
function toggleDay(i, on) { const d = new Set(S.delivery_days); on ? d.add(i) : d.delete(i); if (!d.size) return (toast("Keep at least one delivery day"), render()); saveSetting("delivery_days", [...d].sort()); }
function saveZone(i, f, v) { const z = S.zones.map((x) => ({ ...x })); z[i][f] = v.trim(); saveSetting("zones", z); }
