// FRAMEO — Edge Function: admin-users
// إدارة حسابات الإدارة (إنشاء / تعطيل / إعادة تعيين كلمة المرور / حذف).
// لا يقبل الطلب إلا من مستخدم مسجّل دخوله ودوره "owner" ونشِط.
// يعمل بصلاحية service_role على السيرفر فقط — المفتاح لا يصل للمتصفح أبداً.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const BAN_FOREVER = "876000h";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // 1) من هو المتصل؟
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "unauthorized" }, 401);
    const { data: caller, error: callerErr } = await admin.auth.getUser(token);
    if (callerErr || !caller?.user) return json({ error: "unauthorized" }, 401);

    // 2) لازم يكون owner نشِط
    const { data: me } = await admin
      .from("profiles")
      .select("role, active")
      .eq("id", caller.user.id)
      .maybeSingle();
    if (!me || !me.active || me.role !== "owner") return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    // مساعد: هل سيبقى owner نشِط آخر بعد العملية؟
    const otherActiveOwners = async (excludeId: string) => {
      const { count } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "owner")
        .eq("active", true)
        .neq("id", excludeId);
      return (count ?? 0) > 0;
    };

    switch (action) {
      case "create": {
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");
        const displayName = String(body.display_name || "").trim().slice(0, 80);
        const role = body.role === "owner" ? "owner" : "admin";
        if (!EMAIL_RE.test(email)) return json({ error: "invalid_email" }, 400);
        if (password.length < 10) return json({ error: "weak_password" }, 400);

        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (cErr || !created?.user) return json({ error: cErr?.message || "create_failed" }, 400);

        const { error: pErr } = await admin.from("profiles").insert({
          id: created.user.id,
          email,
          display_name: displayName || null,
          role,
          active: true,
        });
        if (pErr) {
          await admin.auth.admin.deleteUser(created.user.id); // تراجع كامل
          return json({ error: pErr.message }, 400);
        }
        return json({ ok: true, id: created.user.id });
      }

      case "set_active": {
        const id = String(body.id || "");
        const active = !!body.active;
        if (!id) return json({ error: "missing_id" }, 400);
        if (id === caller.user.id && !active) return json({ error: "cannot_disable_self" }, 400);
        const { data: target } = await admin.from("profiles").select("role").eq("id", id).maybeSingle();
        if (!target) return json({ error: "not_found" }, 404);
        if (!active && target.role === "owner" && !(await otherActiveOwners(id))) {
          return json({ error: "last_owner" }, 400);
        }
        const { error: uErr } = await admin.from("profiles").update({ active }).eq("id", id);
        if (uErr) return json({ error: uErr.message }, 400);
        // منع/السماح بتسجيل الدخول على مستوى Auth أيضاً
        await admin.auth.admin.updateUserById(id, { ban_duration: active ? "none" : BAN_FOREVER });
        return json({ ok: true });
      }

      case "reset_password": {
        const id = String(body.id || "");
        const password = String(body.password || "");
        if (!id) return json({ error: "missing_id" }, 400);
        if (password.length < 10) return json({ error: "weak_password" }, 400);
        const { error: rErr } = await admin.auth.admin.updateUserById(id, { password });
        if (rErr) return json({ error: rErr.message }, 400);
        return json({ ok: true });
      }

      case "set_role": {
        const id = String(body.id || "");
        const role = body.role === "owner" ? "owner" : "admin";
        if (!id) return json({ error: "missing_id" }, 400);
        const { data: target } = await admin.from("profiles").select("role").eq("id", id).maybeSingle();
        if (!target) return json({ error: "not_found" }, 404);
        if (target.role === "owner" && role !== "owner" && !(await otherActiveOwners(id))) {
          return json({ error: "last_owner" }, 400);
        }
        const { error: uErr } = await admin.from("profiles").update({ role }).eq("id", id);
        if (uErr) return json({ error: uErr.message }, 400);
        return json({ ok: true });
      }

      case "delete": {
        const id = String(body.id || "");
        if (!id) return json({ error: "missing_id" }, 400);
        if (id === caller.user.id) return json({ error: "cannot_delete_self" }, 400);
        const { data: target } = await admin.from("profiles").select("role").eq("id", id).maybeSingle();
        if (!target) return json({ error: "not_found" }, 404);
        if (target.role === "owner" && !(await otherActiveOwners(id))) {
          return json({ error: "last_owner" }, 400);
        }
        const { error: dErr } = await admin.auth.admin.deleteUser(id);
        if (dErr) return json({ error: dErr.message }, 400);
        return json({ ok: true });
      }

      default:
        return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    return json({ error: "server_error", detail: String((e as Error)?.message || e) }, 500);
  }
});
