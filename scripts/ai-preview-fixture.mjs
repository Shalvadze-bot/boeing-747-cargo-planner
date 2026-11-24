// Deliberately synthetic cartons. The default search places 8 of the 12;
// ordering by narrow edge places 9 under the same two-PMC limit.
const inputs = [
  [140,75,110,3,120,true,'#34d399'],
  [140,115,110,2,120,false,'#c084fc'],
  [110,105,90,2,75,true,'#60a5fa'],
  [140,115,110,3,30,false,'#f4c44e'],
  [140,105,70,2,120,false,'#fb7185'],
];
export const syntheticRows = inputs.map(([length,width,height,quantity,weight,stackable,color], index) =>
  ({ id:'demo-' + (index + 1), name:'Sentetik yük ' + (index + 1), length,width,height,quantity,weight,
    stackable,color,allowRotation:true,orientationMode:'upright' }));
export const syntheticConfig = { maxPallets:2, mirrored:false, allowOverhang:false };
