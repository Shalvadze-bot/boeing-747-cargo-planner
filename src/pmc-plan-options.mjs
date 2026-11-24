export const OBJECTIVES = Object.freeze({
  capacity: 'En çok parça',
  compact: 'En az PMC',
  balance: 'Daha dengeli dağılım',
});

export function layoutKey(result) {
  return JSON.stringify(result.placements.map(p => [p.id,p.palletIndex,p.x,p.y,p.z,p.w,p.l,p.h,p.orientationFace])
    .sort((a,b) => a[0].localeCompare(b[0])));
}

export function compareMetrics(a, b, objective = 'capacity') {
  const delta = a.placed - b.placed;
  const pmcs = b.pmcs - a.pmcs;
  const distance = a.balanceDistance == null || b.balanceDistance == null ? 0 : b.balanceDistance - a.balanceDistance;
  if (objective === 'compact') return pmcs || delta || distance;
  if (objective === 'balance') return delta || distance || pmcs;
  return delta || pmcs || distance;
}

export function sortAlternatives(candidates, baseline, objective) {
  const seen = new Set([layoutKey(baseline.result)]);
  return candidates.filter(candidate => {
    if (!candidate.validation.valid) return false;
    const key = layoutKey(candidate.result);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a,b) => {
    // The compact objective still ranks plans that preserve the standard
    // cargo count ahead of those that leave more pieces behind.
    const loss = (a.validation.stats.placed >= baseline.validation.stats.placed ? 1 : 0) -
      (b.validation.stats.placed >= baseline.validation.stats.placed ? 1 : 0);
    return loss ? -loss : -compareMetrics(a.validation.stats,b.validation.stats,objective);
  }).slice(0,3);
}

export function canApplyAlternative(candidate, baseline, current, objective) {
  if (!candidate?.validation.valid) return false;
  const improves = comparison => !comparison?.stats || (
    candidate.validation.stats.placed >= comparison.stats.placed &&
    compareMetrics(candidate.validation.stats,comparison.stats,objective) > 1e-5
  );
  return improves(baseline) && (!current?.valid || improves(current));
}
