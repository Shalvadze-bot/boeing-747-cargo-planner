import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePmcGeometry, makeResearchModel, fromLegacyPmcPlan } from '../src/pmc-geometry-validator.mjs';

function geometryCases(validate, make, adapt, assert) {
  const item=(id,w=1000,l=1230,h=1350)=>({id,widthMm:w,lengthMm:l,heightMm:h,allowedOrientations:['yaw0','yaw90']});
  const place=(i,palletIndex,uMm,vMm,orientation='yaw0',zMm=0)=>({id:i.id,palletIndex,uMm,vMm,zMm,orientation,
    widthMm:orientation==='yaw90'?i.lengthMm:i.widthMm,lengthMm:orientation==='yaw90'?i.widthMm:i.lengthMm,heightMm:i.heightMm});
  const check=(items,placements,model=make(),unplacedIds=[])=>validate({items,placements,model,unplacedIds});
  const has=(r,c)=>assert.ok(r.issues.some(i=>i.code===c),c);
  return [
    {name:'39 synthetic upright units / 10 PMCs / no operational approval',run(){
      const items=Array.from({length:39},(_,i)=>item(`synthetic-${i}`));
      const ps=items.map((it,i)=>place(it,Math.floor(i/4),(i%2)*1000,Math.floor(i%4/2)*1230));
      const r=check(items,ps);assert.equal(r.status,'PASS');assert.equal(r.palletCount,10);assert.equal(r.placedCount,39);
      assert.equal(r.complete,true);assert.equal(r.operationalStatus,'UNKNOWN');assert.equal(r.operationalApproval,false);
    }},
    {name:'3+2 floor fit but corrected contour fails',run(){
      const items=[item('a'),item('b'),item('c'),item('d',1000,1200,1120),item('e',1000,1200,1120)];
      const p=[...items.slice(0,3).map((x,i)=>place(x,0,0,i*1000,'yaw90')),
        place(items[3],0,1230,0),place(items[4],0,1230,1200)];
      const r=check(items,p);assert.equal(r.status,'FAIL');has(r,'CONTOUR_HEIGHT_EXCEEDED');
      assert.ok(!r.issues.some(i=>i.code==='USABLE_BASE_EXCEEDED'));
    }},
    {name:'mirrored contour yields same result for mirrored physical placement',run(){
      const i=item('a');const m=make();const p=place(i,0,0,0);
      const a=check([i],[p],m);const b=check([i],[{...p,uMm:m.usable.widthMm-p.widthMm}],{...m,contour:{...m.contour,mirrored:true}});
      assert.equal(a.status,b.status);assert.ok(Math.abs(a.minVerticalMarginMm-b.minVerticalMarginMm)<1e-8);
      assert.equal(check([i],[p],{...m,contour:{...m.contour,mirrored:true}}).status,'FAIL');
    }},
    {name:'touching is allowed at zero gap; positive overlap fails',run(){
      const a=item('a'),b=item('b');const p=place(a,0,0,0),q=place(b,0,1000,0);
      assert.equal(check([a,b],[p,q]).status,'PASS');
      const r=check([a,b],[p,{...q,uMm:999.99}]);assert.equal(r.status,'FAIL');has(r,'BOX_OVERLAP');
    }},
    {name:'horizontal gap is independent of numeric epsilon',run(){
      const a=item('a'),b=item('b');const m=make({minHorizontalGapMm:2.5});
      const p=place(a,0,0,0),q=place(b,0,1002.5,0);
      assert.equal(check([a,b],[p,q],m).status,'PASS');
      has(check([a,b],[p,{...q,uMm:1002.4}],m),'HORIZONTAL_CLEARANCE_EXCEEDED');
    }},
    {name:'datum shift changes contour verdict',run(){
      const i=item('a',1000,1230,1190); const p=place(i,0,1200,0);const m=make();
      assert.equal(check([i],[p],m).status,'FAIL');
      assert.equal(check([i],[p],{...m,contour:{...m.contour,highEdgeOffsetMm:0}}).status,'PASS');
    }},
    {name:'missing geometry and permissions remain unknown',run(){
      const i=item('a');delete i.allowedOrientations;const p=place(i,0,0,0);
      let r=check([i],[p]);assert.equal(r.status,'UNKNOWN');has(r,'ORIENTATION_PERMISSION_UNKNOWN');
      r=check([i],[p],{...make(),usable:null});assert.equal(r.status,'UNKNOWN');has(r,'MISSING_GEOMETRY_PARAMETER');
    }},
    {name:'forbidden rotation and mismatched dimensions fail',run(){
      const i=item('a');i.allowedOrientations=['yaw0'];
      has(check([i],[place(i,0,0,0,'yaw90')]),'ORIENTATION_FORBIDDEN');
      has(check([i],[{...place(i,0,0,0),heightMm:123}]),'ORIENTATION_DIMENSION_MISMATCH');
    }},
    {name:'duplicate, omitted and explicitly unplaced are distinct',run(){
      const a=item('a'),b=item('b'),p=place(a,0,0,0);
      has(check([a,b],[p,p]),'UNKNOWN_OR_DUPLICATE_PLACEMENT');
      has(check([a,b],[p]),'ITEM_NOT_ACCOUNTED_FOR');
      const r=check([a,b],[p],make(),['b']);assert.equal(r.status,'PASS');assert.equal(r.complete,false);
    }},
    {name:'boundary and tolerance',run(){
      const i=item('a',1000,1230,1000);const m=make();const p=place(i,0,0,m.usable.lengthMm-i.lengthMm);
      assert.equal(check([i],[p],m).status,'PASS');
      assert.equal(check([i],[{...p,vMm:p.vMm+m.numericalToleranceMm/2}],m).status,'PASS');
      has(check([i],[{...p,vMm:p.vMm+0.1}],m),'USABLE_BASE_EXCEEDED');
    }},
    {name:'interior roof break checked, not just endpoints',run(){
      const i=item('a',1000,1230,1000),p=place(i,0,0,0),m=make();
      const r=check([i],[p],{...m,contour:{...m.contour,highEdgeOffsetMm:0,points:[[0,2000],[500,900],[1000,2000],[2336.8,2000]]}});
      assert.equal(r.status,'FAIL');has(r,'CONTOUR_HEIGHT_EXCEEDED');
    }},
    {name:'stacked cargo is unknown, invalid model and invalid dimensions fail',run(){
      const i=item('a'),p=place(i,0,0,0,'yaw0',20);
      assert.equal(check([i],[p]).status,'UNKNOWN');
      has(check([i],[p],make({numericalToleranceMm:1})),'INVALID_GEOMETRY_PARAMETER');
      has(check([i],[{...p,widthMm:Infinity}]),'INVALID_PLACEMENT');
      has(check([i],[{...p,uMm:-1}]),'NEGATIVE_LOCAL_COORDINATE');
    }},
    {name:'legacy cm adapter uses local mm coordinates and respects explicit orientation',run(){
      const rows=[{id:'synthetic',width:100,length:123,height:135,quantity:1,allowRotation:true}];
      const result={config:{mirrored:false},placements:[{id:'synthetic:1',palletIndex:1,x:8.5,y:326,z:0,w:100,l:123,h:135,orientationFace:'upright'}],unplaced:[]};
      const input=adapt(rows,result,make());
      assert.equal(input.placements[0].vMm,0);assert.equal(input.placements[0].uMm,0);
      assert.equal(validate(input).status,'PASS');
    }}
  ];
}

for (const {name,run} of geometryCases(validatePmcGeometry,makeResearchModel,fromLegacyPmcPlan,assert)) test(name,run);
