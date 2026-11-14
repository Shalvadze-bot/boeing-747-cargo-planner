import {runLongCargo} from './pmc-long-cargo.mjs';
import { runPacking } from './pmc-engine.mjs';

self.onmessage = ({ data }) => {
  try {
    const rows = data.rows.map(row => ({ ...row,
      length: Number(row.length), width: Number(row.width), height: Number(row.height), quantity: Number(row.quantity),
      weight: row.weight === '' || row.weight == null ? null : Number(row.weight),
    }));
    const config = { ...data.config, maxPallets: Number(data.config.maxPallets),
      maxOverhangCm: data.config.allowOverhang && data.config.maxOverhangCm !== '' && data.config.maxOverhangCm != null ? Number(data.config.maxOverhangCm) : null,
      minOverhangHeightCm: data.config.allowOverhang && data.config.minOverhangHeightCm !== '' && data.config.minOverhangHeightCm != null ? Number(data.config.minOverhangHeightCm) : null,
    };
    self.postMessage({ result: (config.longCargo ? runLongCargo : runPacking)(rows, config) });
  } catch {
    self.postMessage({ error: 'Hesaplama tamamlanamadı. Girdileri kontrol edip yeniden deneyin.' });
  }
};
