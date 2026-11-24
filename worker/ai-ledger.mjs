const RESERVE = `
INSERT INTO cargo_ai_calls (actor, run_id, step, work_key, started_ms, model, charge_nano, status)
SELECT ?, ?, ?, ?, ?, ?, ?, 'reserved'
WHERE COALESCE((SELECT SUM(charge_nano) FROM cargo_ai_calls), 0) + ? <= ?
  AND NOT EXISTS (SELECT 1 FROM cargo_ai_calls WHERE status = 'cost_anomaly')
  AND (SELECT count(*) FROM cargo_ai_calls WHERE actor = ? AND started_ms > ?) < ?
  AND NOT EXISTS (SELECT 1 FROM cargo_ai_calls WHERE actor = ? AND status = 'reserved' AND started_ms > ?)
  AND (
    (? = 0 AND NOT EXISTS (
      SELECT 1 FROM cargo_ai_calls WHERE actor = ? AND started_ms > ? AND work_key = ? AND run_id <> ?
    ))
    OR (? > 0 AND EXISTS (
      SELECT 1 FROM cargo_ai_calls WHERE actor = ? AND run_id = ? AND step = ? - 1
        AND work_key = ? AND status = 'completed' AND started_ms > ?
    ))
  )
ON CONFLICT (actor, run_id, step) DO NOTHING
RETURNING step
`;

export async function reserveCall(db, info) {
  const { actor, runId, step, workKey, now, model, reserve, budget, hourly } = info;
  const row = await db.prepare(RESERVE).bind(
    actor, runId, step, workKey, now, model, reserve,
    reserve, budget, actor, now - 3600000, hourly, actor, now - 60000,
    step, actor, now - 45000, workKey, runId, step,
    actor, runId, step, workKey, now - 300000,
  ).first();
  if (row) return null;
  const summary = await db.prepare(`
    SELECT coalesce(sum(charge_nano), 0) AS spent,
      coalesce(sum(CASE WHEN actor = ? AND started_ms > ? THEN 1 ELSE 0 END), 0) AS recent,
      coalesce(max(status = 'cost_anomaly'), 0) AS anomaly
    FROM cargo_ai_calls
  `).bind(actor, now - 3600000).first();
  if (summary.anomaly || summary.spent + reserve > budget) return 'budget';
  return summary.recent >= hourly ? 'rate' : 'duplicate';
}

export async function settleCall(db, info, result) {
  await db.prepare(`
    UPDATE cargo_ai_calls SET charge_nano = ?, status = ?, provider_id = ?,
      input_tokens = ?, output_tokens = ?, elapsed_ms = ?
    WHERE actor = ? AND run_id = ? AND step = ? AND status = 'reserved'
  `).bind(result.cost, result.status, result.providerId ?? null, result.usage?.input ?? null,
    result.usage?.output ?? null, Date.now() - info.now, info.actor, info.runId, info.step).run();
}
