import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Users } from '@phosphor-icons/react';
import { App } from './App';
import { ProjectActivity } from './ProjectActivity';
import { AIRCRAFT_MODEL } from './aircraft-profile.mjs';

const AIRCRAFT_KEY = 'cargo-demo-a330-v1';
const PREVIOUS_AIRCRAFT_KEY = 'cargo-demo-v1';
const PMC_KEY = 'cargo-pmc-v1';
const RECOVERY_KEY = 'cargo-demo-recovery-v1';
const OWNER_KEY = 'cargo-cloud-owner-id';
const CACHE_KEYS = [AIRCRAFT_KEY, PREVIOUS_AIRCRAFT_KEY, PMC_KEY, RECOVERY_KEY, OWNER_KEY];
const EMPTY_PAYLOAD = { version: 1, aircraft: null, pmc: null, recovery: [] };

function readLocalPayload() {
  const read = key => {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch { return null; }
  };
  const aircraft = read(AIRCRAFT_KEY) || read(PREVIOUS_AIRCRAFT_KEY);
  const pmc = read(PMC_KEY);
  const recovery = read(RECOVERY_KEY);
  return aircraft || pmc || recovery
    ? { version: 1, aircraft, pmc, recovery: Array.isArray(recovery) ? recovery : [] }
    : null;
}

function clearLocalPlan() {
  for (const key of CACHE_KEYS) localStorage.removeItem(key);
}

function readLegacyPlan() {
  try { return localStorage.getItem(OWNER_KEY) ? null : readLocalPayload(); }
  catch { return null; }
}

function hydrateLocalPlan(payload) {
  for (const [key, value] of [[AIRCRAFT_KEY, payload.aircraft], [PMC_KEY, payload.pmc], [RECOVERY_KEY, payload.recovery]]) {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  }
  localStorage.setItem(OWNER_KEY, 'sites');
}

function validPayload(value) {
  return value && typeof value === 'object' && value.version === 1 &&
    (value.aircraft === null || (value.aircraft && typeof value.aircraft === 'object')) &&
    (value.pmc === null || (value.pmc && typeof value.pmc === 'object')) &&
    (value.recovery === undefined || Array.isArray(value.recovery));
}

function projectTimestamp(value) {
  return new Date(value).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
}

function SimulationNotice() {
  return <footer className="cloud-simulation-note">SİMÜLASYON — Uçuş operasyonları için onaylı değildir. Gerçek yükleme için onaylı uçak ve operatör limitleri gerekir.</footer>;
}

async function projectRequest(path = '', { method = 'GET', body, signal } = {}) {
  const response = await fetch('/api/projects' + path, {
    method, signal, cache: 'no-store',
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const isJson = response.headers.get('Content-Type')?.includes('application/json');
  const data = isJson ? await response.json() : null;
  if (!response.ok || !isJson) {
    const error = new Error(data?.error || 'Proje bağlantısı kurulamadı.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export function CloudPlanGate() {
  const [legacyPlan, setLegacyPlan] = useState(readLegacyPlan);
  const projectRef = useRef(null);
  const changeTimer = useRef(null);
  const saveInFlight = useRef(null);
  const leaving = useRef(false);
  const [view, setView] = useState('loading');
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [activity, setActivity] = useState(null);
  const [draftName, setDraftName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [renameDraft, setRenameDraft] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncState, setSyncState] = useState('saved');

  const showProjectList = useCallback(async signal => {
    setError(''); setView('loading');
    try {
      const { projects: items } = await projectRequest('', { signal });
      if (signal?.aborted) return;
      setProjects(items);
      setView('projects');
    } catch (listError) {
      if (signal?.aborted) return;
      setError(listError.message);
      setView(listError.status === 401 ? 'sign-in' : 'load-error');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void showProjectList(controller.signal);
    return () => controller.abort();
  }, [showProjectList]);

  useEffect(() => {
    if (view !== 'projects' || busy) return;
    let request;
    const timer = setInterval(async () => {
      if (document.visibilityState !== 'visible' || request) return;
      const controller = new AbortController();
      request = controller;
      try {
        const data = await projectRequest('', { signal: controller.signal });
        if (!controller.signal.aborted) setProjects(data.projects);
      } catch {
        // Preserve the visible projects on a transient refresh failure.
      } finally { request = null; }
    }, 15000);
    return () => { clearInterval(timer); request?.abort(); };
  }, [view, busy]);

  function activateProject(data) {
    if (!validPayload(data.payload)) throw new Error('Proje verisinin biçimi tanınmıyor.');
    clearLocalPlan();
    hydrateLocalPlan(data.payload);
    projectRef.current = { id: data.id, updatedAt: data.updated_at, canEdit: data.can_edit === true };
    setRenameDraft(null);
    setActiveProject(data);
    setActivity(null);
    setSyncState('saved');
    setView('ready');
  }

  async function openProject(project) {
    setBusy(true); setError(''); setView('loading-project');
    try {
      activateProject(await projectRequest('/' + project.id));
    } catch (loadError) {
      setError(loadError.message);
      setView('projects');
    } finally {
      setBusy(false);
    }
  }

  const savePlan = useCallback(async () => {
    const project = projectRef.current;
    if (!project) return false;
    if (!project.canEdit) return true;
    if (saveInFlight.current) return saveInFlight.current;

    async function saveLatest() {
      setSyncState('saving');
      let serialized;
      do {
        const payload = readLocalPayload() || EMPTY_PAYLOAD;
        serialized = JSON.stringify(payload);
        const data = await projectRequest('/' + project.id, {
          method: 'PATCH', body: { payload, expected: project.updatedAt },
        });
        project.updatedAt = data.updated_at;
      } while (JSON.stringify(readLocalPayload() || EMPTY_PAYLOAD) !== serialized);
      setSyncState('saved');
      return true;
    }

    saveInFlight.current = saveLatest().catch(saveError => {
      setSyncState([404, 409].includes(saveError.status) ? 'conflict' : 'error');
      return false;
    }).finally(() => { saveInFlight.current = null; });
    return saveInFlight.current;
  }, []);

  useEffect(() => {
    if (view !== 'ready' || !activeProject?.can_edit) return;
    const schedule = () => {
      clearTimeout(changeTimer.current);
      changeTimer.current = setTimeout(() => {
        if (projectRef.current && !leaving.current) void savePlan();
      }, 700);
    };
    window.addEventListener('cargo:local-plan-change', schedule);
    return () => {
      window.removeEventListener('cargo:local-plan-change', schedule);
      clearTimeout(changeTimer.current);
    };
  }, [view, activeProject?.can_edit, savePlan]);

  useEffect(() => {
    if (view !== 'ready' || !activeProject?.id) return;
    let request;
    let stopped = false;
    const refresh = async () => {
      const project = projectRef.current;
      if (stopped || request || !project || document.visibilityState !== 'visible') return;
      const expected = project.updatedAt;
      const controller = new AbortController();
      request = controller;
      try {
        const data = await projectRequest('/' + project.id + '?presence', { method: 'POST', signal: controller.signal });
        if (stopped || projectRef.current !== project) return;
        setActivity(data);
        if (!saveInFlight.current && project.updatedAt === expected && data.updated_at !== expected) {
          setSyncState('conflict');
        }
      } catch (pollError) {
        if (stopped || projectRef.current !== project) return;
        setActivity(null);
        if (pollError.status === 404 && !project.canEdit) {
          projectRef.current = null;
          setActiveProject(null);
          clearLocalPlan();
          void showProjectList();
        } else if (pollError.status === 404) setSyncState('conflict');
      } finally {
        request = null;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      stopped = true;
      request?.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [view, activeProject?.id, showProjectList]);

  async function createProject(name, payload = EMPTY_PAYLOAD) {
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 80 || busy) return;
    setBusy(true); setError('');
    try {
      const project = await projectRequest('', { method: 'POST', body: { name: cleanName, payload } });
      activateProject(project);
      setShowCreate(false); setDraftName('');
      if (payload !== EMPTY_PAYLOAD) setLegacyPlan(null);
    } catch (createError) {
      setError(createError.message);
    } finally {
      setBusy(false);
    }
  }

  async function renameProject(project) {
    if (!renameDraft || renameDraft.id !== project.id || busy) return;
    const name = renameDraft.name.trim();
    if (!name || name === project.name || name.length > 80) return;
    setBusy(true); setError('');
    try {
      const renamed = await projectRequest('/' + project.id, { method: 'PATCH', body: { name } });
      setProjects(previous => [renamed, ...previous.filter(item => item.id !== project.id)]);
      setRenameDraft(null);
    } catch (renameError) {
      setError(renameError.message);
    } finally {
      setBusy(false);
    }
  }

  function editProjectName(project) {
    setShowCreate(false);
    setError('');
    setRenameDraft({ id: project.id, name: project.name });
  }

  async function deleteProject(project) {
    if (busy || !window.confirm(`“${project.name}” projesi kalıcı olarak silinsin mi?`)) return;
    setBusy(true); setError('');
    try {
      await projectRequest('/' + project.id, { method: 'DELETE' });
      setProjects(previous => previous.filter(item => item.id !== project.id));
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setBusy(false);
    }
  }

  async function goToProjects() {
    if (leaving.current) return;
    leaving.current = true;
    clearTimeout(changeTimer.current);
    try {
      if (!(await savePlan())) return;
      projectRef.current = null;
      setActiveProject(null);
      clearLocalPlan();
      await showProjectList();
    } finally {
      leaving.current = false;
    }
  }

  async function reloadCloudProject() {
    if (!activeProject || saveInFlight.current) return;
    await openProject(activeProject);
  }

  if (view === 'ready' && activeProject) {
    const latest = activity ?? activeProject;
    const membersPath = '/' + activeProject.id + '?members';
    const panel = <ProjectActivity online={activity?.online ?? null} changedBy={latest.last_changed_by}
      changedAt={projectTimestamp(latest.updated_at)} canEdit={activeProject.can_edit}
      requestMembers={(action, email) => projectRequest(membersPath, action ? { method: 'POST', body: { action, email } } : {})}/>;
    return <App cloudProjectName={activeProject.name} syncState={syncState} viewOnly={!activeProject.can_edit} activityPanel={panel}
      onReloadCloud={reloadCloudProject} onGoProjects={goToProjects} onSaveProject={goToProjects}/>;
  }

  if (view === 'loading' || view === 'loading-project') {
    return <main className="cloud-gate"><section className="cloud-card">
      <h1>{view === 'loading' ? 'Projeler yükleniyor' : 'Proje açılıyor'}</h1>
    </section><SimulationNotice/></main>;
  }

  if (view === 'sign-in') {
    return <main className="cloud-gate"><section className="cloud-card">
      <h1>Projelerinizi açın</h1>
      <a className="primary" href="/signin-with-chatgpt?return_to=%2F" target="_top">ChatGPT ile devam et</a>
    </section><SimulationNotice/></main>;
  }

  if (view === 'load-error') {
    return <main className="cloud-gate"><section className="cloud-card">
      <h1>Projeler alınamadı</h1><p className="cloud-error">{error}</p>
      <button className="primary" onClick={() => showProjectList()}>Yeniden dene</button>
    </section><SimulationNotice/></main>;
  }

  return <main className="projects-page"><header className="projects-header"><div><span className="project-eyebrow">{AIRCRAFT_MODEL} · SİMÜLASYON</span><h1>Projelerim</h1></div></header>
    {error && <p className="cloud-error" role="alert">{error}</p>}
    <section className="projects-toolbar"><div><h2>Kayıtlı paletlemeler</h2><p>Her proje kendi yük listesini ve palet düzenini saklar.</p></div><button className="primary create-project-button" disabled={busy} onClick={() => { setRenameDraft(null); setShowCreate(value => !value); setError(''); }}>＋ Yeni proje</button></section>
    {showCreate && <form className="create-project-form" onSubmit={event => { event.preventDefault(); void createProject(draftName); }}><label>Proje adı<input autoFocus maxLength="80" required value={draftName} onChange={event => setDraftName(event.target.value)} placeholder="Örn. Kasım siparişi"/></label><button className="primary" disabled={busy}>{busy ? 'Oluşturuluyor…' : 'Oluştur ve aç'}</button><button type="button" className="text-btn" onClick={() => setShowCreate(false)}>Vazgeç</button></form>}
    {legacyPlan && <div className="legacy-import"><div><b>Bu cihazda kaydedilmiş eski bir plan var</b><small>İsterseniz bunu yeni bir özel proje olarak hesabınıza aktarabilirsiniz.</small></div><button className="cloud-secondary" disabled={busy} onClick={() => createProject('Bu cihazdaki plan', legacyPlan)}>Bu cihazdaki planı kaydet</button></div>}
    {projects.length ? <div className="project-list">{projects.map(project => {
      const editing = renameDraft?.id === project.id;
      return <article className={editing ? 'project-card project-card-editing' : 'project-card'} key={project.id}>
        {!editing && <button className="project-open" type="button" aria-label={`${project.name} projesini aç`}
          disabled={busy} onClick={() => openProject(project)}/>}
        <div className="project-card-icon" aria-hidden="true">✈</div>
        <div className="project-card-info">
          <h3>{editing || !project.can_edit ? project.name : <button className="project-title" type="button" title="Proje adını düzenle"
            aria-label={`${project.name} adını değiştir`} disabled={busy} onClick={() => editProjectName(project)}>{project.name}</button>}</h3>
          <p>Son değişiklik: {project.last_changed_by || 'Yapan kişi bilinmiyor'} · {projectTimestamp(project.updated_at)}</p>
        </div>
        {!editing && <span className="online-card-count" title={`${project.online_count ?? 0} kişi çevrimiçi`}>
          <Users size={16} aria-hidden="true"/><span aria-label={`${project.online_count ?? 0} kişi çevrimiçi`}>{project.online_count ?? 0}</span>
        </span>}
        {editing ? <form className="create-project-form project-rename-form" onSubmit={event => {
          event.preventDefault();
          void renameProject(project);
        }}>
          <label>Yeni proje adı<input autoFocus maxLength={80} required disabled={busy} value={renameDraft.name}
            onChange={event => setRenameDraft({ id: project.id, name: event.target.value })}/></label>
          <button className="primary" type="submit" disabled={busy || !renameDraft.name.trim() || renameDraft.name.trim() === project.name}>
            {busy ? 'Kaydediliyor…' : 'Adı kaydet'}
          </button>
          <button className="text-btn" type="button" disabled={busy} onClick={() => { setRenameDraft(null); setError(''); }}>Vazgeç</button>
        </form> : project.can_edit && <button className="project-delete" aria-label={`${project.name} projesini sil`} disabled={busy} onClick={() => deleteProject(project)}>Sil</button>}
      </article>;
    })}</div> : <section className="projects-empty"><div>📦</div><h2>Henüz kayıtlı proje yok</h2><p>Bir paletleme çalışması başlatıp kaydedin. Sonraki girişlerinizde bu listede bulacaksınız.</p><button className="primary" onClick={() => { setShowCreate(true); setDraftName('Yeni proje'); }}>İlk projeyi oluştur</button></section>}
    <footer className="projects-footer">SİMÜLASYON — Uçuş operasyonları için onaylı değildir. Gerçek yükleme için onaylı uçak ve operatör limitleri gerekir.</footer>
  </main>;
}
