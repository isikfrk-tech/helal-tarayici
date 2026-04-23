'use strict';

class HalalAnalyzer {
  constructor(chineseDb, englishDb) {
    this.db   = chineseDb;
    this.enDb = englishDb || null;
  }

  // Dili otomatik tespit et ve uygun analizi çalıştır
  analyze(text) {
    const lang = this._detectLang(text);
    if (lang === 'en') return this._analyzeEnglish(text);
    // Karma veya Çince: her ikisini de kontrol et
    const zhResult = this._analyzeChinese(text);
    const enResult = this._analyzeEnglish(text);
    return this._mergeResults(zhResult, enResult, text);
  }

  // Çince mi İngilizce mi?
  _detectLang(text) {
    const chCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const total   = text.replace(/\s/g, '').length;
    if (total === 0) return 'zh';
    return (chCount / total) > 0.15 ? 'zh' : 'en';
  }

  // ── Çince analiz ──
  _analyzeChinese(text) {
    const haram = [], suspicious = [], halal_check = [];
    for (const item of this.db.haram)       { if (text.includes(item.chinese)) haram.push({ ...item, display: `${item.chinese} (${item.turkish})` }); }
    for (const item of this.db.suspicious)  { if (text.includes(item.chinese)) suspicious.push({ ...item, display: `${item.chinese} (${item.turkish})` }); }
    for (const item of this.db.halal_check) { if (text.includes(item.chinese)) halal_check.push({ ...item, display: `${item.chinese} (${item.turkish})` }); }
    return { haram, suspicious, halal_check };
  }

  // ── İngilizce analiz ──
  _analyzeEnglish(text) {
    if (!this.enDb) return { haram: [], suspicious: [], halal_check: [] };
    const lower = text.toLowerCase();
    const haram = [], suspicious = [], halal_check = [];

    for (const item of this.enDb.haram) {
      if (this._matchEnglish(lower, item.term)) {
        haram.push({ ...item, chinese: item.term, display: `${item.term} (${item.turkish})` });
      }
    }
    for (const item of this.enDb.suspicious) {
      if (this._matchEnglish(lower, item.term)) {
        suspicious.push({ ...item, chinese: item.term, display: `${item.term} (${item.turkish})` });
      }
    }
    for (const item of this.enDb.halal_check) {
      if (this._matchEnglish(lower, item.term)) {
        halal_check.push({ ...item, chinese: item.term, display: `${item.term} (${item.turkish})` });
      }
    }
    return { haram, suspicious, halal_check };
  }

  // Kelime sınırlarına dikkat ederek eşleştir (ör. "egg" → "eggs" de yakalar ama "eggplant" yakalamaz)
  _matchEnglish(text, term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![a-z])${escaped}(?![a-z])`, 'i');
    return re.test(text);
  }

  // İki analizin sonuçlarını birleştir (çift dil)
  _mergeResults(zh, en, text) {
    const haram      = this._dedup([...zh.haram,      ...en.haram]);
    const suspicious = this._dedup([...zh.suspicious,  ...en.suspicious]);
    const halal_check= this._dedup([...zh.halal_check, ...en.halal_check]);
    return this._verdict({ haram, suspicious, halal_check, text });
  }

  _dedup(arr) {
    const seen = new Set();
    return arr.filter(i => {
      const key = i.turkish;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ── Karar ──
  _verdict({ haram, suspicious, halal_check, text }) {
    if (text.trim().length < 4) {
      return {
        status: 'unreadable', icon: '📷', color: '#95A5A6', bgColor: '#F8F9FA',
        title: 'Metin Okunamadı',
        message: 'İçerik listesi okunamadı. Daha net, yakın bir fotoğraf çekmeyi dene.',
        details: { haram, suspicious, halal_check }
      };
    }

    if (haram.length > 0) {
      const items = haram.map(i => i.display).join('\n• ');
      return {
        status: 'haram', icon: '❌', color: '#E74C3C', bgColor: '#FDEDEC',
        title: 'Haram İçerik Tespit Edildi',
        message: `Bu ürün haram içerik barındırıyor:\n• ${items}`,
        details: { haram, suspicious, halal_check }
      };
    }

    if (suspicious.length > 0 && halal_check.length > 0) {
      const sItems = suspicious.map(i => i.display).join('\n• ');
      const hItems = halal_check.map(i => i.display).join('\n• ');
      return {
        status: 'multiple_check', icon: '⚠️', color: '#E67E22', bgColor: '#FEF9E7',
        title: 'Çoklu Kontrol Gerekli',
        message: `Şüpheli içerik:\n• ${sItems}\n\nKesim kontrolü gerektiren:\n• ${hItems}\n\nHer ikisini de doğrula!`,
        details: { haram, suspicious, halal_check }
      };
    }

    if (suspicious.length > 0) {
      const items = suspicious.map(i => i.display).join('\n• ');
      return {
        status: 'suspicious', icon: '⚠️', color: '#F39C12', bgColor: '#FEF9E7',
        title: 'Şüpheli İçerik Var',
        message: `Kaynağı belirsiz içerik tespit edildi:\n• ${items}\n\nHelallik durumunu araştır!`,
        details: { haram, suspicious, halal_check }
      };
    }

    if (halal_check.length > 0) {
      const items = halal_check.map(i => i.display).join('\n• ');
      return {
        status: 'halal_check', icon: '🔍', color: '#2980B9', bgColor: '#EBF5FB',
        title: 'Kesim Kontrolü Gerekli',
        message: `Haram listesinden bileşen yok, ancak şu içerik(ler) tespit edildi:\n• ${items}\n\nHelallik sertifikasını kontrol et!`,
        details: { haram, suspicious, halal_check }
      };
    }

    // Hayvansal ipucu: Çince karakterler veya İngilizce hayvansal kelimeler
    const zhAnimalHints = ['肉','骨','血','脂','油','奶','蛋','鱼','虾','胶'];
    const enAnimalHints = ['meat','milk','butter','cream','egg','fish','beef','chicken','lamb'];
    const lower = text.toLowerCase();
    const hasAnimal =
      zhAnimalHints.some(k => text.includes(k)) ||
      enAnimalHints.some(k => lower.includes(k));

    if (!hasAnimal) {
      return {
        status: 'vegetarian', icon: '🌱', color: '#27AE60', bgColor: '#EAFAF1',
        title: 'Tamamen Bitkisel Görünüyor',
        message: 'Bilinen hayvansal içerik tespit edilmedi. Ürün tamamen bitkisel görünüyor.',
        details: { haram, suspicious, halal_check }
      };
    }

    return {
      status: 'clean', icon: '✅', color: '#2ECC71', bgColor: '#EAFAF1',
      title: 'Bilinen Haram İçerik Yok',
      message: 'Haram veya şüpheli içerik tespit edilmedi. Yine de içerikleri kendin de incele.',
      details: { haram, suspicious, halal_check }
    };
  }
}
