'use strict';

class HalalAnalyzer {
  constructor(database) {
    this.db = database;
  }

  analyze(text) {
    const haram = [];
    const suspicious = [];
    const halal_check = [];

    for (const item of this.db.haram) {
      if (text.includes(item.chinese)) haram.push(item);
    }
    for (const item of this.db.suspicious) {
      if (text.includes(item.chinese)) suspicious.push(item);
    }
    for (const item of this.db.halal_check) {
      if (text.includes(item.chinese)) halal_check.push(item);
    }

    return this._verdict({ haram, suspicious, halal_check, text });
  }

  _verdict({ haram, suspicious, halal_check, text }) {
    // Metin çok kısaysa okunamadı
    if (text.trim().length < 4) {
      return {
        status: 'unreadable',
        icon: '📷',
        color: '#95A5A6',
        bgColor: '#F8F9FA',
        title: 'Metin Okunamadı',
        message: 'İçerik listesi okunamadı. Daha net, yakın bir fotoğraf çekmeyi dene.',
        details: { haram, suspicious, halal_check }
      };
    }

    // Kesin haram içerik
    if (haram.length > 0) {
      const items = haram.map(i => `${i.chinese} (${i.turkish})`).join('، ');
      return {
        status: 'haram',
        icon: '❌',
        color: '#E74C3C',
        bgColor: '#FDEDEC',
        title: 'Haram İçerik Tespit Edildi',
        message: `Bu ürün haram içerik barındırıyor:\n${items}`,
        details: { haram, suspicious, halal_check }
      };
    }

    // Hem şüpheli hem kesim kontrolü
    if (suspicious.length > 0 && halal_check.length > 0) {
      const sItems = suspicious.map(i => `${i.chinese} (${i.turkish})`).join('، ');
      const hItems = halal_check.map(i => `${i.chinese} (${i.turkish})`).join('، ');
      return {
        status: 'multiple_check',
        icon: '⚠️',
        color: '#E67E22',
        bgColor: '#FEF9E7',
        title: 'Çoklu Kontrol Gerekli',
        message: `Şüpheli içerik: ${sItems}\n\nKesim kontrolü gerektiren: ${hItems}\n\nHer ikisini de doğrula!`,
        details: { haram, suspicious, halal_check }
      };
    }

    // Sadece şüpheli
    if (suspicious.length > 0) {
      const items = suspicious.map(i => `${i.chinese} (${i.turkish})`).join('، ');
      return {
        status: 'suspicious',
        icon: '⚠️',
        color: '#F39C12',
        bgColor: '#FEF9E7',
        title: 'Şüpheli İçerik Var',
        message: `Kaynağı belirsiz içerik tespit edildi:\n${items}\n\nHelallik durumunu araştır!`,
        details: { haram, suspicious, halal_check }
      };
    }

    // Sadece kesim kontrolü
    if (halal_check.length > 0) {
      const items = halal_check.map(i => `${i.chinese} (${i.turkish})`).join('، ');
      return {
        status: 'halal_check',
        icon: '🔍',
        color: '#2980B9',
        bgColor: '#EBF5FB',
        title: 'Kesim Kontrolü Gerekli',
        message: `Haram listesinden bileşen yok, ancak şu içerik(ler) tespit edildi:\n${items}\n\nHelallik sertifikasını kontrol et!`,
        details: { haram, suspicious, halal_check }
      };
    }

    // Hayvansal işaret var ama listede eşleşen yok → "görünürde temiz"
    const animalHints = ['肉', '骨', '血', '脂', '油', '奶', '蛋', '鱼', '虾', '胶'];
    const hasAnimalHint = animalHints.some(k => text.includes(k));

    if (!hasAnimalHint) {
      return {
        status: 'vegetarian',
        icon: '🌱',
        color: '#27AE60',
        bgColor: '#EAFAF1',
        title: 'Tamamen Bitkisel Görünüyor',
        message: 'Bilinen hayvansal içerik tespit edilmedi. Ürün tamamen bitkisel görünüyor.',
        details: { haram, suspicious, halal_check }
      };
    }

    return {
      status: 'clean',
      icon: '✅',
      color: '#2ECC71',
      bgColor: '#EAFAF1',
      title: 'Bilinen Haram İçerik Yok',
      message: 'Haram veya şüpheli içerik tespit edilmedi. Yine de içerikleri kendin de incele.',
      details: { haram, suspicious, halal_check }
    };
  }
}
