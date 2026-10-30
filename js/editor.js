/* ========================================
   FRAME STUDIO — Editor Core (V3)
   Layer order:
      [0] User Image
      [1] Frame
      [2+] Text
   Text fields are built DYNAMICALLY from
   frameConfig.text. Each field may declare:
      - value   : fixed text (no input shown)
      - options : array -> rendered as <select>
      - colors  : array -> restricted color picker
   ======================================== */

'use strict';

const Editor = (() => {
  let canvas = null;
  let userImage = null;
  let frameImage = null;
  let textObjects = {};        // key -> fabric.Text
  let fieldState = {};         // key -> { text, fontSize, color }
  let currentStep = 1;
  let frameConfig = null;

  const el = {};

  // Preferred render order for known field keys; unknown keys appended after.
  const KEY_ORDER = ['name', 'title', 'details', 'role', 'track'];

  function cache() {
    [
      'editorCanvas','canvasContainer','canvasEmpty','canvasControls',
      'uploadZone','fileInput','uploadPreview','previewImg','removeImage',
      'framesGrid','textForm',
      'btnNext','btnPrev','mobileNext','mobilePrev',
      'zoomSlider','zoomValue','zoomIn','zoomOut','resetImage'
    ].forEach(id => { el[id] = document.getElementById(id); });
  }

  /* ===== FRAME CONFIG GUARDS ===== */
  // A frame config is user-editable JSON; fill in sane defaults so a missing
  // or malformed key can never crash the editor.
  function normalizeFrame(frame) {
    if (!frame) return frame;
    frame.canvasWidth = Number(frame.canvasWidth) || 1080;
    frame.canvasHeight = Number(frame.canvasHeight) || 1080;
    frame.photoArea = frame.photoArea || {
      x: 0, y: 0, width: frame.canvasWidth, height: frame.canvasHeight
    };
    frame.text = frame.text || {};
    return frame;
  }

  /* ===== CANVAS ===== */
  function initCanvas() {
    canvas = new fabric.Canvas('editorCanvas', {
      backgroundColor: '#e8e6e1',
      preserveObjectStacking: true,
      selection: false
    });
    fitCanvas();
    window.addEventListener('resize', fitCanvas);
  }

  function showFabricError() {
    if (el.canvasEmpty) {
      el.canvasEmpty.style.display = '';
      el.canvasEmpty.innerHTML =
        '<div class="canvas-empty__icon">' +
          '<svg width="40" height="40" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="15" stroke="currentColor" stroke-width="1.5"/><path d="M20 12v9M20 26v1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '</div>' +
        '<h3>تعذّر تحميل المحرر</h3>' +
        '<p>تأكد من اتصالك بالإنترنت ثم أعد تحميل الصفحة</p>';
    }
    if (el.canvasContainer) el.canvasContainer.style.display = 'none';
    if (el.canvasControls) el.canvasControls.style.display = 'none';
    App.showToast('تعذّر تحميل مكتبة المحرر (Fabric.js)', 'error', 6000);
  }

  function fitCanvas() {
    if (!canvas) return;
    const area = document.getElementById('canvasArea');
    if (!area) return;
    const fw = frameConfig ? frameConfig.canvasWidth : 928;
    const fh = frameConfig ? frameConfig.canvasHeight : 1152;
    const cs = getComputedStyle(area);
    const padBottom = parseFloat(cs.paddingBottom) || 0;
    const gap = 24;
    const availW = Math.max(area.clientWidth - 12, 50);
    const availH = Math.max(area.clientHeight - padBottom - gap, 50);
    const s = Math.min(availW / fw, availH / fh, 1);
    canvas.setDimensions({ width: Math.floor(fw * s), height: Math.floor(fh * s) });
    canvas.setZoom(s);
    canvas.renderAll();
  }

  /* ===== STEPS ===== */
  function goToStep(step) {
    if (step < 1 || step > 4) return;
    currentStep = step;
    document.querySelectorAll('.sidebar__panel').forEach(p =>
      p.classList.toggle('active', +p.dataset.panel === step)
    );
    document.querySelectorAll('.step-pill').forEach(b => {
      const s = +b.dataset.step;
      b.classList.toggle('active', s === step);
      b.classList.toggle('done', s < step);
    });
    if (el.btnPrev) el.btnPrev.style.display = step > 1 ? '' : 'none';
    if (el.mobilePrev) el.mobilePrev.style.display = step > 1 ? '' : 'none';
    if (el.btnNext) el.btnNext.style.display = step === 4 ? 'none' : '';
    if (el.mobileNext) el.mobileNext.style.display = step === 4 ? 'none' : '';
  }

  /* ===== UPLOAD ===== */
  function initUpload() {
    el.uploadZone.addEventListener('click', () => el.fileInput.click());
    el.uploadZone.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileInput.click(); }
    });
    el.uploadZone.addEventListener('dragover', e => { e.preventDefault(); el.uploadZone.classList.add('dragover'); });
    el.uploadZone.addEventListener('dragleave', () => el.uploadZone.classList.remove('dragover'));
    el.uploadZone.addEventListener('drop', e => {
      e.preventDefault(); el.uploadZone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    el.fileInput.addEventListener('change', () => { if (el.fileInput.files[0]) handleFile(el.fileInput.files[0]); });
    el.removeImage.addEventListener('click', removeImage);
  }

  function handleFile(file) {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
      App.showToast('صيغة غير مدعومة', 'error'); return;
    }
    if (file.size > 10 * 1024 * 1024) {
      App.showToast('الملف كبير جدًا — الحد 10MB', 'error'); return;
    }
    const r = new FileReader();
    r.onload = e => {
      placeUserImage(e.target.result);
      el.uploadZone.style.display = 'none';
      el.uploadPreview.style.display = '';
      el.previewImg.src = e.target.result;
      el.canvasEmpty.style.display = 'none';
      el.canvasContainer.style.display = '';
      el.canvasControls.style.display = '';
      App.showToast('تم رفع الصورة بنجاح', 'success');
    };
    r.readAsDataURL(file);
  }

  /* ===== USER IMAGE ===== */
  function placeUserImage(src) {
    fabric.Image.fromURL(src, img => {
      if (userImage) canvas.remove(userImage);
      userImage = img;

      const pa = frameConfig
        ? frameConfig.photoArea
        : { x: 273, y: 290, width: 385, height: 573 };

      const scX = pa.width / img.width;
      const scY = pa.height / img.height;
      const sc = Math.max(scX, scY);

      img.set({
        left: pa.x + pa.width / 2,
        top: pa.y + pa.height / 2,
        originX: 'center',
        originY: 'center',
        scaleX: sc,
        scaleY: sc,
        selectable: true,
        hasControls: true,
        hasBorders: true,
        borderColor: '#FBAE42',
        cornerColor: '#014976',
        cornerSize: 10,
        transparentCorners: false
      });

      canvas.add(img);
      canvas.sendToBack(img);
      restack();
      canvas.renderAll();
      updateZoom(100);
      App.showToast('حرّك الصورة لتظهر في الفتحة', 'info');
    });
  }

  function removeImage() {
    if (userImage) { canvas.remove(userImage); userImage = null; }
    el.uploadZone.style.display = '';
    el.uploadPreview.style.display = 'none';
    if (el.canvasContainer) el.canvasContainer.style.display = '';
    if (el.canvasControls) el.canvasControls.style.display = '';
    el.fileInput.value = '';
  }

  /* ===== FRAME ===== */
  function initFrameSelector() {
    FramesManager.renderFrameCards(el.framesGrid, frame => {
      frameConfig = frame;
      loadFrame(frame);
    });
  }

  function loadFrame(frame) {
    const src = frame.dataUrl || frame.image;
    fabric.Image.fromURL(src, img => {
      if (frameImage) canvas.remove(frameImage);
      frameImage = img;

      if (!frameConfig.canvasWidth) frameConfig.canvasWidth = img.width;
      if (!frameConfig.canvasHeight) frameConfig.canvasHeight = img.height;

      const fw = frameConfig.canvasWidth;
      const fh = frameConfig.canvasHeight;

      img.set({
        left: 0, top: 0,
        scaleX: fw / img.width,
        scaleY: fh / img.height,
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false
      });

      canvas.add(img);
      restack();

      if (el.canvasEmpty) el.canvasEmpty.style.display = 'none';
      if (el.canvasContainer) el.canvasContainer.style.display = '';
      if (el.canvasControls) el.canvasControls.style.display = '';

      canvas.renderAll();
      fitCanvas();
      createTexts(frameConfig);
      buildForm(frameConfig);

      if (userImage) repositionImage();
    });
  }

  function repositionImage() {
    if (!userImage || !frameConfig) return;
    const pa = frameConfig.photoArea;
    const nat = userImage._element;
    const scX = pa.width / nat.naturalWidth;
    const scY = pa.height / nat.naturalHeight;
    const sc = Math.max(scX, scY);
    userImage.set({
      left: pa.x + pa.width / 2,
      top: pa.y + pa.height / 2,
      originX: 'center', originY: 'center',
      scaleX: sc, scaleY: sc
    });
    canvas.renderAll();
  }

  function restack() {
    if (userImage) canvas.sendToBack(userImage);
    if (frameImage) canvas.bringToFront(frameImage);
    Object.values(textObjects).forEach(t => { if (t) canvas.bringToFront(t); });
  }

  /* ===== FIELD HELPERS ===== */
  function orderedKeys(frame) {
    const keys = Object.keys(frame.text || {});
    return keys.sort((a, b) => {
      const ia = KEY_ORDER.indexOf(a), ib = KEY_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }

  // Ensure a fieldState entry exists, seeded from config.
  function ensureState(key, cfg) {
    if (!fieldState[key]) {
      const fixed = typeof cfg.value === 'string';
      let initialText = fixed ? cfg.value : '';
      if (!fixed && Array.isArray(cfg.options) && cfg.options.length) initialText = cfg.options[0];
      fieldState[key] = {
        text: initialText,
        fontSize: cfg.fontSize || 42,
        color: cfg.color || '#FFFFFF'
      };
    }
    return fieldState[key];
  }

  /* ===== TEXT OBJECTS ===== */
  function createTexts(frame) {
    Object.keys(textObjects).forEach(k => {
      if (textObjects[k]) { canvas.remove(textObjects[k]); textObjects[k] = null; }
    });
    textObjects = {};
    if (!frame || !frame.text) { canvas.renderAll(); return; }

    orderedKeys(frame).forEach(key => {
      const cfg = frame.text[key];
      const st = ensureState(key, cfg);
      const fixed = typeof cfg.value === 'string';

      const t = new fabric.Text(st.text, {
        id: key,
        left: cfg.x,
        top: cfg.y,
        fontSize: st.fontSize,
        fontFamily: 'Cairo, Tajawal, sans-serif',
        fontWeight: cfg.fontWeight || 'normal',
        fill: st.color,
        textAlign: cfg.align || 'center',
        originX: 'center', originY: 'center',
        selectable: true, evented: true,
        hasControls: true, hasBorders: true,
        borderColor: '#FBAE42',
        cornerColor: '#014976',
        cornerSize: 10,
        transparentCorners: false,
        lockRotation: true
      });

      textObjects[key] = t;
      canvas.add(t);
      canvas.bringToFront(t);
    });
    canvas.renderAll();
  }

  function updateText(key, val) {
    if (textObjects[key]) { textObjects[key].set('text', val || ''); canvas.renderAll(); }
  }

  /* ===== DYNAMIC FORM ===== */
  function buildForm(frame) {
    if (!el.textForm) return;
    el.textForm.innerHTML = '';
    if (!frame || !frame.text) return;

    orderedKeys(frame).forEach(key => {
      const cfg = frame.text[key];
      const st = ensureState(key, cfg);
      const fixed = typeof cfg.value === 'string';
      const label = cfg.label || key;
      const group = document.createElement('div');
      group.className = 'form-group';

      // --- Fixed text: show read-only preview, no input ---
      if (fixed) {
        const lab = document.createElement('label');
        lab.className = 'form-label';
        lab.textContent = label;
        const box = document.createElement('div');
        box.className = 'form-static';
        box.textContent = cfg.value;
        group.appendChild(lab);
        group.appendChild(box);
        el.textForm.appendChild(group);
        return; // no further controls for fixed fields
      }

      // --- Label ---
      const lab = document.createElement('label');
      lab.className = 'form-label';
      lab.textContent = label;
      group.appendChild(lab);

      // --- Control: select (options) or text input ---
      const inputId = 'input-' + key;
      if (Array.isArray(cfg.options) && cfg.options.length) {
        const sel = document.createElement('select');
        sel.className = 'form-input form-select';
        sel.id = inputId;
        cfg.options.forEach(opt => {
          const o = document.createElement('option');
          o.value = opt; o.textContent = opt;
          sel.appendChild(o);
        });
        sel.value = st.text;
        sel.addEventListener('change', () => { st.text = sel.value; updateText(key, sel.value); });
        group.appendChild(sel);
      } else {
        const inp = document.createElement('input');
        inp.className = 'form-input';
        inp.type = 'text';
        inp.id = inputId;
        inp.placeholder = cfg.placeholder || ('أدخل ' + label);
        inp.maxLength = cfg.maxLength || 40;
        inp.value = st.text;
        inp.addEventListener('input', () => { st.text = inp.value; updateText(key, inp.value); });
        group.appendChild(inp);
      }
      el.textForm.appendChild(group);

      // --- Font size slider ---
      const sGroup = document.createElement('div');
      sGroup.className = 'form-group';
      const sLab = document.createElement('label');
      sLab.className = 'form-label';
      sLab.setAttribute('for', inputId + '-size');
      sLab.textContent = 'حجم خط ' + label;
      const sRow = document.createElement('div');
      sRow.className = 'range-row';
      const range = document.createElement('input');
      range.type = 'range'; range.className = 'form-range';
      range.id = inputId + '-size';
      range.min = 12; range.max = 90; range.value = st.fontSize;
      const sVal = document.createElement('span');
      sVal.className = 'range-val';
      sVal.textContent = st.fontSize + 'px';
      range.addEventListener('input', () => {
        const v = +range.value;
        st.fontSize = v;
        sVal.textContent = v + 'px';
        if (textObjects[key]) { textObjects[key].set('fontSize', v); canvas.renderAll(); }
      });
      sRow.appendChild(range);
      sRow.appendChild(sVal);
      sGroup.appendChild(sLab);
      sGroup.appendChild(sRow);
      el.textForm.appendChild(sGroup);

      // --- Divider between fields ---
      const div = document.createElement('div');
      div.className = 'form-divider';
      el.textForm.appendChild(div);
    });

    // --- Global text color: one control applies to ALL text objects ---
    if (Array.isArray(frame.textColors) && frame.textColors.length) {
      buildGlobalColorControl(frame);
    }
  }

  function buildGlobalColorControl(frame) {
    // Current shared color = fill of the first text object (all are synced).
    const first = Object.values(textObjects).find(t => t);
    const current = first ? first.fill : (frame.textColors[0]);

    const cGroup = document.createElement('div');
    cGroup.className = 'form-group';
    const cLab = document.createElement('label');
    cLab.className = 'form-label';
    cLab.textContent = 'لون النصوص';
    const cRow = document.createElement('div');
    cRow.className = 'color-row';
    cRow.setAttribute('role', 'group');
    cRow.setAttribute('aria-label', 'لون النصوص');

    frame.textColors.forEach(color => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'color-dot' + (color.toUpperCase() === String(current).toUpperCase() ? ' active' : '');
      dot.dataset.color = color;
      dot.style.background = color;
      if (color.toUpperCase() === '#FFFFFF') dot.style.border = '2px solid #ccc';
      dot.setAttribute('aria-label', 'لون النصوص: ' + color);
      dot.setAttribute('aria-pressed', color.toUpperCase() === String(current).toUpperCase() ? 'true' : 'false');
      dot.addEventListener('click', () => {
        cRow.querySelectorAll('.color-dot').forEach(d => {
          d.classList.remove('active'); d.setAttribute('aria-pressed', 'false');
        });
        dot.classList.add('active');
        dot.setAttribute('aria-pressed', 'true');
        setGlobalTextColor(color);
      });
      cRow.appendChild(dot);
    });

    cGroup.appendChild(cLab);
    cGroup.appendChild(cRow);
    el.textForm.appendChild(cGroup);
  }

  function setGlobalTextColor(color) {
    Object.keys(fieldState).forEach(k => { fieldState[k].color = color; });
    Object.values(textObjects).forEach(t => { if (t) t.set('fill', color); });
    canvas.renderAll();
  }

  /* ===== ZOOM ===== */
  function initZoom() {
    el.zoomSlider.addEventListener('input', () => zoomTo(+el.zoomSlider.value));
    el.zoomIn.addEventListener('click', () => zoomTo(Math.min(+el.zoomSlider.value + 10, 300)));
    el.zoomOut.addEventListener('click', () => zoomTo(Math.max(+el.zoomSlider.value - 10, 10)));
    el.resetImage.addEventListener('click', resetImagePos);
  }

  function zoomTo(pct) {
    updateZoom(pct);
    if (!userImage || !frameConfig) return;
    const pa = frameConfig.photoArea;
    const nat = userImage._element;
    const base = Math.max(pa.width / nat.naturalWidth, pa.height / nat.naturalHeight);
    userImage.set({ scaleX: base * (pct / 100), scaleY: base * (pct / 100) });
    canvas.renderAll();
  }

  function updateZoom(v) { el.zoomSlider.value = v; el.zoomValue.textContent = v + '%'; }

  function resetImagePos() {
    repositionImage();
    updateZoom(100);
    App.showToast('تم إعادة ضبط الصورة', 'info');
  }

  /* ===== NAV ===== */
  function initNav() {
    el.btnNext.addEventListener('click', () => goToStep(currentStep + 1));
    el.btnPrev.addEventListener('click', () => goToStep(currentStep - 1));
    el.mobileNext.addEventListener('click', () => goToStep(currentStep + 1));
    el.mobilePrev.addEventListener('click', () => goToStep(currentStep - 1));
    document.querySelectorAll('.step-pill').forEach(b => {
      b.addEventListener('click', () => {
        const s = +b.dataset.step;
        if (s <= currentStep || b.classList.contains('done')) goToStep(s);
      });
    });
  }

  function getCanvas() { return canvas; }
  function getFrameConfig() { return frameConfig; }

  async function init() {
    cache(); initCanvas(); initUpload();
    initZoom(); initNav();
    await FramesManager.loadFrames();
    initFrameSelector();

    const frames = FramesManager.getAll();
    if (frames && frames.length) {
      frameConfig = frames[0];
      loadFrame(frameConfig);
    }

    goToStep(1);
  }

  return { init, getCanvas, getFrameConfig };
})();

document.addEventListener('DOMContentLoaded', Editor.init);
