import {runLongCargo} from './pmc-long-cargo.mjs';
import { runPacking } from './pmc-engine.mjs';
import { normalizePmcInput, STRATEGY_NAMES } from './pmc-search-strategies.mjs';
import { validatePmcCandidate } from './pmc-ai-validation.mjs';

self.onmessage = ({ data }) => {
  try {
    const { rows, config } = normalizePmcInput(data.rows, data.config);
    const strategy = STRATEGY_NAMES.includes(data.strategy) ? data.strategy : undefined;
    const result = (config.longCargo ? runLongCargo : runPacking)(rows, config, strategy);
    if (strategy && !validatePmcCandidate(rows, config, result).valid) {
      self.postMessage({ error: 'Kayıtlı AI yerleşimi mevcut ayarlarla doğrulanamadı.' });
      return;
    }
    self.postMessage({ result });
  } catch {
    self.postMessage({ error: 'Hesaplama tamamlanamadı. Girdileri kontrol edip yeniden deneyin.' });
  }
};
