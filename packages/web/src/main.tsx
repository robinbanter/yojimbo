import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Hit = {
  blobId: string;
  memory: { kind: string; id: string; text: string; createdAt: string; supersedes?: string; action?: string };
};
type Decision = {
  mode: string;
  action: string;
  amountUsdc: number;
  quote: string;
  recalledBlobIds: string[];
  nextWindow: string | null;
  alertRatio: number;
};
type EventRow = {
  id: string;
  at: string;
  beforeRatio: number;
  afterRatio: number | null;
  suiPrice: number;
  mode: string;
  action: string;
  amountUsdc: number;
  outcome: string;
  txDigest: string | null;
  ruleIds: string[];
  recalledBlobIds: string[];
  memoryBlobId?: string;
};
type Status = {
  rpc: string;
  memory: string;
  telegram: string;
  openRouter: string;
  wallet: string | null;
  balanceMist: string | null;
  usdcBalance: string | null;
  mainnetWrites: boolean;
  watcherError: string | null;
  pending: string[];
};
type Message = { role: string; text: string };
type RecentManager = {managerId:string;owner:string;pool:string;lastActivity:string;activity:string;riskRatio:number;liquidationRatio:number};

const api = (path: string) =>
  fetch(`/api${path}`).then(async (r) => {
    const v = await r.json();
    if (!r.ok) throw new Error(String(v.error || `HTTP ${r.status}`).replace(/^Error:\s*/, ''));
    return v;
  });
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
const KIND_LABEL: Record<string, string> = { schedule: 'Schedule', rule: 'Rule', override: 'Your correction' };

function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [position, setPosition] = useState<any>(null);
  const [registry, setRegistry] = useState<any>(null);
  const [memory, setMemory] = useState<Hit[]>([]);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [approval, setApproval] = useState<{ id: string; decision: Decision } | null>(null);
  const [notifications, setNotifications] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [trace, setTrace] = useState<any[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [source, setSource] = useState<'bot'|'watch'>('watch');
  const [managers, setManagers] = useState<RecentManager[]>([]);
  const [watchId, setWatchId] = useState('');
  const [pastedId, setPastedId] = useState('');
  const [watched, setWatched] = useState<any>(null);
  const [dryRun, setDryRun] = useState('');

  const refresh = async () => {
    const requests: [string, string, (v: any) => void][] = [
      ['status', '/status', setStatus],
      ['position', '/position', setPosition],
      ['registry', '/registry', setRegistry],
      [
        'memory',
        '/memory',
        (v) => {
          setMemory(v.hits);
          setDecision(v.decision);
        },
      ],
      ['events', '/events', (v) => setEvents(v.events)],
      ['managers', '/managers/recent', (v) => setManagers(v.managers)],
    ];
    await Promise.all(
      requests.map(async ([name, path, save]) => {
        try {
          save(await api(path));
          setErrors((e) => ({ ...e, [name]: '' }));
        } catch (e) {
          setErrors((v) => ({ ...v, [name]: String((e as Error).message ?? e) }));
        }
      }),
    );
  };

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 15_000);
    const stream = new EventSource('/api/stream');
    stream.addEventListener('notification', (e) =>
      setNotifications((v) => [JSON.parse((e as MessageEvent).data).message, ...v].slice(0, 20)),
    );
    stream.addEventListener('approval', (e) => setApproval(JSON.parse((e as MessageEvent).data)));
    stream.addEventListener('trace', (e) => setTrace((v) => [JSON.parse((e as MessageEvent).data), ...v].slice(0, 30)));
    stream.addEventListener('event', () => void refresh());
    stream.addEventListener('memory', () => void refresh());
    return () => {
      clearInterval(id);
      stream.close();
    };
  }, []);
  useEffect(()=>{if(source==='watch'&&!watchId&&managers.length)setWatchId(managers[0].managerId);},[source,watchId,managers]);
  useEffect(()=>{
    if(source!=='watch'||!watchId)return;
    const load=async()=>{try{setWatched(await api(`/watch/${watchId}`));setErrors(e=>({...e,watch:''}));}catch(e){setWatched(null);setErrors(v=>({...v,watch:String((e as Error).message??e)}));}};
    void load();const id=setInterval(load,15_000);return()=>clearInterval(id);
  },[source,watchId]);

  const send = async (preset?: string) => {
    const text = (preset ?? draft).trim();
    if (!text || busy) return;
    setDraft('');
    setBusy(true);
    setMessages((v) => [...v, { role: 'you', text }]);
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text,watchManagerId:source==='watch'?watchId:undefined }),
      });
      if (!response.body) throw new Error('No stream');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';
        for (const chunk of chunks) {
          const type = /event: ([^\n]+)/.exec(chunk)?.[1];
          const raw = /data: (.+)/.exec(chunk)?.[1];
          if (!type || !raw) continue;
          const data = JSON.parse(raw);
          if (type === 'message') setMessages((v) => [...v, { role: 'yojimbo', text: data.text }]);
          if (type === 'error') setMessages((v) => [...v, { role: 'error', text: data.message }]);
          if (type === 'tool' || type === 'tool_result') setTrace((v) => [{ type, ...data }, ...v].slice(0, 40));
        }
      }
    } catch (e) {
      setMessages((v) => [...v, { role: 'error', text: String((e as Error).message ?? e) }]);
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const decideApproval = async (choice: string) => {
    if (!approval) return;
    try {
      const r = await fetch('/api/decision', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: approval.id, choice }),
      });
      const v = await r.json();
      if (!r.ok) throw new Error(v.error);
      setApproval(null);
      void refresh();
    } catch (e) {
      setNotifications((v) => [String((e as Error).message ?? e), ...v]);
    }
  };

  const visiblePosition=source==='watch'?watched:position;
  const visibleRegistry=source==='watch'?watched?.thresholds:registry;
  const visibleDecision:Decision|null=source==='watch'?watched?.decision??null:decision;
  const state = visiblePosition?.state;
  const ratio: number | undefined = state?.riskRatio;
  const alert = visibleDecision?.alertRatio ?? 1.5;
  const liquidation: number | undefined = visibleRegistry?.liquidation;
  const minBorrow: number | undefined = visibleRegistry?.minBorrow;
  const pos = (v: number | undefined) => (v == null ? 0 : Math.max(0, Math.min(100, ((v - 1) / 1.5) * 100)));
  const kept = memory.filter((h) => ['schedule', 'rule', 'override'].includes(h.memory.kind));
  const memorySetup = status?.memory?.startsWith('Setup required');
  const dryRunDefence=async()=>{
    if(!watchId)return;
    try{const response=await fetch(`/api/watch/${watchId}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'dry-run'})});const result=await response.json();setDryRun(response.ok?JSON.stringify(result):String(result.error));}catch(e){setDryRun(String((e as Error).message??e));}
  };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <img src="/art/yojimbo-mark.webp" alt="" width={36} height={36} />
          <span>
            Yojimbo <em>用心棒</em>
          </span>
        </div>
        <span className={status?.mainnetWrites ? 'badge live' : 'badge'}>
          {status?.mainnetWrites ? 'Real funds' : 'Dry-run only'}
        </span>
      </header>

      <section className="hero">
        <img
          className="hero-art"
          src="/art/yojimbo-hero.webp"
          alt="A ronin keeps night watch on a rainy veranda beside a sleeping figure, a red lantern glowing"
          width={1536}
          height={1024}
        />
        <div className="hero-copy">
          <p className="eyebrow">DeepBook Margin · Sui mainnet</p>
          <h1>A bodyguard for your leverage while you sleep.</h1>
          <p>
            Tell it when you sleep, fly or work, and how you want to be defended. It watches your margin
            account, acts within your rules when you’re away, asks first when you’re awake, and remembers
            every time you overrule it.
          </p>
        </div>
      </section>

      <section className="status" aria-label="Setup">
        {status ? (
          <>
            <Pill warn={status.rpc.startsWith('dev')} label="Chain reads" value={status.rpc} />
            <Pill warn={memorySetup} label="Memory" value={status.memory} />
            <Pill warn={!status.wallet} label="Bot wallet" value={status.wallet ? short(status.wallet) : 'Setup required: YOJIMBO_BOT_KEY'} />
            <Pill
              label="Bot balance"
              value={`${status.balanceMist ? (Number(status.balanceMist) / 1e9).toFixed(3) + ' SUI' : '—'} · ${status.usdcBalance ? (Number(status.usdcBalance) / 1e6).toFixed(2) + ' USDC' : '—'}`}
            />
            <Pill warn={status.telegram.startsWith('Setup')} label="Telegram" value={status.telegram} />
            <Pill warn={status.openRouter.startsWith('Setup')} label="Agent model" value={status.openRouter} />
          </>
        ) : (
          <span className="muted">Connecting…</span>
        )}
      </section>

      {approval && (
        <section className="approval" role="alert">
          <div>
            <b>Yojimbo is asking before it acts</b>
            <p>
              {approval.decision.action}: “{approval.decision.quote}”
            </p>
          </div>
          <div className="approval-actions">
            <button className="primary" onClick={() => decideApproval('approve')}>
              Approve
            </button>
            <button onClick={() => decideApproval('reduce')}>Reduce</button>
            <button onClick={() => decideApproval('ignore')}>Ignore</button>
          </div>
        </section>
      )}

      <main className="grid">
        <section className="card guard" aria-labelledby="guard-title">
          <h2 id="guard-title">On guard</h2>
          <div className="status" aria-label="Position source">
            <button className={source==='bot'?'primary':''} onClick={()=>setSource('bot')}>Bot wallet</button>
            <button className={source==='watch'?'primary':''} onClick={()=>setSource('watch')}>Watch a position</button>
          </div>
          {source==='watch'&&<>
            <p className="pill">Recent real SUI/USDC managers · closest to liquidation first</p>
            {managers.map(m=><button className="event" key={m.managerId} onClick={()=>{setWatched(null);setWatchId(m.managerId);setDryRun('');}}>{short(m.managerId)} · risk {m.riskRatio.toFixed(3)} · last {new Date(m.lastActivity).toLocaleString()}</button>)}
            {errors.managers&&<p className="error">{errors.managers}</p>}
            <form onSubmit={e=>{e.preventDefault();setWatched(null);setWatchId(pastedId.trim());setDryRun('');}}>
              <input value={pastedId} onChange={e=>setPastedId(e.target.value)} placeholder="Paste a MarginManager ID" aria-label="MarginManager ID" />
              <button className="primary">Watch</button>
            </form>
            {watched&&<p className="pill warn">Watching {short(watched.managerId)} (read-only, not yours: Yojimbo can't act on it)</p>}
          </>}
          {state ? (
            <>
              <div className="ratio">
                <b className="num">{Number(ratio).toFixed(3)}</b>
                <span>risk ratio (assets ÷ debt)</span>
              </div>
              <div className="gauge" aria-label="Risk ratio against liquidation, minimum borrow and your alert line">
                <div className="gauge-fill" style={{ width: `${pos(ratio)}%` }} />
                <i className="line-liq" style={{ left: `${pos(liquidation)}%` }} />
                <i className="line-borrow" style={{ left: `${pos(minBorrow)}%` }} />
                <i className="line-alert" style={{ left: `${pos(alert)}%` }} />
              </div>
              <div className="legend">
                <span className="liq">Liquidation {liquidation?.toFixed(2) ?? '—'}</span>
                <span>Min borrow {minBorrow?.toFixed(2) ?? '—'}</span>
                <span className="al">Your alert {alert.toFixed(2)}</span>
              </div>
              <dl className="facts">
                <Fact k="SUI price" v={`$${visiblePosition.price?.toFixed(4) ?? '—'}`} />
                {source==='watch'&&<Fact k="USDC oracle" v={`$${watched.quotePrice?.toFixed(4) ?? '—'}`} />}
                <Fact k="Collateral" v={`${state.baseAsset} SUI`} />
                <Fact k="Quote held" v={`${state.quoteAsset} USDC`} />
                <Fact k="Debt" v={`${state.quoteDebt} USDC`} />
                <Fact k="Mode now" v={visibleDecision?.mode ?? 'Memory setup required'} />
                <Fact k="Next window" v={visibleDecision?.nextWindow ?? '—'} />
              </dl>
              <a className="link" target="_blank" rel="noreferrer" href={`https://suiscan.xyz/mainnet/object/${visiblePosition.managerId}`}>
                MarginManager {short(visiblePosition.managerId)} ↗
              </a>
              {source==='watch'&&<>
                <article className="event">
                  <b>What Yojimbo would do right now</b>
                  <p className="muted small">{watched.decisionSource}</p>
                  <p>{visibleDecision?.mode} · {visibleDecision?.action} · {visibleDecision?.amountUsdc} USDC</p>
                  <p>“{visibleDecision?.quote}”</p>
                  <button className="primary" onClick={dryRunDefence}>Dry-run the defence</button>
                  {dryRun&&<p className="notice">{dryRun}</p>}
                </article>
                <article className="event"><b>Nearby positions at liquidation</b><p>{managers.filter(m=>m.riskRatio<=m.liquidationRatio).length ? managers.filter(m=>m.riskRatio<=m.liquidationRatio).map(m=>`${short(m.managerId)} (${m.riskRatio.toFixed(3)})`).join(', ') : 'None in the recent live sample.'}</p></article>
              </>}
            </>
          ) : (
            <Empty
              art="/art/yojimbo-empty-1.webp"
              title="Nothing to guard yet"
              text={(source==='watch'?errors.watch:errors.position) || (source==='watch'?'Select a recent manager or paste its ID.':'No bot-owned MarginManager found. Fund the bot wallet and open a small SUI/USDC position to start guarding.')}
            />
          )}
          {visibleRegistry && (
            <p className="muted small">
              Live pool thresholds from mainnet: liquidation {liquidation?.toFixed(2)}, min borrow {minBorrow?.toFixed(4)}.
            </p>
          )}
          {errors.registry&&source==='bot' && <p className="error">Registry: {errors.registry}</p>}
        </section>

        <section className="card chat-card" aria-labelledby="chat-title">
          <h2 id="chat-title">Talk to your bodyguard</h2>
          <div className="chat" aria-live="polite">
            {messages.length ? (
              messages.map((m, i) => (
                <div className={`message ${m.role}`} key={i}>
                  <b>{m.role === 'yojimbo' ? 'Yojimbo' : m.role === 'you' ? 'You' : 'Error'}</b>
                  <p>{m.text}</p>
                </div>
              ))
            ) : (
              <div className="starters">
                <p className="muted">Tell it your life and your rules. Try:</p>
                {[
                  'I sleep 01:00 to 08:00 IST every day',
                  'At night add collateral, never close the position',
                  'If the ratio drops under 1.3, cut half',
                  'What is my risk right now?',
                ].map((s) => (
                  <button key={s} className="starter" onClick={() => send(s)} disabled={busy}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. Flying Tuesday 10:00 to 16:00 IST"
              aria-label="Message Yojimbo"
            />
            <button className="primary" disabled={busy}>
              {busy ? 'Thinking…' : 'Send'}
            </button>
          </form>
          <details className="trace" open={trace.length > 0}>
            <summary>Tool calls ({trace.length})</summary>
            {trace.map((t, i) => (
              <pre key={i}>{JSON.stringify(t, null, 2)}</pre>
            ))}
          </details>
        </section>

        <section className="card memory-card" aria-labelledby="memory-title">
          <h2 id="memory-title">
            What it remembers <small>Walrus mainnet</small>
          </h2>
          {errors.memory && <p className="error">{errors.memory}</p>}
          {visibleDecision && (
            <p className="recalled">
              <b>RECALLED {visibleDecision.recalledBlobIds.length}</b> · next move: {visibleDecision.action} · “{visibleDecision.quote}”
            </p>
          )}
          {kept.length ? (
            kept.map((h) => {
              const old = h.memory.supersedes ? memory.find((x) => x.memory.id === h.memory.supersedes) : undefined;
              return (
                <article className={`memory kind-${h.memory.kind}`} key={h.blobId}>
                  <span className="type">{KIND_LABEL[h.memory.kind] ?? h.memory.kind}</span>
                  <p>{h.memory.text}</p>
                  {h.memory.supersedes && (
                    <p className="supersedes">
                      replaces: <s>{old?.memory.text ?? h.memory.supersedes}</s>
                    </p>
                  )}
                  <a target="_blank" rel="noreferrer" href={`https://walruscan.com/mainnet/blob/${h.blobId}`}>
                    {short(h.blobId)} ↗
                  </a>
                </article>
              );
            })
          ) : (
            <Empty
              art="/art/yojimbo-empty-2.webp"
              title={memorySetup ? 'Setup required: Walrus Memory' : 'No rules yet'}
              text="Your schedule, rules and corrections are stored on Walrus. Every defence quotes the one it followed."
            />
          )}
        </section>

        <section className="card events-card" aria-labelledby="events-title">
          <h2 id="events-title">Night log</h2>
          {notifications.map((n, i) => (
            <p className="notice" key={i}>
              {n}
            </p>
          ))}
          {events.length ? (
            events.map((e) => (
              <article className="event" key={e.id}>
                <div className="event-top">
                  <b>
                    {e.action} {e.amountUsdc} USDC
                  </b>
                  <span className="muted small">{new Date(e.at).toLocaleString()}</span>
                </div>
                <p className="num">
                  {e.beforeRatio.toFixed(3)} → {e.afterRatio?.toFixed(3) ?? 'not executed'} · SUI ${e.suiPrice.toFixed(4)} · {e.mode} · {e.outcome}
                </p>
                <p className="small muted">
                  RECALLED {e.recalledBlobIds.length} · rules {e.ruleIds.join(', ') || 'none'}
                </p>
                <div className="links">
                  {e.txDigest && (
                    <a target="_blank" rel="noreferrer" href={`https://suiscan.xyz/mainnet/tx/${e.txDigest}`}>
                      transaction ↗
                    </a>
                  )}
                  {e.memoryBlobId && (
                    <a target="_blank" rel="noreferrer" href={`https://walruscan.com/mainnet/blob/${e.memoryBlobId}`}>
                      event memory ↗
                    </a>
                  )}
                </div>
              </article>
            ))
          ) : (
            <Empty
              art="/art/yojimbo-object-1.webp"
              title="A quiet night"
              text="Every defence lands here with its before and after ratio, the rule it followed and the transaction."
            />
          )}
        </section>
      </main>

      <footer className="foot">
        Positions: DeepBook Margin on Sui mainnet · chain reads: {status?.rpc??'Setup required'} · memory: Walrus Memory · art generated
        with ChatGPT.
      </footer>
    </div>
  );
}

function Pill({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <span className={`pill ${warn ? 'warn' : ''}`}>
      <small>{label}</small>
      {value}
    </span>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd className="num">{v}</dd>
    </div>
  );
}

function Empty({ art, title, text }: { art: string; title: string; text: string }) {
  return (
    <div className="empty">
      <img src={art} alt="" width={88} height={88} />
      <div>
        <b>{title}</b>
        <p>{text}</p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
