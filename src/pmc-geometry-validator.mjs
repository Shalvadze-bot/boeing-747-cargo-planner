// Independent research geometry. All numeric lengths are millimetres.
// Do not use as operational loading approval.

export function makeResearchModel(overrides = {}) {
  return {
    id: 'avianca-a330-200f-contour-1-research-v1',
    units: 'mm',
    authority: 'research-only',
    source: 'https://www.aviancacargo.com/downloads/oversize_eng.pdf#page=4',
    nominal: {widthMm: 2438.4, lengthMm: 3175},
    usable: {xMm: 85, yMm: 85, widthMm: 2268.4, lengthMm: 3005},
    contour: {
      // Coordinates are high-side to low-side. The origin at the usable high edge
      // and vertical datum are assumed; neither is an approved aircraft datum.
      points: [[0,96],[38,96],[74,72],[92,37]].map(([x,z]) => [x*25.4,z*25.4]),
      highEdgeOffsetMm: 34.2,
      verticalOffsetMm: 0,
      mirrored: false,
      extruded: true
    },
    minHorizontalGapMm: 0,
    numericalToleranceMm: 0.000001,
    maxPallets: 30,
    ...overrides
  };
}

export function validatePmcGeometry({items, placements, unplacedIds = [], model} = {}) {
  const issues = [];
  const add = (status, code, ids = [], details = {}) => issues.push({status, code, ids, ...details});
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const positive = v => finite(v) && v > 0;
  const nonnegative = v => finite(v) && v >= 0;
  const validId = v => typeof v === 'string' && v.trim().length > 0;
  const orientations = ['yaw0','yaw90'];
  const itemMap = new Map();
  const seen = new Set();
  const boxes = [];
  const groups = new Map();
  let minVerticalMarginMm = null;
  const missing = v => v === undefined || v === null;
  const report = () => {
    const status = issues.some(i => i.status === 'FAIL') ? 'FAIL' :
      issues.some(i => i.status === 'UNKNOWN') ? 'UNKNOWN' : 'PASS';
    return {status, scope:'research-geometry-only', modelId:model?.id ?? null,
      operationalStatus:'UNKNOWN', operationalApproval:false,
      complete: Array.isArray(items) && itemMap.size === items.length && itemMap.size > 0 &&
        seen.size === itemMap.size && Array.isArray(unplacedIds) && unplacedIds.length === 0 &&
        boxes.length === itemMap.size && !issues.some(i=>i.status==='FAIL'),
      placedCount:boxes.length, unplacedCount:Array.isArray(unplacedIds)?unplacedIds.length:null,
      palletCount:groups.size, minVerticalMarginMm, issues,
      limitations:['Research contour and footprint are not approved aircraft or operator limits.',
        'No CG, floor loading, strength, net/restraint, dynamic stability or door/path verification.',
        'Elevated cargo support is not evaluated in V1.']};
  };
  if (!Array.isArray(items) || !Array.isArray(placements) || !Array.isArray(unplacedIds) || items.length===0) {
    add('FAIL','INVALID_INPUT'); return report();
  }
  for (const item of items) {
    if (!item || !validId(item.id) || itemMap.has(item.id) ||
        ![item.widthMm,item.lengthMm,item.heightMm].every(positive)) {
      add('FAIL','INVALID_OR_DUPLICATE_ITEM',item?.id?[item.id]:[]); continue;
    }
    if (!missing(item.allowedOrientations) && (!Array.isArray(item.allowedOrientations) ||
      item.allowedOrientations.some(o=>!orientations.includes(o)))) {
      add('FAIL','INVALID_ORIENTATION_SET',[item.id]);
    }
    itemMap.set(item.id,item);
  }
  // Do not silently assume any missing model parameter. Invalid supplied data is FAIL.
  const nominal=model?.nominal, base=model?.usable, contour=model?.contour;
  const tol=model?.numericalToleranceMm, gap=model?.minHorizontalGapMm;
  const fields=[model?.id,model?.units,model?.authority,nominal?.widthMm,nominal?.lengthMm,
    base?.xMm,base?.yMm,base?.widthMm,base?.lengthMm,contour?.points,
    contour?.highEdgeOffsetMm,contour?.verticalOffsetMm,contour?.mirrored,contour?.extruded,
    tol,gap,model?.maxPallets];
  let modelOK=true;
  if (fields.some(missing)) {add('UNKNOWN','MISSING_GEOMETRY_PARAMETER'); modelOK=false;}
  if (modelOK && (!validId(model.id) || model.units!=='mm' || model.authority!=='research-only' ||
      ![nominal.widthMm,nominal.lengthMm,base.widthMm,base.lengthMm].every(positive) ||
      ![base.xMm,base.yMm,contour.highEdgeOffsetMm,contour.verticalOffsetMm,tol,gap].every(nonnegative) ||
      tol>0.01 || typeof contour.mirrored!=='boolean' || typeof contour.extruded!=='boolean' ||
      !Number.isSafeInteger(model.maxPallets) || model.maxPallets<1 ||
      !Array.isArray(contour.points) || contour.points.length<2 ||
      contour.points.some((p,i)=>!Array.isArray(p)||p.length!==2||!p.every(finite)||
        p[0]<0||p[1]<0||(i>0&&p[0]<=contour.points[i-1][0])) ||
      contour.points[0][0]!==0 || base.xMm+base.widthMm>nominal.widthMm+tol ||
      base.yMm+base.lengthMm>nominal.lengthMm+tol)) {
    add('FAIL','INVALID_GEOMETRY_PARAMETER'); modelOK=false;
  }
  if (modelOK && !contour.extruded) {
    add('UNKNOWN','LONGITUDINAL_PROFILE_NOT_DEFINED'); modelOK=false;
  }
  const epsilon=modelOK?tol:0;
  function heightAt(x) {
    const p=contour.points;
    if (x<p[0][0]-epsilon || x>p[p.length-1][0]+epsilon) return null;
    x=Math.max(p[0][0],Math.min(p[p.length-1][0],x));
    for(let i=1;i<p.length;i++) {
      if(x<=p[i][0]) {
        const [a,b]=p[i-1], [c,d]=p[i];
        return b+(d-b)*(x-a)/(c-a);
      }
    }
    return p[p.length-1][1];
  }
  for (const p of placements) {
    if (!p || !validId(p.id) || !itemMap.has(p.id) || seen.has(p.id)) {
      add('FAIL','UNKNOWN_OR_DUPLICATE_PLACEMENT',p?.id?[p.id]:[]); continue;
    }
    seen.add(p.id);
    if (!Number.isSafeInteger(p.palletIndex) || p.palletIndex<0 ||
      (modelOK&&p.palletIndex>=model.maxPallets) ||
      ![p.uMm,p.vMm,p.zMm].every(finite) ||
      ![p.widthMm,p.lengthMm,p.heightMm].every(positive) ||
      ![p.uMm+p.widthMm,p.vMm+p.lengthMm,p.zMm+p.heightMm].every(finite)) {
      add('FAIL','INVALID_PLACEMENT',[p.id]); continue;
    }
    boxes.push(p);
    if (!groups.has(p.palletIndex)) groups.set(p.palletIndex,[]);
    groups.get(p.palletIndex).push(p);
    const item=itemMap.get(p.id);
    if (missing(p.orientation)) {
      add('UNKNOWN','ORIENTATION_NOT_SPECIFIED',[p.id]);
    } else if (!orientations.includes(p.orientation)) {
      add('UNKNOWN','ORIENTATION_OUTSIDE_V1',[p.id]);
    } else {
      const expected=p.orientation==='yaw90'?
        [item.lengthMm,item.widthMm,item.heightMm]:[item.widthMm,item.lengthMm,item.heightMm];
      if (![p.widthMm,p.lengthMm,p.heightMm].every((n,i)=>Math.abs(n-expected[i])<=epsilon)) {
        add('FAIL','ORIENTATION_DIMENSION_MISMATCH',[p.id]);
      }
      if (missing(item.allowedOrientations)) add('UNKNOWN','ORIENTATION_PERMISSION_UNKNOWN',[p.id]);
      else if (Array.isArray(item.allowedOrientations)&&!item.allowedOrientations.includes(p.orientation))
        add('FAIL','ORIENTATION_FORBIDDEN',[p.id]);
    }
    if (p.uMm < -epsilon || p.vMm < -epsilon || p.zMm < -epsilon)
      add('FAIL','NEGATIVE_LOCAL_COORDINATE',[p.id]);
    if (p.zMm>epsilon) add('UNKNOWN','ELEVATED_SUPPORT_OUTSIDE_V1',[p.id]);
    if (!modelOK) continue;
    const {uMm:u,vMm:v,zMm:z,widthMm:w,lengthMm:l,heightMm:h}=p;
    if (u+w>base.widthMm+tol || v+l>base.lengthMm+tol) add('FAIL','USABLE_BASE_EXCEEDED',[p.id]);
    const x0=contour.highEdgeOffsetMm+(contour.mirrored?base.widthMm-u-w:u);
    const x1=x0+w;
    const h0=heightAt(x0), h1=heightAt(x1);
    if (h0===null || h1===null) {add('FAIL','CONTOUR_WIDTH_EXCEEDED',[p.id]); continue;}
    // Piecewise-linear envelope: endpoints AND every interior break point.
    // This also handles a non-monotone roof with an interior low point.
    const roof=Math.min(h0,h1,...contour.points.filter(([x])=>x>x0&&x<x1).map(([,z])=>z));
    const margin=roof-(z+h+contour.verticalOffsetMm);
    if (!finite(margin)) {add('FAIL','INVALID_TRANSFORM',[p.id]);continue;}
    minVerticalMarginMm=minVerticalMarginMm===null?margin:Math.min(minVerticalMarginMm,margin);
    if (margin < -tol) add('FAIL','CONTOUR_HEIGHT_EXCEEDED',[p.id],{verticalMarginMm:margin});
  }
  for (const id of unplacedIds) {
    if (!validId(id) || !itemMap.has(id) || seen.has(id)) add('FAIL','UNKNOWN_OR_DUPLICATE_UNPLACED',[id]);
    else seen.add(id);
  }
  for (const id of itemMap.keys()) if(!seen.has(id)) add('FAIL','ITEM_NOT_ACCOUNTED_FOR',[id]);
  for (const group of groups.values()) {
    for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++){
      const a=group[i],b=group[j];
      const dx=Math.max(b.uMm-a.uMm-a.widthMm,a.uMm-b.uMm-b.widthMm);
      const dy=Math.max(b.vMm-a.vMm-a.lengthMm,a.vMm-b.vMm-b.lengthMm);
      const dz=Math.max(b.zMm-a.zMm-a.heightMm,a.zMm-b.zMm-b.heightMm);
      if(dx < -epsilon && dy < -epsilon && dz < -epsilon) add('FAIL','BOX_OVERLAP',[a.id,b.id]);
      // Inter-piece working gap is horizontal only when vertical interiors overlap.
      else if(modelOK&&dz < -tol && dx < gap-tol && dy < gap-tol)
        add('FAIL','HORIZONTAL_CLEARANCE_EXCEEDED',[a.id,b.id],{availableMm:Math.max(dx,dy),requiredMm:gap});
    }
  }
  return report();
}

export function fromLegacyPmcPlan(rows, result, model) {
  // Existing optimizer uses cm measured from physical pallet front/left, with
  // a global longitudinal coordinate. This adapter never infers permissions.
  if (!Array.isArray(rows) || !Array.isArray(result?.placements) ||
      !Array.isArray(result?.unplaced) || !model?.nominal || !model?.usable ||
      result.errors?.length) throw new TypeError('Explicit model and valid optimizer input/output required');
  if (result.config?.longCargo || result.placements.some(p=>p.touchedPallets?.length>1 || p.overhangCm>0))
    throw new RangeError('Multi-position and long cargo are outside PMC Geometry Validator V1');
  if (typeof result.config?.mirrored !== 'boolean' || result.config.mirrored!==model.contour?.mirrored)
    throw new RangeError('Explicit matching mirrored orientation required');
  const items=[], byId=new Map();
  for (const r of rows) {
    if (!Number.isSafeInteger(r.quantity)||r.quantity<1||r.quantity>200||typeof r.id!=='string')
      throw new TypeError('Invalid source row');
    for(let i=1;i<=r.quantity;i++){
      const id=`${r.id}:${i}`;
      const item={id,widthMm:r.width*10,lengthMm:r.length*10,heightMm:r.height*10};
      const mode=r.pieceOrientations?.[i]??r.orientationMode;
      // A missing rotation permission stays unknown. The research check supports
      // only upright dimensions, even when a source permits other faces.
      if (typeof r.allowRotation==='boolean' && (mode===undefined||['upright','side-width','side-length','all'].includes(mode)))
        item.allowedOrientations=r.allowRotation?['yaw0','yaw90']:['yaw0'];
      items.push(item); byId.set(id,item);
    }
  }
  const placements=result.placements.map(p=>{
    const i=byId.get(p.id);
    let orientation=null;
    if(p.orientationFace==='upright'&&i){
      orientation=Math.abs(p.w*10-i.widthMm)<=0.000001&&Math.abs(p.l*10-i.lengthMm)<=0.000001?'yaw0':'yaw90';
    }
    return {id:p.id,palletIndex:p.palletIndex,uMm:p.x*10-model.usable.xMm,
      vMm:p.y*10-p.palletIndex*model.nominal.lengthMm-model.usable.yMm,zMm:p.z*10,
      widthMm:p.w*10,lengthMm:p.l*10,heightMm:p.h*10,orientation};
  });
  return {items,placements,unplacedIds:result.unplaced.map(p=>p.id),model};
}
