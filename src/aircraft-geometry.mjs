/**
 * @license SPDX-License-Identifier: Apache-2.0
 * Aircraft geometry restored from ThreeCargoDigitalTwin.tsx in the user's
 * original Sites source, commit ff2cbef8ffb36e9041f242c6f10af0f1eb1f5b3d.
 * Preserves its procedural shell, hump, hinged nose, wings, engines and tail.
 * Schematic visual only. No original capacities, station mapping or CG model.
 */
import * as THREE from 'three';
export function buildAircraft(scene) {
    // Aircraft Root Group
    const aircraftGroup = new THREE.Group();
    scene.add(aircraftGroup);

    // 1. Procedural Boeing 747-400F Fuselage Shell
    // Length: ~70m -> 86 3D units, Radius: ~3.2m -> 3.2 3D units
    const fuselageGeo = new THREE.CylinderGeometry(3.2, 3.2, 85, 36, 1, true);
    fuselageGeo.rotateZ(Math.PI / 2);

    const fuselageMat = new THREE.MeshPhysicalMaterial({
      color: 0x94a3b8,
      metalness: 0.3,
      roughness: 0.3,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    const fuselageMesh = new THREE.Mesh(fuselageGeo, fuselageMat);
    aircraftGroup.add(fuselageMesh);

    // Wireframe overlay for X-Ray mode
    const wireGeo = new THREE.WireframeGeometry(fuselageGeo);
    const wireMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35 });
    const wireMesh = new THREE.LineSegments(wireGeo, wireMat);
    wireMesh.visible = false;
    aircraftGroup.add(wireMesh);

    // Cockpit & Upper Deck Hump (B747 signature)
    const humpGeo = new THREE.SphereGeometry(3.3, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    humpGeo.scale(2.8, 1.45, 0.95);
    humpGeo.rotateZ(-Math.PI / 2);
    humpGeo.translate(-24, 2.05, 0);
    const humpMesh = new THREE.Mesh(humpGeo, fuselageMat);
    aircraftGroup.add(humpMesh);

    // Cockpit windshield windows
    const windowGeo = new THREE.BoxGeometry(0.3, 0.8, 1.6);
    const windowMat = new THREE.MeshBasicMaterial({ color: 0x0284c7 });
    const windowMesh = new THREE.Mesh(windowGeo, windowMat);
    windowMesh.position.set(-35.5, 3.2, 0);
    aircraftGroup.add(windowMesh);

    // 2. Hinged Nose Cargo Door Visor (NCD)
    // Pivot located at top of nose station (-36, 3.2, 0)
    const noseDoorGroup = new THREE.Group();
    noseDoorGroup.position.set(-36, 2.8, 0);
    aircraftGroup.add(noseDoorGroup);

    const noseVisorGeo = new THREE.ConeGeometry(3.1, 8.5, 32);
    noseVisorGeo.rotateZ(Math.PI / 2);
    noseVisorGeo.translate(-4.25, -2.8, 0);
    const noseVisorMat = new THREE.MeshPhysicalMaterial({
      color: 0x64748b,
      metalness: 0.4,
      roughness: 0.3,
      transparent: true,
      opacity: 0.45,
    });
    const noseVisorMesh = new THREE.Mesh(noseVisorGeo, noseVisorMat);
    noseDoorGroup.add(noseVisorMesh);

    // 3. Main Deck Side Cargo Door (SCD) outline (Port side, aft)
    const scdGeo = new THREE.BoxGeometry(4.2, 3.2, 0.2);
    const scdMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true });
    const scdMesh = new THREE.Mesh(scdGeo, scdMat);
    scdMesh.position.set(14.32, 0.6, -3.2);
    aircraftGroup.add(scdMesh);

    // 4. Swept-Back Wings with Winglets
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.45,
      roughness: 0.45,
      transparent: true,
      opacity: 0.4,
    });

    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(-12, 43); // wingtip
    wingShape.lineTo(-17.5, 43);
    wingShape.lineTo(-24, 0); // wing root
    wingShape.closePath();

    const wingExtrude = new THREE.ExtrudeGeometry(wingShape, { depth: 0.35, bevelEnabled: true, bevelThickness: 0.1 });
    wingExtrude.rotateX(Math.PI / 2);
    wingExtrude.rotateY(-0.08); // dihedral
    wingExtrude.translate(2, -0.6, 0);

    const rightWing = new THREE.Mesh(wingExtrude, wingMat);
    const leftWing = rightWing.clone();
    leftWing.scale.z = -1;
    aircraftGroup.add(rightWing);
    aircraftGroup.add(leftWing);

    // Winglets
    const wingletGeo = new THREE.BoxGeometry(2.4, 3.2, 0.2);
    const rightWinglet = new THREE.Mesh(wingletGeo, wingMat);
    rightWinglet.position.set(-14.5, 2.5, 43);
    rightWinglet.rotateX(-0.1);
    aircraftGroup.add(rightWinglet);

    const leftWinglet = rightWinglet.clone();
    leftWinglet.position.z = -43;
    leftWinglet.rotateX(0.2);
    aircraftGroup.add(leftWinglet);

    // 4 High-Bypass Turbofan Engines
    const engineGeo = new THREE.CylinderGeometry(1.05, 0.95, 4.2, 20);
    engineGeo.rotateZ(Math.PI / 2);
    const engineMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.2 });

    const enginePositions = [
      { x: -5, y: -2.8, z: 12 },
      { x: -10, y: -2.4, z: 22 },
      { x: -5, y: -2.8, z: -12 },
      { x: -10, y: -2.4, z: -22 },
    ];
    enginePositions.forEach((pos) => {
      const eng = new THREE.Mesh(engineGeo, engineMat);
      eng.position.set(pos.x, pos.y, pos.z);
      aircraftGroup.add(eng);

      // Pylon
      const pylonGeo = new THREE.BoxGeometry(2.5, 1.2, 0.2);
      const pylon = new THREE.Mesh(pylonGeo, wingMat);
      pylon.position.set(pos.x, pos.y + 1.2, pos.z);
      aircraftGroup.add(pylon);
    });

    // Tail Horizontal & Vertical Stabilizers
    const hStabGeo = new THREE.BoxGeometry(10, 0.25, 29);
    hStabGeo.translate(36, 1.9, 0);
    const hStab = new THREE.Mesh(hStabGeo, wingMat);
    aircraftGroup.add(hStab);

    const vStabGeo = new THREE.BoxGeometry(12.5, 14.5, 0.35);
    vStabGeo.translate(34, 7.8, 0);
    const vStab = new THREE.Mesh(vStabGeo, wingMat);
    aircraftGroup.add(vStab);

    // 5. Main Deck Floor Group (Supported for Exploded Deck View)
    const mainDeckGroup = new THREE.Group();
    aircraftGroup.add(mainDeckGroup);

    // Roller floor slab
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.85,
      roughness: 0.25,
    });
    const mdFloorGeo = new THREE.BoxGeometry(78, 0.18, 5.8);
    const mdFloor = new THREE.Mesh(mdFloorGeo, floorMat);
    mdFloor.position.set(2, 0.2, 0);
    mainDeckGroup.add(mdFloor);

    // Power Roller guide rails down the centerline
    const railGeo = new THREE.BoxGeometry(76, 0.05, 0.08);
    const railMat = new THREE.MeshBasicMaterial({ color: 0x64748b });
    const centerRail = new THREE.Mesh(railGeo, railMat);
    centerRail.position.set(2, 0.3, 0);
    mainDeckGroup.add(centerRail);

    // 6. Lower Deck Compartment Group
    const lowerDeckGroup = new THREE.Group();
    aircraftGroup.add(lowerDeckGroup);

    const ldFloorGeo = new THREE.BoxGeometry(68, 0.18, 5.0);
    const ldFloor = new THREE.Mesh(ldFloorGeo, floorMat);
    ldFloor.position.set(2, -2.1, 0);
    lowerDeckGroup.add(ldFloor);

    const structure = aircraftGroup.children.filter(child => child !== mainDeckGroup && child !== lowerDeckGroup);
    return { aircraftGroup, mainDeckGroup, lowerDeckGroup, noseDoorGroup, fuselageMesh, wireMesh, humpMesh, structure };
}

// The inactive upper floor must not conceal interactive lower-deck bays.
// Exploded mode deliberately exposes both decks at their separated heights.
export function applyDeckVisibility(model, selectedDeck, separated) {
    model.mainDeckGroup.visible = selectedDeck !== 'lower' || separated;
    model.lowerDeckGroup.visible = true;
}
