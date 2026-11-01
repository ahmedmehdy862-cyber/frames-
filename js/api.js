/* ========================================
   FRAMEO — طبقة الاتصال بالخادم (Supabase)
   - الزوار: قراءة الفريمات العامة فقط + فتح فريم خاص بمفتاحه
   - الإدارة: تسجيل دخول حقيقي + إدارة الفريمات والصور والحسابات
   كل الصلاحيات تُفرض في قاعدة البيانات (RLS) وليس في المتصفح.
   ======================================== */
'use strict';

const Api = (() => {
  const cfg = window.FRAMEO_CONFIG || {};
  const BUCKET = 'frames';
  const PUBLIC_COLS = 'id,name,visibility,image_path,config,sort_order,updated_at';

  const configured = !!(
    cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    /^https:\/\//.test(cfg.SUPABASE_URL) && !/YOUR_/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY)
  );

  let sb = null;
  function client() {
    if (!configured) return null;
    if (!sb) {
      if (!window.supabase || !window.supabase.createClient) return null;
      sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
    }
    return sb;
  }

  /* ---------- helpers ---------- */
  function imageUrl(path) {
    if (!path) return '';
    if (/^(https?:|data:|blob:|assets\/|\.\/|\/)/.test(path)) return path;
    return cfg.SUPABASE_URL.replace(/\/$/, '') + '/storage/v1/object/public/' + BUCKET + '/' + encodeURI(path);
  }

  const num = (v, d, min, max) => {
    v = Number(v);
    if (!isFinite(v)) return d;
    return Math.min(max, Math.max(min, v));
  };

  // يحوّل صف قاعدة البيانات إلى الشكل الذي يفهمه المحرر
  function toFrame(row) {
    const c = row.config || {};
    const W = num(c.canvasWidth, 2500, 100, 10000);
    const H = num(c.canvasHeight, 2500, 100, 10000);
    const pa = c.photoArea || {};
    const text = {};
    Object.entries(c.text && typeof c.text === 'object' ? c.text : {}).forEach(([k, t]) => {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(k) || !t || typeof t !== 'object') return;
      text[k] = {
        x: num(t.x, W / 2, -W, W * 2), y: num(t.y, H / 2, -H, H * 2),
        fontSize: num(t.fontSize, 48, 8, 600),
        fontWeight: t.fontWeight === 'normal' ? 'normal' : 'bold',
        color: /^#[0-9a-fA-F]{3,8}$/.test(t.color || '') ? t.color : '#FFFFFF',
        align: ['left', 'right', 'center'].includes(t.align) ? t.align : 'center',
        label: String(t.label || k).slice(0, 80),
        placeholder: t.placeholder ? String(t.placeholder).slice(0, 80) : undefined,
        value: typeof t.value === 'string' && t.value ? t.value.slice(0, 120) : undefined,
        options: Array.isArray(t.options) ? t.options.map(o => String(o).slice(0, 80)).slice(0, 30) : undefined
      };
    });
    return {
      id: row.id,
      name: row.name,
      visibility: row.visibility,
      accessKey: row.access_key || null,
      sortOrder: row.sort_order || 0,
      imagePath: row.image_path,
      image: imageUrl(row.image_path),
      canvasWidth: W,
      canvasHeight: H,
      photoArea: {
        x: num(pa.x, 0, -W, W * 2), y: num(pa.y, 0, -H, H * 2),
        width: num(pa.width, 500, 10, W * 2), height: num(pa.height, 500, 10, H * 2)
      },
      textColors: Array.isArray(c.textColors) && c.textColors.length
        ? c.textColors.filter(x => /^#[0-9a-fA-F]{3,8}$/.test(x)).slice(0, 12) : ['#FFFFFF'],
      text,
      stickers: Array.isArray(c.stickers) ? c.stickers.map(s => ({
        id: String(s.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40),
        name: String(s.name || s.id || '').slice(0, 60),
        imagePath: s.image || '',
        image: imageUrl(s.image),
        x: num(s.x, 0, -W, W * 2), y: num(s.y, 0, -H, H * 2),
        w: num(s.w, 200, 5, W * 2), h: num(s.h, 200, 5, H * 2)
      })).filter(s => s.id && s.image) : [],
      layerOrder: Array.isArray(c.layerOrder) ? c.layerOrder.map(String) : undefined
    };
  }

  // يحوّل كائن الفريم (من نموذج الإدارة) إلى صف قاعدة بيانات
  function toRow(f) {
    const row = {
      id: f.id,
      name: f.name,
      visibility: f.visibility,
      access_key: f.visibility === 'private' ? f.accessKey : null,
      image_path: f.imagePath,
      sort_order: f.sortOrder || 0,
      config: {
        canvasWidth: f.canvasWidth, canvasHeight: f.canvasHeight,
        photoArea: f.photoArea, textColors: f.textColors, text: f.text,
        stickers: (f.stickers || []).map(s => ({ id: s.id, name: s.name, image: s.imagePath, x: s.x, y: s.y, w: s.w, h: s.h })),
        layerOrder: f.layerOrder
      }
    };
    return row;
  }

  function genKey() {
    const b = new Uint8Array(18);
    crypto.getRandomValues(b);
    return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /* ---------- الزوار ---------- */
  async function listPublic() {
    const c = client();
    if (!c) throw new Error('not_configured');
    const { data, error } = await c.from('frames').select(PUBLIC_COLS)
      .eq('visibility', 'public').order('sort_order').order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(toFrame);
  }

  async function getPrivate(id, key) {
    const c = client();
    if (!c) throw new Error('not_configured');
    const { data, error } = await c.rpc('get_private_frame', { p_id: id, p_key: key });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? toFrame(row) : null;
  }

  /* ---------- الإدارة: الدخول ---------- */
  async function signIn(email, password) {
    const c = client();
    if (!c) throw new Error('not_configured');
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }
  async function signOut() { const c = client(); if (c) await c.auth.signOut(); }
  async function getSession() {
    const c = client(); if (!c) return null;
    const { data } = await c.auth.getSession();
    return data ? data.session : null;
  }
  async function getProfile() {
    const c = client(); if (!c) return null;
    const s = await getSession();
    if (!s) return null;
    const { data, error } = await c.from('profiles').select('id,email,display_name,role,active').eq('id', s.user.id).maybeSingle();
    if (error) throw error;
    return data && data.active ? data : null;
  }
  async function changeOwnPassword(pw) {
    const c = client();
    const { error } = await c.auth.updateUser({ password: pw });
    if (error) throw error;
  }

  /* ---------- الإدارة: الفريمات ---------- */
  async function listAll() {
    const c = client();
    const { data, error } = await c.from('frames').select('*').order('sort_order').order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(toFrame);
  }
  async function insertFrame(f) {
    const { error } = await client().from('frames').insert(toRow(f));
    if (error) throw error;
  }
  async function updateFrame(oldId, f) {
    const { error } = await client().from('frames').update(toRow(f)).eq('id', oldId);
    if (error) throw error;
  }
  async function deleteFrame(id) {
    const { error } = await client().from('frames').delete().eq('id', id);
    if (error) throw error;
  }

  /* ---------- الإدارة: الصور ---------- */
  const MIME = { png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
  async function uploadImage(blob, ext) {
    ext = String(ext || '').toLowerCase().replace('jpeg', 'jpg');
    if (!MIME[ext]) throw new Error('unsupported_type');
    const path = (crypto.randomUUID ? crypto.randomUUID() : genKey()) + '.' + ext;
    const { error } = await client().storage.from(BUCKET).upload(path, blob, {
      contentType: MIME[ext], cacheControl: '31536000', upsert: false
    });
    if (error) throw error;
    return path;
  }
  async function copyImage(path) {
    const ext = String(path).split('.').pop();
    const dest = (crypto.randomUUID ? crypto.randomUUID() : genKey()) + '.' + ext;
    const { error } = await client().storage.from(BUCKET).copy(path, dest);
    if (error) throw error;
    return dest;
  }
  async function removeImages(paths) {
    const list = (paths || []).filter(p => p && !/^(https?:|data:|assets\/)/.test(p));
    if (!list.length) return;
    await client().storage.from(BUCKET).remove(list);
  }

  /* ---------- الإدارة: الحسابات (owner فقط) ---------- */
  async function listProfiles() {
    const { data, error } = await client().from('profiles').select('id,email,display_name,role,active,created_at').order('created_at');
    if (error) throw error;
    return data || [];
  }
  async function adminUsers(payload) {
    const { data, error } = await client().functions.invoke('admin-users', { body: payload });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* ignore */ }
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  return {
    configured, client, imageUrl, genKey, toFrame,
    listPublic, getPrivate,
    signIn, signOut, getSession, getProfile, changeOwnPassword,
    listAll, insertFrame, updateFrame, deleteFrame,
    uploadImage, copyImage, removeImages,
    listProfiles, adminUsers
  };
})();
