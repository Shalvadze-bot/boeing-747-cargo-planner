import {runLongCargo} from './pmc-long-cargo.mjs';
import { runPacking } from './pmc-engine.mjs';
import { normalizePmcInput, STRATEGY_NAMES } from './pmc-search-strategies.mjs';
import { validatePmcCandidate } from './pmc-ai-validation.mjs';
import { runContourPacking } from './pmc-contour-optimizer.mjs';
import { CONTOUR_OPTIMIZER } from './pmc-research-review.mjs';

self.onmessage = ({ data }) => {
  try {
    if(data.config?.optimizer===CONTOUR_OPTIMIZER) {
      self.postMessage({result:runContourPacking(data.rows,data.config,{timeLimitMs:25_000})});
      return;
    }
    const { rows, config } = normalizePmcInput(data.rows, data.config);
    const strategy = STRATEGY_NAMES.includes(data.strategy) ? data.strategy : undefined;
    const started=performance.now();
    const result = (config.longCargo ? runLongCargo : runPacking)(rows, config, strategy);
    if (strategy && !validatePmcCandidate(rows, config, result).valid) {
      self.postMessage({ error: 'Kayıtlı AI yerleşimi mevcut ayarlarla doğrulanamadı.' });
      return;
    }
    self.postMessage({ result:{...result,elapsedMs:performance.now()-started} });
  } catch {
    self.postMessage({ error: 'Hesaplama tamamlanamadı. Girdileri kontrol edip yeniden deneyin.' });
  }
};
