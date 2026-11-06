// Your WhatsApp number, country code first, digits only (e.g. 60123456789).
const WHATSAPP_NUMBER = "60XXXXXXXXX";

const ORDER_TEMPLATE = `Hi Berry Beef, I'd like to order for Wednesday.

Name:
Phone:
Building / street:
Unit:
Mixed (kg):
Big (kg):
White (kg):
Pay by (QR / cash):`;

document.querySelectorAll("[data-wa]").forEach((a) => {
  a.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(ORDER_TEMPLATE)}`;
  a.target = "_blank";
  a.rel = "noopener";
});

// Next delivery, worked out in Malaysia time (UTC+8): every Wednesday, orders close Monday 10pm.
(function nextDrop() {
  const MY = 8 * 3600 * 1000;
  const now = Date.now();
  const my = new Date(now + MY); // read with getUTC* to get Malaysia wall-clock time
  const day = my.getUTCDay();
  let addDays = (3 - day + 7) % 7;
  const wed = () => Date.UTC(my.getUTCFullYear(), my.getUTCMonth(), my.getUTCDate() + addDays);
  let cutoff = wed() - 2 * 86400000 + 22 * 3600000 - MY; // Monday 22:00 Malaysia, as a real timestamp
  if (now >= cutoff) { addDays += 7; cutoff += 7 * 86400000; }
  const wedDate = new Date(wed());
  const cutDate = new Date(cutoff + MY);
  const fmt = (d, o) => d.toLocaleDateString("en-GB", { timeZone: "UTC", ...o });
  const wedText = fmt(wedDate, { weekday: "long", day: "numeric", month: "short" });
  const cutText = fmt(cutDate, { weekday: "long", day: "numeric", month: "short" });

  const ms = cutoff - now;
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000);
  const left = d > 0 ? `${d} day${d > 1 ? "s" : ""}, ${h} hour${h === 1 ? "" : "s"} left to order` : `${h} hour${h === 1 ? "" : "s"} left to order`;

  const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  set("nd-day", wedText);
  set("nd-cut", `Order by ${cutText}, 10pm`);
  set("nd-left", left);
  set("cta-cut", `Orders for ${wedText} close ${cutText} at 10pm.`);
  set("year", String(new Date().getFullYear()));
})();
