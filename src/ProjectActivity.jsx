import React, { useState } from 'react';
import { Users } from '@phosphor-icons/react';

export function ProjectActivity({ online, changedBy, changedAt, canEdit, requestMembers }) {
  const [showMembers, setShowMembers] = useState(false);
  const [members, setMembers] = useState(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadMembers(action, target) {
    setBusy(true);
    setError('');
    try {
      const result = await requestMembers(action, target);
      setMembers(result.members);
      if (action === 'grant') setEmail('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="project-activity" aria-label="Proje etkinliği">
    <h2><Users size={18}/> Projeye bakanlar{online !== null && <span className="online-pill">{online.length} çevrimiçi</span>}</h2>
    {online === null ? <p>Çevrimiçi durumu alınıyor.</p> : online.length ? <ul className="online-list">
      {online.map((person, index) => <li key={index}><span className="online-dot" aria-hidden="true"/>{person.name}{person.you && ' (sen)'}</li>)}
    </ul> : <p>Şu anda bakan kimse yok.</p>}
    {changedBy && <p>Son değişiklik: <strong>{changedBy}</strong> · {changedAt}</p>}
    {canEdit && <>
      <button className="text-btn project-share-toggle" type="button" aria-expanded={showMembers} onClick={() => {
        setShowMembers(!showMembers);
        if (!showMembers && !busy) void loadMembers();
      }}>Görüntüleme erişimi</button>
      {showMembers && <div className="project-share-panel">
        <p>Site’a erişimi olan bir ChatGPT hesabına bu projeyi görme izni ver.</p>
        <form onSubmit={event => {
          event.preventDefault();
          if (!busy && email.trim()) void loadMembers('grant', email.trim());
        }}>
          <label>Hesap e-postası<input type="email" maxLength={254} required value={email}
            onChange={event => setEmail(event.target.value)}/></label>
          <button type="submit" className="outline amber" disabled={busy || !email.trim()}>Erişim ver</button>
        </form>
        {error && <p className="cloud-error" role="alert">{error}</p>}
        {members === null && busy && <p>Liste yükleniyor.</p>}
        {members?.length > 0 && <ul className="project-viewer-list">{members.map(member => <li key={member}>
          <span>{member}</span><button type="button" className="text-btn" disabled={busy}
            aria-label={member + ' görüntüleme erişimini kaldır'} onClick={() => loadMembers('revoke', member)}>Kaldır</button>
        </li>)}</ul>}
      </div>}
    </>}
  </section>;
}
