import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

/* Yojimbo v5. Finish copied from Otzar (ivory and white cards, deep primary, gold only for key numbers, framed art,
   calm bands, slim bar with pill tabs). Layout from the category leaders: DeFi Saver Automation (Liquidation
   Protection: one ratio, a bar with the trigger line, the protection settings beside it) and the Aave position
   dashboard (position card, then the lists). Routes: / landing, /app guard, /memory, /log. */

type Hit = {
  blobId: string;
  memory: { kind: string; id: string; text: string; createdAt: string; supersedes?: string; action?: string; ids?: string[] };
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
  fork?: { label: string; forkedAtCheckpoint: string; checkpoint: string; clockMs: number; writes: boolean } | null;
  watcherError: string | null;
  pending: string[];
};
type Step = { name: string; kind: string; pending: boolean; error: string; args: [string, string][]; result: [string, string][] };
type Message = { role: 'you' | 'yojimbo' | 'error'; text: string; at: string; steps?: Step[] };
type RecentManager = { managerId: string; owner: string; pool: string; lastActivity: string; activity: string; riskRatio: number; liquidationRatio: number };
type Cushion = { kind: 'none' } | { kind: 'at' } | { kind: 'move'; price: number; move: number; tier: 'danger' | 'watch' | 'safe' };
type Tier = 'danger' | 'watch' | 'safe';
type Route = 'home' | 'app' | 'memory' | 'log';

const api = (path: string) =>
  fetch(`/api${path}`).then(async (r) => {
    const v = await r.json();
    if (!r.ok) throw new Error(String(v.error || `HTTP ${r.status}`).replace(/^Error:\s*/, ''));
    return v;
  });
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const KIND_LABEL: Record<string, string> = { schedule: 'Schedule', rule: 'Rule', override: 'Your correction', retire: 'You asked to forget' };
const STARTERS = ['What rules do you remember for me?', 'I sleep 01:00 to 08:00 IST every day', 'At night add collateral, never close the position', 'How close is the position I am watching to liquidation?'];
const AVATAR = '/art/yojimbo-chat-avatar.webp';
const RM = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s)) return '—';
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
/** "Setup required: A / B" → its variable names, so they can be listed in mono. */
const setupVars = (v: string | null | undefined) => {
  const m = /^Setup required:\s*(.+)$/.exec(v ?? '');
  return m ? m[1] : '';
};
const ratioText = (r: number) => (r >= 1000 ? '1000' : r.toFixed(3));

/* ---------- tiny router ---------- */
const routeOf = (p: string): Route => (p.startsWith('/app') ? 'app' : p.startsWith('/memory') ? 'memory' : p.startsWith('/log') ? 'log' : 'home');
function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
  }, []);
  return path;
}
function go(to: string) {
  const [path, hash] = to.split('#');
  if (path && path !== location.pathname) {
    history.pushState(null, '', to);
    dispatchEvent(new PopStateEvent('popstate'));
    if (!hash) scrollTo({ top: 0 });
  }
  if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ behavior: RM() ? 'auto' : 'smooth', block: 'start' }));
}
function Link({ to, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        go(to);
      }}
    >
      {children}
    </a>
  );
}

function App() {
  const path = usePath();
  const route = routeOf(path);
  const [status, setStatus] = useState<Status | null>(null);
  const [position, setPosition] = useState<any>(null);
  const [registry, setRegistry] = useState<any>(null);
  const [memory, setMemory] = useState<Hit[] | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [approval, setApproval] = useState<{ id: string; decision: Decision } | null>(null);
  const [notifications, setNotifications] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [trace, setTrace] = useState<any[]>([]);
  const [live, setLive] = useState<Step[]>([]);
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
  const thread = useRef<HTMLDivElement>(null);
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [botWatched, setBotWatched] = useState<any>(null);
  const autoBot = useRef(false);

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
    stream.addEventListener('notification', (e) => setNotifications((v) => [JSON.parse((e as MessageEvent).data).message, ...v].slice(0, 20)));
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
    // On a local fork the point is the bot's own position, so open on it once.
    if (status?.fork && !autoBot.current) {
      autoBot.current = true;
      setSource('bot');
    }
  }, [status?.fork]);
  const botManagerId: string | undefined = position?.managerId ?? undefined;
  useEffect(() => {
    if (source !== 'bot' || !botManagerId) return;
    const load = async () => {
      try {
        setBotWatched(await api(`/watch/${botManagerId}`));
      } catch {
        setBotWatched(null);
      }
    };
    void load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [source, botManagerId]);
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
    const el = thread.current;
    if (el && (messages.length || busy)) el.scrollTo({ top: el.scrollHeight, behavior: RM() ? 'auto' : 'smooth' });
  }, [messages, busy, live]);
  useEffect(() => {
    const t: Record<Route, string> = {
      home: 'Yojimbo · a bodyguard for your leverage',
      app: 'Yojimbo · On guard',
      memory: 'Yojimbo · What it remembers',
      log: 'Yojimbo · Night log',
    };
    document.title = t[route];
  }, [route]);

  const send = async (preset?: string) => {
    const text = (preset ?? draft).trim();
    if (!text || busy) return;
    setDraft('');
    setBusy(true);
    setLive([]);
    setMessages((v) => [...v, { role: 'you', text, at: clock() }]);
    // Every tool call of this turn is kept with the answer it produced, so it renders as a timeline under that answer.
    const turn: any[] = [];
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, watchManagerId: source === 'watch' ? watchId : undefined }),
      });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? `Chat failed (HTTP ${response.status})`);
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
          if (type === 'tool' || type === 'tool_result') {
            turn.push({ type, ...data });
            setTrace((v) => [{ type, ...data }, ...v].slice(0, 40));
            setLive(buildSteps(turn));
          }
          if (type === 'message') {
            const steps = buildSteps(turn.splice(0));
            setLive([]);
            setMessages((v) => [...v, { role: 'yojimbo', text: data.text, at: clock(), steps }]);
          }
          if (type === 'error') setMessages((v) => [...v, { role: 'error', text: data.message, at: clock(), steps: buildSteps(turn.splice(0)) }]);
          if (type === 'done') {
            finished = true;
            void reader.cancel().catch(() => {});
          }
        }
      }
    } catch (e) {
      setMessages((v) => [...v, { role: 'error', text: String((e as Error).message ?? e), at: clock() }]);
    } finally {
      setBusy(false);
      setLive([]);
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
  const visibleDecision: Decision | null = source === 'watch' ? watched?.decision ?? null : decision ?? botWatched?.decision ?? null;
  const activeAssess = source === 'watch' ? watched : botWatched;
  const activeId = source === 'watch' ? watchId : botManagerId;
  const caps: { perActionUsdc: number; dailyUsdc: number } | undefined = activeAssess?.caps ?? watched?.caps ?? botWatched?.caps;
  const fork = status?.fork ?? null;
  const writesLive = !!(fork ? fork.writes : status?.mainnetWrites);
  const where = fork ? 'the local fork' : 'Sui mainnet';
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
    const base = Number(state.baseAsset),
      quote = Number(state.quoteAsset),
      bd = Number(state.baseDebt),
      qd = Number(state.quoteDebt);
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
  const tier: Tier | null = cushion ? (cushion.kind === 'move' ? cushion.tier : cushion.kind === 'at' ? 'danger' : 'safe') : null;
  const tierWord = tier === 'danger' ? (cushion?.kind === 'at' ? 'Liquidatable' : 'Danger') : tier === 'watch' ? 'Watch' : tier === 'safe' ? 'Safe' : '';
  const hits = memory ?? [];
  const gone = new Set<string>(hits.flatMap((h) => (h.memory.kind === 'retire' && Array.isArray(h.memory.ids) ? h.memory.ids : [])));
  const kept = hits.filter((h) => ['schedule', 'rule', 'override', 'retire'].includes(h.memory.kind));
  const activeOf = (kinds: string[]) =>
    kept.filter((h) => kinds.includes(h.memory.kind) && !gone.has(h.memory.id)).sort((a, b) => String(b.memory.createdAt).localeCompare(String(a.memory.createdAt)));
  const memorySetup = !!status?.memory?.startsWith('Setup required');
  const atLiq = (managers ?? []).filter((m) => m.riskRatio <= m.liquidationRatio);
  const dryRunDefence = async () => {
    if (!activeId || dryBusy) return;
    setDryBusy(true);
    try {
      const response = await fetch(`/api/watch/${activeId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'dry-run' }) });
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
  const keys = status
    ? [
        { label: 'Chain reads', value: status.rpc, level: status.rpc.startsWith('Setup') ? 'setup' : status.fork || status.rpc.startsWith('dev') ? 'warn' : 'ok' },
        { label: 'Walrus Memory', value: status.memory, level: status.memory.startsWith('Setup') ? 'setup' : 'ok' },
        { label: 'Bot wallet', value: status.wallet ? short(status.wallet) : 'Setup required: YOJIMBO_BOT_KEY', level: status.wallet ? 'ok' : 'setup' },
        { label: 'Telegram', value: status.telegram, level: status.telegram.startsWith('Setup') ? 'setup' : 'ok' },
        { label: 'Agent model', value: status.openRouter === 'ready' ? 'Key set (OpenRouter)' : status.openRouter, level: status.openRouter === 'ready' ? 'ok' : 'setup' },
      ]
    : [];
  if (status)
    keys.push(
      fork
        ? { label: 'Writes', value: fork.writes ? 'Real transactions on the local fork only' : 'Simulated on the fork only', level: 'warn' }
        : { label: 'Writes', value: status.mainnetWrites ? 'Mainnet enabled' : 'Dry-run only (YOJIMBO_ALLOW_MAINNET unset)', level: status.mainnetWrites ? 'ok' : 'warn' },
    );
  const watchError = source === 'watch' ? errors.watch || errors.managers : errors.position;
  const localRuleIds = (visibleDecision?.recalledBlobIds ?? []).filter((id) => id.startsWith('local-file:'));
  const localRules = !!fork && (hits.some((h) => h.blobId.startsWith('local-file:')) || localRuleIds.length > 0);
  const toChat = (preset?: string) => {
    if (route !== 'app') go('/app#chat');
    else document.getElementById('chat')?.scrollIntoView({ behavior: RM() ? 'auto' : 'smooth', block: 'center' });
    if (preset) void send(preset);
    else setTimeout(() => (document.querySelector('.composer input') as HTMLInputElement | null)?.focus({ preventScroll: true }), 50);
  };
  const steps4 = journeySteps(status, position, kept.length || (localRules ? localRuleIds.length || 1 : 0), memorySetup && !localRules, writesLive);
  const journey = (variant: 'panel' | 'inline') => (
    <Journey
      variant={variant}
      status={status}
      position={position}
      registry={registry}
      caps={caps}
      memorySetup={memorySetup}
      fork={fork}
      localRules={localRules}
      writesLive={writesLive}
      states={steps4}
      busy={busy}
      onRules={toChat}
      onDone={() => void refresh()}
    />
  );
  const modeWord = status ? (fork ? (fork.writes ? 'Fork writes on' : 'Fork, simulate only') : status.mainnetWrites ? 'Real funds' : 'Dry-run only') : 'Connecting…';
  const forkBanner = fork && (
    <div className="fork-banner" role="note">
      <b>LOCAL FORK</b>
      <span>
        {fork.label} · now at checkpoint {fork.checkpoint} · transactions run only on this machine, never on mainnet
      </span>
    </div>
  );

  if (route === 'home')
    return (
      <div className="site">
        <a className="skip" href="#main">
          Skip to content
        </a>
        {forkBanner}
        <Landing status={status} memoryCount={memory ? kept.length : null} memoryError={errors.memory} memorySetup={memorySetup} events={events} watched={watched} registry={registry} caps={caps} />
      </div>
    );

  // Protection settings, all from live state: the alert ratio from the rule engine, the caps from the server, the
  // rule and schedule texts from the newest active Walrus memories.
  const rules = activeOf(['override', 'rule']);
  const schedules = activeOf(['schedule']);
  const hasDebt = Number(position?.state?.quoteDebt) > 0 || Number(position?.state?.baseDebt) > 0;
  const guard: { word: string; tone: 'ok' | 'warn' | 'off' | 'muted'; note: string } =
    source === 'watch'
      ? { word: 'Watching only', tone: 'muted', note: 'This position is not the bot’s. Yojimbo can read it, not act on it.' }
      : !status
        ? { word: 'Checking…', tone: 'muted', note: '' }
        : !status.wallet
          ? { word: 'Guard off', tone: 'off', note: 'Setup required: YOJIMBO_BOT_KEY' }
          : !hasDebt
            ? { word: 'Guard off', tone: 'off', note: 'The bot wallet has no open position yet.' }
            : writesLive
              ? { word: 'Guard on', tone: 'ok', note: fork ? 'Real transactions on the local fork only.' : 'It will send real defences on Sui mainnet.' }
              : { word: 'Guard on · dry-run', tone: 'warn', note: 'It simulates each defence and sends nothing.' };
  const telegramOn = !!status && !status.telegram.startsWith('Setup');

  return (
    <div className={`app ${fork ? 'has-fork' : ''}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      {forkBanner}
      <header className="bar">
        <div className="bar-row">
          <Link to="/" className="bar-logo" aria-label="Yojimbo home">
            <Wordmark />
          </Link>
          <nav className="seg-nav" aria-label="App" data-film="tabs">
            <Link to="/app" aria-current={route === 'app' ? 'page' : undefined} data-film="tab-guard">
              Guard
            </Link>
            <Link to="/memory" aria-current={route === 'memory' ? 'page' : undefined} data-film="tab-memory">
              Memory
            </Link>
            <Link to="/log" aria-current={route === 'log' ? 'page' : undefined} data-film="tab-log">
              Night log
            </Link>
          </nav>
          <div className="bar-end">
            <span className={`mode-pill ${fork ? 'fork' : status?.mainnetWrites ? 'live' : ''}`}>
              <i aria-hidden="true" />
              {modeWord}
            </span>
            <Keys keys={keys} error={errors.status} />
          </div>
        </div>
      </header>

      <main id="main" className="app-main">
        {approval && (
          <div className="approval" role="alert" data-film="approval">
            <div className="approval-text">
              <b>Yojimbo is asking before it acts</b>
              <p>
                {approval.decision.action}: “{approval.decision.quote}”
              </p>
            </div>
            <div className="approval-actions">
              <button className="pill pill-gold pill-sm" onClick={() => decideApproval('approve')}>
                Approve
              </button>
              <button className="pill pill-ghost pill-sm" onClick={() => decideApproval('reduce')}>
                Reduce
              </button>
              <button className="pill pill-ghost pill-sm" onClick={() => decideApproval('ignore')}>
                Ignore
              </button>
            </div>
          </div>
        )}

        {route === 'app' && (
          <div className="page">
            <header className="dash-head">
              <div>
                <p className="lbl">
                  <span className={`live-dot ${fork ? 'fork' : ''}`} aria-hidden="true" />
                  SUI/USDC on DeepBook Margin · read from {where} every 15 s
                </p>
                <h1>On guard</h1>
                <p className="dash-sub">A bodyguard for your leverage while you sleep. It follows only the rules you gave it.</p>
              </div>
              <button className="pill pill-line pill-sm" aria-expanded={journeyOpen} aria-controls="journey" onClick={() => setJourneyOpen((v) => !v)}>
                {journeyOpen ? 'Hide setup' : 'Get guarded in 4 steps'}
              </button>
            </header>
            {journeyOpen && (
              <section className="card" id="journey" aria-label="Get guarded in 4 steps">
                {journey('panel')}
              </section>
            )}

            <div className="dash-grid">
              <div className="dash-main">
                {/* (1) Position */}
                <section className={`card pos-card ${tier ? `is-${tier}` : ''}`} id="position" aria-labelledby="position-title" data-film="position">
                  <div className="card-title">
                    <div>
                      <p className="lbl">Position</p>
                      <h2 id="position-title">{source === 'watch' ? 'Watched position' : 'Your position'}</h2>
                    </div>
                    <div className="seg" role="group" aria-label="Position source">
                      <button aria-pressed={source === 'watch'} className={source === 'watch' ? 'on' : ''} onClick={() => setSource('watch')}>
                        Watch any
                      </button>
                      <button aria-pressed={source === 'bot'} className={source === 'bot' ? 'on' : ''} onClick={() => setSource('bot')} data-film="source-bot">
                        Bot wallet
                      </button>
                    </div>
                  </div>

                  {source === 'watch' && (
                    <div className="picker">
                      {managers === null && !errors.managers ? (
                        <span className="skeleton picker-skel" aria-label="Loading positions" />
                      ) : managers && managers.length ? (
                        <label className="select">
                          <span className="sr">Position to watch</span>
                          <select value={watchId} onChange={(e) => selectManager(e.target.value)}>
                            {!managers.some((m) => m.managerId === watchId) && watchId && <option value={watchId}>{short(watchId)} · pasted</option>}
                            {managers.map((m) => (
                              <option key={m.managerId} value={m.managerId}>
                                {short(m.managerId)} · ratio {m.riskRatio >= 1000 ? '1000 (max)' : m.riskRatio.toFixed(3)} · {ago(m.lastActivity)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        !errors.managers && <p className="fine">No recent SUI/USDC positions found.</p>
                      )}
                      <form
                        className="paste"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (pastedId.trim()) selectManager(pastedId.trim());
                        }}
                      >
                        <input value={pastedId} onChange={(e) => setPastedId(e.target.value)} placeholder="or paste a position ID 0x…" aria-label="MarginManager ID" spellCheck={false} />
                        <button className="pill pill-line pill-sm">Watch</button>
                      </form>
                      {errors.managers && <p className="err-line">Positions: {errors.managers}</p>}
                      <p className="fine">
                        Real positions, closest to liquidation first. At liquidation now:{' '}
                        {atLiq.length ? atLiq.map((m) => `${short(m.managerId)} (${m.riskRatio.toFixed(3)})`).join(', ') : 'none in the recent live sample'}.
                      </p>
                    </div>
                  )}

                  {source === 'bot' && (
                    <dl className="bot-facts">
                      <div>
                        <dt>Bot wallet</dt>
                        <dd className={status?.wallet ? 'mono' : status ? 'setup' : ''}>
                          {!status ? (
                            '…'
                          ) : status.wallet ? (
                            <a href={`https://suiscan.xyz/mainnet/account/${status.wallet}`} target="_blank" rel="noreferrer">
                              {short(status.wallet)} <ArrowOut />
                            </a>
                          ) : (
                            'Setup required'
                          )}
                        </dd>
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
                        <dt>Sends</dt>
                        <dd>{fork ? (fork.writes ? 'Local fork only' : 'Fork, simulate only') : status?.mainnetWrites ? 'Mainnet enabled' : 'Dry-run only'}</dd>
                      </div>
                    </dl>
                  )}
                  {source === 'bot' && status?.watcherError && !/^(Error:\s*)?Setup required/.test(status.watcherError) && (
                    <p className="err-line">{status.watcherError.replace(/^Error:\s*/, '')}</p>
                  )}

                  {state ? (
                    <>
                      <div className="ratio-row">
                        <div className="ratio" data-film="ratio">
                          <span className="lbl">Risk ratio</span>
                          <b className="num">{ratioText(Number(ratio))}</b>
                          <span className="ratio-help">what it owns ÷ what it owes{Number(ratio) >= 1000 ? ' · the chain’s maximum' : ''}</span>
                        </div>
                        {tier && <span className={`tier tier-${tier}`}>{tierWord}</span>}
                      </div>
                      <RiskBar ratio={Number(ratio)} liquidation={liquidation} minBorrow={minBorrow} alert={alert} />
                      {cushion && (
                        <p className="cushion">
                          {cushion.kind === 'move' ? (
                            <>
                              SUI can {cushion.move < 0 ? 'fall' : 'rise'} <b className="gold-num">{Math.abs(cushion.move * 100).toFixed(1)}%</b> before liquidation
                              <span className="num"> · liquidated at SUI ${cushion.price.toFixed(4)}</span>
                            </>
                          ) : cushion.kind === 'at' ? (
                            <>The ratio is at or below the liquidation line now.</>
                          ) : (
                            <>No SUI price move alone can liquidate this position.</>
                          )}
                        </p>
                      )}
                      <dl className="pos-kv">
                        <Fact k="Collateral" v={fmtAmt(state.baseAsset)} unit="SUI" />
                        <Fact k="Cash held" v={fmtAmt(state.quoteAsset)} unit="USDC" />
                        <Fact k="Debt" v={fmtAmt(state.quoteDebt)} unit="USDC" />
                        <Fact k="SUI price" v={visiblePosition.price != null ? `$${Number(visiblePosition.price).toFixed(4)}` : '—'} unit="USD" />
                        {source === 'watch' && <Fact k="USDC price" v={watched.quotePrice != null ? `$${watched.quotePrice.toFixed(4)}` : '—'} unit="USD" />}
                      </dl>
                      <div className="pos-foot">
                        {visiblePosition?.managerId &&
                          (fork ? (
                            <span className="ext" title={`${visiblePosition.managerId} (state read from the local fork; not a Suiscan link)`}>
                              Position <span className="mono">{short(visiblePosition.managerId)}</span> <ForkTag />
                            </span>
                          ) : (
                            <a className="ext" target="_blank" rel="noreferrer" href={`https://suiscan.xyz/mainnet/object/${visiblePosition.managerId}`} data-film="suiscan">
                              Position <span className="mono">{short(visiblePosition.managerId)}</span> on SuiScan <ArrowOut />
                            </a>
                          ))}
                        {visibleRegistry && (
                          <span className="fine">
                            Pool rules from {fork ? 'the local fork' : 'mainnet'}: liquidation {liquidation?.toFixed(2)}, minimum to borrow {minBorrow?.toFixed(4)}.
                          </span>
                        )}
                      </div>
                    </>
                  ) : source === 'watch' && watchId && !errors.watch ? (
                    <div className="pos-skeleton" aria-label={`Reading the position from ${where}`}>
                      <span className="skeleton s1" />
                      <span className="skeleton s2" />
                      <span className="skeleton s3" />
                      <p className="fine">
                        Reading {short(watchId)} from {where}…
                      </p>
                    </div>
                  ) : source === 'bot' ? (
                    journey('inline')
                  ) : (
                    <State title="Nothing to guard yet" text={watchError || 'Pick a position above or paste its ID.'} error={!!watchError} />
                  )}
                  {errors.registry && source === 'bot' && <p className="err-line">Registry: {errors.registry}</p>}
                </section>

                {/* (3) Chat */}
                <section className="card chat-card" id="chat" aria-labelledby="chat-title" data-film="chat">
                  <div className="chat-head">
                    <img src={AVATAR} alt="" width={44} height={44} />
                    <div>
                      <h2 id="chat-title">Talk to your bodyguard</h2>
                      <p>
                        <span className={`dot ${status?.openRouter === 'ready' ? 'ok' : 'warn'}`} aria-hidden="true" />
                        {status?.openRouter === 'ready' ? 'Tell it your hours and rules. Every tool call shows under its answer.' : status?.openRouter ?? 'Connecting…'}
                      </p>
                    </div>
                  </div>
                  <div className="thread" ref={thread} aria-live="polite" data-film="thread">
                    {messages.length === 0 && (
                      <div className="welcome">
                        <p className="greet">Tell me when you sleep and what I may do. I’ll remember it on Walrus and keep watch.</p>
                        <div className="chips">
                          {STARTERS.map((s) => (
                            <button key={s} className="chip" onClick={() => send(s)} disabled={busy}>
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {messages.map((m, i) => (
                      <div className={`message ${m.role}`} key={i}>
                        {m.role !== 'you' && <img className="avatar" src={AVATAR} alt="" width={30} height={30} />}
                        <div className="msg-col">
                          <div className="bubble">
                            {m.role === 'error' && <b>Error</b>}
                            <p>{m.role === 'error' ? m.text.replace(/^Error:\s*/, '') : m.text}</p>
                          </div>
                          {m.steps && m.steps.length > 0 && <Steps steps={m.steps} />}
                          <time className="msg-time">
                            {m.role === 'you' ? 'You' : 'Yojimbo'} · {m.at}
                          </time>
                        </div>
                      </div>
                    ))}
                    {busy && (
                      <div className="message yojimbo" aria-label="Yojimbo is thinking">
                        <img className="avatar" src={AVATAR} alt="" width={30} height={30} />
                        <div className="msg-col">
                          <div className="bubble thinking">
                            <span className="typing">
                              <i />
                              <i />
                              <i />
                            </span>
                            <small>{live.length && live[live.length - 1].pending ? `Calling ${live[live.length - 1].name}…` : 'Thinking…'}</small>
                          </div>
                          {live.length > 0 && <Steps steps={live} />}
                        </div>
                      </div>
                    )}
                  </div>
                  <form
                    className="composer"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void send();
                    }}
                  >
                    <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. I sleep 01:00 to 08:00 IST" aria-label="Message Yojimbo" data-film="composer" />
                    <button className="pill pill-navy send" disabled={busy}>
                      {busy ? 'Thinking…' : 'Send'}
                    </button>
                  </form>
                  <details className="trace">
                    <summary>Raw tool JSON ({trace.length})</summary>
                    <div className="trace-body">{trace.length ? trace.map((t, i) => <pre key={i}>{JSON.stringify(t, null, 2)}</pre>) : <p>No tool calls yet.</p>}</div>
                  </details>
                </section>
              </div>

              {/* (2) Protection */}
              <aside className="dash-rail">
                <section className="card prot-card" id="protection" aria-labelledby="protection-title" data-film="protection">
                  <div className="card-title">
                    <div>
                      <p className="lbl">Protection</p>
                      <h2 id="protection-title">{guard.word}</h2>
                    </div>
                    <span className={`guard-dot g-${guard.tone}`} aria-hidden="true" />
                  </div>
                  {guard.note && <p className="prot-note">{guard.note}</p>}
                  <dl className="prot-list">
                    <div>
                      <dt>Acts when</dt>
                      <dd>
                        risk ratio falls under <b className="num">{alert.toFixed(2)}</b>
                      </dd>
                    </div>
                    <div>
                      <dt>What it does</dt>
                      <dd>{memory === null && !errors.memory ? '…' : rules[0] ? `“${rules[0].memory.text}”` : memorySetup ? 'Setup required: Walrus Memory' : 'No rule yet. Tell it in chat.'}</dd>
                    </div>
                    <div>
                      <dt>Max per defence</dt>
                      <dd>
                        {caps ? (
                          <>
                            <b className="gold-num num">{caps.perActionUsdc} USDC</b> · {caps.dailyUsdc} USDC a day
                          </>
                        ) : (
                          '—'
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Sleep schedule</dt>
                      <dd>{memory === null && !errors.memory ? '…' : schedules[0] ? `“${schedules[0].memory.text}”` : memorySetup ? 'Setup required: Walrus Memory' : 'Not set yet'}</dd>
                    </div>
                    <div>
                      <dt>Telegram</dt>
                      <dd>
                        {status ? (
                          telegramOn ? (
                            <>
                              <span className="dot ok" aria-hidden="true" />
                              {status.telegram === 'Telegram ready' ? 'Connected · @Yojimbo_robot' : status.telegram}
                            </>
                          ) : (
                            <>
                              <span className="dot warn" aria-hidden="true" />
                              Setup required
                            </>
                          )
                        ) : (
                          '…'
                        )}
                      </dd>
                    </div>
                  </dl>
                  {visibleDecision && (
                    <div className="now" data-film="decision">
                      <p className="lbl">Right now</p>
                      <p>
                        <b>{visibleDecision.mode}</b> · would <b>{visibleDecision.action}</b>
                        {visibleDecision.amountUsdc ? ` ${visibleDecision.amountUsdc} USDC` : ''}
                      </p>
                      <blockquote>“{visibleDecision.quote}”</blockquote>
                      <small>
                        Recalled {visibleDecision.recalledBlobIds.length} · {activeAssess?.decisionSource ?? (memorySetup ? 'Walrus Memory setup required' : 'Walrus Memory')}
                      </small>
                    </div>
                  )}
                  {state && activeId && (
                    <div className="dry">
                      <button className="pill pill-line pill-block" onClick={dryRunDefence} disabled={dryBusy} data-film="dry-run">
                        {dryBusy ? 'Checking…' : 'Dry-run the defence'}
                      </button>
                      <span>Never sends a transaction.</span>
                    </div>
                  )}
                  {dryRun && (
                    <p className={`guardrail ${dryRun.ok ? 'ok' : 'refused'}`} role="status">
                      <b>{dryRun.ok ? 'Dry-run result' : 'Guard rail · refused'}</b> {dryRun.text}
                    </p>
                  )}
                </section>
              </aside>
            </div>
          </div>
        )}

        {route === 'memory' && (
          <div className="page">
            <header className="dash-head">
              <div>
                <p className="lbl">{localRules ? 'Local rules file (fork)' : 'Walrus mainnet'}</p>
                <h1>What it remembers</h1>
                <p className="dash-sub">
                  {localRules
                    ? 'Read from docs/fork-rules.json on this machine. This is not Walrus Memory.'
                    : 'Every hour, rule and correction you gave it, each stored on Walrus. Forgotten ones stay visible, struck through.'}
                </p>
              </div>
              <button className="pill pill-navy pill-sm" onClick={() => toChat()}>
                Tell it a rule
              </button>
            </header>
            {memory && kept.length > 0 && (
              <dl className="stats3" aria-label="Memory counts">
                <div>
                  <dt>Memories on Walrus</dt>
                  <dd className="gold-num">{kept.length}</dd>
                </div>
                <div>
                  <dt>In use</dt>
                  <dd>{kept.filter((h) => !gone.has(h.memory.id) && h.memory.kind !== 'retire').length}</dd>
                </div>
                <div>
                  <dt>Forgotten</dt>
                  <dd>{kept.filter((h) => gone.has(h.memory.id)).length}</dd>
                </div>
              </dl>
            )}
            {visibleDecision && (
              <p className="recalled card">
                <b>Last recall: {visibleDecision.recalledBlobIds.length} memories</b>
                <span>
                  next move: {visibleDecision.action} · “{visibleDecision.quote}”
                </span>
              </p>
            )}
            {errors.memory && <State title="Couldn’t read memories" text={errors.memory} error />}
            <section className="card" id="memory" aria-labelledby="memory-title" data-film="memories">
              <div className="card-title">
                <div>
                  <h2 id="memory-title">Memories</h2>
                  <p>Newest first. Each one links to its Walrus blob.</p>
                </div>
              </div>
              {memory === null && !errors.memory ? (
                <div className="mem-grid">
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className="skeleton mem-skel" />
                  ))}
                </div>
              ) : kept.length ? (
                <div className="mem-grid memories">
                  {[...kept]
                    .sort((a, b) => String(b.memory.createdAt).localeCompare(String(a.memory.createdAt)))
                    .map((h) => {
                      const old = h.memory.supersedes ? hits.find((x) => x.memory.id === h.memory.supersedes) : undefined;
                      const forgotten = gone.has(h.memory.id);
                      return (
                        <article className={`memory kind-${h.memory.kind}${forgotten ? ' forgotten' : ''}`} key={h.blobId} data-film={forgotten ? 'memory-forgotten' : 'memory'}>
                          <div className="mem-top">
                            <span className="mem-tag">{forgotten ? 'Forgotten · no longer used' : KIND_LABEL[h.memory.kind] ?? h.memory.kind}</span>
                            <time dateTime={h.memory.createdAt}>{ago(h.memory.createdAt)}</time>
                          </div>
                          <p className="mem-text">
                            {forgotten ? <s>{h.memory.text}</s> : h.memory.text}
                            {h.memory.kind === 'retire' && Array.isArray(h.memory.ids) && <span className="mem-sub"> · {h.memory.ids.length} memories</span>}
                          </p>
                          {h.memory.supersedes && (
                            <p className="supersedes">
                              replaces: <s>{old?.memory.text ?? h.memory.supersedes}</s>
                            </p>
                          )}
                          {h.blobId.startsWith('local-file:') ? (
                            <span className="ext">
                              <span className="mono">{h.blobId}</span> <ForkTag text="local file" />
                            </span>
                          ) : (
                            <a className="ext" target="_blank" rel="noreferrer" href={`https://walruscan.com/mainnet/blob/${h.blobId}`} data-film="blob-link">
                              Blob <span className="mono">{short(h.blobId)}</span> <ArrowOut />
                            </a>
                          )}
                        </article>
                      );
                    })}
                </div>
              ) : localRules ? (
                <div className="mem-grid memories">
                  {localRuleIds.map((id) => (
                    <article className="memory kind-rule" key={id}>
                      <div className="mem-top">
                        <span className="mem-tag">Recalled from the local rules file</span>
                      </div>
                      <p className="mem-text mono">{id.replace(/^local-file:/, '')}</p>
                      <span className="ext">
                        <span className="mono">{id}</span> <ForkTag text="local file" />
                      </span>
                    </article>
                  ))}
                </div>
              ) : (
                !errors.memory && (
                  <State
                    art="/art/yojimbo-empty-memory.webp"
                    title={memorySetup ? 'Setup required: Walrus Memory' : 'No rules yet'}
                    detail={memorySetup ? 'MEMWAL_MAINNET_KEY / MEMWAL_MAINNET_ACCOUNT_ID' : undefined}
                    text="Your hours, rules and corrections are stored on Walrus. Every defence quotes the one it followed."
                  />
                )
              )}
            </section>
          </div>
        )}

        {route === 'log' && (
          <div className="page">
            <header className="dash-head">
              <div>
                <p className="lbl">{events ? `${events.length} defence${events.length === 1 ? '' : 's'}` : 'Defences'}</p>
                <h1>Night log</h1>
                <p className="dash-sub">Each defence with the ratio before and after, the rule it followed and the transaction.</p>
              </div>
              <Link to="/app" className="pill pill-navy pill-sm">
                Back to the guard
              </Link>
            </header>
            {notifications.length > 0 && (
              <section className="card notices" aria-label="Alerts">
                <p className="lbl">Alerts sent {telegramOn ? 'here and on Telegram' : 'in this page'}</p>
                {notifications.map((n, i) => (
                  <p className="notice" key={i}>
                    {n}
                  </p>
                ))}
              </section>
            )}
            {errors.events && <State title="Couldn’t read the night log" text={errors.events} error />}
            <section className="card" id="log" aria-labelledby="log-title" data-film="log">
              <div className="card-title">
                <div>
                  <h2 id="log-title">Defences</h2>
                  <p>Newest first.</p>
                </div>
              </div>
              {events === null && !errors.events ? (
                <div className="log">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="skeleton log-skel" />
                  ))}
                </div>
              ) : events && events.length ? (
                <div className="log">
                  <div className="log-head" aria-hidden="true">
                    <span>What it did</span>
                    <span>Risk ratio</span>
                    <span>Rule it followed</span>
                    <span>Proof</span>
                  </div>
                  {[...events]
                    .sort((a, b) => b.at.localeCompare(a.at))
                    .map((e) => {
                      const followed = e.ruleIds.map((id) => hits.find((h) => h.memory.id === id)?.memory.text ?? id);
                      return (
                        <article className="event" key={e.id} data-film="event">
                          <div className="ev-what">
                            <b>
                              {e.action} {e.amountUsdc} USDC
                            </b>
                            <span className={`outcome o-${/fail|error|refus/i.test(e.outcome) ? 'bad' : /dry/i.test(e.outcome) ? 'dry' : 'ok'}`}>{e.outcome}</span>
                            <time dateTime={e.at}>{new Date(e.at).toLocaleString()}</time>
                          </div>
                          <div className="ev-ratio num" data-film="event-ratio">
                            <b>{e.beforeRatio.toFixed(3)}</b> → <b className={e.afterRatio != null ? 'gold-num' : ''}>{e.afterRatio?.toFixed(3) ?? 'not executed'}</b>
                            <small>
                              SUI ${e.suiPrice.toFixed(4)} · {e.mode}
                            </small>
                          </div>
                          <div className="ev-rule">
                            {followed.length ? followed.map((t, i) => <q key={i}>{t}</q>) : <span className="fine">No rule</span>}
                            <small>Recalled {e.recalledBlobIds.length} memories</small>
                          </div>
                          <div className="ev-links">
                            {e.txDigest &&
                              (fork || /fork/i.test(e.outcome) ? (
                                <span className="ext" title="This transaction exists only on the local fork; it is not on Suiscan">
                                  <span className="mono">{short(e.txDigest)}</span> <ForkTag />
                                </span>
                              ) : (
                                <a className="ext" target="_blank" rel="noreferrer" href={`https://suiscan.xyz/mainnet/tx/${e.txDigest}`} data-film="event-tx">
                                  Transaction <ArrowOut />
                                </a>
                              ))}
                            {e.memoryBlobId && (
                              <a className="ext" target="_blank" rel="noreferrer" href={`https://walruscan.com/mainnet/blob/${e.memoryBlobId}`}>
                                Event memory <ArrowOut />
                              </a>
                            )}
                          </div>
                        </article>
                      );
                    })}
                </div>
              ) : (
                !errors.events && <State art="/art/yojimbo-empty-log.webp" title="A quiet night" text="No defence yet. Every one lands here with its before and after ratio, the rule it followed and the transaction." />
              )}
            </section>
          </div>
        )}
      </main>
      <footer className="app-foot">
        <span>Yojimbo · DeepBook Margin on {fork ? fork.label : 'Sui mainnet'} · chain reads: {status?.rpc ?? '…'} · memory: {localRules ? 'local rules file (fork)' : 'Walrus Memory'}</span>
        <span>MIT · © 2026 Nivesh Gajengi · Art generated with ChatGPT</span>
      </footer>
    </div>
  );
}

/* ---------- landing ---------- */
function Landing(props: {
  status: Status | null;
  memoryCount: number | null;
  memoryError?: string;
  memorySetup: boolean;
  events: EventRow[] | null;
  watched: any;
  registry: any;
  caps?: { perActionUsdc: number; dailyUsdc: number };
}) {
  const { status, memoryCount, events, watched, registry, caps } = props;
  const telegramOn = !!status && !status.telegram.startsWith('Setup');
  const mem = memoryCount == null ? (props.memoryError ? '—' : '…') : String(memoryCount);
  const price = watched?.price != null ? `$${Number(watched.price).toFixed(4)}` : '…';
  return (
    <>
      <header className="l-nav">
        <Link to="/" className="bar-logo" aria-label="Yojimbo home">
          <Wordmark />
        </Link>
        <nav aria-label="Sections">
          <a href="#jobs">What it does</a>
          <a href="#how">How it works</a>
          <a href="#security">Safety</a>
        </nav>
        <div className="l-nav-end">
          <Link to="/app" className="pill pill-navy pill-sm" data-film="launch">
            Open the app
          </Link>
        </div>
      </header>

      <main id="main">
        <section className="hero">
          <div className="hero-copy">
            <p className="hero-lbl">
              <span className="live-dot" aria-hidden="true" />
              AI bodyguard · DeepBook Margin on Sui
            </p>
            <h1>
              A bodyguard for your leverage <span>while you sleep.</span>
            </h1>
            <p className="lede">Tell it your hours and your rules in plain words. It watches your borrowed-money trade every 15 seconds and steps in before you get sold out.</p>
            <div className="hero-num" aria-live="polite">
              <b>{mem}</b>
              <span>{props.memorySetup ? 'Walrus Memory setup required' : 'rules, hours and corrections it remembers · Walrus mainnet'}</span>
            </div>
            <div className="hero-cta">
              <Link to="/app" className="pill pill-navy pill-lg" data-film="hero-cta">
                Open the app <Arrow />
              </Link>
              <a href="#how" className="pill pill-line pill-lg">
                How it works
              </a>
            </div>
          </div>
          <figure className="hero-frame">
            <img src="/art/yojimbo-hero.webp" alt="A guard keeps watch on the veranda while the owner sleeps inside" width={1536} height={1024} loading="eager" />
          </figure>
        </section>

        <dl className="kpis" aria-label="Live numbers">
          <div>
            <dt>Memories on Walrus</dt>
            <dd className="gold-num">{mem}</dd>
          </div>
          <div>
            <dt>Defences in the night log</dt>
            <dd>{events ? events.length : '…'}</dd>
          </div>
          <div>
            <dt>SUI price · live oracle</dt>
            <dd>{price}</dd>
          </div>
          <div>
            <dt>Liquidation line · pool rule</dt>
            <dd>{registry?.liquidation != null ? Number(registry.liquidation).toFixed(2) : '…'}<small> risk ratio</small></dd>
          </div>
        </dl>

        <section className="l-sec" id="jobs">
          <header className="l-head center">
            <p className="lbl">What it does</p>
            <h2>One bodyguard, three jobs.</h2>
          </header>
          <div className="products">
            <article className="product">
              <img className="product-art" src="/art/yojimbo-wave-gauge.webp" alt="" width={1536} height={1024} />
              <div className="product-top">
                <span className="vtag vtag-navy">Watch</span>
                <span className="status">
                  <i className="live-dot" />
                  Live · Sui mainnet
                </span>
              </div>
              <h3>Watches your risk</h3>
              <p>Reads your position every 15 seconds through Tatum and knows how far SUI can fall before you are liquidated.</p>
              <div className="product-num">
                <b>15 s</b>
                <span>between reads</span>
              </div>
              <Link to="/app" className="pill pill-line pill-block">
                See the position
              </Link>
            </article>
            <article className="product">
              <img className="product-art" src="/art/yojimbo-feature-2.webp" alt="" width={1024} height={1024} />
              <div className="product-top">
                <span className="vtag vtag-seal">Remember</span>
                <span className="status">
                  <i className={props.memorySetup ? 'warn-dot' : 'ok-dot'} />
                  {props.memorySetup ? 'Setup required' : 'Walrus mainnet'}
                </span>
              </div>
              <h3>Remembers your rules</h3>
              <p>Your sleeping hours, your rules and every correction are stored on Walrus. Tell it to forget one and it stops using it.</p>
              <div className="product-num">
                <b className="gold-num">{mem}</b>
                <span>memories stored</span>
              </div>
              <Link to="/memory" className="pill pill-line pill-block">
                See what it remembers
              </Link>
            </article>
            <article className="product">
              <img className="product-art" src="/art/yojimbo-feature-1.webp" alt="" width={1024} height={1024} />
              <div className="product-top">
                <span className="vtag">Defend</span>
                <span className="status">
                  <i className={telegramOn ? 'ok-dot' : 'warn-dot'} />
                  {!status ? 'Connecting…' : telegramOn ? 'Telegram alerts on' : 'Telegram setup required'}
                </span>
              </div>
              <h3>Defends inside your caps</h3>
              <p>Adds collateral or trims the trade, never above your cap, and messages you on Telegram first. Each defence quotes the rule it followed.</p>
              <div className="product-num">
                <b>{caps ? `${caps.perActionUsdc} USDC` : '…'}</b>
                <span>most it spends per defence</span>
              </div>
              <Link to="/log" className="pill pill-line pill-block">
                See the night log
              </Link>
            </article>
          </div>
        </section>

        <div className="band band-navy">
          <section className="l-sec" id="how">
            <header className="l-head center">
              <p className="lbl">How it works</p>
              <h2>Tell it once. It keeps watch.</h2>
            </header>
            <ol className="steps3">
              <li>
                <span className="step-n">01</span>
                <h3>Tell it your rules</h3>
                <p>“I sleep 01:00 to 08:00 IST. At night add collateral, never close, at most 3 USDC.” Each rule becomes a Walrus memory.</p>
              </li>
              <li>
                <span className="step-n">02</span>
                <h3>It watches</h3>
                <p>Every 15 seconds it reads your risk ratio: what your trade owns divided by what it owes. Below your alert line it gets ready.</p>
              </li>
              <li>
                <span className="step-n">03</span>
                <h3>It defends and tells you</h3>
                <p>It messages you on Telegram, then adds collateral or trims within your caps, and logs the ratio before and after.</p>
              </li>
            </ol>
          </section>
        </div>

        <div className="band band-seal">
          <section className="l-sec" id="security">
            <header className="l-head center">
              <img className="sec-art" src="/art/yojimbo-object-3.webp" alt="" width={768} height={768} />
              <p className="lbl">Safety</p>
              <h2>It can only do what you allow.</h2>
            </header>
            <div className="safety">
              <article className="safe">
                <span className="safe-k">01</span>
                <h3>Its own wallet</h3>
                <p>It trades only from its own bot wallet, holding only what you let it risk. Never your main wallet.</p>
              </article>
              <article className="safe">
                <span className="safe-k">02</span>
                <h3>Hard caps</h3>
                <p>A cap per defence and per day is enforced on the server, whatever the chat says.</p>
              </article>
              <article className="safe">
                <span className="safe-k">03</span>
                <h3>Your words, on record</h3>
                <p>Every rule is a Walrus memory with a public blob ID. Each defence quotes the one it followed.</p>
              </article>
              <article className="safe">
                <span className="safe-k">04</span>
                <h3>Dry-run until you say so</h3>
                <p>Sending on mainnet needs an explicit server flag. Until then every defence is only simulated.</p>
              </article>
            </div>
            <div className="sec-links">
              {status?.wallet && (
                <a href={`https://suiscan.xyz/mainnet/account/${status.wallet}`} target="_blank" rel="noreferrer" className="pill pill-line pill-sm">
                  Bot wallet on SuiScan <ArrowOut />
                </a>
              )}
              <span className={`pp ${status?.mainnetWrites ? 'pp-ok' : ''}`}>
                <i />
                {status ? (status.fork ? 'Local fork' : status.mainnetWrites ? 'Mainnet sends on' : 'Dry-run only right now') : 'Connecting…'}
              </span>
            </div>
          </section>
        </div>

        <section className="cta-band">
          <img className="cta-art" src="/art/yojimbo-guardian-seated.webp" alt="" width={768} height={768} />
          <div>
            <h2>Go to sleep. It’s on guard.</h2>
            <p>Open the app, pick a position and tell Yojimbo your rules.</p>
          </div>
          <Link to="/app" className="pill pill-gold pill-lg">
            Open the app <Arrow />
          </Link>
        </section>
      </main>

      <footer className="l-foot">
        <div className="l-foot-row">
          <div className="l-foot-brand">
            <Wordmark />
            <p>An AI bodyguard for DeepBook Margin positions on Sui. Reads through Tatum, memory on Walrus, alerts on Telegram.</p>
          </div>
          <nav aria-label="Footer">
            <Link to="/app">Guard</Link>
            <Link to="/memory">Memory</Link>
            <Link to="/log">Night log</Link>
          </nav>
        </div>
        <p className="l-foot-legal">MIT · © 2026 Nivesh Gajengi · Art generated with ChatGPT · Total Recall, track 02</p>
      </footer>
    </>
  );
}

const Wordmark = () => (
  <span className="wordmark">
    <img className="mark-img" src="/art/yojimbo-mark.webp" alt="" width={34} height={34} />
    <span className="wm">Yojimbo</span>
    <em className="wm-ja" lang="ja">
      用心棒
    </em>
  </span>
);

type StepState = 'done' | 'todo' | 'setup' | 'loading';
function journeySteps(status: Status | null, position: any, rules: number, memorySetup: boolean, writesLive: boolean): StepState[] {
  if (!status) return ['loading', 'loading', 'loading', 'loading'];
  const wallet = !!status.wallet;
  const funded = wallet && Number(status.balanceMist) > 0 && Number(status.usdcBalance) > 0;
  const open = wallet && (Number(position?.state?.quoteDebt) > 0 || Number(position?.state?.baseDebt) > 0);
  return [!wallet ? 'setup' : funded ? 'done' : 'todo', !wallet ? 'setup' : open ? 'done' : 'todo', memorySetup ? 'setup' : rules > 0 ? 'done' : 'todo', open && writesLive ? 'done' : !wallet ? 'setup' : 'todo'];
}
const STATE_WORD: Record<StepState, string> = { done: 'Done', todo: 'To do', setup: 'Setup required', loading: 'Checking…' };
const RULE_CHIPS = ['I sleep 01:00 to 08:00 IST every day', 'At night add collateral, never close the position'];

async function post(path: string, data: unknown) {
  const r = await fetch(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const v = await r.json();
  if (!r.ok) throw new Error(String(v.error || `HTTP ${r.status}`).replace(/^Error:\s*/, ''));
  return v;
}
const sent = (r: any) => r?.mode === 'mainnet' || r?.mode === 'fork';
const outcome = (r: any) => {
  const failed = r?.status?.status === 'failure' ? ` · ${sent(r) ? 'failed' : 'dry run failed'}: ${r.status.error ?? 'unknown error'}` : '';
  const tx = r.txDigest ? ` · tx ${String(r.txDigest)}${r.mode === 'fork' ? ' (fork only, not on Suiscan)' : ''}` : '';
  return `${r.note ?? r.mode}${tx}${failed}`;
};

/** The newcomer's path, with live status on every step: fund the bot wallet, open the position, give it rules,
 * let it watch. Yojimbo acts only through its own wallet because DeepBook Margin keeps a manager's caps inside the
 * MarginManager and checks the sender, so they cannot be delegated to the user's wallet. */
function Journey(props: {
  variant: 'panel' | 'inline';
  status: Status | null;
  position: any;
  registry: any;
  caps?: { perActionUsdc: number; dailyUsdc: number };
  memorySetup: boolean;
  fork: Status['fork'];
  localRules: boolean;
  writesLive: boolean;
  states: StepState[];
  busy: boolean;
  onRules: (preset?: string) => void;
  onDone: () => void;
}) {
  const { status, position, registry, caps, states } = props;
  const [deposit, setDeposit] = useState('6');
  const [borrow, setBorrow] = useState('3');
  const [copied, setCopied] = useState(false);
  const [run, setRun] = useState<{ busy: boolean; lines: { label: string; text: string; ok: boolean }[] } | null>(null);
  const wallet = status?.wallet ?? null;
  const d = Number(deposit),
    b = Number(borrow);
  const valid = Number.isFinite(d) && Number.isFinite(b) && d > 0 && b > 0;
  const leverage = valid ? (d + b) / d : null;
  const ratio = valid ? (d + b) / b : null;
  const minBorrow: number | undefined = registry?.minBorrow;
  const liq: number | undefined = registry?.liquidation;
  const cap = caps?.perActionUsdc;
  const problem = !valid
    ? 'Enter both amounts in USDC.'
    : cap != null && (d > cap || b > cap)
      ? `Each amount must be at most ${cap} USDC, the per-action cap (YOJIMBO_MAX_DEFENCE_USDC).`
      : minBorrow != null && ratio! < minBorrow
        ? `A ${ratio!.toFixed(2)} ratio is under the pool's minimum borrow ratio ${minBorrow.toFixed(2)}. Borrow less.`
        : '';
  const hasManager = !!position?.managerId;
  const copy = async () => {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  const open = async () => {
    if (!wallet || problem || run?.busy) return;
    const lines: { label: string; text: string; ok: boolean }[] = [];
    setRun({ busy: true, lines });
    try {
      if (!hasManager) {
        const r = await post('/bot/create', {});
        lines.push({ label: 'Create the MarginManager', text: outcome(r), ok: sent(r) });
        if (!sent(r)) {
          lines.push({ label: 'Deposit, borrow and buy SUI', text: 'Not run: the manager only exists on chain once the create transaction is sent.', ok: false });
          return;
        }
      }
      const o = await post('/bot/open', { depositUsdc: d, borrowUsdc: b });
      lines.push({ label: 'Deposit, borrow and buy SUI', text: outcome(o), ok: sent(o) });
    } catch (e) {
      lines.push({ label: 'Refused', text: String((e as Error).message ?? e), ok: false });
    } finally {
      setRun({ busy: false, lines: [...lines] });
      props.onDone();
    }
  };
  const chip = (i: number) => <span className={`jchip s-${states[i]}`}>{STATE_WORD[states[i]]}</span>;
  return (
    <ol className={`journey ${props.variant}`} data-film="journey">
      <li className={`jstep s-${states[0]}`}>
        <div className="jhead">
          <span className="jnum">1</span>
          <h3>Fund the bot wallet</h3>
          {chip(0)}
        </div>
        <p className="jtext">Yojimbo acts only from its own wallet. Send it only the SUI (for fees) and USDC you allow it to risk.</p>
        {!status ? (
          <p className="fine">Checking the bot wallet…</p>
        ) : wallet ? (
          <>
            <div className="addr">
              <code>{wallet}</code>
              <button className="pill pill-line pill-sm" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            {props.fork && <p className="fine">Fork balances: funded from the fork-only hub wallet (scripts/fork-demo.sh). Nothing here is on mainnet.</p>}
            <dl className="jbal">
              <div>
                <dt>SUI</dt>
                <dd className="num">{status?.balanceMist != null ? (Number(status.balanceMist) / 1e9).toFixed(3) : '—'}</dd>
              </div>
              <div>
                <dt>USDC</dt>
                <dd className="num">{status?.usdcBalance != null ? (Number(status.usdcBalance) / 1e6).toFixed(2) : '—'}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="jsetup">
            Setup required: <code>YOJIMBO_BOT_KEY</code>
            <span>Create a fresh Sui key for Yojimbo alone, never your main wallet, and set it on the server.</span>
          </p>
        )}
      </li>

      <li className={`jstep s-${states[1]}`}>
        <div className="jhead">
          <span className="jnum">2</span>
          <h3>Open the position</h3>
          {chip(1)}
        </div>
        <p className="jtext">
          Yojimbo {hasManager ? 'uses its MarginManager' : 'creates a MarginManager'}, deposits your USDC, borrows USDC against it and buys SUI with both: a long SUI trade.
        </p>
        {states[1] === 'done' ? (
          <p className="jdone">
            Open: ratio {Number(position.state.riskRatio).toFixed(3)} on {short(position.managerId)}.
          </p>
        ) : (
          <>
            <div className="jform">
              <label>
                <span>Deposit</span>
                <span className="field">
                  <input inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} aria-label="Deposit USDC" />
                  <em>USDC</em>
                </span>
              </label>
              <label>
                <span>Borrow</span>
                <span className="field">
                  <input inputMode="decimal" value={borrow} onChange={(e) => setBorrow(e.target.value)} aria-label="Borrow USDC" />
                  <em>USDC</em>
                </span>
              </label>
            </div>
            <dl className="preview">
              <div>
                <dt>Leverage</dt>
                <dd className="num">{leverage ? `${leverage.toFixed(2)}×` : '—'}</dd>
              </div>
              <div>
                <dt>Starting ratio</dt>
                <dd className="num">{ratio ? ratio.toFixed(2) : '—'}</dd>
              </div>
              <div>
                <dt>Liquidation at</dt>
                <dd className="num">{liq != null ? liq.toFixed(2) : '—'}</dd>
              </div>
            </dl>
            <p className="fine">Ratio = (deposit + borrow) ÷ borrow, before fees and slippage. 90% of the USDC buys SUI at market.</p>
            {problem && <p className="err-line">{problem}</p>}
            <button className="pill pill-navy" onClick={open} disabled={!wallet || !!problem || run?.busy} data-film="open-position">
              {!status ? 'Checking…' : !wallet ? 'Setup required: YOJIMBO_BOT_KEY' : run?.busy ? 'Building…' : hasManager ? 'Open the position' : 'Create manager and open'}
            </button>
            {run && run.lines.length > 0 && (
              <ul className="jrun" role="status">
                {run.lines.map((l, i) => (
                  <li key={i} className={l.ok ? 'ok' : 'no'}>
                    <b>{l.label}</b> {l.text}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </li>

      <li className={`jstep s-${states[2]}`}>
        <div className="jhead">
          <span className="jnum">3</span>
          <h3>Tell it your rules</h3>
          {chip(2)}
        </div>
        <p className="jtext">Say when you sleep and what it may do. Each one is {props.localRules ? 'recalled' : 'kept on Walrus'} and quoted when Yojimbo acts.</p>
        {props.localRules ? (
          <p className="fine">On this fork the rules come from the local rules file docs/fork-rules.json, not Walrus Memory.</p>
        ) : (
          props.memorySetup && (
            <p className="jsetup">
              Setup required: <code>MEMWAL_MAINNET_KEY / MEMWAL_MAINNET_ACCOUNT_ID</code>
            </p>
          )
        )}
        <div className="chips">
          {RULE_CHIPS.map((c) => (
            <button key={c} className="chip" onClick={() => props.onRules(c)} disabled={props.busy}>
              {c}
            </button>
          ))}
        </div>
      </li>

      <li className={`jstep s-${states[3]}`}>
        <div className="jhead">
          <span className="jnum">4</span>
          <h3>It keeps watch</h3>
          {chip(3)}
        </div>
        <p className="jtext">
          Every 15 s it reads the position. When a rule fires it adds collateral, trims with a reduce-only order or repays debt, never above{' '}
          {caps ? `${caps.perActionUsdc} USDC a defence and ${caps.dailyUsdc} USDC a day` : 'your caps'}. While you’re awake it asks first.
        </p>
        <p className="fine">
          Now:{' '}
          {status
            ? props.fork
              ? props.fork.writes
                ? 'real transactions on the local fork only, never mainnet'
                : 'simulated on the local fork, nothing is sent'
              : status.mainnetWrites
                ? 'mainnet sends enabled'
                : 'dry-run only, nothing is sent'
            : 'connecting'}{' '}
          · alerts {status?.telegram?.startsWith('Setup') ? 'in this page only (Telegram not set up)' : 'here and on Telegram'}.
        </p>
      </li>
    </ol>
  );
}

const fmtAmt = (v: unknown) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '—');
  return n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 2 : 4 });
};

/** DeFi Saver-style ratio bar: liquidation on the left, your alert line, safe to the right. Linear from the pool's
 * liquidation ratio to a top that leaves room above the alert line; a ratio past the top pins to the right edge. */
function RiskBar({ ratio, liquidation, minBorrow, alert }: { ratio: number; liquidation?: number; minBorrow?: number; alert: number }) {
  const liq = liquidation ?? 1.1;
  const top = Math.max(2.5, alert + 1);
  const pct = (r: number) => Math.max(0, Math.min(100, ((r - liq) / (top - liq)) * 100));
  const at = ratio <= liq ? 0 : pct(ratio);
  const a = pct(alert);
  return (
    <div className="riskbar" data-film="risk-bar" role="img" aria-label={`Risk ratio ${ratioText(ratio)}. Liquidation at ${liquidation?.toFixed(2) ?? 'unknown'}, your alert line ${alert.toFixed(2)}.`}>
      <div className="rb-track">
        <span className="rb-danger" style={{ width: `${a}%` }} />
        {minBorrow != null && <span className="rb-tick" style={{ left: `${pct(minBorrow)}%` }} title={`Minimum to borrow ${minBorrow.toFixed(2)}`} />}
        <span className="rb-alert" style={{ left: `${a}%` }} />
        <span className="rb-mark" style={{ left: `${at}%` }}>
          <i />
        </span>
      </div>
      <div className="rb-labels">
        <span className="rb-l-liq">
          <b>Liquidation</b> {liquidation?.toFixed(2) ?? '—'}
        </span>
        <span className="rb-l-alert" style={{ left: `${a}%` }}>
          <b>Alert line</b> {alert.toFixed(2)}
        </span>
        <span className="rb-l-safe">
          <b>Safe</b> {ratio > top ? `${top.toFixed(1)}+` : ''}
        </span>
      </div>
    </div>
  );
}

function Keys({ keys, error }: { keys: { label: string; value: string; level: string }[]; error?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const missing = keys.filter((k) => k.level === 'setup').length;
  return (
    <div className="keys" ref={ref}>
      <button className="keys-btn" aria-expanded={open} aria-controls="keys-panel" onClick={() => setOpen((v) => !v)}>
        <span className="dots" aria-hidden="true">
          {keys.map((k) => (
            <i key={k.label} className={`d-${k.level}`} />
          ))}
        </span>
        <span className="keys-sum">{error ? 'Server unreachable' : keys.length ? (missing ? `${missing} to set` : 'All set') : '…'}</span>
      </button>
      {open && (
        <div className="keys-panel" id="keys-panel" role="dialog" aria-label="Keys and services">
          <p className="lbl">Keys and services</p>
          {error && <p className="err-line">Server unreachable: {error}</p>}
          <ul>
            {keys.map((k) => {
              const vars = setupVars(k.value);
              return (
                <li key={k.label}>
                  <i className={`d-${k.level}`} aria-hidden="true" />
                  <span className="k-label">{k.label}</span>
                  <span className="k-value">{vars ? 'Setup required' : k.value}</span>
                  {vars && <code>{vars}</code>}
                </li>
              );
            })}
          </ul>
          <p className="fine">Set these in the server environment. Nothing is faked while one is missing.</p>
        </div>
      )}
    </div>
  );
}

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="steps" aria-label="Tool calls" data-film="tool-steps">
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
              <p className="step-args">
                {s.args.map(([k, v]) => (
                  <span key={k}>
                    {k} <b>{v}</b>
                  </span>
                ))}
              </p>
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
  );
}

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

function Fact({ k, v, unit }: { k: string; v: string; unit?: string }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd className="num">
        {v}
        {unit && <small>{unit}</small>}
      </dd>
    </div>
  );
}

function State({ art, title, text, detail, error }: { art?: string; title: string; text: string; detail?: string; error?: boolean }) {
  return (
    <div className={`state ${error ? 'state-error' : ''} ${art ? 'state-art' : ''}`}>
      {art ? <img className="state-img" src={art} alt="" width={120} height={120} /> : <span className="state-mark" aria-hidden="true">{error ? '!' : '·'}</span>}
      <div>
        <strong>{title}</strong>
        {detail && <code className="vars">{detail}</code>}
        <p>{text}</p>
      </div>
    </div>
  );
}

const ForkTag = ({ text = 'fork' }: { text?: string }) => <span className="fork-tag">{text}</span>;

const ArrowOut = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="ico">
    <path d="M4 2.5h5.5V8M9.2 2.8 2.5 9.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Arrow = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="ico">
    <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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
