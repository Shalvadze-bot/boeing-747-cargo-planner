import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildAircraft, applyDeckVisibility} from '../src/aircraft-geometry.mjs';

test('A330 schematic has a tapered fuselage, twin engines, forward left door and two lower holds',()=>{
 const scene=new THREE.Scene();
 const m=buildAircraft(scene);
 const box=new THREE.Box3().setFromObject(m.fuselageMesh);
 assert.ok(Math.abs(box.max.x-box.min.x-58.82)<.001);
 assert.equal(m.fuselageMesh.geometry.type,'LatheGeometry');
 assert.equal(m.aircraftGroup.children.filter(n=>n.geometry?.type==='CylinderGeometry').length,2);
 assert.ok(m.mainDoorGroup.position.x<0&&m.mainDoorGroup.position.z>0);
 assert.equal(m.lowerDeckGroup.children.length,2);
 assert.ok(!m.structure.includes(m.mainDeckGroup));
 assert.ok(!m.structure.includes(m.lowerDeckGroup));
 assert.notEqual(m.mainDeckGroup,m.lowerDeckGroup);
 scene.traverse(n=>{n.geometry?.dispose();n.material?.dispose();});
});

test('selected lower deck is not concealed by the upper floor; separation shows both',()=>{
 const model={mainDeckGroup:new THREE.Group(),lowerDeckGroup:new THREE.Group()};
 applyDeckVisibility(model,'lower',false);
 assert.equal(model.mainDeckGroup.visible,false);
 assert.equal(model.lowerDeckGroup.visible,true);
 applyDeckVisibility(model,'lower',true);
 assert.equal(model.mainDeckGroup.visible,true);
 assert.equal(model.lowerDeckGroup.visible,true);
 applyDeckVisibility(model,'main',false);
 assert.equal(model.mainDeckGroup.visible,true);
});
