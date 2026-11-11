import React, {useEffect, useRef, useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {buildAircraft, applyDeckVisibility} from './aircraft-geometry.mjs';
import {slots} from './engine.mjs';
import {pmcBoxTransforms} from './pmc-aircraft.mjs';
import './aircraft-scene.css';

const PRESETS = {
  iso: {label:'Perspektif', eye:[-60,38,76], target:[0,0,0]},
  top: {label:'Tepeden', eye:[0,100,0.1], target:[0,0,0]},
  side: {label:'Yandan', eye:[0,1.5,105], target:[0,0,0]},
  nose: {label:'Burundan', eye:[-110,6,0], target:[-20,2,0]},
};
function disposeTree(root) {
  const geometries = new Set(), materials = new Set();
  root.traverse(object => {if(object.geometry) geometries.add(object.geometry); if(object.material) (Array.isArray(object.material)?object.material:[object.material]).forEach(m=>materials.add(m));});
  geometries.forEach(g=>g.dispose()); materials.forEach(m=>m.dispose());
}

export default function AircraftScene({cargo, plan, locked, selected, deck, onSelect, onPlace, onTopView, readOnly=false}) {
  const mount = useRef(null), wrapper = useRef(null), api = useRef(null);
  const latest = useRef(null);
  latest.current = {cargo, plan, locked, selected, deck, onSelect, onPlace, readOnly};
  const [error,setError] = useState(''), [retry,setRetry] = useState(0), [shell,setShell] = useState('cutaway');
  const [separated,setSeparated] = useState(false), [nose,setNose] = useState(false), [full,setFull] = useState(false);
  const [hover,setHover] = useState(''), [fullscreenNotice,setFullscreenNotice] = useState('');
  const visual = useRef(null); visual.current = {shell,separated,nose};
  useEffect(()=>{
    const change=()=>setFull(document.fullscreenElement===wrapper.current);
    const escape=event=>{if(event.key==='Escape'&&document.fullscreenElement===wrapper.current){document.exitFullscreen().catch(()=>setFullscreenNotice('Tam ekrandan çıkılamadı. Tarayıcının tam ekran denetimini kullanın.'));}};
    document.addEventListener('fullscreenchange',change);
    document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('fullscreenchange',change);document.removeEventListener('keydown',escape);};
  },[]);
  useEffect(()=>{
    const container = mount.current;
    let renderer, scene, controls, frame, observer, environment;
    let stopped=false, lost=false;
    const cleanups=[];
    setError('');
    try {
      // Match the recovered scene's software-GPU guard, without allocating a
      // second context: use the same canvas/context for the actual renderer.
      const canvasElement=document.createElement('canvas');
      const context=canvasElement.getContext('webgl2',{antialias:false,alpha:false});
      if(!context)throw new Error('WebGL2 context unavailable');
      const gpuInfo=context.getExtension('WEBGL_debug_renderer_info');
      const gpu=String(context.getParameter(gpuInfo?gpuInfo.UNMASKED_RENDERER_WEBGL:context.RENDERER));
      const software=/SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      renderer = new THREE.WebGLRenderer({canvas:canvasElement,context,antialias:false,alpha:false});
      renderer.setPixelRatio(software?1:Math.min(window.devicePixelRatio||1,1.5));
      renderer.outputColorSpace=THREE.SRGBColorSpace;
      renderer.toneMapping=THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure=1.15;
      container.appendChild(renderer.domElement);
      renderer.domElement.setAttribute('aria-label',latest.current.readOnly?'Yalnız seçili PMC paletinin görsel önizlemesi. Ağırlık ve yerleşim doğrulanmamıştır.':'Döndürülebilir şematik uçak. Pozisyon işlemleri aşağıdaki listeden de yapılabilir.');
      scene=new THREE.Scene(); scene.background=new THREE.Color(0x060b14);
      scene.fog=new THREE.FogExp2(0x060b14,0.0032);
      const pmrem=new THREE.PMREMGenerator(renderer), room=new RoomEnvironment();
      try {environment=pmrem.fromScene(room,0.04); scene.environment=environment.texture;} finally {room.dispose();pmrem.dispose();}
      const camera=new THREE.PerspectiveCamera(38,1,0.5,600);
      controls=new OrbitControls(camera,renderer.domElement);
      controls.enableDamping=!software; controls.dampingFactor=.06; controls.minDistance=30; controls.maxDistance=220;
      let fitScale=1;
      const preset=key=>{const p=PRESETS[key]; controls.target.set(...p.target); camera.position.set(...p.eye).sub(controls.target).multiplyScalar(fitScale).add(controls.target); controls.update();};
      preset('iso');
      const key=new THREE.DirectionalLight(0xfff6ea,2.4);key.position.set(45,65,55);scene.add(key);
      scene.add(new THREE.HemisphereLight(0x7dd3fc,0x0f172a,1.3));
      const rim=new THREE.DirectionalLight(0x38bdf8,1.5);rim.position.set(-55,25,-55);scene.add(rim);
      const grid=new THREE.GridHelper(190,38,0x1e293b,0x0f172a);grid.position.y=-8.2;scene.add(grid);
      const model=buildAircraft(scene);
      const mainBays=new THREE.Group(),lowerBays=new THREE.Group();
      model.mainDeckGroup.add(mainBays);model.lowerDeckGroup.add(lowerBays);
      let targets=[];
      const refresh=()=>{
        for(const group of [mainBays,lowerBays]){disposeTree(group);group.clear();}
        targets=[];
        const state=latest.current;
        slots.forEach(slot=>{
          const main=slot.deck==='main', group=main?mainBays:lowerBays;
          // Synthetic normalized engine positions, not Boeing stations or scaled ULDs.
          const x=-33+slot.x*68,z=slot.side?1.45:-1.45,y=main?.35:-1.95;
          const item=state.cargo.find(c=>c.id===state.plan[slot.id]);
          const chosen=!!item&&item.id===state.selected;
          const active=slot.deck===state.deck;
          const color=chosen?0xfacc15:state.locked.includes(slot.id)?0xa78bfa:item?0x38bdf8:0x64748b;
          const bay=new THREE.Mesh(new THREE.BoxGeometry(main?7.3:14.2,.08,2.3),new THREE.MeshBasicMaterial({color,transparent:true,opacity:active?.36:.12}));
          bay.position.set(x,y,z);bay.userData.slot=slot.id;group.add(bay);targets.push(bay);
          if(item?.pmc?.items?.length){
            for(const box of pmcBoxTransforms(item,{x,y,z,maxLength:main?6.5:12.8,maxWidth:2.05,maxHeight:main?1.85:1.25})){
              const mesh=new THREE.Mesh(new THREE.BoxGeometry(...box.size),new THREE.MeshStandardMaterial({color:box.color||'#38bdf8',roughness:.65,transparent:true,opacity:active?1:.35}));
              mesh.position.set(...box.position);mesh.userData.slot=slot.id;group.add(mesh);targets.push(mesh);
              mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),new THREE.LineBasicMaterial({color:chosen?0xfacc15:0xffffff,transparent:true,opacity:chosen?.9:.35})));
            }
          }else if(item){
            const height=main?1.85:1.25;
            const mesh=new THREE.Mesh(new THREE.BoxGeometry(main?6.5:12.8,height,2.05),new THREE.MeshStandardMaterial({color,metalness:.55,roughness:.32,transparent:true,opacity:active?1:.35}));
            mesh.position.set(x,y+height/2+.06,z);mesh.userData.slot=slot.id;group.add(mesh);targets.push(mesh);
            mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),new THREE.LineBasicMaterial({color:chosen?0xfacc15:0xffffff,transparent:true,opacity:.5})));
          }
        });
      };
      const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();
      const pick=event=>{
        const bounds=renderer.domElement.getBoundingClientRect();
        pointer.set((event.clientX-bounds.left)/bounds.width*2-1,-(event.clientY-bounds.top)/bounds.height*2+1);
        ray.setFromCamera(pointer,camera);
        return ray.intersectObjects(targets,false).find(hit=>slots.find(s=>s.id===hit.object.userData.slot)?.deck===latest.current.deck)?.object.userData.slot;
      };
      const canvas=renderer.domElement;
      const listen=(target,type,handler,options)=>{target.addEventListener(type,handler,options);cleanups.push(()=>target.removeEventListener(type,handler,options));};
      let gesture=null; const pointers=new Set();
      listen(canvas,'pointerdown',e=>{pointers.add(e.pointerId);if(pointers.size===1&&e.button===0)gesture={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false};else if(gesture)gesture.moved=true;});
      listen(canvas,'pointermove',e=>{if(gesture&&Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)>5)gesture.moved=true;if(!pointers.size)setHover(latest.current.readOnly?'':pick(e)||'');});
      listen(window,'pointerup',e=>{
        const g=gesture; pointers.delete(e.pointerId);
        if(g?.id===e.pointerId){gesture=null;if(!g.moved&&e.target===canvas){const sid=pick(e);if(sid){const s=latest.current;if(s.readOnly)return;const id=s.plan[sid];if(id)s.onSelect(id);else s.onPlace(s.selected,sid);}}}
      });
      listen(window,'pointercancel',e=>{pointers.delete(e.pointerId);gesture=null;});
      listen(canvas,'pointerleave',()=>setHover(''));
      listen(canvas,'webglcontextlost',e=>{e.preventDefault();lost=true;if(frame!==undefined)cancelAnimationFrame(frame);setError('3D grafik bağlantısı kesildi. Yeniden deneyebilir veya üstten görünümü kullanabilirsiniz.');});
      listen(canvas,'webglcontextrestored',()=>setRetry(n=>n+1));
      const resize=()=>{const w=Math.max(container.clientWidth,1),h=Math.max(container.clientHeight,1);camera.aspect=w/h;const nextScale=Math.max(1,1.45/camera.aspect);camera.position.sub(controls.target).multiplyScalar(nextScale/fitScale).add(controls.target);fitScale=nextScale;controls.maxDistance=220*fitScale;camera.updateProjectionMatrix();renderer.setSize(w,h);};
      if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(resize);observer.observe(container);}
      listen(window,'resize',resize);resize();
      api.current={refresh,preset};refresh();
      const render=()=>{
        if(stopped||lost)return;
        const v=visual.current;
        applyDeckVisibility(model,latest.current.deck,v.separated);
        model.mainDeckGroup.position.y=THREE.MathUtils.lerp(model.mainDeckGroup.position.y,v.separated?4.6:0,.12);
        model.lowerDeckGroup.position.y=THREE.MathUtils.lerp(model.lowerDeckGroup.position.y,v.separated?-4.6:0,.12);
        model.noseDoorGroup.rotation.z=THREE.MathUtils.lerp(model.noseDoorGroup.rotation.z,v.nose?-Math.PI/3.2:0,.1);
        model.structure.forEach(node=>{node.visible=v.shell!=='decks';});
        model.fuselageMesh.visible=v.shell!=='decks'&&v.shell!=='wire';
        model.humpMesh.visible=model.fuselageMesh.visible;
        model.wireMesh.visible=v.shell==='wire';
        model.fuselageMesh.material.opacity=v.shell==='ghost'?.28:.16;
        controls.update();renderer.render(scene,camera);frame=requestAnimationFrame(render);
      };render();
    } catch (cause) {
      console.error('Aircraft 3D initialization failed:', cause);
      setError('Bu tarayıcıda 3D görünüm açılamadı. Planınız korunuyor; üstten görünümü kullanabilirsiniz.');
    }
    return()=>{
      stopped=true;if(frame!==undefined)cancelAnimationFrame(frame);api.current=null;
      cleanups.forEach(fn=>fn());observer?.disconnect();controls?.dispose();
      if(scene)disposeTree(scene);environment?.dispose();
      if(renderer){renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();}
    };
  },[retry]);
  useEffect(()=>{api.current?.refresh();},[cargo,plan,locked,selected,deck]);
  async function fullscreen(){setFullscreenNotice('');try{if(document.fullscreenElement===wrapper.current)await document.exitFullscreen();else await wrapper.current.requestFullscreen();}catch{setFullscreenNotice('Tam ekran açılamadı. 3D görünümü normal boyutta kullanabilirsiniz.');}}
  return <section ref={wrapper} className="aircraft-3d" data-visual-only={readOnly?'true':undefined} data-visible-cargo={cargo.filter(item=>Object.values(plan).includes(item.id)).map(item=>item.id).join(',')} aria-label={readOnly?'Seçili PMC görsel önizlemesi':'3D uçak görünümü'}>
    <div className="aircraft-3d-tools" aria-label="3D görünüm araçları">
      <div>{Object.entries(PRESETS).map(([key,p])=><button key={key} onClick={()=>api.current?.preset(key)}>{p.label}</button>)}</div>
      <label>Gövde <select value={shell} onChange={e=>setShell(e.target.value)}><option value="cutaway">Kesit</option><option value="ghost">Saydam</option><option value="wire">Tel kafes</option><option value="decks">Yalnız güverteler</option></select></label>
      <button aria-pressed={separated} onClick={()=>setSeparated(v=>!v)}>Güverteleri ayır</button>
      <button aria-pressed={nose} onClick={()=>setNose(v=>!v)}>Burun kapısı {nose?'kapat':'aç'}</button>
      {typeof document!=='undefined'&&document.fullscreenEnabled&&<button onClick={fullscreen}>{full?'Tam ekrandan çık':'Tam ekran'}</button>}
    </div>
    {fullscreenNotice&&<p className="aircraft-3d-hint" role="status">{fullscreenNotice}</p>}
    {readOnly?<div className="aircraft-3d-warning visual-preview-warning" role="note"><strong>YALNIZCA GÖRSEL ÖNİZLEME · AĞIRLIK DOĞRULANMADI</strong><span>Yükleme veya uçuş onayı değildir. Ölçü, ağırlık, denge ve operasyonel uygunluk kontrolü yapılmaz. Konumlar ve yük boyutları şematiktir.</span><span>Kaydedilmiş ağırlık: {cargo.find(item=>item.id===selected)?.weight?.toLocaleString('tr-TR')} kg · Değiştirilmedi, gerçek ağırlık olarak doğrulanmadı.</span><span>Bu görünüm kaydedilmiş planı, yerleşimi ve plan çıktısını değiştirmez.</span></div>:<div className="aircraft-3d-warning">SİMÜLASYON · Uçuş operasyonları için onaylı değildir. Konumlar ve yük boyutları şematiktir.</div>}
    <div className="aircraft-3d-viewport"><div ref={mount} className="aircraft-3d-canvas"/>{error&&<div className="aircraft-3d-fallback" role="status"><p>{error}</p><button onClick={()=>setRetry(n=>n+1)}>3D yeniden dene</button>{!readOnly&&<button onClick={onTopView}>Üstten görünümü aç</button>}</div>}</div>
    <p className="aircraft-3d-hint">Sürükle: döndür · Tekerlek / iki parmak: yakınlaştır · Sağ sürükle: kaydır. {readOnly?'Görsel önizleme: pozisyonlara tıklamak planı değiştirmez.':`${hover?hover+' · ':''}Seçili güvertedeki yüke tıklayın; boş pozisyona tıklayarak seçili paleti yerleştirin.`}</p>
    {!readOnly&&<details className="aircraft-3d-positions"><summary>Klavye ile pozisyon seç / yerleştir · {deck==='main'?'Ana':'Alt'} güverte</summary><div>{slots.filter(s=>s.deck===deck).map(s=><button key={s.id} aria-pressed={!!plan[s.id]&&plan[s.id]===selected} onClick={()=>plan[s.id]?onSelect(plan[s.id]):onPlace(selected,s.id)}>{s.id} · {plan[s.id]||'Boş'}{locked.includes(s.id)?' · Sabit':''}</button>)}</div></details>}
  </section>;
}
