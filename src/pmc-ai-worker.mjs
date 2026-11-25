import { runPacking } from './pmc-engine.mjs';
import { runLongCargo } from './pmc-long-cargo.mjs';
import { normalizePmcInput, STRATEGY_NAMES } from './pmc-search-strategies.mjs';
import { repackOnePmc } from './pmc-chat-search.mjs';
import { validatePmcCandidate } from './pmc-ai-validation.mjs';
import { CONTOUR_OPTIMIZER, recheckContourSnapshot } from './pmc-research-review.mjs';

self.onmessage = ({ data }) => {
  try {
    const { rows, config } = normalizePmcInput(data.rows, data.config);
    if(config.optimizer===CONTOUR_OPTIMIZER) {
      self.postMessage(recheckContourSnapshot(data.rows,config,data.baseline));
      return;
    }
    if (data.strategy && !STRATEGY_NAMES.includes(data.strategy)) throw new Error('Bilinmeyen arama stratejisi.');
    const started = performance.now();
    const result = data.singlePmc ? repackOnePmc(rows,config,data.current,data.singlePmc.index,data.strategy) :
      data.baseline ?? (config.longCargo ? runLongCargo : runPacking)(rows, config, data.strategy);
    self.postMessage({ result, validation: validatePmcCandidate(rows, config, result), elapsedMs: performance.now() - started });
  } catch {
    self.postMessage({ error: 'Yerleşim güvenli biçimde doğrulanamadı.' });
  }
};
