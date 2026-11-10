import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildAircraft, applyDeckVisibility} from '../src/aircraft-geometry.mjs';

test('restored original aircraft has shell, signature hump, wings, four engines, hinged nose and separate decks',()=>{
 const scene=new THREE.Scene();
 const m=buildAircraft(scene);
 assert.equal(m.fuselageMesh.geometry.parameters.height,85);
 assert.equal(m.humpMesh.geometry.type,'SphereGeometry');
 assert.equal(m.aircraftGroup.children.filter(n=>n.geometry?.type==='ExtrudeGeometry').length,2);
 assert.equal(m.aircraftGroup.children.filter(n=>n.geometry?.type==='CylinderGeometry'&&n.geometry.parameters.height===4.2).length,4);
 assert.equal(m.noseDoorGroup.position.x,-36);
 assert.equal(m.noseDoorGroup.children[0].geometry.type,'ConeGeometry');
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
