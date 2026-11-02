/* ========================================
   FRAMEO — المنطق المشترك + الموشن
   ======================================== */
'use strict';

const App = (() => {
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function initHeader() {
    const h = document.getElementById('header');
    if (!h) return;
    const fn = () => h.classList.toggle('scrolled', window.scrollY > 10);
    window.addEventListener('scroll', fn, { passive: true });
    fn();
  }

  function initMobileMenu() {
    const btn = document.getElementById('menuBtn');
    const nav = document.getElementById('mainNav');
    if (!btn || !nav) return;
    const close = () => {
      nav.classList.remove('open'); btn.classList.remove('open'); btn.setAttribute('aria-expanded', 'false');
    };
    btn.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      btn.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open);
    });
    nav.querySelectorAll('.nav__link').forEach(l => l.addEventListener('click', close));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  function showToast(msg, type = 'info', dur = 3500) {
    const c = document.getElementById('toastContainer');
    if (!c) return;
    const t = document.createElement('div');
    t.className = `toast toast--${type}`;
    t.setAttribute('role', 'alert');
    const span = document.createElement('span');
    span.textContent = msg;              // textContent دائماً — لا HTML من أي مصدر
    t.appendChild(span);
    c.appendChild(t);
    setTimeout(() => {
      t.classList.add('removing');
      t.addEventListener('animationend', () => t.remove());
      setTimeout(() => t.remove(), 600);
    }, dur);
  }

  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', e => {
        const id = a.getAttribute('href');
        if (id.length < 2) return;
        const tgt = document.querySelector(id);
        if (tgt) { e.preventDefault(); tgt.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); }
      });
    });
  }

  /* ظهور العناصر عند التمرير */
  function initReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!els.length) return;
    if (!('IntersectionObserver' in window) || reduceMotion) { els.forEach(el => el.classList.add('in')); return; }
    const obs = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting) { en.target.classList.add('in'); obs.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    els.forEach(el => obs.observe(el));
  }

  /* إضاءة تتبع المؤشر على البطاقات */
  function initSpotlight() {
    if (reduceMotion) return;
    document.querySelectorAll('.fx-card').forEach(card => {
      card.addEventListener('pointermove', e => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        card.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });
  }

  /* ميلان ثلاثي الأبعاد للوحة الفريم في الهيرو */
  function initTilt() {
    const wrap = document.getElementById('heroVisual');
    const plate = document.getElementById('heroPlate');
    if (!wrap || !plate || reduceMotion || !window.matchMedia('(hover: hover)').matches) return;
    wrap.addEventListener('pointermove', e => {
      const r = wrap.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      plate.style.setProperty('--ry', (-px * 16) + 'deg');   // RTL-safe: الاتجاه يتبع المؤشر
      plate.style.setProperty('--rx', (py * 12) + 'deg');
    });
    wrap.addEventListener('pointerleave', () => {
      plate.style.setProperty('--ry', '0deg'); plate.style.setProperty('--rx', '0deg');
    });
  }

  /* Splash: مرة واحدة لكل جلسة، ويمكن تخطيه بالنقر */
  function initSplash() {
    const s = document.getElementById('splash');
    if (!s) return;
    let seen = false;
    try { seen = sessionStorage.getItem('frameo_splash') === '1'; } catch (e) { /* ignore */ }
    if (seen || reduceMotion) { s.remove(); return; }
    document.documentElement.style.overflow = 'hidden';
    const finish = () => {
      if (s.classList.contains('done')) return;
      s.classList.add('done');
      document.documentElement.style.overflow = '';
      try { sessionStorage.setItem('frameo_splash', '1'); } catch (e) { /* ignore */ }
      setTimeout(() => s.remove(), 1000);
    };
    s.addEventListener('click', finish);
    setTimeout(finish, 2300);
  }

  /* PWA: تسجيل Service Worker + زر التثبيت */
  let installPrompt = null;

  function initPWA() {
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => { /* غير مدعوم */ });
      });
    }

    const btn = document.getElementById('installBtn');
    if (!btn) return;

    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      installPrompt = e;
      const item = btn.closest('li');
      if (item) item.hidden = false;
    });

    window.addEventListener('appinstalled', () => {
      installPrompt = null;
      App.showToast('تم تثبيت FRAMEO على جهازك 🎉', 'success');
    });

    btn.addEventListener('click', async () => {
      if (installPrompt) {
        installPrompt.prompt();
        const choice = await installPrompt.userChoice.catch(() => ({}));
        installPrompt = null;
        if (choice && choice.outcome === 'accepted') return;
        App.showToast('يمكنك التثبيت من قائمة المتصفح في أي وقت.', 'info');
        return;
      }
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      App.showToast(
        ios
          ? 'للتثبيت على iPhone: افتح الموقع في Safari ثم زر المشاركة ← «إضافة إلى الشاشة الرئيسية».'
          : 'للتثبيت: من قائمة المتصفح (⋮) اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».',
        'info', 9000
      );
    });
  }

  function init() {
    initHeader();
    initMobileMenu();
    initSmoothScroll();
    initReveal();
    initSpotlight();
    initTilt();
    initSplash();
    initPWA();
  }

  return { init, showToast };
})();

document.addEventListener('DOMContentLoaded', App.init);
