// All data access goes through window.API, so pages never talk to the database directly.
(function () {
  if (window.API) return; // a test harness may provide its own
  const cfg = window.CS_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  let meCache = null;

  window.API = {
    async session() { const { data } = await sb.auth.getSession(); return data.session; },
    async signIn(email, password) { ok(await sb.auth.signInWithPassword({ email, password })); meCache = null; },
    async signUp(email, password, name, phone) {
      const d = ok(await sb.auth.signUp({ email, password, options: { data: { name, phone } } }));
      meCache = null;
      return { needsConfirm: !d.session };
    },
    async resetPassword(email) { ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/login.html?reset=1" })); },
    async setPassword(password) { ok(await sb.auth.updateUser({ password })); },
    onAuth(cb) { sb.auth.onAuthStateChange((ev) => cb(ev)); },
    async signOut() { await sb.auth.signOut(); meCache = null; },

    async me(force) {
      if (meCache && !force) return meCache;
      const s = await this.session(); if (!s) return null;
      const uid = s.user.id;
      const profile = ok(await sb.from("profiles").select("*").eq("id", uid).maybeSingle());
      const customer = ok(await sb.from("customers").select("*").eq("user_id", uid).maybeSingle());
      meCache = { id: uid, email: s.user.email, role: profile ? profile.role : "customer", name: profile ? profile.name : "", profile, customer };
      return meCache;
    },
    async settings() { return ok(await sb.from("settings").select("*").eq("id", 1).single()); },
    async nextDeliveryDate() { return ok(await sb.rpc("next_delivery_date")); },

    // customer
    async updateMyCustomer(id, fields) { return ok(await sb.from("customers").update(fields).eq("id", id).select().single()); },
    async myOrders(customerId) { return ok(await sb.from("orders").select("*").eq("customer_id", customerId).order("delivery_date", { ascending: false }).order("created_at", { ascending: false })); },
    async placeOrder(o) { return ok(await sb.from("orders").insert(o).select().single()); },
    async cancelOrder(id) { ok(await sb.rpc("cancel_my_order", { p_id: id })); },

    // rider
    async riderOrders(date, uid) { return ok(await sb.from("orders").select("*").eq("rider_id", uid).eq("delivery_date", date).neq("status", "cancelled").order("seq", { ascending: true, nullsFirst: false })); },
    async riderUpdate(id, status, paid) { ok(await sb.rpc("rider_update", { p_id: id, p_status: status, p_paid: paid })); },
    async customersByIds(ids) { if (!ids.length) return []; return ok(await sb.from("customers").select("id,note").in("id", ids)); },

    // admin
    async orders(date) { return ok(await sb.from("orders").select("*").eq("delivery_date", date).order("created_at")); },
    async allOrderCounts() { return ok(await sb.from("orders").select("id,customer_id,delivery_date,status,created_at")); },
    async saveOrder(o) {
      const { id, ...rest } = o;
      if (id) return ok(await sb.from("orders").update(rest).eq("id", id).select().single());
      return ok(await sb.from("orders").insert(rest).select().single());
    },
    async deleteOrder(id) { ok(await sb.from("orders").delete().eq("id", id)); },
    async customers() { return ok(await sb.from("customers").select("*").order("name")); },
    async saveCustomer(c) {
      const { id, created_at, ...rest } = c;
      if (id) return ok(await sb.from("customers").update(rest).eq("id", id).select().single());
      return ok(await sb.from("customers").insert(rest).select().single());
    },
    async deleteCustomer(id) { ok(await sb.from("customers").delete().eq("id", id)); },
    async profiles() { return ok(await sb.from("profiles").select("*").order("name")); },
    async setRole(id, role) { ok(await sb.from("profiles").update({ role }).eq("id", id)); },
    async saveSettings(s) { const { id, updated_at, ...rest } = s; return ok(await sb.from("settings").update({ ...rest, updated_at: new Date().toISOString() }).eq("id", 1).select().single()); },
    async farms() { return ok(await sb.from("farms").select("*").order("created_at")); },
    async saveFarm(f) { const { id, created_at, ...rest } = f; if (id) return ok(await sb.from("farms").update(rest).eq("id", id).select().single()); return ok(await sb.from("farms").insert(rest).select().single()); },
    async farmPrices(farmId, limit = 30) { return ok(await sb.from("farm_prices").select("*").eq("farm_id", farmId).order("price_date", { ascending: false }).limit(limit)); },
    async farmOrder(farmId, date) { return ok(await sb.from("farm_orders").select("*").eq("farm_id", farmId).eq("delivery_date", date).maybeSingle()); },
    async farmTotals(date) { return ok(await sb.rpc("admin_farm_totals", { d: date })); },
    async week(date) { return ok(await sb.from("weeks").select("*").eq("delivery_date", date).maybeSingle()); },
    async saveWeek(w) { return ok(await sb.from("weeks").upsert(w).select().single()); },
  };
})();
