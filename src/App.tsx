import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, Clock3, Mic, Pause, Play, Plus, RotateCcw, Search, Star, Trash2, Volume2 } from 'lucide-react';

type Phrase = { id: number; text: string; translation: string; tag: string; level: '入门'|'进阶'|'挑战'; status: 'new'|'practice'|'mastered'; attempts: number; last?: string };
type SessionStatus = 'idle' | 'running' | 'paused';
type Session = {
  phraseId: number;
  text: string;
  startedAt: number;   // 开始时间（本段练习第一次开始）
  elapsed: number;     // 已累计的有效时长（毫秒，暂停期间不计入）
  runningFrom: number | null; // 当前未结算的计时段起点；null 表示已暂停
};
type PendingRating = { phraseId: number; text: string; startedAt: number; elapsed: number; switchTo: number | null };
type PracticeRecord = { id: number; phraseId: number; text: string; startedAt: number; duration: number; rating: number };

const seed: Phrase[] = [
  { id: 1, text: 'The morning light feels different today.', translation: '今天的晨光感觉不一样。', tag: '日常', level: '入门', status: 'practice', attempts: 3, last: '今天 09:24' },
  { id: 2, text: 'Could you walk me through the next step?', translation: '你能带我了解下一步吗？', tag: '工作', level: '进阶', status: 'new', attempts: 0 },
  { id: 3, text: 'I appreciate your patience and thoughtful feedback.', translation: '感谢你的耐心和细致反馈。', tag: '表达', level: '挑战', status: 'mastered', attempts: 8, last: '昨天 18:10' },
  { id: 4, text: 'Let’s make room for a little curiosity.', translation: '给好奇心留一点空间。', tag: '灵感', level: '入门', status: 'new', attempts: 0 },
];
const bars = Array.from({ length: 68 }, (_, i) => 18 + ((i * 29) % 44));
const PHRASES_KEY = 'sound-lab-phrases';
const RECORDS_KEY = 'sound-lab-records';
const SESSION_KEY = 'sound-lab-session';

function load<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
const fmtClock = (ms: number) => {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60), s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
const fmtStartedAt = (ts: number) => {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function App() {
  const [phrases, setPhrases] = useState<Phrase[]>(() => load(PHRASES_KEY, seed));
  const [records, setRecords] = useState<PracticeRecord[]>(() => load(RECORDS_KEY, [] as PracticeRecord[]));
  const [draft, setDraft] = useState<Session | null>(() => {
    // 关掉页面期间计时不累计：回来后若上次还在计时，按暂停恢复
    const s = load<Session | null>(SESSION_KEY, null);
    return s ? { ...s, runningFrom: null } : null;
  });
  const [pending, setPending] = useState<PendingRating | null>(null);
  const [rating, setRating] = useState(0);
  const [selected, setSelected] = useState<number>(() => {
    const s = load<Session | null>(SESSION_KEY, null);
    return s?.phraseId ?? load<Phrase[]>(PHRASES_KEY, seed)[0]?.id ?? 1;
  });
  const [view, setView] = useState<'library'|'records'|'mastered'>('library');
  const [filter, setFilter] = useState('全部');
  const [query, setQuery] = useState('');
  const [playing, setPlaying] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newText, setNewText] = useState('');
  const [, setNow] = useState(Date.now());
  const draftRef = useRef<Session | null>(draft);
  draftRef.current = draft;

  const current = phrases.find(p => p.id === selected) ?? phrases[0];
  const status: SessionStatus = draft && draft.phraseId === current?.id ? (draft.runningFrom ? 'running' : 'paused') : 'idle';
  const elapsedMs = draft && draft.phraseId === current?.id
    ? draft.elapsed + (draft.runningFrom ? Date.now() - draft.runningFrom : 0)
    : 0;

  const visiblePhrases = useMemo(() => {
    const list = view === 'mastered' ? phrases.filter(p => p.status === 'mastered') : phrases;
    return list.filter(p => (filter === '全部' || p.tag === filter || p.level === filter || (filter === '待练' && p.status !== 'mastered')) && p.text.toLowerCase().includes(query.toLowerCase()));
  }, [phrases, filter, query, view]);
  const tags = ['全部', ...Array.from(new Set(phrases.map(p => p.tag)))];

  useEffect(() => { localStorage.setItem(PHRASES_KEY, JSON.stringify(phrases)); }, [phrases]);
  useEffect(() => { localStorage.setItem(RECORDS_KEY, JSON.stringify(records)); }, [records]);
  useEffect(() => {
    if (draft) localStorage.setItem(SESSION_KEY, JSON.stringify(draft));
    else localStorage.removeItem(SESSION_KEY);
  }, [draft]);

  // 计时心跳：只在运行中刷新显示；接电话/切后台时自动暂停，时间不累计
  useEffect(() => {
    if (!draft?.runningFrom) return;
    const tick = window.setInterval(() => setNow(Date.now()), 500);
    const pause = () => {
      const d = draftRef.current;
      if (d?.runningFrom) setDraft({ ...d, elapsed: d.elapsed + Date.now() - d.runningFrom, runningFrom: null });
    };
    document.addEventListener('visibilitychange', pause);
    window.addEventListener('pagehide', pause);
    return () => { window.clearInterval(tick); document.removeEventListener('visibilitychange', pause); window.removeEventListener('pagehide', pause); };
  }, [draft?.runningFrom]);

  // 把当前会话收好（暂停并带去评分）。switchTo 为评分完成后要切换到的句子；为 null 表示留在本句
  const closeSession = (d: Session, switchTo: number | null) => {
    const elapsed = d.elapsed + (d.runningFrom ? Date.now() - d.runningFrom : 0);
    setDraft(null);
    setPending({ phraseId: d.phraseId, text: d.text, startedAt: d.startedAt, elapsed, switchTo });
    setRating(0);
  };

  const beginSession = () => {
    if (!current) return;
    setDraft({ phraseId: current.id, text: current.text, startedAt: Date.now(), elapsed: 0, runningFrom: Date.now() });
  };
  const pauseSession = () => {
    const d = draftRef.current;
    if (d?.runningFrom) setDraft({ ...d, elapsed: d.elapsed + Date.now() - d.runningFrom, runningFrom: null });
  };
  const resumeSession = () => {
    const d = draftRef.current;
    if (d && !d.runningFrom) setDraft({ ...d, runningFrom: Date.now() });
  };
  const endSession = () => {
    const d = draftRef.current;
    if (d && d.phraseId === current?.id) closeSession(d, null);
  };

  // 切换到别的句子前，先把当前会话收好，避免计时串到另一句
  const selectPhrase = (id: number) => {
    if (id === selected) return;
    const d = draftRef.current;
    if (d && d.phraseId === selected) {
      const acc = d.elapsed + (d.runningFrom ? Date.now() - d.runningFrom : 0);
      if (acc < 1000) { setDraft(null); setSelected(id); }
      else closeSession({ ...d, elapsed: acc, runningFrom: null }, id);
    } else setSelected(id);
  };

  const submitRating = () => {
    if (!pending || rating === 0) return;
    const rec: PracticeRecord = { id: Date.now(), phraseId: pending.phraseId, text: pending.text, startedAt: pending.startedAt, duration: Math.round(pending.elapsed / 1000), rating };
    setRecords(rs => [rec, ...rs]);
    // 句子已被移除时映射不到，练习次数自然不变；记录里仍保留原句文字
    setPhrases(ps => ps.map(p => p.id === pending.phraseId ? { ...p, attempts: p.attempts + 1, status: 'practice', last: '刚刚' } : p));
    const next = pending.switchTo;
    setPending(null);
    setRating(0);
    if (next !== null) setSelected(next);
  };

  const addPhrase = () => {
    if (!newText.trim()) return;
    const id = Date.now();
    setPhrases(ps => [...ps, { id, text: newText.trim(), translation: '待补充译文', tag: '自定义', level: '入门', status: 'new', attempts: 0 }]);
    setNewText('');
    setShowAdd(false);
    setView('library');
    selectPhrase(id);
  };

  // 移除句子只把它移出句子库；进行中的会话照常收好评分，历史记录保留原句文字
  const removePhrase = () => {
    if (!current) return;
    const removing = current.id;
    const fallback = phrases.find(p => p.id !== removing)?.id ?? 0;
    const d = draftRef.current;
    if (d && d.phraseId === removing) {
      const acc = d.elapsed + (d.runningFrom ? Date.now() - d.runningFrom : 0);
      if (acc >= 1000) { closeSession({ ...d, elapsed: acc, runningFrom: null }, fallback); setPhrases(ps => ps.filter(p => p.id !== removing)); return; }
      setDraft(null);
    }
    setPhrases(ps => ps.filter(p => p.id !== removing));
    setSelected(fallback);
  };

  const latestRecord = records.find(r => r.phraseId === current?.id);
  const totalMinutes = Math.round(records.reduce((sum, r) => sum + r.duration, 0) / 60);

  const recordsView = (
    <section className="records-panel">
      <div className="section-head"><div><h2>每次练习都算数</h2><p>保存句子、开始时间、有效时长与自评得分</p></div></div>
      {records.length === 0 ? (
        <div className="empty">还没有练习记录，开始第一段录音吧</div>
      ) : (
        <div className="record-list">
          {records.map(r => (
            <div key={r.id} className="log-row">
              <div className="log-icon"><Mic size={15}/></div>
              <div className="log-copy"><strong>{r.text}</strong><span>{fmtStartedAt(r.startedAt)} · 有效时长 {fmtClock(r.duration * 1000)}</span></div>
              <div className="log-stars">{[1,2,3,4,5].map(n => <Star key={n} size={14} className={n <= r.rating ? 'star-on' : ''}/>)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  const practiceView = current && (
    <>
      <section className="stats"><div><span>本周完成</span><strong>{records.length} <em>次</em></strong><div className="progress"><i style={{width: `${Math.min(100, records.length * 5)}%`}}/></div></div><div><span>累计有效时长</span><strong>{totalMinutes} <em>分钟</em></strong><small>暂停与接电话不计入</small></div><div><span>最佳自评</span><strong>{records.length ? Math.max(...records.map(r => r.rating)) : 0} <em>分</em></strong><small className="green">{records.length ? '继续保持' : '完成后自评'}</small></div></section>
      <div className="content-grid">
        <section className="library">
          <div className="section-head"><div><h2>{view === 'mastered' ? '已掌握' : '句子库'}</h2><p>选择一句开始你的声音训练</p></div>{view === 'library' && <button className="ghost" onClick={() => setFilter(filter === '待练' ? '全部' : '待练')}>只看待练</button>}</div>
          <div className="filters">{tags.map(t => <button key={t} className={filter === t ? 'chip active' : 'chip'} onClick={() => setFilter(t)}>{t}</button>)}</div>
          <div className="phrase-list">{visiblePhrases.map(p => (
            <button key={p.id} onClick={() => selectPhrase(p.id)} className={p.id === selected ? 'phrase selected' : 'phrase'}>
              <div className="phrase-icon">{p.status === 'mastered' ? <Check size={15}/> : <Mic size={15}/>}</div>
              <div className="phrase-copy"><strong>{p.text}</strong><span>{p.translation}</span><div className="phrase-meta"><i>{p.tag}</i><i>{p.level}</i>{p.attempts > 0 && <small>{p.attempts} 次练习</small>}{draft?.phraseId === p.id && <small className="live-dot">{draft.runningFrom ? '● 计时中' : '❚❚ 已暂停'}</small>}</div></div>
              <ChevronRight size={17}/>
            </button>
          ))}{visiblePhrases.length === 0 && <div className="empty">没有找到匹配句子</div>}</div>
        </section>
        <section className="practice">
          <div className="practice-head"><div><span className="label">CURRENT PHRASE</span><h2>跟着感觉读</h2></div><button className="icon-btn" onClick={removePhrase} title="移除句子"><Trash2 size={17}/></button></div>
          <div className="focus-card"><div className="focus-tag">{current.tag} · {current.level}</div><p className="focus-text">{current.text}</p><p className="focus-translation">{current.translation}</p><div className="audio-sample"><button className="round-btn" onClick={() => setPlaying(v => !v)}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button><div className="sample-wave">{bars.map((h,i) => <i key={i} style={{height: `${h * (playing ? 1.15 : 0.72)}%`}}/> )}</div><span>0:08</span></div></div>
          <div className="record-card">
            <div className="record-top"><div><span className="label">YOUR PRACTICE</span><h3>{status === 'running' ? '计时中，读完可暂停分段' : status === 'paused' ? '已暂停，继续后接着计时' : latestRecord ? '继续练习这一句' : '准备好后开始录音'}</h3></div><span className={`record-time ${status}`}>{fmtClock(elapsedMs)}</span></div>
            <div className="record-wave">{bars.slice(5,58).map((h,i) => <i key={i} className={status === 'running' ? 'live' : ''} style={{height: `${h * (status === 'running' ? (0.4 + ((i%5)/7)) : 0.4)}%`}}/> )}</div>
            <div className="record-actions">
              {status === 'idle' && <button className="record-button" onClick={beginSession}><span><Mic size={16}/></span>开始录音</button>}
              {status === 'running' && <><button className="record-button recording" onClick={pauseSession}><span><Pause size={16}/></span>暂停</button><button className="secondary" onClick={endSession}><Check size={15}/>结束并评分</button></>}
              {status === 'paused' && <><button className="record-button" onClick={resumeSession}><span><Play size={16}/></span>继续计时</button><button className="secondary" onClick={endSession}><Check size={15}/>结束并评分</button></>}
              {(status === 'running' || status === 'paused') && <button className="icon-btn" title="放弃本次练习" onClick={() => setDraft(null)}><RotateCcw size={15}/></button>}
            </div>
            {status === 'paused' && <p className="pause-hint">暂停期间不计时；接电话或中途跟读都可以先暂停，回来继续。</p>}
          </div>
          {latestRecord && <div className="last-record"><span className="label">LAST RECORD</span><div className="last-row"><div className="log-stars">{[1,2,3,4,5].map(n => <Star key={n} size={13} className={n <= latestRecord.rating ? 'star-on' : ''}/>)}</div><span>{fmtClock(latestRecord.duration * 1000)} · {fmtStartedAt(latestRecord.startedAt)}</span></div></div>}
          <div className="tip"><span>练习小贴士</span><p>一次练习可以分成多段：暂停不计入有效时长，结束后给自己打个分吧。</p><Mic size={15}/></div>
        </section>
      </div>
    </>
  );

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark"><Volume2 size={19}/></div><div><strong>声线练习室</strong><span>Pronounce / practice</span></div></div><div className="side-label">我的练习</div><nav>
      <button className={view==='library'?'side-link active':'side-link'} onClick={() => setView('library')}><Mic size={17}/>练习库 <b>{phrases.length}</b></button>
      <button className={view==='records'?'side-link active':'side-link'} onClick={() => setView('records')}><Clock3 size={17}/>练习记录 <b>{records.length}</b></button>
      <button className={view==='mastered'?'side-link active':'side-link'} onClick={() => setView('mastered')}><Check size={17}/>已掌握 <b>{phrases.filter(p => p.status === 'mastered').length}</b></button>
    </nav><div className="sidebar-foot"><div className="streak"><span>累计有效时长</span><strong>{totalMinutes} <small>分钟</small></strong><i>{records.length} 次已保存练习</i></div><div className="profile"><div className="avatar">YL</div><div><strong>Yuki Lin</strong><span>普通计划</span></div><ChevronRight size={16}/></div></div></aside>
    <main className="main">
      <header className="topbar"><div><p className="eyebrow">WEDNESDAY, SEP 12</p><h1>{view === 'records' ? '练习记录' : view === 'mastered' ? '已掌握的句子' : '今天练什么？'}</h1></div><div className="top-actions"><div className="search"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索句子"/></div>{view !== 'records' && <button className="primary" onClick={() => setShowAdd(true)}><Plus size={17}/>添加句子</button>}</div></header>
      {view === 'records' ? recordsView : practiceView}
    </main>

    {showAdd && <div className="modal-backdrop" onClick={() => setShowAdd(false)}><div className="modal" onClick={e => e.stopPropagation()}><div className="modal-head"><h2>添加练习句子</h2><button className="icon-btn" onClick={() => setShowAdd(false)}>×</button></div><label>英文句子<textarea autoFocus value={newText} onChange={e => setNewText(e.target.value)} placeholder="例如：I can make this happen."/></label><div className="modal-actions"><button className="secondary" onClick={() => setShowAdd(false)}>取消</button><button className="primary" onClick={addPhrase}>加入句子库</button></div></div></div>}

    {pending && <div className="modal-backdrop"><div className="modal" onClick={e => e.stopPropagation()}><div className="modal-head"><h2>给这段练习打分</h2></div><p className="rate-text">“{pending.text}”</p><p className="rate-meta">开始于 {fmtStartedAt(pending.startedAt)} · 有效时长 {fmtClock(pending.elapsed)}</p><div className="rate-stars">{[1,2,3,4,5].map(n => <button key={n} className="rate-star" onMouseEnter={() => setRating(n)} onClick={() => setRating(n)}><Star size={34} className={n <= rating ? 'star-on big' : ''}/></button>)}</div><p className="rate-label">{['', '还需多练', '基本顺下来', '感觉不错', '相当流畅', '非常满意'][rating]}</p><div className="modal-actions"><button className="ghost" onClick={() => { setPending(null); setRating(0); if (pending.switchTo !== null) setSelected(pending.switchTo); }}>不保存</button><button className="primary" disabled={rating === 0} onClick={submitRating}><Check size={15}/>保存评分</button></div></div></div>}
  </div>;
}
