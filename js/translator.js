'use strict';

class Translator {
  constructor(translations) {
    this.dict = translations;
  }

  // Çince içerik listesini ayrıştır ve çevir
  translateIngredients(rawText) {
    const cleaned = this._stripLabel(rawText);
    const items   = this._split(cleaned);
    return items
      .map(item => this._translateOne(item))
      .filter(i => i.original.length > 0);
  }

  // "配料：" "原料：" gibi başlıkları sil
  _stripLabel(text) {
    return text
      .replace(/^[\s\S]*?(?:配料|原料|成分|材料)[：:]\s*/, '')
      .trim();
  }

  // Çince separator karakterlerine göre böl
  _split(text) {
    return text
      .split(/[、，,；;\s]+/)
      .map(s => s.replace(/[()（）[\]【】]/g, '').trim())
      .filter(s => s.length > 0 && s.length <= 20);
  }

  // Tek bir içeriği çevir — uzun eşleşmeyi önce dene (greedy)
  _translateOne(original) {
    // Tam eşleşme
    if (this.dict[original]) {
      return { original, turkish: this.dict[original], matched: true };
    }
    // İçerik, sözlükteki anahtar kelimeyi barındırıyor mu? (en uzun eşleşme)
    let best = null;
    for (const key of Object.keys(this.dict)) {
      if (original.includes(key) && (!best || key.length > best.length)) {
        best = key;
      }
    }
    if (best) {
      return { original, turkish: this.dict[best], matched: true };
    }
    return { original, turkish: null, matched: false };
  }

  // Ürün türünü tahmin et
  guessProductType(rawText) {
    const text = rawText;
    const rules = [
      { keys: ['方便面', '拉面', '挂面', '面条'],            label: '🍜 Hazır/Anlık Noodle' },
      { keys: ['饼干', '曲奇', '奥利奥'],                    label: '🍪 Bisküvi / Kurabiye' },
      { keys: ['蛋糕', '面包', '吐司', '糕'],               label: '🎂 Ekmek / Kek' },
      { keys: ['薯片', '薯条', '土豆片'],                    label: '🥔 Patates Cipsi' },
      { keys: ['糖果', '软糖', '硬糖', '棒棒糖'],            label: '🍬 Şekerleme' },
      { keys: ['巧克力'],                                    label: '🍫 Çikolata' },
      { keys: ['冰淇淋', '雪糕', '冰棍'],                    label: '🍦 Dondurma' },
      { keys: ['饮料', '果汁', '汽水', '可乐'],              label: '🥤 İçecek' },
      { keys: ['酸奶', '乳酸'],                              label: '🥛 Yoğurt' },
      { keys: ['牛奶', '奶粉'],                              label: '🥛 Süt Ürünü' },
      { keys: ['豆腐', '豆浆', '大豆蛋白'],                  label: '🫘 Soya Ürünü' },
      { keys: ['牛肉', '羊肉', '鸡肉', '猪肉', '肉松'],     label: '🥩 Et Ürünü' },
      { keys: ['虾', '鱼', '海鲜', '蟹'],                   label: '🦐 Deniz Ürünü' },
      { keys: ['米', '大米', '糯米'],                        label: '🍚 Pirinç Ürünü' },
      { keys: ['咖啡'],                                      label: '☕ Kahve' },
      { keys: ['茶', '绿茶', '红茶'],                        label: '🍵 Çay' },
      { keys: ['花生', '坚果', '核桃', '杏仁'],              label: '🥜 Kuruyemiş' },
      { keys: ['果冻', '布丁', '明胶'],                      label: '🍮 Jöle / Puding' },
      { keys: ['辣条', '辣片'],                              label: '🌶️ Acı Atıştırmalık' },
    ];

    for (const rule of rules) {
      if (rule.keys.some(k => text.includes(k))) return rule.label;
    }
    return null;
  }
}
