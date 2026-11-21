// Airbus A330 Aircraft Characteristics, 2-6-1 fig. 004 and 2-6-2 fig. 001.
// Pallet orientation and arrangement follow the 96 × 125 in examples.
// Drawing coordinates and all weight/height limits are for simulation only.
export const AIRCRAFT_MODEL = 'A330-243F';
export const AIRCRAFT_LENGTH = 58.82;
export const AIRCRAFT_WIDTH = 5.64;
export const AIRCRAFT_SPAN = 60.30;
export const AIRBUS_LAYOUT_SOURCE = 'https://www.aircraft.airbus.com/sites/default/files/2025-12/AC_A330_20251201.pdf';

const short = 243.84, long = 317.5;
const pairedRows = ['AB','BC','CE','EF','FH','HJ','JK','KM','MP'];
const aftRows = ['PP','RR','SS','TT'];
const pitch = dimension => dimension / 100 + 0.05;
const id = (deck, index) => deck + String(index + 1).padStart(2, '0');

function slot({deck, index, label, col, side = null, station, group, crosswise = false}) {
  const main = deck === 'main';
  return {
    id: id(main ? 'M' : 'L', index), label, deck, col, side, station, group,
    x: 0.5 + station / AIRCRAFT_LENGTH, zone: station < 0 ? 'Ön' : 'Arka',
    lateral: side === null ? 0 : (side ? -1 : 1) * pitch(short) / 2,
    l: crosswise ? short : long, w: crosswise ? long : short,
    max: main ? 6000 : 2000, h: main ? 260 : 150
  };
}

export const aircraftSlots = [
  ...pairedRows.flatMap((row, col) => [0, 1].map(side => slot({
    deck: 'main', index: 2 * col + side, label: row + (side ? 'R' : 'L'),
    col, side, station: -22.4 + (col + 0.5) * pitch(long), group: 'paired'
  }))),
  ...aftRows.map((label, i) => slot({
    deck: 'main', index: 18 + i, label, col: 9 + i,
    station: -22.4 + 9 * pitch(long) + (i + 0.5) * pitch(short),
    group: 'aft', crosswise: true
  })),
  ...Array.from({length: 8}, (_, i) => {
    const forward = i < 4;
    return slot({
      deck: 'lower', index: i, label: (forward ? 'Ö' : 'A') + (i % 4 + 1),
      col: i, station: (forward ? -21.4 : 6.3) + (i % 4 + 0.5) * pitch(short),
      group: forward ? 'forward' : 'aft', crosswise: true
    });
  })
];

export const slotLabel = id => aircraftSlots.find(slot => slot.id === id)?.label ?? id;
