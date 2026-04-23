'use strict';

// ── State ──
let db = null;
let analyzer = null;
let currentMode = 'ocr'; // 'ocr' | 'barcode'
let stream = null;
let html5QrCode = null;
let history = JSON.parse(localStorage.getItem('scan_history') || '[]');

// ── DOM refs ──
const $ = id => document.getElementById(id);
const screens = {
  home:   $('screen-home'),
  scan:   $('screen-scan'),
  result: $('screen-result')
};

// ── Init ──
async function init() {
  await loadDatabase();
  renderHistory();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

async function loadDatabase() {
  try {
    const res = await fetch('./data/ingredients.json');
    db = await res.json();
    analyzer = new HalalAnalyzer(db);
  } catch {
    showToast('Veritabanı yüklenemedi!');
  }
}

// ── Navigation ──
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');

  const header = $('main-header');
  const backBtn = $('back-btn');
  const headerTitle = $('header-title');

  if (name === 'home') {
    backBtn.style.display = 'none';
    headerTitle.textContent = 'Helal Tarayıcı';
    stopCamera();
  } else if (name === 'scan') {
    backBtn.style.display = 'flex';
    headerTitle.textContent = currentMode === 'ocr' ? 'İçindekiler Tara' : 'Barkod Tara';
  } else if (name === 'result') {
    backBtn.style.display = 'flex';
    headerTitle.textContent = 'Sonuç';
    stopCamera();
  }
}

// ── Scan Mode ──
function startOCR() {
  currentMode = 'ocr';
  $('scan-frame-hint').textContent = 'İçindekiler listesini çerçeveye al';
  $('capture-btn').style.display = 'flex';
  $('gallery-btn').style.display = 'flex';
  $('barcode-container').style.display = 'none';
  $('video-container').style.display = 'block';
  showScreen('scan');
  startCamera();
}

function startBarcode() {
  currentMode = 'barcode';
  $('scan-frame-hint').textContent = 'Barkodu çerçeveye getir';
  $('capture-btn').style.display = 'none';
  $('gallery-btn').style.display = 'none';
  $('video-container').style.display = 'none';
  $('barcode-container').style.display = 'block';
  showScreen('scan');
  startBarcodeReader();
}

// ── Camera ──
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    $('video-preview').srcObject = stream;
  } catch {
    showToast('Kameraya erişilemedi. Galeri kullan.');
  }
}

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

// ── OCR Capture ──
async function captureAndAnalyze() {
  const video = $('video-preview');
  const canvas = $('canvas-preview');

  canvas.width  = video.videoWidth  || 640;
  canvas.height = video.videoHeight || 480;
  canvas.getContext('2d').drawImage(video, 0, 0);
  preprocessCanvas(canvas);

  await runOCR(canvas);
}

async function analyzeFromFile(file) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.src = url;
  await img.decode();

  const canvas = $('canvas-preview');
  canvas.width  = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  preprocessCanvas(canvas);
  URL.revokeObjectURL(url);

  await runOCR(canvas);
}

function preprocessCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    // Kontrast artır
    const val = Math.min(255, Math.max(0, (gray - 128) * 1.4 + 128));
    data[i] = data[i+1] = data[i+2] = val;
  }
  ctx.putImageData(imageData, 0, 0);
}

async function runOCR(canvas) {
  showLoading('OCR işleniyor...', 'İlk açılışta ~40MB Çince dil paketi indirilir');
  try {
    const { createWorker } = Tesseract;
    const worker = await createWorker('chi_sim', 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          $('loading-sub').textContent = `%${Math.round(m.progress * 100)} tamamlandı`;
        }
      }
    });
    const { data: { text } } = await worker.recognize(canvas);
    await worker.terminate();
    const verdict = analyzer.analyze(text);
    showResult(verdict, text, null);
  } catch (err) {
    hideLoading();
    showToast('OCR hatası: ' + err.message);
  }
}

// ── Barcode ──
async function startBarcodeReader() {
  await loadScript('https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js');

  html5QrCode = new Html5Qrcode('barcode-reader');
  try {
    await html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 240, height: 120 } },
      onBarcodeDetected,
      () => {}
    );
  } catch {
    showToast('Kameraya erişilemedi.');
  }
}

async function onBarcodeDetected(barcode) {
  await html5QrCode.stop().catch(() => {});
  html5QrCode = null;
  showLoading('Ürün aranıyor...', barcode);

  // 1. Önce localStorage'daki önbellekte ara
  const cached = getCachedProduct(barcode);
  if (cached) {
    hideLoading();
    showResult(cached.verdict, '', barcode, cached.name);
    return;
  }

  // 2. İnternette Open Food Facts'e bak
  try {
    const res  = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
    const data = await res.json();
    if (data.status === 1) {
      const product = data.product;
      const ingText =
        product.ingredients_text_zh ||
        product.ingredients_text_zh_CN ||
        product.ingredients_text || '';
      const name = product.product_name_zh || product.product_name || barcode;
      const verdict = analyzer.analyze(ingText);
      cacheProduct(barcode, name, verdict);
      hideLoading();
      showResult(verdict, ingText, barcode, name);
      return;
    }
  } catch { /* offline veya ürün bulunamadı */ }

  hideLoading();
  showToast('Ürün veritabanında bulunamadı. İçindekiler modunu dene.');
  showScreen('home');
}

// ── Product Cache ──
function getCachedProduct(barcode) {
  const db = JSON.parse(localStorage.getItem('products_db') || '{}');
  return db[barcode] || null;
}

function cacheProduct(barcode, name, verdict) {
  const db = JSON.parse(localStorage.getItem('products_db') || '{}');
  db[barcode] = { name, verdict, date: new Date().toISOString() };
  localStorage.setItem('products_db', JSON.stringify(db));
}

// ── Result ──
function showResult(verdict, ocrText, barcode, productName) {
  hideLoading();

  const header = $('result-header');
  header.style.background = verdict.bgColor || '#F8F9FA';
  $('result-icon').textContent  = verdict.icon;
  $('result-title').textContent = verdict.title;
  $('result-title').style.color = verdict.color;
  $('result-message').textContent = verdict.message;

  // OCR metni
  const ocrBox = $('ocr-box');
  if (ocrText && ocrText.trim()) {
    ocrBox.style.display = 'block';
    $('ocr-raw-text').textContent = ocrText.trim().substring(0, 300);
  } else {
    ocrBox.style.display = 'none';
  }

  // Detay etiketleri
  const tagsContainer = $('ingredient-tags');
  tagsContainer.innerHTML = '';
  const { haram, suspicious, halal_check } = verdict.details || {};
  (haram || []).forEach(i => {
    tagsContainer.insertAdjacentHTML('beforeend',
      `<span class="ingredient-tag tag-haram">${i.chinese} ${i.turkish}</span>`);
  });
  (suspicious || []).forEach(i => {
    tagsContainer.insertAdjacentHTML('beforeend',
      `<span class="ingredient-tag tag-suspicious">⚠️ ${i.chinese} ${i.turkish}</span>`);
  });
  (halal_check || []).forEach(i => {
    tagsContainer.insertAdjacentHTML('beforeend',
      `<span class="ingredient-tag tag-check">🔍 ${i.chinese} ${i.turkish}</span>`);
  });
  $('details-section').style.display =
    (haram?.length || suspicious?.length || halal_check?.length) ? 'block' : 'none';

  // Ürün adı
  $('product-name-row').style.display = productName ? 'block' : 'none';
  if (productName) $('product-name-text').textContent = productName;

  // Geçmişe kaydet
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

// ── History ──
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
    list.innerHTML = `
      <div class="empty-history">
        <div class="empty-icon">📋</div>
        <p>Henüz tarama yapmadın.<br>Bir ürün tara, burada görünür.</p>
      </div>`;
    return;
  }

  list.innerHTML = history.slice(0, 10).map(h => `
    <div class="history-item" onclick="replayHistory(${h.id})">
      <span class="history-icon">${h.icon}</span>
      <div class="history-info">
        <div class="name">${h.name}</div>
        <div class="date">${h.date}</div>
      </div>
      <span class="history-status" style="color:${h.color};background:${hexToRgba(h.color, 0.12)}">${h.title.split(' ').slice(0,2).join(' ')}</span>
    </div>`).join('');
}

function replayHistory(id) {
  const entry = history.find(h => h.id === id);
  if (!entry) return;
  showResult(entry.verdict, entry.ocrText || '', entry.barcode, entry.name !== 'Manuel tarama' ? entry.name : null);
}

function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── Loading ──
function showLoading(text, sub) {
  $('loading-text').textContent = text || 'Yükleniyor...';
  $('loading-sub').textContent  = sub  || '';
  $('loading-overlay').classList.add('active');
}
function hideLoading() {
  $('loading-overlay').classList.remove('active');
}

// ── Toast ──
let toastTimer;
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ── Script loader ──
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ── Start ──
document.addEventListener('DOMContentLoaded', init);
