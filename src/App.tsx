import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Clock3, Mic, Pause, Play, Plus, RotateCcw, Search, Star, Trash2, Volume2 } from 'lucide-react';

type Phrase = { id: number; text: string; translation: string; tag: string; level: '入门'|'进阶'|'挑战'; status: 'new'|'practice'|'mastered'; attempts: number; last?: string };
// 记录里保存句子原文快照，之后把句子移出句子库也不影响旧记录
type SessionRecord = { id: number; phraseId: number; text: string; startedAt: number; durationSec: number; rating: number };
// 进行中的会话：accumulated 是已暂停段落累计的秒数，runningSince 是当前计时段的起点（null 表示暂停中）
type ActiveSession = { phraseId: number; text: string; startedAt: number; accumulated: number; runningSince: number | null };
type PendingRecord = { phraseId: number; text: string; startedAt: number; durationSec: number };

const seed: Phrase[] = [
  { id: 1, text: 'The morning light feels different today.', translation: '今天的晨光感觉不一样。', tag: '日常', level: '入门', status: 'practice', attempts: 3, last: '今天 09:24' },
  { id: 2, text: 'Could you walk me through the next step?', translation: '你能带我了解下一步吗？', tag: '工作', level: '进阶', status: 'new', attempts: 0 },
  { id: 3, text: 'I appreciate your patience and thoughtful feedback.', translation: '感谢你的耐心和细致反馈。', tag: '表达', level: '挑战', status: 'mastered', attempts: 8, last: '昨天 18:10' },
  { id: 4, text: 'Let’s make room for a little curiosity.', translation: '给好奇心留一点空间。', tag: '灵感', level: '入门', status: 'new', attempts: 0 },
];
const bars = Array.from({ length: 68 }, (_, i) => 18 + ((i * 29) % 44));

const fmtClock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const fmtTime = (ts: number) => new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const dayKey = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const load = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; } catch { return fallback; } };

export default function App() {
  const [phrases, setPhrases] = useState<Phrase[]>(() => load('sound-lab-phrases', seed));
  const [records, setRecords] = useState<SessionRecord[]>(() => load('sound-lab-records', []));
  // 进行中的会话也会持久化：关掉页面再回来时恢复为暂停状态，可以继续计时
  const [active, setActive] = useState<ActiveSession | null>(() => {
    const a = load<ActiveSession | null>('sound-lab-active', null);
    if (!a || typeof a.accumulated !== 'number') return null;
    return phrases.some(p => p.id === a.phraseId) ? { ...a, runningSince: null } : null;
  });
  const [pendingRating, setPendingRating] = useState<PendingRecord | null>(() => load('sound-lab-pending', null));
  const [rating, setRating] = useState(0);
  const [selected, setSelected] = useState(() => {
    if (active) return active.phraseId;
    const saved = Number(localStorage.getItem('sound-lab-selected'));
    return phrases.some(p => p.id === saved) ? saved : (phrases[0]?.id ?? 0);
  });
  const [view, setView] = useState<'library' | 'records'>('library');
  const [filter, setFilter] = useState('全部');
  const [query, setQuery] = useState('');
  const [playing, setPlaying] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newText, setNewText] = useState('');
  const [now, setNow] = useState(Date.now());

  const current = phrases.find(p => p.id === selected) ?? phrases[0];
  const filtered = useMemo(() => phrases.filter(p => (filter === '全部' || p.tag === filter || p.level === filter || (filter === '待练' && p.status !== 'mastered') || (filter === '已掌握' && p.status === 'mastered')) && p.text.toLowerCase().includes(query.toLowerCase())), [phrases, filter, query]);
  const tags = ['全部', ...Array.from(new Set(phrases.map(p => p.tag)))];
  const running = !!active?.runningSince;
  const elapsed = active ? active.accumulated + (active.runningSince ? Math.floor((now - active.runningSince) / 1000) : 0) : 0;

  useEffect(() => { localStorage.setItem('sound-lab-phrases', JSON.stringify(phrases)); }, [phrases]);
  useEffect(() => { localStorage.setItem('sound-lab-records', JSON.stringify(records)); }, [records]);
  useEffect(() => { active ? localStorage.setItem('sound-lab-active', JSON.stringify(active)) : localStorage.removeItem('sound-lab-active'); }, [active]);
  useEffect(() => { pendingRating ? localStorage.setItem('sound-lab-pending', JSON.stringify(pendingRating)) : localStorage.removeItem('sound-lab-pending'); }, [pendingRating]);
  useEffect(() => { localStorage.setItem('sound-lab-selected', String(selected)); }, [selected]);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [running]);

  const startSession = () => { if (!current) return; setNow(Date.now()); setActive({ phraseId: current.id, text: current.text, startedAt: Date.now(), accumulated: 0, runningSince: Date.now() }); };
  const pauseSession = () => { if (!active?.runningSince) return; setActive({ ...active, accumulated: active.accumulated + Math.floor((Date.now() - active.runningSince) / 1000), runningSince: null }); };
  const resumeSession = () => { if (!active || active.runningSince) return; setNow(Date.now()); setActive({ ...active, runningSince: Date.now() }); };
  // 结束当前会话：有效时长不足 1 秒直接丢弃，否则先补 1-5 分自评再保存
  const finalizeSession = () => {
    if (!active) return;
    const total = active.accumulated + (active.runningSince ? Math.floor((Date.now() - active.runningSince) / 1000) : 0);
    setActive(null);
    if (total >= 1) { setRating(0); setPendingRating({ phraseId: active.phraseId, text: active.text, startedAt: active.startedAt, durationSec: total }); }
  };
  const saveRecord = () => {
    if (!pendingRating || rating < 1) return;
    setRecords(rs => [...rs, { id: Date.now(), ...pendingRating, rating }]);
    setPhrases(ps => ps.map(p => p.id === pendingRating.phraseId ? { ...p, attempts: p.attempts + 1, status: p.status === 'mastered' ? p.status : 'practice', last: '刚刚' } : p));
    setPendingRating(null);
  };
  // 切换句子前先收好当前会话，计时不会串到另一句
  const selectPhrase = (id: number) => { if (id === selected) return; finalizeSession(); setSelected(id); };
  const addPhrase = () => { if (!newText.trim()) return; const id = Date.now(); setPhrases(ps => [...ps, { id, text: newText.trim(), translation: '待补充译文', tag: '自定义', level: '入门', status: 'new', attempts: 0 }]); selectPhrase(id); setNewText(''); setShowAdd(false); };
  // 只把句子移出句子库；旧记录存的是原文快照，仍然保留
  const removePhrase = () => {
    if (!current) return;
    if (active?.phraseId === current.id) finalizeSession();
    const rest = phrases.filter(p => p.id !== current.id);
    setPhrases(rest);
    setSelected(rest[0]?.id ?? 0);
  };

  const weekStart = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }, []);
  const weekCount = records.filter(r => r.startedAt >= weekStart).length;
  const totalMin = Math.round(records.reduce((s, r) => s + r.durationSec, 0) / 60);
  const best = records.reduce((m, r) => Math.max(m, r.rating), 0);
  const streak = useMemo(() => {
    const days = new Set(records.map(r => dayKey(r.startedAt)));
    const d = new Date();
    if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (days.has(dayKey(d.getTime()))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }, [records]);

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark"><Volume2 size={19}/></div><div><strong>声线练习室</strong><span>Pronounce / practice</span></div></div><div className="side-label">我的练习</div><nav><button className={view === 'library' ? 'side-link active' : 'side-link'} onClick={() => setView('library')}><Mic size={17}/>练习库 <b>{phrases.length}</b></button><button className={view === 'records' ? 'side-link active' : 'side-link'} onClick={() => setView('records')}><Clock3 size={17}/>练习记录 <b>{records.length}</b></button><button className="side-link" onClick={() => { setView('library'); setFilter('已掌握'); }}><Check size={17}/>已掌握 <b>{phrases.filter(p => p.status === 'mastered').length}</b></button></nav><div className="sidebar-foot"><div className="streak"><span>连续练习</span><strong>{streak} <small>天</small></strong><i>{records.length ? `最近 ${fmtTime(Math.max(...records.map(r => r.startedAt)))}` : '还没有练习记录'}</i></div><div className="profile"><div className="avatar">YL</div><div><strong>Yuki Lin</strong><span>普通计划</span></div><ChevronRight size={16}/></div></div></aside>
    <main className="main"><header className="topbar"><div><p className="eyebrow">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase()}</p><h1>今天练什么？</h1></div><div className="top-actions"><div className="search"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索句子"/></div><button className="primary" onClick={() => setShowAdd(true)}><Plus size={17}/>添加句子</button></div></header>
      <section className="stats"><div><span>本周完成</span><strong>{weekCount} <em>/ 20</em></strong><div className="progress"><i style={{width: `${Math.min(100, weekCount / 20 * 100)}%`}}/></div></div><div><span>练习时长</span><strong>{totalMin} <em>分钟</em></strong><small>共 {records.length} 次练习</small></div><div><span>最高自评</span><strong>{best || '—'} <em>分</em></strong><small className="green">满分 5 分</small></div></section>
      <div className="content-grid">
        {view === 'records' ? <section className="library records-wide"><div className="section-head"><div><h2>练习记录</h2><p>每次练习的句子、开始时间、有效时长和自评</p></div></div><div className="record-list">{records.length === 0 && <div className="empty">还没有练习记录，完成一次练习后会出现在这里</div>}{[...records].reverse().map(r => <div key={r.id} className="record-item"><div className="record-item-main"><strong>{r.text}</strong><span>{fmtTime(r.startedAt)} 开始 · 有效时长 {fmtClock(r.durationSec)}</span></div><div className="record-stars">{[1,2,3,4,5].map(n => <Star key={n} size={14} className={n <= r.rating ? 'on' : 'off'} fill="currentColor"/>)}</div></div>)}</div></section>
        : <>
        <section className="library"><div className="section-head"><div><h2>句子库</h2><p>选择一句开始你的声音训练</p></div><button className="ghost" onClick={() => setFilter('待练')}>只看待练</button></div><div className="filters">{tags.map(t => <button key={t} className={filter === t ? 'chip active' : 'chip'} onClick={() => setFilter(t)}>{t}</button>)}</div><div className="phrase-list">{filtered.map(p => <button key={p.id} onClick={() => selectPhrase(p.id)} className={p.id === selected ? 'phrase selected' : 'phrase'}><div className="phrase-icon">{p.status === 'mastered' ? <Check size={15}/> : <Mic size={15}/>}</div><div className="phrase-copy"><strong>{p.text}</strong><span>{p.translation}</span><div className="phrase-meta"><i>{p.tag}</i><i>{p.level}</i>{p.attempts > 0 && <small>{p.attempts} 次练习</small>}</div></div><ChevronRight size={17}/></button>)}{filtered.length === 0 && <div className="empty">没有找到匹配句子</div>}</div></section>
        {current && <section className="practice"><div className="practice-head"><div><span className="label">CURRENT PHRASE</span><h2>跟着感觉读</h2></div><button className="icon-btn" onClick={removePhrase} title="删除句子"><Trash2 size={17}/></button></div><div className="focus-card"><div className="focus-tag">{current.tag} · {current.level}</div><p className="focus-text">{current.text}</p><p className="focus-translation">{current.translation}</p><div className="audio-sample"><button className="round-btn" onClick={() => setPlaying(!playing)}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button><div className="sample-wave">{bars.map((h,i) => <i key={i} style={{height: `${h * (playing ? 1.15 : 0.72)}%`}}/> )}</div><span>0:08</span></div></div><div className="record-card"><div className="record-top"><div><span className="label">PRACTICE SESSION</span><h3>{!active ? '准备好后开始练习' : running ? '计时中，暂停不计入时长' : '已暂停，继续后接着计时'}</h3></div><span className="record-time">{fmtClock(elapsed)}</span></div><div className="record-wave">{bars.slice(5,58).map((h,i) => <i key={i} className={running ? 'live' : ''} style={{height: `${h * (running ? (0.4 + ((i%5)/7)) : 0.4)}%`}}/> )}</div><div className="record-actions">{!active && <button className="record-button" onClick={startSession}><span><Mic size={16}/></span>开始练习</button>}{running && <button className="record-button recording" onClick={pauseSession}><span><Pause size={16}/></span>暂停</button>}{active && !running && <button className="record-button" onClick={resumeSession}><span><Play size={16}/></span>继续</button>}{active && <button className="secondary" onClick={finalizeSession}><Check size={15}/>结束并评分</button>}</div>{active && <p className="session-note">本次会话开始于 {fmtTime(active.startedAt)} · 可分多段进行，只累计有效时长</p>}</div><div className="tip"><span>练习小贴士</span><p>放慢速度，先把每个音节读清楚，再自然地连起来。</p><RotateCcw size={15}/></div></section>}
        </>}
      </div>
    </main>{showAdd && <div className="modal-backdrop" onClick={() => setShowAdd(false)}><div className="modal" onClick={e => e.stopPropagation()}><div className="modal-head"><h2>添加练习句子</h2><button className="icon-btn" onClick={() => setShowAdd(false)}>×</button></div><label>英文句子<textarea autoFocus value={newText} onChange={e => setNewText(e.target.value)} placeholder="例如：I can make this happen."/></label><div className="modal-actions"><button className="secondary" onClick={() => setShowAdd(false)}>取消</button><button className="primary" onClick={addPhrase}>加入句子库</button></div></div></div>}
    {pendingRating && <div className="modal-backdrop"><div className="modal"><div className="modal-head"><h2>本次练习怎么样？</h2></div><p className="rating-phrase">{pendingRating.text}</p><p className="rating-meta">{fmtTime(pendingRating.startedAt)} 开始 · 有效时长 {fmtClock(pendingRating.durationSec)}</p><div className="stars">{[1,2,3,4,5].map(n => <button key={n} className={n <= rating ? 'star on' : 'star'} onClick={() => setRating(n)}><Star size={28} fill="currentColor"/></button>)}</div><div className="modal-actions"><button className="primary" disabled={rating < 1} onClick={saveRecord}>保存{rating > 0 ? ` ${rating} 分` : ''}记录</button></div></div></div>}
  </div>;
}
