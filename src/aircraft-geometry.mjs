// Schematic A330-243F geometry, shared by the aircraft planner and PMC preview.
import * as THREE from 'three';
import {AIRCRAFT_LENGTH, AIRCRAFT_SPAN, AIRCRAFT_WIDTH, aircraftSlots} from './aircraft-profile.mjs';

export const DECK_HEIGHT = {main: -0.03, lower: -1.79};

export function buildAircraft(scene) {
  const aircraftGroup = new THREE.Group();
  scene.add(aircraftGroup);
  const halfLength = AIRCRAFT_LENGTH / 2;
  const radius = AIRCRAFT_WIDTH / 2;
  const profile = [
    [-halfLength, 0], [-28.6, 1], [-27.4, 1.85], [-25.4, 2.55], [-22.5, radius],
    [16.5, radius], [20, 2.5], [23, 1.98], [26.8, 1.2], [halfLength, 0.14]
  ];
  const shell = new THREE.LatheGeometry(profile.map(([x, r]) => new THREE.Vector2(r, x)), 48);
  shell.rotateZ(-Math.PI / 2);
  const fuselageMat = new THREE.MeshPhysicalMaterial({
    color: 0x94a3b8, metalness: .3, roughness: .35, transparent: true, opacity: .22, depthWrite: false
  });
  const fuselageMesh = new THREE.Mesh(shell, fuselageMat);
  const wireMesh = new THREE.LineSegments(new THREE.WireframeGeometry(shell),
    new THREE.LineBasicMaterial({color: 0x38bdf8, transparent: true, opacity: .24}));
  wireMesh.visible = false;
  aircraftGroup.add(fuselageMesh, wireMesh);

  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.38, 2.18),
    new THREE.MeshBasicMaterial({color: 0x38bdf8}));
  cockpit.position.set(-26.5, 1.78, 0);
  aircraftGroup.add(cockpit);

  const wingMat = new THREE.MeshStandardMaterial({
    color: 0x506278, metalness: .45, roughness: .45, transparent: true, opacity: .68
  });
  function surface(points, material, thickness) {
    const shape = new THREE.Shape(points.map(([x,z])=>new THREE.Vector2(x,z)));
    return new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:false}),material);
  }
  const tip = AIRCRAFT_SPAN / 2;
  const engineGeometry = new THREE.CylinderGeometry(1.21, 1.32, 4.15, 28);
  engineGeometry.rotateZ(-Math.PI / 2);
  const engineMaterial = new THREE.MeshStandardMaterial({color:0x64748b,metalness:.7,roughness:.3});
  const inletGeometry = new THREE.CircleGeometry(1.05, 28);
  inletGeometry.rotateY(-Math.PI / 2);
  const inletMaterial = new THREE.MeshBasicMaterial({color:0x101923});
  for (const side of [-1, 1]) {
    const wing = surface([[-7.8,0],[6.8,tip],[10,tip],[4.1,0]],wingMat,.28);
    wing.rotateX(Math.PI / 2);
    wing.scale.y=side;
    wing.position.y=-0.95;
    const winglet = new THREE.Mesh(new THREE.BoxGeometry(2,.95,.17),wingMat);
    winglet.position.set(8.2,-.53,side*(tip-.35));
    const horizontalTail = surface([[18.8,0],[25.3,9.1],[27.2,9.1],[25.8,0]],wingMat,.2);
    horizontalTail.rotateX(Math.PI / 2);
    horizontalTail.scale.y=side;
    horizontalTail.position.y=1.05;
    const engine = new THREE.Mesh(engineGeometry,engineMaterial);
    engine.position.set(-5.5,-3,side*8.2);
    const inlet = new THREE.Mesh(inletGeometry,inletMaterial);
    inlet.position.x=-2.085;
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(3,1.25,.22),wingMat);
    pylon.position.set(.65,1.4,0);
    engine.add(inlet,pylon);
    aircraftGroup.add(wing,winglet,horizontalTail,engine);
  }
  const tail = surface([[17,1.2],[22.5,11],[25.5,11],[26.4,1.2]],wingMat,.28);
  tail.position.z=-.14;
  aircraftGroup.add(tail);

  // Aircraft left is positive Z when facing toward the nose (negative X).
  const mainDoorGroup = new THREE.Group();
  mainDoorGroup.position.set(-19.49,2.32,2.32);
  const door = new THREE.Mesh(new THREE.BoxGeometry(3.56,2.32,.08),
    new THREE.MeshStandardMaterial({color:0x0e7490,transparent:true,opacity:.64}));
  door.position.y=-1.16;
  door.add(new THREE.LineSegments(new THREE.EdgesGeometry(door.geometry),new THREE.LineBasicMaterial({color:0x7dd3fc})));
  mainDoorGroup.add(door);
  aircraftGroup.add(mainDoorGroup);
  const lowerDoorMaterial = new THREE.LineBasicMaterial({color:0x38bdf8});
  const lowerDoorGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(2.55,1.27,.07));
  for (const x of [-16.3,13.1]) {
    const lowerDoor = new THREE.LineSegments(lowerDoorGeometry,lowerDoorMaterial);
    lowerDoor.position.set(x,-1.12,-2.53);
    aircraftGroup.add(lowerDoor);
  }

  const mainDeckGroup = new THREE.Group(), lowerDeckGroup = new THREE.Group();
  const floorMat = new THREE.MeshStandardMaterial({color:0x1e293b,metalness:.75,roughness:.3});
  for (const [group, deck, segment, width] of [
    [mainDeckGroup,'main',null,5.16],
    [lowerDeckGroup,'lower','forward',3.35],
    [lowerDeckGroup,'lower','aft',3.35]
  ]) {
    const positions = aircraftSlots.filter(s=>s.deck===deck&&(!segment||s.group===segment));
    const first = positions[0], last = positions.at(-1);
    const start = first.station-first.l/200, end = last.station+last.l/200;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(end-start,.12,width),floorMat);
    floor.position.set((start+end)/2,DECK_HEIGHT[deck]-.075,0);
    group.add(floor);
  }
  const structure = [...aircraftGroup.children];
  aircraftGroup.add(mainDeckGroup,lowerDeckGroup);
  return {aircraftGroup,mainDeckGroup,lowerDeckGroup,mainDoorGroup,fuselageMesh,wireMesh,structure};
}

export function applyDeckVisibility(model, selectedDeck, separated) {
  model.mainDeckGroup.visible = selectedDeck !== 'lower' || separated;
  model.lowerDeckGroup.visible = true;
}
