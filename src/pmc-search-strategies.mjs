const area = item => item.width * item.length;
const volume = item => area(item) * item.height;
const longest = item => Math.max(item.width, item.length);
const narrowest = item => Math.min(item.width, item.length);

export const STRATEGIES = Object.freeze({
  long_first: 'En uzun taban kenarından başla.',
  heavy_first: 'Bilinen ağır parçaları önce dene.',
  small_first: 'Küçük hacimleri önce dene.',
  broad_first: 'Geniş tabanlı parçaları önce dene.',
  narrow_first: 'Dar taban kenarından başla.',
  nonstackable_last: 'Üst yüzeyi destek olarak kullanılabilen parçaları önce dene.',
  flat_orientation: 'İzinli yönler arasından daha alçak olanlara öncelik ver.',
  narrow_orientation: 'İzinli yönler arasından dar eni önce dene.',
});
export const STRATEGY_NAMES = Object.keys(STRATEGIES);

export function strategyOrder(strategy, getRow = item => item) {
  const sorter = {
    long_first: (a, b) => longest(b) - longest(a) || area(b) - area(a),
    heavy_first: (a, b) => (b.weight ?? -1) - (a.weight ?? -1) || area(b) - area(a),
    small_first: (a, b) => volume(a) - volume(b),
    broad_first: (a, b) => area(b) - area(a),
    narrow_first: (a, b) => narrowest(a) - narrowest(b) || longest(b) - longest(a),
    nonstackable_last: (a, b) => Number(b.stackable) - Number(a.stackable) || area(b) - area(a),
    flat_orientation: (a, b) => b.height - a.height,
    narrow_orientation: (a, b) => longest(b) - longest(a),
  }[strategy];
  return sorter && ((a, b) => sorter(getRow(a), getRow(b)));
}

export function strategyOrientations(variants, strategy) {
  if (strategy === 'flat_orientation') return [...variants].sort((a, b) => a[2] - b[2] || a[0] - b[0]);
  if (strategy === 'narrow_orientation') return [...variants].sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  return variants;
}

export function normalizePmcConfig(config) {
  return { ...config, maxPallets: Number(config.maxPallets),
    maxOverhangCm: config.allowOverhang && config.maxOverhangCm !== '' && config.maxOverhangCm != null ? Number(config.maxOverhangCm) : null,
    minOverhangHeightCm: config.allowOverhang && config.minOverhangHeightCm !== '' && config.minOverhangHeightCm != null ? Number(config.minOverhangHeightCm) : null,
  };
}

export function normalizePmcInput(rows, config) {
  return {
    rows: rows.map(row => ({ ...row,
      length: Number(row.length), width: Number(row.width), height: Number(row.height),
      quantity: Number(row.quantity),
      weight: row.weight === '' || row.weight == null ? null : Number(row.weight),
    })),
    config: normalizePmcConfig(config),
  };
}
