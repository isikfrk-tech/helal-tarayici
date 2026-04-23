'use strict';

// ── State ──
let db = null;
let analyzer = null;
let currentMode = 'ocr';
let stream = null;
let html5QrCode = null;
let history = [];

// ── DOM helper (güvenli) ──
function $(id) {
  const el = document.getElementById(id);
  if (!el) console.warn('Element bulunamadı:', id);
  return el;
}

// ── Global hata yakalama (mobil debug için) ──
window.onerror = (msg, src, line, col, err) => {
  showError('JS Hatası: ' + msg + (line ? ' (satır ' + line + ')' : ''));
  return false;
};
window.addEventListener('unhandledrejection', e => {
  showError('Promise Hatası: ' + (e.reason?.message || e.reason || 'Bilinmiyor'));
});

function showError(msg) {
  const box = document.getElementById('error-box');
  if (box) {
    box.textContent = '⚠️ ' + msg;
    box.style.display = 'block';
    setTimeout(() => { box.style.display = 'none'; }, 8000);
  }
  console.error(msg);
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  // Eski cache'leri temizle, sonra yeni SW kaydet
  if ('caches' in window) {
    caches.keys().then(keys => {
      keys.filter(k => k !== 'helal-tarayici-v4').forEach(k => caches.delete(k));
    });
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  history = JSON.parse(localStorage.getItem('scan_history') || '[]');
  loadDatabase();
  renderHistory();

  // Tıklama teşhisi — her butona görünür tepki ekle
  document.querySelectorAll('.scan-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showDebug('Tıklama algılandı ✓');
    });
  });

  showDebug('Uygulama yüklendi · ' + new Date().toLocaleTimeString('tr-TR'));
});

function showDebug(msg) {
  const box = document.getElementById('debug-box');
  if (box) {
    box.textContent = msg;
    box.style.display = 'block';
  }
}

async function loadDatabase() {
  try {
    const res = await fetch('./data/ingredients.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    db = await res.json();
    analyzer = new HalalAnalyzer(db);
  } catch (err) {
    showError('Veritabanı yüklenemedi: ' + err.message);
  }
}

// ── Navigation ──
function showScreen(name) {
  ['screen-home', 'screen-scan', 'screen-paste', 'screen-result'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  const target = document.getElementById('screen-' + name);
  if (target) target.classList.add('active');

  const backBtn    = $('back-btn');
  const titleEl    = $('header-title');

  if (name === 'home') {
    if (backBtn)  backBtn.style.display  = 'none';
    if (titleEl)  titleEl.textContent    = 'Helal Tarayıcı';
    stopCamera();
  } else if (name === 'scan') {
    if (backBtn)  backBtn.style.display  = 'flex';
    if (titleEl)  titleEl.textContent    = currentMode === 'ocr' ? 'İçindekiler Tara' : 'Barkod Tara';
  } else if (name === 'paste') {
    if (backBtn)  backBtn.style.display  = 'flex';
    if (titleEl)  titleEl.textContent    = 'Metin Yapıştır';
    stopCamera();
  } else if (name === 'result') {
    if (backBtn)  backBtn.style.display  = 'flex';
    if (titleEl)  titleEl.textContent    = 'Sonuç';
    stopCamera();
  }
}

// ── OCR Modu — kamerayı KULLANICI GESTİ içinde başlat ──
function startOCR() {
  currentMode = 'ocr';
  showScreen('scan');

  const videoContainer  = $('video-container');
  const barcodeContainer = $('barcode-container');
  if (videoContainer)   videoContainer.style.display   = 'block';
  if (barcodeContainer) barcodeContainer.style.display = 'none';

  // iOS: getUserMedia kullanıcı gestine doğrudan bağlı olmalı
  // Hiç async beklemeden hemen çağır
  const video = $('video-preview');
  if (!video) { showError('Video elementi bulunamadı'); return; }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showCameraFallback('Bu tarayıcı kamera erişimini desteklemiyor.');
    return;
  }

  // Kamera isteği — iOS için zincirsiz, doğrudan çağrı
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(s => {
      stream = s;
      video.srcObject = s;
      video.setAttribute('playsinline', '');
      video.setAttribute('muted', '');
      return video.play();
    })
    .then(() => {
      // iOS bazen environment desteklemez, tekrar dene
    })
    .catch(err => {
      if (err.name === 'OverconstrainedError' || err.name === 'NotFoundError') {
        // Arka kamera yoksa ön kamera dene
        navigator.mediaDevices.getUserMedia({ video: true })
          .then(s => {
            stream = s;
            video.srcObject = s;
            video.setAttribute('playsinline', '');
            return video.play();
          })
          .catch(e2 => showCameraFallback(e2.message));
      } else if (err.name === 'NotAllowedError') {
        showCameraFallback('Kamera izni reddedildi. Tarayıcı ayarlarından izin ver.');
      } else {
        showCameraFallback(err.message);
      }
    });
}

function showCameraFallback(msg) {
  const vc = $('video-container');
  if (!vc) return;
  vc.innerHTML = `
    <div style="padding:32px 20px;text-align:center;">
      <div style="font-size:48px;margin-bottom:12px;">📵</div>
      <div style="font-size:15px;font-weight:600;margin-bottom:8px;color:#2C3E50;">Kamera açılamadı</div>
      <div style="font-size:13px;color:#7F8C8D;line-height:1.6;margin-bottom:20px;">${msg}</div>
      <label style="display:inline-flex;align-items:center;gap:8px;padding:14px 24px;border-radius:50px;background:white;border:2px solid #E8ECF0;cursor:pointer;font-size:15px;">
        🖼️ Galeriden Fotoğraf Seç
        <input type="file" accept="image/*" style="display:none" onchange="analyzeFromFile(this.files[0])">
      </label>
    </div>`;
}

// ── Metin Yapıştırma Modu ──
function startPaste() {
  showScreen('paste');
  const ta = $('paste-textarea');
  if (ta) { ta.value = ''; setTimeout(() => ta.focus(), 100); }
}

function analyzePastedText() {
  if (!analyzer) { showError('Veritabanı henüz yüklenmedi.'); return; }
  const text = ($('paste-textarea')?.value || '').trim();
  if (text.length < 2) { showToast('Önce metni yapıştır.'); return; }
  const verdict = analyzer.analyze(text);
  showResult(verdict, text, null);
}

// ── Barkod Modu ──
function startBarcode() {
  currentMode = 'barcode';
  showScreen('scan');
  const vc = $('video-container');
  const bc = $('barcode-container');
  if (vc) vc.style.display = 'none';
  if (bc) bc.style.display = 'block';
  startBarcodeReader();
}

// ── Kamera durdur ──
function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  if (html5QrCode) {
    html5QrCode.stop().catch(() => {});
    html5QrCode = null;
  }
}

// ── Fotoğraf çek ve analiz et ──
function captureAndAnalyze() {
  const video  = $('video-preview');
  const canvas = $('canvas-preview');
  if (!video || !canvas) return;

  const w = video.videoWidth  || 640;
  const h = video.videoHeight || 480;
  canvas.width  = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, w, h);
  preprocessCanvas(canvas);
  runOCR(canvas);
}

// ── Galeriden seç ──
function analyzeFromFile(file) {
  if (!file) return;
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const canvas = $('canvas-preview');
    if (!canvas) return;
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    preprocessCanvas(canvas);
    URL.revokeObjectURL(url);
    runOCR(canvas);
  };
  img.src = url;
}

// ── Görüntü ön işleme (kontrast artır) ──
function preprocessCanvas(canvas) {
  const ctx  = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d    = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
    const val  = Math.min(255, Math.max(0, (gray - 128) * 1.4 + 128));
    d[i] = d[i+1] = d[i+2] = val;
  }
  ctx.putImageData(data, 0, 0);
}

// ── OCR ──
async function runOCR(canvas) {
  if (!analyzer) {
    showError('Veritabanı henüz yüklenmedi, bir saniye bekle.');
    return;
  }
  showLoading('OCR işleniyor...', 'İlk kullanımda ~40MB Çince paketi indirilir');
  try {
    const { createWorker } = Tesseract;
    const worker = await createWorker('chi_sim', 1, {
      workerPath: './vendor/tesseract/worker.min.js',
      langPath:   './vendor/tessdata',
      corePath:   './vendor/tesseract/tesseract-core-simd.wasm.js',
      logger: m => {
        if (m.status === 'loading tesseract core')       $('loading-sub').textContent = 'OCR motoru yükleniyor...';
        else if (m.status === 'loading language traineddata') $('loading-sub').textContent = 'Çince paketi yükleniyor (~2MB)...';
        else if (m.status === 'recognizing text')        $('loading-sub').textContent = `Metin okunuyor: %${Math.round(m.progress * 100)}`;
      }
    });
    const { data: { text } } = await worker.recognize(canvas);
    await worker.terminate();

    if (!text || text.trim().length < 2) {
      hideLoading();
      showToast('Metin okunamadı. Daha yakın ve net bir fotoğraf çek.');
      return;
    }
    const verdict = analyzer.analyze(text);
    showResult(verdict, text, null);
  } catch (err) {
    hideLoading();
    const msg = err.message || '';
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('load')) {
      showToast('İnternet gerekli — ilk kullanımda dil paketi indirilir.');
    } else {
      showError('OCR hatası: ' + msg);
    }
  }
}

// ── Barkod ──
async function startBarcodeReader() {
  try {
    await loadScript('https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js');
    html5QrCode = new Html5Qrcode('barcode-reader');
    await html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 240, height: 120 } },
      onBarcodeDetected,
      () => {}
    );
  } catch (err) {
    showError('Barkod okuyucu başlatılamadı: ' + err.message);
  }
}

async function onBarcodeDetected(barcode) {
  await html5QrCode.stop().catch(() => {});
  html5QrCode = null;
  showLoading('Ürün aranıyor...', barcode);

  const cached = getCachedProduct(barcode);
  if (cached) { hideLoading(); showResult(cached.verdict, '', barcode, cached.name); return; }

  try {
    const res  = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
    const data = await res.json();
    if (data.status === 1) {
      const p       = data.product;
      const ingText = p.ingredients_text_zh || p.ingredients_text_zh_CN || p.ingredients_text || '';
      const name    = p.product_name_zh || p.product_name || barcode;
      const verdict = analyzer.analyze(ingText);
      cacheProduct(barcode, name, verdict);
      hideLoading();
      showResult(verdict, ingText, barcode, name);
      return;
    }
  } catch { /* offline veya bulunamadı */ }

  hideLoading();
  showToast('Ürün bulunamadı. İçindekiler modunu dene.');
  showScreen('home');
}

// ── Ürün cache ──
function getCachedProduct(barcode) {
  const store = JSON.parse(localStorage.getItem('products_db') || '{}');
  return store[barcode] || null;
}
function cacheProduct(barcode, name, verdict) {
  const store = JSON.parse(localStorage.getItem('products_db') || '{}');
  store[barcode] = { name, verdict, date: new Date().toISOString() };
  localStorage.setItem('products_db', JSON.stringify(store));
}

// ── Sonuç göster ──
function showResult(verdict, ocrText, barcode, productName) {
  hideLoading();

  const header = $('result-header');
  if (header) header.style.background = verdict.bgColor || '#F8F9FA';

  const iconEl   = $('result-icon');
  const titleEl2 = $('result-title');
  const msgEl    = $('result-message');

  if (iconEl)   iconEl.textContent   = verdict.icon;
  if (titleEl2) { titleEl2.textContent = verdict.title; titleEl2.style.color = verdict.color; }
  if (msgEl)    msgEl.textContent    = verdict.message;

  const ocrBox = $('ocr-box');
  const ocrRaw = $('ocr-raw-text');
  if (ocrBox && ocrRaw) {
    if (ocrText && ocrText.trim()) {
      ocrBox.style.display = 'block';
      ocrRaw.textContent   = ocrText.trim().substring(0, 300);
    } else {
      ocrBox.style.display = 'none';
    }
  }

  const tagsEl = $('ingredient-tags');
  if (tagsEl) {
    tagsEl.innerHTML = '';
    const { haram = [], suspicious = [], halal_check = [] } = verdict.details || {};
    haram.forEach(i => tagsEl.insertAdjacentHTML('beforeend',
      `<span class="ingredient-tag tag-haram">${i.chinese} ${i.turkish}</span>`));
    suspicious.forEach(i => tagsEl.insertAdjacentHTML('beforeend',
      `<span class="ingredient-tag tag-suspicious">⚠️ ${i.chinese} ${i.turkish}</span>`));
    halal_check.forEach(i => tagsEl.insertAdjacentHTML('beforeend',
      `<span class="ingredient-tag tag-check">🔍 ${i.chinese} ${i.turkish}</span>`));

    const detailsEl = $('details-section');
    if (detailsEl) detailsEl.style.display = (haram.length || suspicious.length || halal_check.length) ? 'block' : 'none';
  }

  const nameRow = $('product-name-row');
  const nameText = $('product-name-text');
  if (nameRow && nameText) {
    nameRow.style.display = productName ? 'block' : 'none';
    if (productName) nameText.textContent = productName;
  }

  saveToHistory({
    id: Date.now(),
    icon: verdict.icon,
    status: verdict.status,
    title: verdict.title,
    color: verdict.color,
    name: productName || 'Manuel tarama',
    date: new Date().toLocaleDateString('tr-TR'),
    verdict, ocrText, barcode
  });

  showScreen('result');
}

// ── Geçmiş ──
function saveToHistory(entry) {
  history.unshift(entry);
  if (history.length > 50) history = history.slice(0, 50);
  localStorage.setItem('scan_history', JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  const list = $('history-list');
  if (!list) return;
  if (history.length === 0) {
    list.innerHTML = `<div class="empty-history"><div class="empty-icon">📋</div><p>Henüz tarama yapmadın.<br>Bir ürün tara, burada görünür.</p></div>`;
    return;
  }
  list.innerHTML = history.slice(0, 10).map(h => `
    <div class="history-item" onclick="replayHistory(${h.id})">
      <span class="history-icon">${h.icon}</span>
      <div class="history-info">
        <div class="name">${h.name}</div>
        <div class="date">${h.date}</div>
      </div>
      <span class="history-status" style="color:${h.color};background:${hexToRgba(h.color,0.12)}">${h.title.split(' ').slice(0,2).join(' ')}</span>
    </div>`).join('');
}

function replayHistory(id) {
  const entry = history.find(h => h.id === id);
  if (entry) showResult(entry.verdict, entry.ocrText || '', entry.barcode, entry.name !== 'Manuel tarama' ? entry.name : null);
}

function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── Loading ──
function showLoading(text, sub) {
  const ol = $('loading-overlay');
  const lt = $('loading-text');
  const ls = $('loading-sub');
  if (lt) lt.textContent = text || 'Yükleniyor...';
  if (ls) ls.textContent = sub  || '';
  if (ol) ol.classList.add('active');
}
function hideLoading() {
  const ol = $('loading-overlay');
  if (ol) ol.classList.remove('active');
}

// ── Toast ──
let toastTimer;
function showToast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
}

// ── Script yükleyici ──
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Script yüklenemedi: ' + src));
    document.head.appendChild(s);
  });
}
