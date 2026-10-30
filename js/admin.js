'use strict';
(() => {
  const LS_KEY = 'fs_admin_frames';
  const PASS_KEY = 'fs_admin_pass_hash';
  const SESSION_KEY = 'fs_admin_session';
  const ATTEMPT_KEY = 'fs_admin_attempts';
  const LOCK_KEY = 'fs_admin_lock';
  let frames = [];
  let current = null;
  let filter = 'all';
  let dragTarget = null;
  let dragOffset = {x:0,y:0};
  let imgCache = {};

  async function sha256(s){ const b=new TextEncoder().encode(s); const h=await crypto.subtle.digest('SHA-256', b); return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
  const DEFAULT_HASH = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9'; // admin123
  async function getStoredHash(){ return localStorage.getItem(PASS_KEY) || DEFAULT_HASH; }
  function isLocked(){ const until= +localStorage.getItem(LOCK_KEY)||0; return Date.now()<until; }
  function recordFail(){ let n=(+localStorage.getItem(ATTEMPT_KEY)||0)+1; localStorage.setItem(ATTEMPT_KEY, n); if(n>=5){ localStorage.setItem(LOCK_KEY, Date.now()+5*60*1000); localStorage.setItem(ATTEMPT_KEY,0); return true; } return false; }
  function clearAttempts(){ localStorage.removeItem(ATTEMPT_KEY); localStorage.removeItem(LOCK_KEY); }
  function isLogged(){ const s=sessionStorage.getItem(SESSION_KEY); if(!s) return false; const exp=+sessionStorage.getItem(SESSION_KEY+'_exp')||0; if(Date.now()>exp){ sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY+'_exp'); return false; } return s==='1'; }
  function setSession(){ sessionStorage.setItem(SESSION_KEY,'1'); sessionStorage.setItem(SESSION_KEY+'_exp', Date.now()+15*60*1000); }
  // auto extend on activity
  setInterval(()=>{ if(isLogged()) sessionStorage.setItem(SESSION_KEY+'_exp', Date.now()+15*60*1000); }, 60*1000);

  // Load frames: merge config + localStorage override
  async function loadFrames(){
    await FramesManager.loadFrames();
    let base = FramesManager.getAll();
    const stored = localStorage.getItem(LS_KEY);
    if(stored){
      try{ const j=JSON.parse(stored); if(Array.isArray(j) && j.length) base=j; }catch(e){}
    }
    // add missing visibility/accessKey defaults
    frames = base.map(f=>({
      visibility: 'public',
      accessKey: genKey(),
      ...f
    }));
  }

  function genKey(){ return Math.random().toString(36).slice(2,9); }

  function saveFrames(){
    localStorage.setItem(LS_KEY, JSON.stringify(frames));
  }

  // UI refs
  const $ = id=>document.getElementById(id);
  function renderList(){
    const list=$('framesList');
    list.innerHTML='';
    const filtered = frames.filter(f=> filter==='all' ? true : f.visibility===filter);
    $('framesCount').textContent = filtered.length + ' / ' + frames.length;
    filtered.forEach(f=>{
      const div=document.createElement('div');
      div.className='admin-frame-item'+(current && current.id===f.id?' active':'');
      const imgSrc = f.dataUrl || f.image;
      div.innerHTML=`<img src="${imgSrc}" onerror="this.style.background='#eee'"><div class="admin-frame-item__meta"><strong>${f.name}</strong><small>${f.id} • ${f.canvasWidth}×${f.canvasHeight}</small><div><span class="badge ${f.visibility==='public'?'badge--public':'badge--private'}">${f.visibility==='public'?'عام':'خاص'}</span></div></div><button class="btn btn--ghost btn--sm" data-copy="${f.id}" title="نسخ الرابط">🔗</button>`;
      div.addEventListener('click', e=>{ if(e.target.dataset.copy) return; selectFrame(f.id); });
      const copyBtn=div.querySelector('[data-copy]');
      if(copyBtn) copyBtn.addEventListener('click', e=>{ e.stopPropagation(); copyLink(f); });
      list.appendChild(div);
    });
  }

  function selectFrame(id){
    current = frames.find(f=>f.id===id) || null;
    renderList();
    if(!current){ $('frameForm').style.display='none'; $('emptyState').style.display=''; return; }
    $('emptyState').style.display='none';
    $('frameForm').style.display='';
    fillForm(current);
    drawPreview();
  }

  function fillForm(f){
    $('fName').value=f.name||'';
    $('fId').value=f.id||'';
    $('fW').value=f.canvasWidth||2500;
    $('fH').value=f.canvasHeight||2500;
    $('fImage').value=f.image||'';
    $('pX').value=f.photoArea?.x||0;
    $('pY').value=f.photoArea?.y||0;
    $('pW').value=f.photoArea?.width||500;
    $('pH').value=f.photoArea?.height||500;
    $('fColors').value=(f.textColors||[]).join(', ');
    // visibility
    document.querySelectorAll('input[name="vis"]').forEach(r=> r.checked = r.value=== (f.visibility||'public'));
    updateVisUI();
    $('fKey').value=f.accessKey||genKey();
    updateLinks();
    // texts
    renderTexts(f.text||{});
    // image preview
    if(f.image){
      const ip=$('imagePreview');
      ip.style.display='';
      ip.querySelector('img').src = f.dataUrl || f.image;
    }
  }

  function renderTexts(textObj){
    const c=$('textsContainer'); c.innerHTML='';
    Object.entries(textObj).forEach(([key,cfg])=>{
      c.appendChild(createTextRow(key,cfg));
    });
  }
  function createTextRow(key,cfg){
    const div=document.createElement('div');
    div.className='text-field'; div.dataset.key=key;
    div.innerHTML=`
      <div class="text-field__head"><strong>المفتاح: <input value="${key}" data-field="key" style="width:120px;padding:4px;border:1px solid #ddd;border-radius:6px" dir="ltr"></strong>
        <button type="button" class="btn btn--danger btn--sm" data-del>حذف</button></div>
      <div class="admin-grid2">
        <label>التسمية (label)<input data-field="label" class="input" value="${cfg.label||''}"></label>
        <label>placeholder<input data-field="placeholder" class="input" value="${cfg.placeholder||''}"></label>
      </div>
      <div class="admin-grid2">
        <label>قيمة ثابتة (value) <small>اتركه فارغ للسماح بالإدخال</small><input data-field="value" class="input" value="${cfg.value||''}"></label>
        <label>اختيارات (options) مفصولة بفاصلة<input data-field="options" class="input" dir="ltr" value="${(cfg.options||[]).join(', ')}"></label>
      </div>
      <div class="admin-grid4">
        <label>X <input data-field="x" type="number" class="input" value="${cfg.x||0}"></label>
        <label>Y <input data-field="y" type="number" class="input" value="${cfg.y||0}"></label>
        <label>حجم الخط <input data-field="fontSize" type="number" class="input" value="${cfg.fontSize||50}"></label>
        <label>السمك <select data-field="fontWeight" class="input"><option value="normal" ${cfg.fontWeight==='normal'?'selected':''}>normal</option><option value="bold" ${cfg.fontWeight==='bold'?'selected':''}>bold</option></select></label>
      </div>
      <div class="admin-grid2">
        <label>اللون <input data-field="color" type="color" class="input" value="${cfg.color||'#FFFFFF'}" style="height:40px;padding:2px"><input data-field="colorText" class="input" value="${cfg.color||'#FFFFFF'}" dir="ltr" style="margin-top:4px"></label>
        <label>المحاذاة <select data-field="align" class="input"><option value="center" ${cfg.align==='center'?'selected':''}>center</option><option value="left" ${cfg.align==='left'?'selected':''}>left</option><option value="right" ${cfg.align==='right'?'selected':''}>right</option></select></label>
      </div>
    `;
    div.querySelector('[data-del]').addEventListener('click',()=>{ div.remove(); drawPreview(); });
    div.querySelectorAll('input,select').forEach(inp=>{
      inp.addEventListener('input', drawPreview);
      inp.addEventListener('change', drawPreview);
    });
    return div;
  }

  function collectForm(){
    const id=$('fId').value.trim().replace(/\s+/g,'-').toLowerCase();
    if(!id) { App.showToast('المعرّف مطلوب','error'); return null; }
    const text={};
    document.querySelectorAll('.text-field').forEach(row=>{
      const k=row.querySelector('[data-field="key"]').value.trim();
      if(!k) return;
      const get=f=> row.querySelector(`[data-field="${f}"]`)?.value||'';
      const color = row.querySelector('[data-field="color"]').value || get('colorText');
      const opts = get('options').split(',').map(s=>s.trim()).filter(Boolean);
      const o={ x:+get('x'), y:+get('y'), fontSize:+get('fontSize'), fontWeight:get('fontWeight'), color, align:get('align'), label:get('label'), placeholder:get('placeholder') };
      if(get('value')) o.value=get('value');
      if(opts.length) o.options=opts;
      text[k]=o;
    });
    const colors=$('fColors').value.split(',').map(s=>s.trim()).filter(Boolean);
    const vis=document.querySelector('input[name="vis"]:checked')?.value||'public';
    return {
      id,
      name:$('fName').value.trim()||id,
      image:$('fImage').value.trim()||'assets/frames/'+id+'.webp',
      canvasWidth:+$('fW').value||2500,
      canvasHeight:+$('fH').value||2500,
      photoArea:{ x:+$('pX').value||0, y:+$('pY').value||0, width:+$('pW').value||500, height:+$('pH').value||500 },
      textColors: colors.length?colors:['#FFFFFF'],
      text,
      visibility: vis,
      accessKey: $('fKey').value.trim()||genKey()
    };
  }

  function updateVisUI(){
    const vis=document.querySelector('input[name="vis"]:checked')?.value;
    $('privateBox').style.display= vis==='private'?'':'none';
  }
  function originBase(){
    return location.origin + location.pathname.replace(/\/[^\/]*$/,'/').replace(/\/$/,'');
  }
  function updateLinks(){
    const f=collectForm(); if(!f) return;
    const base = location.href.replace(/admin\.html.*$/,'').replace(/\/$/,'');
    const pub = f.visibility==='public' ? `${base}/editor.html?frame=${f.id}` : `${base}/editor.html?frame=${f.id}&key=${f.accessKey}`;
    if($('publicLink')) $('publicLink').textContent=pub;
    if($('privateLink')) $('privateLink').textContent=pub;
  }

  function copyLink(f){
    const base=location.href.replace(/admin\.html.*$/,'').replace(/\/$/,'');
    const link = f.visibility==='private' ? `${base}/editor.html?frame=${f.id}&key=${f.accessKey}` : `${base}/editor.html?frame=${f.id}`;
    navigator.clipboard.writeText(link).then(()=> App.showToast('تم نسخ الرابط','success')).catch(()=> prompt('انسخ الرابط:',link));
  }

  // Canvas preview with drag
  function drawPreview(){
    const canvas=$('adminCanvas'); if(!canvas) return;
    const ctx=canvas.getContext('2d');
    const f=collectForm(); if(!f) return;
    // clear
    ctx.fillStyle='#e8e6e1'; ctx.fillRect(0,0,canvas.width,canvas.height);
    // scale factor
    const scale = canvas.width / f.canvasWidth;
    // draw frame image if loaded
    const imgSrc = $('fImage').value.trim();
    // try cache
    if(imgSrc && imgCache[imgSrc]?.complete){
      ctx.drawImage(imgCache[imgSrc],0,0,canvas.width,canvas.height);
    } else if(imgSrc){
      const im=new Image();
      im.onload=()=>{ imgCache[imgSrc]=im; drawPreview(); };
      im.onerror=()=>{};
      im.src=imgSrc.startsWith('data:')?imgSrc:imgSrc;
      // also show placeholder rect
    }
    // photoArea
    ctx.save();
    ctx.strokeStyle='#FBAE42'; ctx.lineWidth=2; ctx.setLineDash([6,4]);
    ctx.fillStyle='rgba(251,174,66,0.25)';
    const px=f.photoArea.x*scale, py=f.photoArea.y*scale, pw=f.photoArea.width*scale, ph=f.photoArea.height*scale;
    ctx.fillRect(px,py,pw,ph); ctx.strokeRect(px,py,pw,ph);
    ctx.fillStyle='#FBAE42'; ctx.font='12px Cairo'; ctx.fillText('الصورة',px+6,py+14);
    ctx.restore();
    // texts
    document.querySelectorAll('.text-field').forEach(row=>{
      const k=row.querySelector('[data-field="key"]').value.trim();
      const x=+row.querySelector('[data-field="x"]').value||0;
      const y=+row.querySelector('[data-field="y"]').value||0;
      const col=row.querySelector('[data-field="color"]').value||'#FBAE42';
      ctx.fillStyle=col;
      ctx.beginPath(); ctx.arc(x*scale,y*scale,6,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#0d1a30'; ctx.font='10px Cairo'; ctx.textAlign='center'; ctx.fillText(k,x*scale,y*scale-10);
    });
  }

  function canvasToFrameCoords(e,canvas){
    const rect=canvas.getBoundingClientRect();
    const f=collectForm(); if(!f) return {x:0,y:0};
    const scaleX = f.canvasWidth / canvas.width;
    const scaleY = f.canvasHeight / canvas.height;
    // account for CSS scaling
    const cssScale = canvas.width / rect.width;
    const cx = (e.touches?e.touches[0].clientX:e.clientX) - rect.left;
    const cy = (e.touches?e.touches[0].clientY:e.clientY) - rect.top;
    return { x: cx * cssScale * scaleX/ (canvas.width/canvas.width) * (canvas.width/ rect.width * rect.width/canvas.width) , y: cy * scaleY * (canvas.height/rect.height) };
    // simpler: use rect scaling
  }
  function getMouseFrame(e){
    const canvas=$('adminCanvas'); const rect=canvas.getBoundingClientRect();
    const f=collectForm(); 
    const scale = canvas.width / f.canvasWidth;
    const xCss = (e.touches?e.touches[0].clientX:e.clientX) - rect.left;
    const yCss = (e.touches?e.touches[0].clientY:e.clientY) - rect.top;
    // map css pixels to canvas pixels then to frame coords
    const xCanvas = xCss * (canvas.width / rect.width);
    const yCanvas = yCss * (canvas.height / rect.height);
    return { x: xCanvas / scale, y: yCanvas / scale, xCanvas, yCanvas, scale };
  }

  function initCanvasDrag(){
    const canvas=$('adminCanvas');
    canvas.addEventListener('pointerdown', e=>{
      const pos=getMouseFrame(e);
      const f=collectForm();
      // check text hits first
      const texts=[...document.querySelectorAll('.text-field')];
      for(const row of texts){
        const x=+row.querySelector('[data-field="x"]').value, y=+row.querySelector('[data-field="y"]').value;
        const scale=canvas.width/f.canvasWidth;
        const dx = pos.xCanvas - x*scale, dy=pos.yCanvas - y*scale;
        if(Math.sqrt(dx*dx+dy*dy)<14){ dragTarget=row.querySelector('[data-field="key"]').value; return; }
      }
      // check photoArea
      const pa=f.photoArea; const scale=canvas.width/f.canvasWidth;
      if(pos.xCanvas>pa.x*scale && pos.xCanvas< (pa.x+pa.width)*scale && pos.yCanvas>pa.y*scale && pos.yCanvas< (pa.y+pa.height)*scale){
        dragTarget='photo'; dragOffset={ x: pos.x - pa.x, y: pos.y - pa.y };
      }
    });
    canvas.addEventListener('pointermove', e=>{
      if(!dragTarget) return;
      const pos=getMouseFrame(e);
      if(dragTarget==='photo'){
        $('pX').value=Math.round(pos.x - dragOffset.x);
        $('pY').value=Math.round(pos.y - dragOffset.y);
      } else {
        const row=[...document.querySelectorAll('.text-field')].find(r=> r.querySelector('[data-field="key"]').value===dragTarget);
        if(row){ row.querySelector('[data-field="x"]').value=Math.round(pos.x); row.querySelector('[data-field="y"]').value=Math.round(pos.y); }
      }
      drawPreview(); updateLinks();
    });
    window.addEventListener('pointerup',()=> dragTarget=null);
  }

  // Events
  function bind(){
    $('btnNewFrame').addEventListener('click',()=>{
      const nid='frame-'+Date.now().toString(36).slice(-4);
      const nf={ id:nid, name:'فريم جديد', image:'assets/frames/'+nid+'.webp', canvasWidth:2500, canvasHeight:2500, photoArea:{x:877,y:881,width:748,height:748}, textColors:['#FFFFFF','#FBAE42'], text:{ name:{x:1250,y:1873,fontSize:72,fontWeight:'bold',color:'#FFFFFF',align:'center',label:'الاسم',placeholder:'أدخل اسمك'} }, visibility:'public', accessKey:genKey() };
      frames.push(nf); saveFrames(); renderList(); selectFrame(nid);
      App.showToast('تم إنشاء فريم جديد','success');
    });
    $('frameForm').addEventListener('submit', e=>{
      e.preventDefault();
      const nf=collectForm(); if(!nf) return;
      const idx=frames.findIndex(x=>x.id===current.id);
      // if id changed, check duplicate
      if(nf.id!==current.id && frames.some(x=>x.id===nf.id)){ App.showToast('المعرّف موجود مسبقاً','error'); return; }
      // preserve image dataUrl if had
      if(current.dataUrl) nf.dataUrl=current.dataUrl;
      // if file uploaded as dataUrl
      const fileInput=$('fImageFile');
      if(fileInput.files[0]){
        const reader=new FileReader();
        reader.onload=()=>{
          nf.dataUrl=reader.result;
          // save file path hint: keep original image path but embed dataUrl for preview
          completeSave(nf, idx);
        };
        reader.readAsDataURL(fileInput.files[0]);
      } else {
        completeSave(nf, idx);
      }
    });
    function completeSave(nf, idx){
      frames[idx]=nf; current=nf; saveFrames(); renderList(); selectFrame(nf.id); drawPreview(); updateLinks();
      App.showToast('تم الحفظ محلياً — حمّل frames.json وارفعه لـ GitHub','success',5000);
    }
    $('btnAddText').addEventListener('click',()=>{
      const c=$('textsContainer');
      const key='field'+ (c.children.length+1);
      c.appendChild(createTextRow(key,{x:1250,y:2000,fontSize:48,fontWeight:'bold',color:'#FFFFFF',align:'center',label:'حقل جديد',placeholder:''}));
      drawPreview();
    });
    $('btnDuplicate').addEventListener('click',()=>{
      if(!current) return;
      const copy=JSON.parse(JSON.stringify(current));
      copy.id=current.id+'-copy'; copy.name=current.name+' نسخة'; copy.accessKey=genKey();
      frames.push(copy); saveFrames(); renderList(); selectFrame(copy.id);
    });
    $('btnDelete').addEventListener('click',()=>{
      if(!current) return;
      if(!confirm('حذف الفريم '+current.name+' ؟')) return;
      frames=frames.filter(f=>f.id!==current.id); saveFrames(); current=null; renderList(); $('frameForm').style.display='none'; $('emptyState').style.display='';
      App.showToast('تم الحذف','info');
    });
    $('btnPreviewEditor').addEventListener('click',()=>{
      const nf=collectForm(); if(!nf) return;
      const base=location.href.replace(/admin\.html.*$/,'');
      const url = nf.visibility==='private' ? `${base}editor.html?frame=${nf.id}&key=${nf.accessKey}` : `${base}editor.html?frame=${nf.id}`;
      window.open(url,'_blank');
    });
    // visibility toggles
    document.querySelectorAll('input[name="vis"]').forEach(r=> r.addEventListener('change',()=>{ updateVisUI(); updateLinks(); drawPreview(); }));
    $('btnGenKey').addEventListener('click',()=>{ $('fKey').value=genKey(); updateLinks(); });
    $('btnCopyPrivate').addEventListener('click',()=> { navigator.clipboard.writeText($('privateLink').textContent).then(()=>App.showToast('تم النسخ','success')); });
    $('btnCopyPublic').addEventListener('click',()=> { navigator.clipboard.writeText($('publicLink').textContent).then(()=>App.showToast('تم النسخ','success')); });
    // live update
    ['fName','fId','fW','fH','fImage','pX','pY','pW','pH','fColors','fKey'].forEach(id=>{
      const el=$(id); if(el) el.addEventListener('input',()=>{ drawPreview(); updateLinks(); });
    });
    // image file
    $('fImageFile').addEventListener('change', e=>{
      const file=e.target.files[0]; if(!file) return;
      $('fImage').value='assets/frames/'+file.name;
      const reader=new FileReader();
      reader.onload=()=>{
        const ip=$('imagePreview'); ip.style.display=''; ip.querySelector('img').src=reader.result;
        imgCache[$('fImage').value]=Object.assign(new Image(),{src:reader.result});
        // store temp dataUrl for preview
        current.dataUrl=reader.result;
        drawPreview();
      };
      reader.readAsDataURL(file);
    });
    $('btnExport').addEventListener('click',()=>{
      const blob=new Blob([JSON.stringify(frames,null,2)],{type:'application/json'});
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='frames.json'; a.click();
      App.showToast('تم تحميل frames.json','success');
    });
    $('importFile').addEventListener('change', e=>{
      const file=e.target.files[0]; if(!file) return;
      const r=new FileReader(); r.onload=()=>{
        try{ const j=JSON.parse(r.result); if(!Array.isArray(j)) throw 0; frames=j.map(f=>({visibility:'public',accessKey:genKey(),...f})); saveFrames(); renderList(); App.showToast('تم الاستيراد','success'); }catch{ App.showToast('ملف غير صالح','error'); }
      }; r.readAsText(file);
    });
    $('btnImport').addEventListener('click',()=> $('importFile').click());
    $('btnBuildData').addEventListener('click',()=> App.showToast('شغّل: node tools/build-frames-data.js بعد رفع الصور','info',6000));
    document.querySelectorAll('.filter-btn').forEach(b=>{
      b.addEventListener('click',()=>{ document.querySelectorAll('.filter-btn').forEach(x=>x.classList.remove('active')); b.classList.add('active'); filter=b.dataset.filter; renderList(); });
    });
    // settings
    $('btnSettings').addEventListener('click',()=> $('settingsModal').style.display='flex');
    $('btnCloseSettings').addEventListener('click',()=> $('settingsModal').style.display='none');
    $('btnSavePass').addEventListener('click', async ()=>{
      const p=$('setPass').value, p2=$('setPass2').value;
      if(!p || p!==p2){ App.showToast('كلمات المرور غير متطابقة','error'); return; }
      if(p.length<6){ App.showToast('كلمة المرور قصيرة جداً (6 أحرف على الأقل)','error'); return; }
      const h=await sha256(p); localStorage.setItem(PASS_KEY,h); App.showToast('تم حفظ كلمة المرور','success'); $('settingsModal').style.display='none';
      $('setPass').value=''; $('setPass2').value='';
    });
    $('btnResetAll').addEventListener('click',()=>{
      if(!confirm('مسح كل التعديلات المحلية والعودة للأصل؟')) return;
      localStorage.removeItem(LS_KEY); location.reload();
    });
    $('btnLogout').addEventListener('click',()=>{ sessionStorage.removeItem(SESSION_KEY); location.reload(); });
    // login with hashing + brute force protection
    $('loginBtn').addEventListener('click', tryLogin);
    $('loginPass').addEventListener('keydown', e=>{ if(e.key==='Enter') tryLogin(); });
    async function tryLogin(){
      if(isLocked()){ const until=+localStorage.getItem(LOCK_KEY); const sec=Math.ceil((until-Date.now())/1000); App.showToast(`محظور مؤقتاً - حاول بعد ${sec} ثانية`,'error',5000); return; }
      const input=$('loginPass').value; const h=await sha256(input); const stored=await getStoredHash();
      if(h===stored){ clearAttempts(); setSession(); $('loginOverlay').style.display='none'; $('loginErr').style.display='none'; initApp(); }
      else { $('loginErr').style.display=''; $('loginErr').textContent='كلمة المرور غير صحيحة'; if(recordFail()) App.showToast('تم الحظر 5 دقائق بسبب محاولات كثيرة','error',6000); }
    }
    if(isLogged()) $('loginOverlay').style.display='none';
  }

  function initApp(){
    loadFrames().then(()=>{ renderList(); initCanvasDrag(); if(frames[0]) selectFrame(frames[0].id); });
  }
  document.addEventListener('DOMContentLoaded', ()=>{
    bind();
    if(isLogged()) initApp();
  });
})();
