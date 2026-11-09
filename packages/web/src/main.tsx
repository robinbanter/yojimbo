import React, { useEffect, useMemo, useRef, useState } from 'react';
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
type RecentManager = { managerId: string; owner: string; pool: string; lastActivity: string; activity: string; riskRatio: number; liquidationRatio: number };
type Cushion = { kind: 'none' } | { kind: 'at' } | { kind: 'move'; price: number; move: number; tier: 'danger' | 'watch' | 'safe' };

const api = (path: string) =>
  fetch(`/api${path}`).then(async (r) => {
    const v = await r.json();
    if (!r.ok) throw new Error(String(v.error || `HTTP ${r.status}`).replace(/^Error:\s*/, ''));
    return v;
  });
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
const KIND_LABEL: Record<string, string> = { schedule: 'Schedule', rule: 'Rule', override: 'Your correction' };
const STARTERS = [
  'How close is the position I am watching to liquidation?',
  'I sleep 01:00 to 08:00 IST every day',
  'At night add collateral, never close the position',
  'If the ratio drops under 1.3, cut half',
];

const BAND = [
  {
    art: '/art/yojimbo-feature-2.webp',
    title: 'Learns your hours',
    text: 'Say when you sleep, fly or work. Each schedule is kept as a memory on Walrus and decides whether Yojimbo asks first or guards alone.',
  },
  {
    art: '/art/yojimbo-feature-3.webp',
    title: 'Keeps your orders',
    text: 'Rules and every correction you make are recalled before each decision, and each defence quotes the rule it followed.',
  },
  {
    art: '/art/yojimbo-feature-1.webp',
    title: 'Steps in within caps',
    text: 'Adds USDC collateral, trims with a reduce-only order or repays debt, from its own bot wallet only and never above the per-action cap.',
  },
];

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s)) return '—';
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const ratioTier = (r: number, liq: number) => (r <= liq ? 'bad' : r < 1.25 ? 'warn' : r < 1.5 ? 'mid' : 'ok');

/** "Setup required: A / B" → { setup: true, vars: "A / B" } so the variable names can sit in mono under a clear label. */
const splitSetup = (v: string) => {
  const m = /^Setup required:\s*(.+)$/.exec(v);
  return m ? { setup: true, title: 'Setup required', detail: m[1] } : { setup: false, title: v, detail: '' };
};

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
  const [source, setSource] = useState<'bot' | 'watch'>('watch');
  const [managers, setManagers] = useState<RecentManager[] | null>(null);
  const [watchId, setWatchId] = useState('');
  const [pastedId, setPastedId] = useState('');
  const [watched, setWatched] = useState<any>(null);
  const [dryRun, setDryRun] = useState<{ ok: boolean; text: string } | null>(null);
  const [dryBusy, setDryBusy] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  // The looping hero film is optional: it is skipped under reduced motion and dropped if the file is missing,
  // leaving the still poster image underneath.
  const [heroVideo, setHeroVideo] = useState(() => !matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => mq.matches && setHeroVideo(false);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

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
    stream.addEventListener('trace', (e) => setTrace((v) => [{ type: 'decision', ...JSON.parse((e as MessageEvent).data) }, ...v].slice(0, 30)));
    stream.addEventListener('event', () => void refresh());
    stream.addEventListener('memory', () => void refresh());
    return () => {
      clearInterval(id);
      stream.close();
    };
  }, []);
  useEffect(() => {
    if (source === 'watch' && !watchId && managers?.length) setWatchId(managers[0].managerId);
  }, [source, watchId, managers]);
  useEffect(() => {
    if (source !== 'watch' || !watchId) return;
    const load = async () => {
      try {
        setWatched(await api(`/watch/${watchId}`));
        setErrors((e) => ({ ...e, watch: '' }));
      } catch (e) {
        setWatched(null);
        setErrors((v) => ({ ...v, watch: String((e as Error).message ?? e) }));
      }
    };
    void load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [source, watchId]);
  useEffect(() => {
    const el = chatEnd.current?.parentElement;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [messages, busy]);

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
        body: JSON.stringify({ message: text, watchManagerId: source === 'watch' ? watchId : undefined }),
      });
      if (!response.body) throw new Error('No stream');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      while (!finished) {
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
          if (type === 'done') {
            finished = true;
            void reader.cancel().catch(() => {});
          }
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

  const visiblePosition = source === 'watch' ? watched : position;
  const visibleRegistry = source === 'watch' ? watched?.thresholds : registry;
  const visibleDecision: Decision | null = source === 'watch' ? watched?.decision ?? null : decision;
  const state = visiblePosition?.state;
  const ratio: number | undefined = state?.riskRatio;
  const alert = visibleDecision?.alertRatio ?? 1.5;
  const liquidation: number | undefined = visibleRegistry?.liquidation;
  const minBorrow: number | undefined = visibleRegistry?.minBorrow;
  // SUI price at which the risk ratio hits the liquidation line, from the position's own on-chain balances and
  // Pyth prices: (base*p + quote*q) / (quoteDebt*q + baseDebt*p) = L  =>  p = q*(L*quoteDebt - quote) / (base - L*baseDebt).
  const cushion: Cushion | null = (() => {
    if (!state || liquidation == null) return null;
    const p = Number(state.basePythPrice) / 10 ** Number(state.basePythDecimals);
    const q = Number(state.quotePythPrice) / 10 ** Number(state.quotePythDecimals);
    const base = Number(state.baseAsset), quote = Number(state.quoteAsset), bd = Number(state.baseDebt), qd = Number(state.quoteDebt);
    if (![p, q, base, quote, bd, qd].every(Number.isFinite) || p <= 0) return null;
    if (bd === 0 && qd === 0) return { kind: 'none' };
    if (Number(ratio) <= liquidation) return { kind: 'at' };
    const denom = base - liquidation * bd;
    if (denom === 0) return { kind: 'none' };
    const price = (q * (liquidation * qd - quote)) / denom;
    if (price <= 0) return { kind: 'none' };
    const move = price / p - 1;
    return { kind: 'move', price, move, tier: Math.abs(move) < 0.03 ? 'danger' : Math.abs(move) < 0.1 ? 'watch' : 'safe' };
  })();
  const tier = cushion ? (cushion.kind === 'move' ? cushion.tier : cushion.kind === 'at' ? 'danger' : 'safe') : null;
  const tierWord = tier === 'danger' ? (cushion?.kind === 'at' ? 'Liquidatable' : 'Danger') : tier === 'watch' ? 'Watch' : tier === 'safe' ? 'Safe' : '';
  const pos = (v: number | undefined) => (v == null ? 0 : Math.max(0, Math.min(100, ((v - 1) / 1.5) * 100)));
  const kept = memory.filter((h) => ['schedule', 'rule', 'override'].includes(h.memory.kind));
  const memorySetup = status?.memory?.startsWith('Setup required');
  const atLiq = (managers ?? []).filter((m) => m.riskRatio <= m.liquidationRatio);
  const dryRunDefence = async () => {
    if (!watchId || dryBusy) return;
    setDryBusy(true);
    try {
      const response = await fetch(`/api/watch/${watchId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'dry-run' }) });
      const result = await response.json();
      setDryRun(response.ok ? { ok: true, text: result.outcome ? String(result.outcome) : JSON.stringify(result) } : { ok: false, text: String(result.error) });
    } catch (e) {
      setDryRun({ ok: false, text: String((e as Error).message ?? e) });
    } finally {
      setDryBusy(false);
    }
  };
  const selectManager = (id: string) => {
    setWatched(null);
    setWatchId(id);
    setDryRun(null);
  };
  const steps = useMemo(() => buildSteps([...trace].reverse()), [trace]);

  return (
    <div className="app">
      <a className="skip" href="#desk">
        Skip to the guard desk
      </a>
      <header className="top">
        <a className="brand" href="#top" aria-label="Yojimbo home">
          <img src="/art/yojimbo-mark.webp" alt="" width={34} height={34} />
          <span>
            Yojimbo <em lang="ja">用心棒</em>
          </span>
        </a>
        <nav className="top-nav" aria-label="Sections">
          <a href="#desk">Guard desk</a>
          <a href="#chat">Chat</a>
          <a href="#memory">Memory</a>
          <a href="#log">Night log</a>
        </nav>
        <div className="top-right">
          <span className={`mode-pill ${status?.mainnetWrites ? 'live' : ''}`}>
            <i aria-hidden="true" />
            {status ? (status.mainnetWrites ? 'Real funds' : 'Dry-run only') : 'Connecting…'}
          </span>
        </div>
      </header>

      <section className="hero" id="top" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="dot" aria-hidden="true" /> DeepBook Margin · Sui mainnet
          </p>
          <h1 id="hero-title">
            A bodyguard for your leverage <em>while you sleep.</em>
          </h1>
          <p className="lede">
            Tell Yojimbo in chat how to defend you while you sleep or fly. It keeps your rules on Walrus Memory, watches your
            margin position, asks first when you’re awake and acts within your caps when you’re not.
          </p>
          <div className="hero-cta">
            <a className="btn primary" href="#desk">
              Open guard desk
            </a>
            <a className="btn ghost" href="#chat">
              Talk to Yojimbo
            </a>
          </div>
        </div>
        <figure className="hero-art">
          <img
            src="/art/yojimbo-hero.webp"
            alt="A ronin keeps night watch on a rainy veranda beside a sleeping figure, a red lantern glowing"
            width={1536}
            height={1024}
          />
          {heroVideo && (
            <video
              autoPlay
              muted
              loop
              playsInline
              poster="/art/yojimbo-hero.webp"
              src="/art/yojimbo-hero-loop.mp4"
              aria-hidden="true"
              onError={() => setHeroVideo(false)}
            />
          )}
          <figcaption className="hero-widget" aria-live="polite">
            <div className="hw-head">
              <span className="live-dot" aria-hidden="true" />
              <span>{source === 'watch' ? 'On guard · live from Sui mainnet' : 'Bot wallet'}</span>
            </div>
            {state ? (
              <>
                <div className="hw-row">
                  <span className="hw-ratio">{Number(ratio).toFixed(3)}</span>
                  <span className="hw-label">
                    risk ratio
                    <br />
                    <span className="mono">{short(visiblePosition.managerId)}</span>
                  </span>
                </div>
                {cushion?.kind === 'move' && (
                  <p className={`hw-cushion t-${tier}`}>
                    <b>{tierWord}</b> SUI {cushion.move < 0 ? '−' : '+'}
                    {Math.abs(cushion.move * 100).toFixed(1)}% to liquidation
                  </p>
                )}
                {cushion?.kind === 'at' && <p className="hw-cushion t-danger"><b>Liquidatable</b> at or below the line now</p>}
                {cushion?.kind === 'none' && <p className="hw-cushion t-safe"><b>Safe</b> no SUI move alone liquidates it</p>}
              </>
            ) : (source === 'watch' ? errors.watch || errors.managers : errors.position) ? (
              <p className="hw-err">{source === 'watch' ? errors.watch || errors.managers : errors.position}</p>
            ) : (
              <div className="hw-loading" aria-label="Reading mainnet">
                <span />
                <span />
              </div>
            )}
          </figcaption>
        </figure>
      </section>

      <section className="status" aria-label="Setup">
        {status ? (
          <>
            <StatusCell label="Chain reads" value={status.rpc} warn={status.rpc.startsWith('dev') || status.rpc.startsWith('Setup')} />
            <StatusCell label="Agent model" value={status.openRouter === 'ready' ? 'Ready' : status.openRouter} warn={status.openRouter.startsWith('Setup')} />
            <StatusCell label="Memory" value={status.memory} warn={memorySetup} />
            <StatusCell label="Bot wallet" value={status.wallet ? short(status.wallet) : 'Setup required: YOJIMBO_BOT_KEY'} warn={!status.wallet} mono={!!status.wallet} />
            <StatusCell
              label="Bot balance"
              value={`${status.balanceMist ? (Number(status.balanceMist) / 1e9).toFixed(3) + ' SUI' : '— SUI'} · ${status.usdcBalance ? (Number(status.usdcBalance) / 1e6).toFixed(2) + ' USDC' : '— USDC'}`}
              warn={!status.wallet}
            />
            <StatusCell label="Telegram" value={status.telegram} warn={status.telegram.startsWith('Setup')} />
          </>
        ) : errors.status ? (
          <p className="error">Server unreachable: {errors.status}</p>
        ) : (
          <p className="muted">Connecting to the Yojimbo server…</p>
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
            <button className="btn light" onClick={() => decideApproval('approve')}>
              Approve
            </button>
            <button className="btn outline-light" onClick={() => decideApproval('reduce')}>
              Reduce
            </button>
            <button className="btn outline-light" onClick={() => decideApproval('ignore')}>
              Ignore
            </button>
          </div>
        </section>
      )}

      <main className="desk" id="desk">
        <section className="panel watchlist" aria-labelledby="guard-title">
          <div className="panel-head">
            <h2 id="guard-title">On guard</h2>
            <span className="count">{source === 'watch' ? `${managers?.length ?? 0} live` : 'yours'}</span>
          </div>
          <div className="seg" role="group" aria-label="Position source">
            <button aria-pressed={source === 'watch'} className={source === 'watch' ? 'on' : ''} onClick={() => setSource('watch')}>
              Watch a position
            </button>
            <button aria-pressed={source === 'bot'} className={source === 'bot' ? 'on' : ''} onClick={() => setSource('bot')}>
              Bot wallet
            </button>
          </div>
          {source === 'watch' ? (
            <>
              <p className="caption">Recent real SUI/USDC managers on mainnet, closest to liquidation first. Risk ratio = assets ÷ debt.</p>
              {managers === null && !errors.managers ? (
                <div className="mgr-skeleton" aria-label="Loading managers">
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} />
                  ))}
                </div>
              ) : managers && managers.length ? (
                <div className="mgrs" role="list">
                  {managers.map((m, i) => (
                    <button
                      role="listitem"
                      aria-current={watchId === m.managerId ? 'true' : undefined}
                      className={`mgr ${watchId === m.managerId ? 'on' : ''}`}
                      key={m.managerId}
                      onClick={() => selectManager(m.managerId)}
                      title={`${m.managerId}\nLast activity ${new Date(m.lastActivity).toLocaleString()} (${m.activity})`}
                    >
                      <span className="mgr-rank">{String(i + 1).padStart(2, '0')}</span>
                      <span className="mgr-id">
                        <span className="mono">{short(m.managerId)}</span>
                        <small>{ago(m.lastActivity)}</small>
                      </span>
                      <span className={`risk r-${ratioTier(m.riskRatio, m.liquidationRatio)}`} title={m.riskRatio >= 1000 ? 'The chain reports its maximum risk ratio (1000) for this manager' : undefined}>{m.riskRatio >= 1000 ? '1000 · max' : m.riskRatio.toFixed(3)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                !errors.managers && <p className="muted small">No recent SUI/USDC managers found on mainnet.</p>
              )}
              {errors.managers && <p className="error">Managers: {errors.managers}</p>}
              <form
                className="watch-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (pastedId.trim()) selectManager(pastedId.trim());
                }}
              >
                <input value={pastedId} onChange={(e) => setPastedId(e.target.value)} placeholder="Paste a manager ID 0x…" aria-label="MarginManager ID" spellCheck={false} />
                <button className="btn primary">Watch</button>
              </form>
            </>
          ) : (
            <div className="bot-box">
              <p className="caption">Yojimbo only ever acts on the position its own bot wallet owns, within your caps.</p>
              <dl className="bot-facts">
                <div>
                  <dt>Wallet</dt>
                  <dd className={status?.wallet ? 'mono' : 'setup'}>{status?.wallet ? short(status.wallet) : 'Setup required: YOJIMBO_BOT_KEY'}</dd>
                </div>
                <div>
                  <dt>SUI</dt>
                  <dd>{status?.balanceMist ? `${(Number(status.balanceMist) / 1e9).toFixed(3)} SUI` : '—'}</dd>
                </div>
                <div>
                  <dt>USDC</dt>
                  <dd>{status?.usdcBalance ? `${(Number(status.usdcBalance) / 1e6).toFixed(2)} USDC` : '—'}</dd>
                </div>
                <div>
                  <dt>Writes</dt>
                  <dd>{status?.mainnetWrites ? 'Mainnet enabled' : 'Dry-run only'}</dd>
                </div>
              </dl>
              {status?.watcherError && <p className="error">{status.watcherError.replace(/^Error:\s*/, '')}</p>}
            </div>
          )}
        </section>

        <section className="panel position" aria-labelledby="position-title">
          <div className="panel-head">
            <h2 id="position-title">{source === 'watch' ? 'Watched position' : 'Your position'}</h2>
            {source === 'watch' && watched && <span className="tag">Read-only · not yours, Yojimbo can’t act on it</span>}
          </div>
          {state ? (
            <>
              <div className="ratio-row">
                <div className="ratio">
                  <b>{Number(ratio).toFixed(3)}</b>
                  <span>risk ratio (assets ÷ debt)</span>
                </div>
                <a className="link" target="_blank" rel="noreferrer" href={`https://suiscan.xyz/mainnet/object/${visiblePosition.managerId}`}>
                  <span>MarginManager</span>
                  <span className="mono">{short(visiblePosition.managerId)}</span>
                  <ArrowOut />
                </a>
              </div>
              {cushion && (
                <p className={`cushion cushion-${tier}`}>
                  <span className="cushion-chip">{tierWord}</span>
                  <span>
                    {cushion.kind === 'move' ? (
                      <>
                        SUI can {cushion.move < 0 ? 'fall' : 'rise'} <b className="num">{Math.abs(cushion.move * 100).toFixed(1)}%</b> (to{' '}
                        <b className="num">${cushion.price.toFixed(4)}</b>) before this position is liquidated.
                      </>
                    ) : cushion.kind === 'at' ? (
                      <>The ratio is at or below the liquidation line now.</>
                    ) : (
                      <>No SUI price move alone can liquidate this position.</>
                    )}
                  </span>
                </p>
              )}
              <div className="gauge-wrap">
                <div className="gauge" role="img" aria-label={`Risk ratio ${Number(ratio).toFixed(3)} against liquidation ${liquidation?.toFixed(2) ?? 'unknown'}, minimum borrow ${minBorrow?.toFixed(2) ?? 'unknown'} and your alert ${alert.toFixed(2)}`}>
                  <div className="zone z-liq" style={{ width: `${pos(liquidation)}%` }} />
                  <div className="zone z-borrow" style={{ left: `${pos(liquidation)}%`, width: `${pos(minBorrow) - pos(liquidation)}%` }} />
                  <div className="zone z-alert" style={{ left: `${pos(minBorrow)}%`, width: `${pos(alert) - pos(minBorrow)}%` }} />
                  <div className="zone z-safe" style={{ left: `${pos(alert)}%`, right: 0 }} />
                  <i className="tick" style={{ left: `${pos(liquidation)}%` }} />
                  <i className="tick" style={{ left: `${pos(minBorrow)}%` }} />
                  <i className="tick" style={{ left: `${pos(alert)}%` }} />
                  <span className={`needle t-${tier ?? 'safe'}`} style={{ left: `${pos(ratio)}%` }}>
                    <em>{Number(ratio).toFixed(3)}</em>
                  </span>
                </div>
                <div className="legend">
                  <span className="liq" style={{ left: `${pos(liquidation)}%` }}>
                    Liquidation <b>{liquidation?.toFixed(2) ?? '—'}</b>
                  </span>
                  <span className="mb" style={{ left: `${pos(minBorrow)}%` }}>
                    Min borrow <b>{minBorrow?.toFixed(2) ?? '—'}</b>
                  </span>
                  <span className="al" style={{ left: `${pos(alert)}%` }}>
                    Your alert <b>{alert.toFixed(2)}</b>
                  </span>
                </div>
              </div>
              <dl className="facts">
                <Fact k="SUI price" v={visiblePosition.price != null ? `$${visiblePosition.price.toFixed(4)}` : '—'} unit="USD" />
                {source === 'watch' && <Fact k="USDC oracle" v={watched.quotePrice != null ? `$${watched.quotePrice.toFixed(4)}` : '—'} unit="USD" />}
                <Fact k="Collateral" v={String(state.baseAsset)} unit="SUI" />
                <Fact k="Quote held" v={String(state.quoteAsset)} unit="USDC" />
                <Fact k="Debt" v={String(state.quoteDebt)} unit="USDC" />
                <Fact k="Mode now" v={visibleDecision?.mode ?? 'Memory setup required'} text />
                <Fact k="Next window" v={visibleDecision?.nextWindow ?? '—'} text wide />
              </dl>
              {source === 'watch' && (
                <article className="decision" aria-labelledby="decision-title">
                  <div className="decision-head">
                    <img src="/art/yojimbo-object-3.webp" alt="" width={44} height={44} />
                    <div>
                      <h3 id="decision-title">What Yojimbo would do right now</h3>
                      <p className="muted small">{watched.decisionSource}</p>
                    </div>
                  </div>
                  <div className="verdict">
                    <span>
                      <small>Mode</small>
                      {visibleDecision?.mode ?? '—'}
                    </span>
                    <span>
                      <small>Action</small>
                      {visibleDecision?.action ?? '—'}
                    </span>
                    <span>
                      <small>Amount</small>
                      {visibleDecision?.amountUsdc ?? 0} USDC
                    </span>
                  </div>
                  <blockquote>“{visibleDecision?.quote}”</blockquote>
                  {visibleDecision?.action === 'ignore' && /no remembered rules/i.test(String(watched?.decisionSource ?? '')) && (
                    <p className="hint">No rules yet, so Yojimbo only watches. Tell it in chat what to do, e.g. “below 1.15, add 10 USDC”.</p>
                  )}
                  <div className="decision-actions">
                    <button className="btn primary" onClick={dryRunDefence} disabled={dryBusy}>
                      {dryBusy ? 'Checking…' : 'Dry-run the defence'}
                    </button>
                    <span className="muted small">Never sends a transaction.</span>
                  </div>
                  {dryRun && (
                    <div className={`guardrail ${dryRun.ok ? 'ok' : 'refused'}`} role="status">
                      <b>{dryRun.ok ? 'Dry-run result' : 'Guard rail · refused'}</b>
                      <p>{dryRun.text}</p>
                    </div>
                  )}
                </article>
              )}
              {source === 'watch' && (
                <p className="nearby">
                  <b>Nearby positions at liquidation:</b>{' '}
                  {atLiq.length ? atLiq.map((m) => `${short(m.managerId)} (${m.riskRatio.toFixed(3)})`).join(', ') : 'none in the recent live sample.'}
                </p>
              )}
            </>
          ) : source === 'watch' && watchId && !errors.watch ? (
            <div className="pos-skeleton" aria-label="Reading the position from mainnet">
              <span className="s1" />
              <span className="s2" />
              <span className="s3" />
              <p className="muted small">Reading {short(watchId)} from Sui mainnet…</p>
            </div>
          ) : (
            <Empty
              art="/art/yojimbo-empty-2.webp"
              title={source === 'bot' && /Setup required/.test(errors.position ?? '') ? 'Setup required' : 'Nothing to guard yet'}
              text={
                (source === 'watch' ? errors.watch : errors.position) ||
                (source === 'watch' ? 'Select a recent manager or paste its ID.' : 'No bot-owned MarginManager found. Fund the bot wallet and open a small SUI/USDC position to start guarding.')
              }
            />
          )}
          {visibleRegistry && (
            <p className="thresholds">
              Live pool thresholds from mainnet: liquidation {liquidation?.toFixed(2)}, min borrow {minBorrow?.toFixed(4)}.
            </p>
          )}
          {errors.registry && source === 'bot' && <p className="error">Registry: {errors.registry}</p>}
        </section>

        <section className="panel chat-card" id="chat" aria-labelledby="chat-title">
          <div className="chat-head">
            <img src="/art/yojimbo-mark.webp" alt="" width={40} height={40} />
            <div>
              <h2 id="chat-title">Talk to your bodyguard</h2>
              <p className="muted small">
                <span className={`state-dot ${status?.openRouter === 'ready' ? 'ok' : 'warn'}`} aria-hidden="true" />
                {status?.openRouter === 'ready' ? 'Agent ready · real tool calls, shown below' : status?.openRouter ?? 'Connecting…'}
              </p>
            </div>
          </div>
          <div className="chat" aria-live="polite">
            {messages.length ? (
              messages.map((m, i) => (
                <div className={`message ${m.role}`} key={i}>
                  {m.role !== 'you' && <img className="avatar" src="/art/yojimbo-mark.webp" alt="" width={28} height={28} />}
                  <div className="bubble">
                    <b>{m.role === 'yojimbo' ? 'Yojimbo' : m.role === 'you' ? 'You' : 'Error'}</b>
                    <p>{m.text}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="starters">
                <p className="greet">Tell me your life and your rules. I’ll remember them and keep watch.</p>
                {STARTERS.map((s) => (
                  <button key={s} className="starter" onClick={() => send(s)} disabled={busy}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {busy && (
              <div className="message thinking" aria-label="Yojimbo is thinking">
                <img className="avatar" src="/art/yojimbo-mark.webp" alt="" width={28} height={28} />
                <div className="bubble">
                  <span className="typing">
                    <i />
                    <i />
                    <i />
                  </span>
                  <small>{steps.length && steps[steps.length - 1].pending ? `Calling ${steps[steps.length - 1].name}…` : 'Thinking…'}</small>
                </div>
              </div>
            )}
            <div ref={chatEnd} />
          </div>
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. Flying Tuesday 10:00 to 16:00 IST" aria-label="Message Yojimbo" />
            <button className="btn primary send" disabled={busy}>
              {busy ? 'Thinking…' : 'Send'}
            </button>
          </form>
          <div className="tools" aria-label="Tool calls">
            <div className="tools-head">
              <h3>Tool calls</h3>
              <span className="count">{steps.length}</span>
            </div>
            {steps.length ? (
              <ol className="steps">
                {steps.map((s, i) => (
                  <li key={i} className={`step ${s.error ? 'err' : s.pending ? 'pending' : 'done'}`}>
                    <span className="step-icon" aria-hidden="true">
                      {s.error ? '!' : s.pending ? '' : <Check />}
                    </span>
                    <div className="step-body">
                      <div className="step-top">
                        <code>{s.name}</code>
                        <small>{s.error ? 'error' : s.pending ? 'running' : s.kind === 'decision' ? 'rule engine' : 'returned'}</small>
                      </div>
                      {s.args.length > 0 && (
                        <dl className="kv args">
                          {s.args.map(([k, v]) => (
                            <div key={k}>
                              <dt>{k}</dt>
                              <dd>{v}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {s.error ? (
                        <p className="step-err">{s.error}</p>
                      ) : (
                        s.result.length > 0 && (
                          <dl className="kv">
                            {s.result.map(([k, v]) => (
                              <div key={k}>
                                <dt>{k}</dt>
                                <dd>{v}</dd>
                              </div>
                            ))}
                          </dl>
                        )
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted small">Every chain read and memory recall the agent makes appears here, step by step.</p>
            )}
            <details className="trace">
              <summary>Raw tool JSON ({trace.length})</summary>
              {trace.map((t, i) => (
                <pre key={i}>{JSON.stringify(t, null, 2)}</pre>
              ))}
            </details>
          </div>
        </section>
      </main>

      <div className="lower">
        <section className="panel memory-card" id="memory" aria-labelledby="memory-title">
          <div className="panel-head">
            <h2 id="memory-title">What it remembers</h2>
            <span className="tag">Walrus mainnet</span>
          </div>
          {errors.memory && <p className="error">{errors.memory}</p>}
          {visibleDecision && (
            <p className="recalled">
              <b>Recalled {visibleDecision.recalledBlobIds.length}</b>
              <span>
                next move: {visibleDecision.action} · “{visibleDecision.quote}”
              </span>
            </p>
          )}
          {kept.length ? (
            <div className="memories">
              {kept.map((h) => {
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
                      <span className="mono">{short(h.blobId)}</span> <ArrowOut />
                    </a>
                  </article>
                );
              })}
            </div>
          ) : (
            <Empty
              art="/art/yojimbo-object-2.webp"
              title={memorySetup ? 'Setup required: Walrus Memory' : 'No rules yet'}
              text="Your schedule, rules and corrections are stored on Walrus. Every defence quotes the one it followed."
              detail={memorySetup ? 'MEMWAL_MAINNET_KEY / MEMWAL_MAINNET_ACCOUNT_ID' : undefined}
            />
          )}
        </section>

        <section className="panel events-card" id="log" aria-labelledby="events-title">
          <div className="panel-head">
            <h2 id="events-title">Night log</h2>
            <span className="tag">{events.length} defences</span>
          </div>
          {notifications.map((n, i) => (
            <p className="notice" key={i}>
              {n}
            </p>
          ))}
          {errors.events && <p className="error">{errors.events}</p>}
          {events.length ? (
            <div className="log">
              {events.map((e) => (
                <article className="event" key={e.id}>
                  <div className="event-top">
                    <b>
                      {e.action} {e.amountUsdc} USDC
                    </b>
                    <span className={`outcome o-${/fail|error|refus/i.test(e.outcome) ? 'bad' : /dry/i.test(e.outcome) ? 'dry' : 'ok'}`}>{e.outcome}</span>
                    <time className="muted small" dateTime={e.at}>
                      {new Date(e.at).toLocaleString()}
                    </time>
                  </div>
                  <p className="num">
                    ratio {e.beforeRatio.toFixed(3)} → {e.afterRatio?.toFixed(3) ?? 'not executed'} · SUI ${e.suiPrice.toFixed(4)} · {e.mode}
                  </p>
                  <p className="small muted">
                    Recalled {e.recalledBlobIds.length} · rules {e.ruleIds.join(', ') || 'none'}
                  </p>
                  <div className="links">
                    {e.txDigest && (
                      <a target="_blank" rel="noreferrer" href={`https://suiscan.xyz/mainnet/tx/${e.txDigest}`}>
                        transaction <ArrowOut />
                      </a>
                    )}
                    {e.memoryBlobId && (
                      <a target="_blank" rel="noreferrer" href={`https://walruscan.com/mainnet/blob/${e.memoryBlobId}`}>
                        event memory <ArrowOut />
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty
              art="/art/yojimbo-empty-1.webp"
              title="A quiet night"
              text="Every defence lands here with its before and after ratio, the rule it followed and the transaction."
            />
          )}
        </section>
      </div>

      <section className="watch-band" aria-labelledby="band-title">
        <div className="band-head">
          <p className="eyebrow plain">How it keeps watch</p>
          <h2 id="band-title">
            Three things a good bodyguard does, <em>without being told twice.</em>
          </h2>
        </div>
        <div className="band-grid">
          {BAND.map((b) => (
            <article className="band-card" key={b.title}>
              <img src={b.art} alt="" width={1024} height={1024} />
              <div>
                <h3>{b.title}</h3>
                <p>{b.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer className="foot">
        <img src="/art/yojimbo-mark.webp" alt="" width={22} height={22} />
        <span>
          Positions: DeepBook Margin on Sui mainnet · chain reads: {status?.rpc ?? 'Setup required'} · memory: Walrus Memory · art generated with
          ChatGPT.
        </span>
      </footer>
    </div>
  );
}

type Step = { name: string; kind: string; pending: boolean; error: string; args: [string, string][]; result: [string, string][] };

const fmt = (v: unknown): string => {
  if (v == null) return '—';
  if (typeof v === 'string') return /^0x[0-9a-f]{20,}$/i.test(v) ? short(v) : v.length > 90 ? `${v.slice(0, 88)}…` : v;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4)));
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  return '{…}';
};
const PREFERRED = ['error', 'outcome', 'riskRatio', 'price', 'quotePrice', 'suiPriceAtLiquidationUsd', 'suiMoveToLiquidationPercent', 'alreadyLiquidatable', 'liquidation', 'minBorrow', 'mode', 'action', 'amountUsdc', 'quote', 'managers', 'hits'];
const LABEL: Record<string, string> = {
  riskRatio: 'risk ratio',
  price: 'SUI price (USD)',
  quotePrice: 'USDC oracle (USD)',
  suiPriceAtLiquidationUsd: 'SUI at liquidation (USD)',
  suiMoveToLiquidationPercent: 'move to liquidation (%)',
  alreadyLiquidatable: 'liquidatable now',
  amountUsdc: 'amount (USDC)',
  managerId: 'manager',
  recalled: 'recalled',
};
/** Pulls the facts a person cares about out of a tool payload, one level deep, without inventing anything. */
const summarise = (obj: unknown): [string, string][] => {
  if (obj == null || typeof obj !== 'object') return obj == null ? [] : [['value', fmt(obj)]];
  if (Array.isArray(obj)) return [['items', String(obj.length)]];
  const flat: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) if (!(k2 in flat) && (v2 == null || typeof v2 !== 'object' || Array.isArray(v2))) flat[k2] = v2;
    } else flat[k] = v;
  }
  const keys = PREFERRED.filter((k) => k in flat);
  const picked = (keys.length ? keys : Object.keys(flat)).slice(0, 5);
  return picked.map((k) => [LABEL[k] ?? k, fmt(flat[k])]);
};
function buildSteps(chrono: any[]): Step[] {
  const out: Step[] = [];
  for (const t of chrono) {
    if (t.type === 'tool') {
      out.push({ name: t.name, kind: 'tool', pending: true, error: '', args: Object.entries(t.args ?? {}).map(([k, v]) => [LABEL[k] ?? k, fmt(v)]), result: [] });
    } else if (t.type === 'tool_result') {
      const open = [...out].reverse().find((s) => s.pending && s.name === t.name);
      const err = t.result && typeof t.result === 'object' && 'error' in t.result ? String(t.result.error) : '';
      const result = err ? [] : summarise(t.result);
      if (open) Object.assign(open, { pending: false, error: err, result });
      else out.push({ name: t.name, kind: 'tool', pending: false, error: err, args: [], result });
    } else if (t.type === 'decision') {
      out.push({ name: 'decide', kind: 'decision', pending: false, error: '', args: [], result: summarise(t.decision ?? t) });
    }
  }
  return out;
}

function StatusCell({ label, value, warn, mono }: { label: string; value: string; warn?: boolean; mono?: boolean }) {
  const s = splitSetup(value);
  return (
    <div className={`cell ${s.setup ? 'setup' : warn ? 'warn' : 'ok'}`}>
      <span className="cell-label">
        <i aria-hidden="true" />
        {label}
      </span>
      <span className={`cell-value ${mono ? 'mono' : ''}`}>{s.title}</span>
      {s.detail && <code className="cell-detail">{s.detail}</code>}
    </div>
  );
}

function Fact({ k, v, unit, text, wide }: { k: string; v: string; unit?: string; text?: boolean; wide?: boolean }) {
  return (
    <div className={`${text ? 'is-text' : ''} ${wide ? 'wide' : ''}`}>
      <dt>
        {k}
        {unit && <small>{unit}</small>}
      </dt>
      <dd className="num">{v}</dd>
    </div>
  );
}

function Empty({ art, title, text, detail }: { art: string; title: string; text: string; detail?: string }) {
  return (
    <div className="empty">
      <img src={art} alt="" width={96} height={96} />
      <div>
        <b>{title}</b>
        {detail && <code>{detail}</code>}
        <p>{text}</p>
      </div>
    </div>
  );
}

const ArrowOut = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="ico">
    <path d="M4 2.5h5.5V8M9.2 2.8 2.5 9.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Check = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="m2.5 6.3 2.2 2.2 4.8-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
