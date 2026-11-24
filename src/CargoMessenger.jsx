import React, { useEffect, useRef, useState } from 'react';
import { ArrowsIn, ArrowsOut, Camera, ChatCircleDots, FileXls, Image, Minus, Paperclip, Plus, Sparkle, Square, X, ArrowUp } from '@phosphor-icons/react';
import { AiPlanPreview } from './AiPackingPanel';
import { ChatResultCard } from './ChatResultCards';
import { readChatManifest } from './chat-manifest.mjs';
import { streamLines } from './ai-stream.mjs';
import './cargo-messenger.css';

const messageLimit = 1800;
const encoder = new TextEncoder();
const toolLabels = {
  compare:'Planları karşılaştır',
  optimize_layout:'PMC planını optimize et',
  optimize_pmc:'Seçili PMC’yi optimize et',
  optimize_aircraft:'Uçağı optimize et',
  space:'Kontur boşluğu',
  balance:'Ağırlık dağılımı',
  unplaced:'Yerleşmeyen parçalar',
  restore:'Önceki planı aç',
};
const headings = {balance:'PMC ağırlık dağılımı',space:'Kullanılabilir şematik kontur',unplaced:'Yerleşmeyen parçalar'};
const pmcActions = ['compare','optimize_layout','optimize_pmc','import','apply'];
const subset = items => items?.slice(0,24);

function modelContext(pmc,aircraft,mode) {
  const context = {mode,selection:{...pmc?.selection,...(mode==='aircraft'?aircraft.selection:{aircraftPosition:aircraft.selection.position})},pmc,aircraft};
  if (encoder.encode(JSON.stringify(context)).length <= 8500) return context;
  return {...context,
    pmc:pmc&&{...pmc,manifest:subset(pmc.manifest),placements:subset(pmc.placements),unplaced:subset(pmc.unplaced),contextLimited:true},
    aircraft:{...aircraft,manifest:subset(aircraft.manifest),selectedPmcItems:subset(aircraft.selectedPmcItems),contextLimited:true},
  };
}

export default function CargoMessenger({projectId,mode,pmcRef,aircraft,hidden}) {
  const [service,setService]=useState(null);
  const [display,setDisplay]=useState('closed');
  const [expanded,setExpanded]=useState(false);
  const [messages,setMessages]=useState([]);
  const [draft,setDraft]=useState('');
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState('');
  const [preview,setPreview]=useState(null);
  const [confirmation,setConfirmation]=useState(null);
  const [confirming,setConfirming]=useState(false);
  const [notice,setNotice]=useState('');
  const ctrl=useRef(null), ids=useRef(0), list=useRef(null), field=useRef(null);
  const latestPlans=useRef(null);
  const launcher=useRef(null), attachment=useRef(null), image=useRef(null), camera=useRef(null), excel=useRef(null);
  const current = useRef(null);
  current.current = {aircraft,mode};

  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/ai/status',{cache:'no-store',signal:controller.signal}).then(r=>r.ok?r.json():{available:false})
      .then(value=>{if(!controller.signal.aborted)setService(value);})
      .catch(()=>{if(!controller.signal.aborted)setService({available:false});});
    return ()=>{controller.abort();ctrl.current?.abort();};
  },[projectId]);
  useEffect(()=>{
    if (list.current) list.current.scrollTop=list.current.scrollHeight;
  },[messages,display]);
  useEffect(()=>{
    if (display==='open' && !hidden) field.current?.focus({preventScroll:true});
  },[display,hidden]);

  function patch(id,update) {
    setMessages(previous=>previous.map(message=>message.id===id?{...message,...update(message)}:message));
  }
  function append(role,text,include=false) {
    const id=++ids.current;
    setMessages(previous=>[...previous,{id,role,text,include}].slice(-42));
    return id;
  }
  function startOperation() {
    if (ctrl.current) return null;
    const controller=new AbortController();
    ctrl.current=controller;
    setBusy(true);setNotice('');
    return controller;
  }
  function finishOperation(controller) {
    if (ctrl.current!==controller) return;
    ctrl.current=null;
    setBusy(false);setProgress('');
  }
  function finishMessage(error,id,controller) {
    if (ctrl.current!==controller) return;
    patch(id,()=>({error:controller.signal.aborted?'İşlem durduruldu.':error.message,include:false}));
  }

  function snapshot() {
    const bridge=pmcRef.current;
    return {bridge,aircraft,mode,pmcKey:bridge?.key(),aircraftKey:aircraft.key()};
  }

  async function runTool(action,snap,signal) {
    signal.throwIfAborted();
    const {bridge,pmcKey,aircraftKey}=snap;
    const toolMode=pmcActions.includes(action)?'pmc':action==='optimize_aircraft'?'aircraft':snap.mode;
    const key=toolMode==='pmc'?pmcKey:aircraftKey;
    if (toolMode==='pmc' ? !bridge || pmcRef.current?.key()!==key : current.current.aircraft.key()!==key) {
      throw new Error('Çalışma sırasında plan değişti. Güncel plan için yeniden deneyin.');
    }
    if (action==='compare') {
      const value=bridge.getOutcome() ?? (latestPlans.current?.key===key?latestPlans.current.value:null);
      if (!value) throw new Error('Karşılaştırma için önce bir PMC optimizasyonu çalıştırın.');
      return {type:'plans',value,key};
    }
    if (action==='restore') {
      if (!(toolMode==='pmc'?bridge.canRestore:snap.aircraft.canRestore)) throw new Error('Geri yüklenebilecek güncel bir önceki plan yok.');
      return {type:'restore',key,mode:toolMode};
    }
    if (action==='optimize_aircraft') {
      setProgress('Uçak yerleşimi hesaplanıyor ve doğrulanıyor');
      const value=await snap.aircraft.optimize(signal);
      if (current.current.aircraft.key()!==key) throw new Error('Uçak yerleşimi hesaplama sırasında değişti.');
      return {type:'aircraft',value,key};
    }
    if (action.startsWith('optimize_')) {
      const value=await bridge.optimize(action,signal,setProgress);
      if (pmcRef.current?.key()!==key) throw new Error('PMC planı hesaplama sırasında değişti.');
      latestPlans.current={key,value};
      return {type:'plans',value,key};
    }
    if (toolMode==='aircraft') return {type:'aircraft-analysis',title:'Uçak yükleme analizi',value:snap.aircraft.inspect(action==='unplaced')};
    setProgress('PMC geometrisi ve ağırlık verileri kontrol ediliyor');
    const value=await bridge.inspect(signal);
    return {type:action,title:headings[action],value};
  }

  async function send(event) {
    event?.preventDefault();
    const text=draft.trim();
    if (!text || !service?.available || confirming) return;
    const controller=startOperation();
    if (!controller) return;
    const {signal}=controller, snap=snapshot();
    const pmc=snap.bridge?.context();
    if (pmc && !pmc.alternatives.length && latestPlans.current?.key===snap.pmcKey) {
      pmc.alternatives=latestPlans.current.value.alternatives.map((item,i)=>[i,item.validation.stats,item.elapsedMs]);
    }
    const context=modelContext(pmc,snap.aircraft.context(),mode);
    setDraft('');
    const idUser=append('user',text,true);
    const id=append('assistant','');
    setProgress('Proje bağlamı hazırlanıyor');
    const input=messages.filter(m=>m.include && m.text).slice(-6).map(({role,text})=>({role,text:text.slice(0,1000)}));
    input.push({role:'user',text});
    let action, completed=false, responseText='';
    try {
      const response=await fetch('/api/ai/chat',{method:'POST',signal,headers:{'Content-Type':'application/json'},
        body:JSON.stringify({runId:crypto.randomUUID(),projectId,messages:input,context})});
      if (!response.ok || !response.body) {
        const detail=await response.json().catch(()=>null);
        patch(idUser,()=>({include:false}));
        throw new Error(detail?.error??'Sohbet yanıtı alınamadı.');
      }
      for await (const line of streamLines(response.body)) {
        signal.throwIfAborted();
        const update=JSON.parse(line);
        if (update.type==='delta') {
          responseText=(responseText+update.value).slice(0,2400);
          patch(id,()=>({text:responseText}));
        } else if (update.type==='progress') setProgress(update.value);
        else if (update.type==='tool' && Object.hasOwn(toolLabels,update.value)) action=update.value;
        else if (update.type==='done') completed=true;
        else if (update.type==='error') throw new Error(update.value);
      }
      if (!completed) throw new Error('Sohbet bağlantısı tamamlanmadan kapandı.');
      if (action) {
        const card=await runTool(action,snap,signal);
        patch(id,()=>({card,text:responseText,include:!!responseText}));
      } else patch(id,()=>({text:responseText||'AI metin döndürmedi.',include:!!responseText}));
    } catch (error) { finishMessage(error,id,controller); }
    finally { finishOperation(controller); }
  }

  async function shortcut(action) {
    const controller=startOperation();
    if (!controller) return;
    const snap=snapshot();
    append('user',toolLabels[action]);
    const id=append('assistant','');
    try {
      const card=await runTool(action,snap,controller.signal);
      patch(id,()=>({card}));
    } catch (error) { finishMessage(error,id,controller); }
    finally { finishOperation(controller); }
  }

  async function readAttachment(event) {
    const file=event.target.files?.[0];
    event.target.value='';
    if (!file) return;
    const controller=startOperation();
    if (!controller) return;
    const key=pmcRef.current?.key();
    append('user',file.name.slice(0,160));
    const id=append('assistant','');
    try {
      const result=await readChatManifest(file,controller.signal,setProgress);
      controller.signal.throwIfAborted();
      if (!result.rows.length) throw new Error('Yük ölçüsü bulunamadı. Birimli ölçüler ve açık sütun başlıkları içeren bir dosya seçin.');
      patch(id,()=>({card:{type:'import',key,...result}}));
    } catch (error) { finishMessage(error,id,controller); }
    finally { finishOperation(controller); }
  }

  async function commit() {
    if (!confirmation || confirming) return;
    const value=confirmation;
    const bridge=pmcRef.current;
    const activeAircraft=current.current.aircraft;
    const onAircraft=value.type==='aircraft'||value.mode==='aircraft';
    const key=onAircraft?activeAircraft.key():bridge?.key();
    setConfirming(true);setNotice('');
    try {
      if (!key || key!==value.key) throw new Error('Proje değişti. Güncel verilerle işlemi yeniden hazırlayın.');
      if (value.type==='import') bridge.import(value.value);
      else if (value.type==='apply') await bridge.apply(value.value,value.candidate);
      else if (value.type==='aircraft') activeAircraft.apply(value.value);
      else if (!await (onAircraft?activeAircraft.restore():bridge.restore())) throw new Error('Önceki yerleşim güncel kısıtlarda geri yüklenemedi.');
      append('assistant',{import:'Onaylanan satırlar yük listesine eklendi.',apply:'Doğrulanan PMC planı uygulandı.',
        aircraft:'Doğrulanan uçak planı uygulandı.',restore:'Önceki plan geri yüklendi.'}[value.type]);
    } catch(error) {setNotice(error.message);}
    finally{setConfirming(false);setConfirmation(null);}
  }

  function close(next='closed') {
    setDisplay(next);setExpanded(false);setConfirmation(null);
    requestAnimationFrame(()=>launcher.current?.focus({preventScroll:true}));
  }
  const open = display==='open';
  const actions = mode==='aircraft'?['optimize_aircraft','balance','unplaced']:['optimize_layout','optimize_pmc','compare','space','balance','unplaced'];
  if (!service || hidden) return null;

  return <div className={'cargo-messenger'+(open?' messenger-open':'')}>
    {!open&&<button ref={launcher} className={'messenger-launch '+(display==='minimized'?'messenger-minimized':'')} type="button"
      aria-label={display==='minimized'?'AI sohbetini yeniden aç':'AI sohbetini aç'} onClick={()=>setDisplay('open')}>
      <ChatCircleDots size={26} weight="fill"/>{display==='minimized'&&<span>AI sohbeti{busy?' · Çalışıyor':''}</span>}
    </button>}
    <section className={'messenger-window '+(expanded?'messenger-full':'')} aria-labelledby="cargo-messenger-title"
      hidden={!open} onKeyDown={event=>{if(event.key==='Escape'&&!preview&&!confirming)close();}}>
      <div className="messenger-header">
        <div className="messenger-icon"><Sparkle size={20} weight="fill"/></div>
        <div><h2 id="cargo-messenger-title">Kargo Asistanı</h2><small>{service.mock?'Simüle API · Yerel önizleme':service.available?'Bu projeye özel sohbet':'Dosya ve yerel plan araçları'}</small></div>
        <button type="button" aria-label="Yeni sohbet" title="Yeni sohbet" disabled={confirming} onClick={()=>{
          ctrl.current?.abort();ctrl.current=null;setBusy(false);setMessages([]);setDraft('');setPreview(null);setNotice('');setProgress('');setConfirmation(null);
        }}><Plus size={18}/></button>
        <button type="button" aria-label={expanded?'Kompakt görünüme dön':'Tam ekrana genişlet'} onClick={()=>setExpanded(!expanded)}>{expanded?<ArrowsIn size={17}/>:<ArrowsOut size={17}/>}</button>
        <button type="button" aria-label="Sohbeti küçült" onClick={()=>close('minimized')}><Minus size={18}/></button>
        <button type="button" aria-label="Sohbeti kapat" onClick={()=>close()}><X size={18}/></button>
      </div>
      <div className="messenger-scroll" ref={list} role="log" aria-label="Sohbet mesajları" aria-live="off">
        {!messages.length&&<div className="messenger-empty"><p>Yük planınız hakkında soru sorun veya yük listesi ekleyin.</p>
          {!service.available&&<p>AI bağlantısı hazır değil. Dosya okuma ve yerleşim araçları açık.</p>}</div>}
        {messages.map(message=><article className={'messenger-message '+message.role} key={message.id}>
          {message.text&&<p>{message.text}</p>}{message.error&&<p className="messenger-error" role="alert">{message.error}</p>}
          {message.card&&<ChatResultCard card={message.card} preview={setPreview} confirm={setConfirmation}/>}
        </article>)}
        {progress&&<p className="messenger-progress" role="status">{progress}</p>}
        {notice&&<p className="messenger-error" role="alert">{notice}</p>}
      </div>
      {confirmation&&<section className="messenger-confirm" aria-label="İşlem onayı">
        <strong>{confirmation.title}</strong><p>{confirmation.description}</p>
        <button type="button" disabled={confirming} onClick={()=>setConfirmation(null)}>Vazgeç</button>
        <button type="button" className="primary" disabled={confirming} onClick={commit}>{confirming?'Doğrulanıyor…':'Onayla'}</button>
      </section>}
      <form className="messenger-compose" onSubmit={send}>
        <details className="messenger-tools"><summary>Plan araçları</summary><div>
          {[...actions,'restore'].map(action=><button type="button" key={action} disabled={busy||confirming} onClick={event=>{
            event.currentTarget.closest('details').open=false;void shortcut(action);
          }}>{toolLabels[action]}</button>)}</div></details>
        <div className="messenger-input">
          <textarea ref={field} aria-label="Mesaj" maxLength={messageLimit} placeholder="Plan hakkında sorun…" rows={1} value={draft} onChange={event=>setDraft(event.target.value)}
            onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}}/>
          {busy?<button type="button" className="messenger-send" aria-label="Yanıtı durdur" onClick={()=>ctrl.current?.abort()}><Square size={17} weight="fill"/></button>:
            <button type="submit" className="messenger-send" aria-label="Gönder" disabled={!draft.trim()||!service.available||confirming}><ArrowUp size={21} weight="bold"/></button>}
        </div>
        <div className="messenger-files">
          <button type="button" disabled={busy||confirming} aria-label="Dosya ekle" title="PDF, CSV, Excel veya görsel ekle" onClick={()=>attachment.current.click()}><Paperclip size={18}/></button>
          <button type="button" disabled={busy||confirming} aria-label="Görsel ekle" title="Görsel ekle" onClick={()=>image.current.click()}><Image size={18}/></button>
          <button type="button" disabled={busy||confirming} aria-label="Kameradan ekle" title="Kameradan ekle" onClick={()=>camera.current.click()}><Camera size={18}/></button>
          <button type="button" disabled={busy||confirming} aria-label="Excel ekle" title="Excel ekle" onClick={()=>excel.current.click()}><FileXls size={18}/></button>
          <small>Simülasyon · Uçuş onayı değildir.</small>
          <input hidden type="file" ref={attachment} accept=".csv,.xlsx,application/pdf,image/png,image/jpeg,image/webp" onChange={readAttachment}/>
          <input hidden type="file" ref={image} accept="image/png,image/jpeg,image/webp" onChange={readAttachment}/>
          <input hidden type="file" ref={camera} accept="image/*" capture="environment" onChange={readAttachment}/>
          <input hidden type="file" ref={excel} accept=".xlsx,.csv" onChange={readAttachment}/>
        </div>
      </form>
      {preview?.result&&<AiPlanPreview {...preview} onClose={()=>setPreview(null)}/>}
      {preview?.aircraft&&<div className="messenger-confirm messenger-aircraft-preview">
        <strong>Uçak planı önizlemesi</strong><ul>{preview.aircraft.positions.map(p=><li key={p.label}>{p.label} · {p.reference}</li>)}</ul>
        <button type="button" onClick={()=>setPreview(null)}>Önizlemeyi kapat</button>
      </div>}
    </section>
  </div>;
}
