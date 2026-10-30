/* ========================================
   FRAME STUDIO — Frame System (V3)
   Loads frames from config/frames.json,
   falls back to built-in data for file://
   or when the config cannot be fetched.
   ======================================== */

'use strict';

const FramesManager = (() => {
  let framesData = [];
  let selectedFrame = null;

  const BUILT_IN_FRAMES = [
    {
      id: 'codemakers',
      name: 'The Code Makers Journey',
      image: 'assets/frames/codemakers.webp',
      canvasWidth: 2500,
      canvasHeight: 2500,
      photoArea: { x: 877, y: 881, width: 748, height: 748 },
      textColors: ['#FFFFFF', '#FBAE42'],
      text: {
        name: { x: 1250, y: 1873, fontSize: 72, fontWeight: 'bold', color: '#FFFFFF', align: 'center', label: '\u0627\u0644\u0627\u0633\u0645', placeholder: '\u0623\u062F\u062E\u0644 \u0627\u0633\u0645\u0643' },
        role: { x: 1250, y: 2036, fontSize: 52, fontWeight: 'bold', color: '#FFFFFF', align: 'center', label: '\u0627\u0644\u0639\u0636\u0648\u064A\u0629', value: 'Code Makers member' },
        track: { x: 1250, y: 2200, fontSize: 50, fontWeight: 'bold', color: '#FFFFFF', align: 'center', label: '\u0627\u0644\u062A\u0631\u0627\u0643', options: ['Data analysis-Season1', 'UI/UX-Season1', 'Backend-Season1'] }
      }
    },
    {
      id: 'midnight-gold',
      name: 'Midnight Gold \u2014 \u0634\u0647\u0627\u062F\u0629 \u0623\u0646\u064A\u0642\u0629',
      image: 'assets/frames/midnight-gold.webp',
      canvasWidth: 2500,
      canvasHeight: 2500,
      photoArea: { x: 550, y: 300, width: 1400, height: 1400 },
      textColors: ['#F3ECDC', '#FBAE42', '#C9A35C'],
      text: {
        name: { x: 1250, y: 1890, fontSize: 96, fontWeight: 'bold', color: '#F3ECDC', align: 'center', label: '\u0627\u0644\u0627\u0633\u0645', placeholder: '\u0623\u062F\u062E\u0644 \u0627\u0644\u0627\u0633\u0645' },
        role: { x: 1250, y: 2020, fontSize: 56, fontWeight: 'bold', color: '#FBAE42', align: 'center', label: '\u0627\u0644\u0645\u0633\u0645\u0649 \u0623\u0648 \u0627\u0644\u0639\u0636\u0648\u064A\u0629', placeholder: '\u0623\u062F\u062E\u0644 \u0627\u0644\u0645\u0633\u0645\u0649' },
        note: { x: 1250, y: 2160, fontSize: 46, fontWeight: 'normal', color: '#F3ECDC', align: 'center', label: '\u0643\u0644\u0645\u0629 \u0627\u0644\u0634\u0643\u0631', placeholder: '\u0634\u0643\u0631\u0627\u064B \u0648\u062A\u0642\u062F\u064A\u0631\u0627\u064B' }
      }
    }
  ];

  // On file:// the browser taints the canvas for any <img> loaded from a
  // relative path, which blocks toBlob/toDataURL on export. Loading the frame
  // as an inline base64 data URL avoids the taint. We only pull in the (large)
  // embedded data file when actually running from file://; over http(s) the
  // normal image files are used and this is never loaded.
  function isFileProtocol() {
    return location.protocol === 'file:';
  }

  function loadEmbeddedData() {
    if (window.FRAME_DATA) return Promise.resolve(window.FRAME_DATA);
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'js/frames-data.js';
      s.onload = () => resolve(window.FRAME_DATA || {});
      s.onerror = () => { console.warn('Could not load js/frames-data.js'); resolve({}); };
      document.head.appendChild(s);
    });
  }

  function applyEmbeddedData() {
    if (!isFileProtocol()) return Promise.resolve();
    return loadEmbeddedData().then((data) => {
      if (!data) return;
      framesData.forEach(frame => {
        if (data[frame.id]) frame.dataUrl = data[frame.id];
      });
    });
  }

  async function loadFrames() {
    try {
      const resp = await fetch('config/frames.json');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const parsed = await resp.json();
      framesData = (Array.isArray(parsed) && parsed.length) ? parsed : BUILT_IN_FRAMES;
    } catch (e) {
      console.warn('Could not load config/frames.json, using built-in frames:', e.message);
      framesData = BUILT_IN_FRAMES;
    }
    await applyEmbeddedData();
  }

  function selectFrame(container, card, frame) {
    if (container) {
      container.querySelectorAll('.frame-card').forEach(c => {
        c.classList.remove('active');
        c.setAttribute('aria-pressed', 'false');
      });
    }
    card.classList.add('active');
    card.setAttribute('aria-pressed', 'true');
    selectedFrame = frame;
  }

  function renderFrameCards(container, onSelect) {
    if (!container || !framesData.length) return;
    container.innerHTML = '';

    framesData.forEach(frame => {
      const card = document.createElement('div');
      card.className = 'frame-card';
      card.dataset.frameId = frame.id;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-pressed', 'false');
      card.setAttribute('aria-label', 'اختر ' + frame.name);

      const imgWrap = document.createElement('div');
      imgWrap.className = 'frame-card__img';

      const img = document.createElement('img');
      img.src = frame.dataUrl || frame.image;
      img.alt = frame.name;
      img.loading = 'lazy';
      imgWrap.appendChild(img);

      const label = document.createElement('div');
      label.className = 'frame-card__label';
      label.textContent = frame.name;

      card.appendChild(imgWrap);
      card.appendChild(label);

      const choose = () => {
        selectFrame(container, card, frame);
        if (onSelect) onSelect(frame);
      };

      card.addEventListener('click', choose);
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose();
        }
      });

      container.appendChild(card);
    });

    // Keep the first frame highlighted when the editor boots with it selected.
    const first = container.querySelector('.frame-card');
    if (first) selectFrame(container, first, framesData[0]);
  }

  function getAll() { return framesData; }
  function getSelectedFrame() { return selectedFrame; }

  return { loadFrames, renderFrameCards, getAll, getSelectedFrame };
})();
