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
  fork?: { label: string; forkedAtCheckpoint: string; checkpoint: string; clockMs: number; writes: boolean } | null;
  watcherError: string | null;
  pending: string[];
};
type Step = { name: string; kind: string; pending: boolean; error: string; args: [string, string][]; result: [string, string][] };
type Message = { role: 'you' | 'yojimbo' | 'error'; text: string; at: string; steps?: Step[] };
type RecentManager = { managerId: string; owner: string; pool: string; lastActivity: string; activity: string; riskRatio: number; liquidationRatio: number };
type Cushion = { kind: 'none' } | { kind: 'at' } | { kind: 'move'; price: number; move: number; tier: 'danger' | 'watch' | 'safe' };
type Tier = 'danger' | 'watch' | 'safe';

const api = (path: string) =>
  fetch(`/api${path}`).then(async (r) => {
    const v = await r.json();
    if (!r.ok) throw new Error(String(v.error || `HTTP ${r.status}`).replace(/^Error:\s*/, ''));
    return v;
  });
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const KIND_LABEL: Record<string, string> = { schedule: 'Schedule', rule: 'Rule', override: 'Your correction' };
const STARTERS = [
  'How close is the position I am watching to liquidation?',
  'I sleep 01:00 to 08:00 IST every day',
  'At night add collateral, never close the position',
  'If the ratio drops under 1.3, cut half',
];
const STORY = [
  {
    art: '/art/yojimbo-night-watch.webp',
    step: '01 · Sleep',
    title: 'While you sleep',
    text: 'Your sleeping hours are a schedule kept on Walrus. Inside them Yojimbo guards alone: it adds USDC collateral, trims with a reduce-only order or repays debt, from its own bot wallet and never above the per-action cap.',
  },
  {
    art: '/art/yojimbo-plane-night.webp',
    step: '02 · Fly',
    title: 'While you fly',
    text: 'Say “Flying Tuesday 10:00 to 16:00 IST” and that window joins the schedule. Your rules and every correction are recalled before each move.',
  },
  {
    art: '/art/yojimbo-dawn.webp',
    step: '03 · Wake',
    title: 'When you wake',
    text: 'Awake, it asks first: Approve, Reduce or Ignore, falling back to your rule’s default after 60 seconds. The night log shows each defence and the rule it quoted.',
  },
];
const LANTERN: Record<Tier, string> = {
  safe: '/art/yojimbo-lantern-safe.webp',
  watch: '/art/yojimbo-lantern-watch.webp',
  danger: '/art/yojimbo-lantern-danger.webp',
};
const POSE: Record<string, { src: string; alt: string; label: string }> = {
  seated: { src: '/art/yojimbo-guardian-seated.webp', alt: 'The guardian sits at rest', label: 'At rest' },
  alert: { src: '/art/yojimbo-guardian-alert.webp', alt: 'The guardian rises, hand on his sword', label: 'On alert' },
  bow: { src: '/art/yojimbo-guardian-bow.webp', alt: 'The guardian bows', label: 'Done, bowing' },
};
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
const ratioTier = (r: number, liq: number) => (r <= liq ? 'bad' : r < 1.25 ? 'warn' : r < 1.5 ? 'mid' : 'ok');
/** "Setup required: A / B" → its variable names, so they can be listed in mono. */
const setupVars = (v: string | null | undefined) => {
  const m = /^Setup required:\s*(.+)$/.exec(v ?? '');
  return m ? m[1] : '';
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
  const [approved, setApproved] = useState(false);
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
      setApproved(choice === 'approve');
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
  const tier: Tier | null = cushion ? (cushion.kind === 'move' ? cushion.tier : cushion.kind === 'at' ? 'danger' : 'safe') : null;
  const tierWord = tier === 'danger' ? (cushion?.kind === 'at' ? 'Liquidatable' : 'Danger') : tier === 'watch' ? 'Watch' : tier === 'safe' ? 'Safe' : '';
  const kept = memory.filter((h) => ['schedule', 'rule', 'override'].includes(h.memory.kind));
  const memorySetup = status?.memory?.startsWith('Setup required');
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
  // The guardian follows the decision: at rest when Yojimbo would ignore, on alert when a defence is pending or the
  // guard rail refused it, bowing after you approved one.
  const pose = approved
    ? 'bow'
    : approval || (dryRun && !dryRun.ok) || (visibleDecision && visibleDecision.action !== 'ignore')
      ? 'alert'
      : 'seated';
  const keys = status
    ? [
        { label: 'Chain reads', value: status.rpc, level: status.rpc.startsWith('Setup') ? 'setup' : status.fork || status.rpc.startsWith('dev') ? 'warn' : 'ok' },
        { label: 'Walrus Memory', value: status.memory, level: status.memory.startsWith('Setup') ? 'setup' : 'ok' },
        { label: 'Bot wallet', value: status.wallet ? short(status.wallet) : 'Setup required: YOJIMBO_BOT_KEY', level: status.wallet ? 'ok' : 'setup' },
        { label: 'Telegram', value: status.telegram, level: status.telegram.startsWith('Setup') ? 'setup' : 'ok' },
        { label: 'Agent model', value: status.openRouter === 'ready' ? 'Key set (OpenRouter)' : status.openRouter, level: status.openRouter === 'ready' ? 'ok' : 'setup' },
      ]
    : [];
  const watchError = source === 'watch' ? errors.watch || errors.managers : errors.position;
  if (status)
    keys.push(
      fork
        ? { label: 'Writes', value: fork.writes ? 'Real transactions on the local fork only' : 'Simulated on the fork only', level: 'warn' }
        : { label: 'Writes', value: status.mainnetWrites ? 'Mainnet enabled' : 'Dry-run only (YOJIMBO_ALLOW_MAINNET unset)', level: status.mainnetWrites ? 'ok' : 'warn' },
    );
  const localRuleIds = (visibleDecision?.recalledBlobIds ?? []).filter((id) => id.startsWith('local-file:'));
  const localRules = !!fork && (memory.some((h) => h.blobId.startsWith('local-file:')) || localRuleIds.length > 0);
  const toChat = (preset?: string) => {
    document.getElementById('chat')?.scrollIntoView({ behavior: RM() ? 'auto' : 'smooth', block: 'center' });
    if (preset) void send(preset);
    else (document.querySelector('.composer input') as HTMLInputElement | null)?.focus({ preventScroll: true });
  };
  const steps4 = journeySteps(status, position, kept.length || (localRules ? localRuleIds.length || 1 : 0), !!memorySetup && !localRules, writesLive);
  const journey = (variant: 'panel' | 'inline') => (
    <Journey
      variant={variant}
      status={status}
      position={position}
      positionError={errors.position}
      registry={registry}
      caps={watched?.caps}
      rulesCount={kept.length}
      memorySetup={!!memorySetup}
      fork={fork}
      localRules={localRules}
      writesLive={writesLive}
      states={steps4}
      busy={busy}
      onRules={toChat}
      onDone={() => void refresh()}
    />
  );

  return (
    <div className={`app ${fork ? 'has-fork' : ''}`}>
      <a className="skip" href="#console">
        Skip to the guard console
      </a>

      <div className="stage" id="top">
        <div className="stage-bg" aria-hidden="true">
          <img src="/art/yojimbo-night-watch.webp" alt="" width={1536} height={1024} />
          <span className="stage-rain" />
          <span className="stage-shade" />
        </div>

        {fork && (
          <div className="fork-banner" role="note">
            <b>LOCAL FORK</b>
            <span>
              {fork.label} · now at checkpoint {fork.checkpoint} · transactions run only on this machine, never on mainnet
            </span>
          </div>
        )}
        <header className="top">
          <a className="brand" href="#top" aria-label="Yojimbo home">
            <img src="/art/yojimbo-mark.webp" alt="" width={36} height={36} />
            <span>
              Yojimbo <em lang="ja">用心棒</em>
            </span>
          </a>
          <nav className="top-nav" aria-label="Sections">
            <a href="#decision">Decision</a>
            <a href="#memory">Memory</a>
            <a href="#log">Night log</a>
            <a href="#how">How it keeps watch</a>
          </nav>
          <div className="top-right">
            <Keys keys={keys} error={errors.status} />
            <span className={`mode-pill ${fork ? 'fork' : status?.mainnetWrites ? 'live' : ''}`}>
              <i aria-hidden="true" />
              {status ? (fork ? (fork.writes ? 'Fork writes on' : 'Fork, simulate only') : status.mainnetWrites ? 'Real funds' : 'Dry-run only') : 'Connecting…'}
            </span>
          </div>
        </header>

        <div className="console-head">
          <div className="console-title">
            <h1>
              A bodyguard for your leverage <em>while you sleep.</em>
            </h1>
            <p>
              <span className={`live-dot ${fork ? 'fork' : ''}`} aria-hidden="true" /> DeepBook Margin · SUI/USDC ·{' '}
              {fork ? <b className="fork-word">{fork.label}</b> : 'read live from Sui mainnet'} every 15 s
              {status && (
                <span className="mode-inline"> · {fork ? (fork.writes ? 'fork writes on' : 'fork, simulate only') : status.mainnetWrites ? 'real funds' : 'dry-run only'}</span>
              )}
            </p>
          </div>
          <button className="stepper" aria-expanded={journeyOpen} aria-controls="journey" onClick={() => setJourneyOpen((v) => !v)}>
            <span className="stepper-label">
              Get guarded in 4 steps
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={journeyOpen ? 'up' : ''}>
                <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="stepper-steps">
              {JOURNEY_SHORT.map((t, i) => (
                <span key={t} className={`sp s-${steps4[i]}`}>
                  <i aria-hidden="true">{steps4[i] === 'done' ? <Check /> : i + 1}</i>
                  {t}
                </span>
              ))}
            </span>
          </button>
        </div>
        {journeyOpen && (
          <section className="journey-panel" id="journey" aria-label="Get guarded in 4 steps">
            {journey('panel')}
          </section>
        )}

        <main className="console" id="console">
          <section className="rail panel" aria-labelledby="guard-title">
            <div className="rail-head">
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
                <p className="rail-note">Real SUI/USDC margin managers, closest to liquidation first.</p>
                {managers === null && !errors.managers ? (
                  <div className="mgr-skeleton" aria-label="Loading managers">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span key={i} />
                    ))}
                  </div>
                ) : managers && managers.length ? (
                  <div className="mgrs" role="list">
                    {managers.map((m) => (
                      <button
                        role="listitem"
                        aria-current={watchId === m.managerId ? 'true' : undefined}
                        className={`mgr ${watchId === m.managerId ? 'on' : ''}`}
                        key={m.managerId}
                        onClick={() => selectManager(m.managerId)}
                        title={`${m.managerId}\nLast activity ${new Date(m.lastActivity).toLocaleString()} (${m.activity})`}
                      >
                        <span className="mgr-id">
                          <span className="mono">{short(m.managerId)}</span>
                          <small>{ago(m.lastActivity)}</small>
                        </span>
                        <span
                          className={`risk r-${ratioTier(m.riskRatio, m.liquidationRatio)}`}
                          title={m.riskRatio >= 1000 ? 'The chain reports its maximum risk ratio (1000) for this manager' : undefined}
                        >
                          {m.riskRatio >= 1000 ? '1000 · max' : m.riskRatio.toFixed(3)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  !errors.managers && <p className="rail-note">No recent SUI/USDC managers found.</p>
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
                <div className="bot-intro">
                  <img src="/art/yojimbo-seal-wallet.webp" alt="" width={72} height={72} />
                  <p>Yojimbo only ever acts on the position its own bot wallet owns, within your caps.</p>
                </div>
                <dl className="bot-facts">
                  <div>
                    <dt>Wallet</dt>
                    <dd className={status?.wallet ? 'mono' : 'setup'}>{status?.wallet ? short(status.wallet) : 'Setup required'}</dd>
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
                    <dd>{fork ? (fork.writes ? 'Local fork only' : 'Fork, simulate only') : status?.mainnetWrites ? 'Mainnet enabled' : 'Dry-run only'}</dd>
                  </div>
                </dl>
                {!status?.wallet && <code className="vars">YOJIMBO_BOT_KEY</code>}
                {status?.watcherError && !/^(Error:\s*)?Setup required/.test(status.watcherError) && (
                  <p className="error">{status.watcherError.replace(/^Error:\s*/, '')}</p>
                )}
              </div>
            )}
          </section>

          <section className={`instrument panel ${tier ? `is-${tier}` : ''}`} aria-labelledby="position-title">
            {approval && (
              <div className="approval" role="alert">
                <img src={POSE.alert.src} alt="" width={56} height={56} />
                <div className="approval-text">
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
              </div>
            )}
            <div className="inst-head">
              <div className="inst-title">
                <h2 id="position-title">{source === 'watch' ? 'Watched position' : 'Your position'}</h2>
                {source === 'watch' && watched && <span className="tag">Read-only · not yours, Yojimbo can’t act on it</span>}
              </div>
              {visiblePosition?.managerId &&
                (fork ? (
                  <span className="link fork-ref" title={`${visiblePosition.managerId} (state read from the local fork; not a Suiscan link)`}>
                    <span>MarginManager</span>
                    <span className="mono">{short(visiblePosition.managerId)}</span>
                    <ForkTag />
                  </span>
                ) : (
                  <a className="link" target="_blank" rel="noreferrer" href={`https://suiscan.xyz/mainnet/object/${visiblePosition.managerId}`}>
                    <span>MarginManager</span>
                    <span className="mono">{short(visiblePosition.managerId)}</span>
                    <ArrowOut />
                  </a>
                ))}
            </div>
            {state ? (
              <>
                <div className="inst-main">
                  <div className="ratio">
                    <span className="ratio-label">Risk ratio · assets ÷ debt</span>
                    <b>{Number(ratio).toFixed(3)}</b>
                  </div>
                  <figure className="guardian-fig">
                    <img className={`guardian g-${pose}`} key={pose} src={POSE[pose].src} alt={POSE[pose].alt} width={160} height={160} />
                    <figcaption>
                      {POSE[pose].label}
                      <span>{visibleDecision ? ` · ${visibleDecision.mode} · would ${visibleDecision.action}` : ' · mode needs Walrus Memory'}</span>
                    </figcaption>
                  </figure>
                </div>
                {cushion && tier && (
                  <div className={`cushion cushion-${tier}`}>
                    <img className={`lantern l-${tier}`} src={LANTERN[tier]} alt="" width={96} height={96} />
                    <div className="cushion-body">
                      <span className="cushion-chip">{tierWord}</span>
                      <p className="cushion-line">
                        {cushion.kind === 'move' ? (
                          <>
                            SUI can {cushion.move < 0 ? 'fall' : 'rise'} <b>{Math.abs(cushion.move * 100).toFixed(1)}%</b> before liquidation.
                          </>
                        ) : cushion.kind === 'at' ? (
                          <>The ratio is at or below the liquidation line now.</>
                        ) : (
                          <>No SUI price move alone can liquidate this position.</>
                        )}
                      </p>
                      {cushion.kind === 'move' && (
                        <p className="cushion-sub num">
                          Liquidation at SUI ${cushion.price.toFixed(4)} · now ${Number(visiblePosition.price).toFixed(4)}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                <Gauge ratio={Number(ratio)} liquidation={liquidation} minBorrow={minBorrow} alert={alert} tier={tier ?? 'safe'} />
                <dl className="facts">
                  <Fact k="SUI price" v={visiblePosition.price != null ? `$${Number(visiblePosition.price).toFixed(4)}` : '—'} />
                  {source === 'watch' && <Fact k="USDC oracle" v={watched.quotePrice != null ? `$${watched.quotePrice.toFixed(4)}` : '—'} />}
                  <Fact k="Collateral" v={fmtAmt(state.baseAsset)} unit="SUI" />
                  <Fact k="Quote held" v={fmtAmt(state.quoteAsset)} unit="USDC" />
                  <Fact k="Debt" v={fmtAmt(state.quoteDebt)} unit="USDC" />
                </dl>
              </>
            ) : source === 'watch' && watchId && !errors.watch ? (
              <div className="pos-skeleton" aria-label={`Reading the position from ${where}`}>
                <span className="s1" />
                <span className="s2" />
                <span className="s3" />
                <p>
                  Reading {short(watchId)} from {where}…
                </p>
              </div>
            ) : source === 'bot' ? (
              journey('inline')
            ) : (
              <div className="inst-empty">
                <img src="/art/yojimbo-lantern-safe.webp" alt="" width={140} height={140} />
                <h3>Nothing to guard yet</h3>
                <p>{watchError || 'Pick a manager on the left or paste its ID.'}</p>
              </div>
            )}
            {visibleRegistry && (
              <p className="thresholds">
                Pool thresholds read from {fork ? 'the local fork' : 'mainnet'}: liquidation {liquidation?.toFixed(2)}, minimum borrow {minBorrow?.toFixed(4)}.
              </p>
            )}
            {errors.registry && source === 'bot' && <p className="error">Registry: {errors.registry}</p>}
          </section>

          <section className="dock panel" id="chat" aria-labelledby="chat-title">
            <div className="dock-head">
              <img src={AVATAR} alt="" width={48} height={48} />
              <div>
                <h2 id="chat-title">Talk to your bodyguard</h2>
                <p>
                  <span className={`state-dot ${status?.openRouter === 'ready' ? 'ok' : 'warn'}`} aria-hidden="true" />
                  {status?.openRouter === 'ready' ? 'Real tool calls, shown under each answer' : status?.openRouter ?? 'Connecting…'}
                </p>
              </div>
            </div>
            <div className="thread" ref={thread} aria-live="polite">
              {messages.length === 0 && (
                <div className="welcome">
                  <img className="moon" src="/art/yojimbo-moon-phases.webp" alt="" width={1536} height={512} />
                  <p className="greet">Tell me your hours and your rules. I’ll remember them and keep watch.</p>
                  <p className="greet-sub">Try one:</p>
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
                  {m.role !== 'you' && <img className="avatar" src={AVATAR} alt="" width={32} height={32} />}
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
                <div className="message yojimbo-thinking" aria-label="Yojimbo is thinking">
                  <img className="avatar" src={AVATAR} alt="" width={32} height={32} />
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
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. Flying Tuesday 10:00 to 16:00 IST" aria-label="Message Yojimbo" />
              <button className="btn primary send" disabled={busy}>
                {busy ? 'Thinking…' : 'Send'}
              </button>
            </form>
            <details className="trace">
              <summary>
                <img src="/art/yojimbo-tool-brush.webp" alt="" width={22} height={22} /> Raw tool JSON ({trace.length})
              </summary>
              <div className="trace-body">
                {trace.length ? trace.map((t, i) => <pre key={i}>{JSON.stringify(t, null, 2)}</pre>) : <p>No tool calls yet.</p>}
              </div>
            </details>
          </section>
        </main>
      </div>

      <div className="paper">
        {state && activeAssess && (
          <section className="band decision" id="decision" aria-labelledby="decision-title">
            <div className="band-side">
              <p className="kicker">Decision</p>
              <h2 id="decision-title">What Yojimbo would do right now</h2>
              <p className="band-note">{activeAssess.decisionSource}</p>
            </div>
            <div className="band-main">
              <div className="verdict">
                <div>
                  <small>Mode</small>
                  <b>{visibleDecision?.mode ?? '—'}</b>
                </div>
                <div>
                  <small>Action</small>
                  <b>{visibleDecision?.action ?? '—'}</b>
                </div>
                <div>
                  <small>Amount</small>
                  <b>{visibleDecision?.amountUsdc ?? 0} USDC</b>
                </div>
              </div>
              <blockquote>“{visibleDecision?.quote}”</blockquote>
              {visibleDecision?.action === 'ignore' && /no remembered rules/i.test(String(activeAssess?.decisionSource ?? '')) && (
                <p className="hint">No rules yet, so Yojimbo only watches. Tell it in chat what to do, e.g. “below 1.15, add 10 USDC”.</p>
              )}
              <div className="decision-actions">
                <button className="btn primary big" onClick={dryRunDefence} disabled={dryBusy}>
                  {dryBusy ? 'Checking…' : 'Dry-run the defence'}
                </button>
                <span>Never sends a transaction.</span>
              </div>
              {dryRun && (
                <div className={`guardrail ${dryRun.ok ? 'ok' : 'refused'}`} role="status">
                  <img src={dryRun.ok ? POSE.bow.src : POSE.alert.src} alt="" width={64} height={64} />
                  <div>
                    <b>{dryRun.ok ? 'Dry-run result' : 'Guard rail · refused'}</b>
                    <p>{dryRun.text}</p>
                  </div>
                </div>
              )}
              <p className="nearby">
                <b>Nearby positions at liquidation:</b>{' '}
                {atLiq.length ? atLiq.map((m) => `${short(m.managerId)} (${m.riskRatio.toFixed(3)})`).join(', ') : 'none in the recent live sample.'}
              </p>
            </div>
          </section>
        )}

        <section className="band memory-band" id="memory" aria-labelledby="memory-title">
          <div className="band-side">
            <p className="kicker">{localRules ? 'Local rules file (fork)' : 'Walrus mainnet'}</p>
            <h2 id="memory-title">What it remembers</h2>
            {localRules && <p className="band-note">Read from docs/fork-rules.json on this machine. This is not Walrus Memory, which still needs setup.</p>}
            <img className="band-art" src="/art/yojimbo-scroll-rules.webp" alt="" width={160} height={160} />
          </div>
          <div className="band-main">
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
                      {h.blobId.startsWith('local-file:') ? (
                        <span className="local-ref">
                          <span className="mono">{h.blobId}</span> <ForkTag text="local file" />
                        </span>
                      ) : (
                        <a target="_blank" rel="noreferrer" href={`https://walruscan.com/mainnet/blob/${h.blobId}`}>
                          <span className="mono">{short(h.blobId)}</span> <ArrowOut />
                        </a>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : localRules ? (
              <div className="memories">
                {localRuleIds.map((id) => (
                  <article className="memory kind-rule" key={id}>
                    <span className="type">Recalled from the local rules file</span>
                    <p className="mono">{id.replace(/^local-file:/, '')}</p>
                    <span className="local-ref">
                      <span className="mono">{id}</span> <ForkTag text="local file" />
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                art="/art/yojimbo-empty-memory.webp"
                title={memorySetup ? 'Setup required: Walrus Memory' : 'No rules yet'}
                text="Your schedule, rules and corrections are stored on Walrus. Every defence quotes the one it followed."
                detail={memorySetup ? 'MEMWAL_MAINNET_KEY / MEMWAL_MAINNET_ACCOUNT_ID' : undefined}
              />
            )}
          </div>
        </section>

        <section className="band log-band" id="log" aria-labelledby="events-title">
          <div className="band-side">
            <p className="kicker">{events.length} defences</p>
            <h2 id="events-title">Night log</h2>
          </div>
          <div className="band-main">
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
                      <time dateTime={e.at}>{new Date(e.at).toLocaleString()}</time>
                    </div>
                    <p className="num">
                      ratio {e.beforeRatio.toFixed(3)} → {e.afterRatio?.toFixed(3) ?? 'not executed'} · SUI ${e.suiPrice.toFixed(4)} · {e.mode}
                    </p>
                    <p className="event-meta">
                      Recalled {e.recalledBlobIds.length} · rules {e.ruleIds.join(', ') || 'none'}
                    </p>
                    <div className="links">
                      {e.txDigest &&
                        (fork || /fork/i.test(e.outcome) ? (
                          <span className="local-ref" title="This transaction exists only on the local fork; it is not on Suiscan">
                            <span className="mono">{e.txDigest}</span> <ForkTag />
                          </span>
                        ) : (
                          <a target="_blank" rel="noreferrer" href={`https://suiscan.xyz/mainnet/tx/${e.txDigest}`}>
                            transaction <ArrowOut />
                          </a>
                        ))}
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
              <Empty art="/art/yojimbo-empty-log.webp" title="A quiet night" text="Every defence lands here with its before and after ratio, the rule it followed and the transaction." />
            )}
          </div>
        </section>
      </div>

      <section className="story" id="how" aria-labelledby="story-title">
        <div className="story-head">
          <p className="kicker">How it keeps watch</p>
          <h2 id="story-title">
            Sleep, fly, wake. <em>It keeps the same orders.</em>
          </h2>
        </div>
        <div className="story-grid">
          {STORY.map((b) => (
            <article className="story-card" key={b.title}>
              <div className="story-art">
                <img src={b.art} alt="" width={1536} height={1024} />
              </div>
              <div className="story-text">
                <span className="story-step">{b.step}</span>
                <h3>{b.title}</h3>
                <p>{b.text}</p>
              </div>
            </article>
          ))}
        </div>
        <footer className="foot">
          <img src="/art/yojimbo-mark.webp" alt="" width={22} height={22} />
          <span>
            Positions: DeepBook Margin on {fork ? fork.label : 'Sui mainnet'} · chain reads: {status?.rpc ?? 'Setup required'} · memory: {localRules ? 'local rules file (fork), not Walrus Memory' : 'Walrus Memory'} · art generated with ChatGPT.
          </span>
        </footer>
      </section>
    </div>
  );
}

type StepState = 'done' | 'todo' | 'setup' | 'loading';
const JOURNEY_SHORT = ['Fund', 'Open', 'Rules', 'Watch'];
function journeySteps(status: Status | null, position: any, rules: number, memorySetup: boolean, writesLive: boolean): StepState[] {
  if (!status) return ['loading', 'loading', 'loading', 'loading'];
  const wallet = !!status.wallet;
  const funded = wallet && Number(status.balanceMist) > 0 && Number(status.usdcBalance) > 0;
  const open = wallet && (Number(position?.state?.quoteDebt) > 0 || Number(position?.state?.baseDebt) > 0);
  return [
    !wallet ? 'setup' : funded ? 'done' : 'todo',
    !wallet ? 'setup' : open ? 'done' : 'todo',
    memorySetup ? 'setup' : rules > 0 ? 'done' : 'todo',
    open && writesLive ? 'done' : !wallet ? 'setup' : 'todo',
  ];
}
const STATE_WORD: Record<StepState, string> = { done: 'Done', todo: 'To do', setup: 'Setup required', loading: 'Checking…' };
const RULE_CHIPS = ['I sleep 01:00 to 08:00 IST every day', 'Flying Tuesday 10:00 to 16:00 IST', 'At night add collateral, never close the position'];

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
  positionError?: string;
  registry: any;
  caps?: { perActionUsdc: number; dailyUsdc: number };
  rulesCount: number;
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
  const [deposit, setDeposit] = useState('10');
  const [borrow, setBorrow] = useState('10');
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
    <ol className={`journey ${props.variant}`}>
      <li className={`jstep s-${states[0]}`}>
        <div className="jhead">
          <span className="jnum">1</span>
          <h3>Fund Yojimbo’s bot wallet</h3>
          {chip(0)}
        </div>
        <p className="jtext">
          Yojimbo acts only through its own wallet: DeepBook Margin keeps a position’s caps inside its MarginManager and checks the sender, so they
          can’t be handed to your wallet. From your own wallet, send only the SUI (for gas) and USDC you allow it to risk.
        </p>
        {wallet ? (
          <>
            <div className="addr">
              <code>{wallet}</code>
              <button className="btn ghost small" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            {props.fork && <p className="jfine">Fork balances: funded from the fork-only hub wallet (scripts/fork-demo.sh). Nothing here is on mainnet.</p>}
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
          <h3>Open your margin position</h3>
          {chip(1)}
        </div>
        <p className="jtext">
          Yojimbo {hasManager ? 'uses its MarginManager' : 'creates a MarginManager'}, deposits your USDC, borrows USDC against it and buys SUI with
          both: a long SUI position in the SUI/USDC pool.
        </p>
        {states[1] === 'done' ? (
          <p className="jdone">Open: ratio {Number(position.state.riskRatio).toFixed(3)} on {short(position.managerId)}.</p>
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
            <p className="jfine">Ratio = (deposit + borrow) ÷ borrow, before trading fees and slippage. 90% of the USDC buys SUI at market.</p>
            {problem && <p className="jwarn">{problem}</p>}
            <button className="btn primary" onClick={open} disabled={!wallet || !!problem || run?.busy}>
              {!wallet ? 'Setup required: YOJIMBO_BOT_KEY' : run?.busy ? 'Building…' : hasManager ? 'Open the position' : 'Create manager and open'}
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
        <p className="jtext">
          Say when you sleep or fly and what it may do. Each one is {props.localRules ? 'recalled' : 'kept on Walrus Memory'} and quoted when Yojimbo acts.
        </p>
        {props.localRules ? (
          <p className="jfine">On this fork the rules come from the local rules file docs/fork-rules.json, not Walrus Memory.</p>
        ) : props.memorySetup && (
          <p className="jsetup">
            Setup required: <code>MEMWAL_MAINNET_KEY / MEMWAL_MAINNET_ACCOUNT_ID</code>
          </p>
        )}
        <div className="jchips">
          {RULE_CHIPS.map((c) => (
            <button key={c} className="chip" onClick={() => props.onRules(c)} disabled={props.busy}>
              {c}
            </button>
          ))}
        </div>
        <button className="btn ghost" onClick={() => props.onRules()}>
          Write your own in chat
        </button>
      </li>

      <li className={`jstep s-${states[3]}`}>
        <div className="jhead">
          <span className="jnum">4</span>
          <h3>It keeps watch</h3>
          {chip(3)}
        </div>
        <p className="jtext">
          Every 15 s it reads the position. When a rule fires it adds USDC collateral, trims with a reduce-only order or repays debt, never above{' '}
          {caps ? `${caps.perActionUsdc} USDC an action and ${caps.dailyUsdc} USDC a day` : 'your per-action and daily caps'}. While you’re awake it asks
          first: Approve, Reduce or Ignore.
        </p>
        <p className="jfine">
          Now:{' '}
          {status
            ? props.fork
              ? props.fork.writes
                ? 'real transactions on the local fork only, never mainnet'
                : 'simulated on the local fork, nothing is sent'
              : status.mainnetWrites
                ? 'mainnet writes enabled'
                : 'dry-run only, nothing is sent'
            : 'connecting'}{' '}
          · alerts{' '}
          {status?.telegram?.startsWith('Setup') ? 'in this page only (Telegram not set up)' : 'here and on Telegram'}.
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

/** The ink sea rises toward the vermilion liquidation line as the ratio falls. Height is linear in ratio from the
 * liquidation line (top) down to 1.8 (floor); everything is drawn from the live ratio and the pool's thresholds. */
function Gauge({ ratio, liquidation, minBorrow, alert, tier }: { ratio: number; liquidation?: number; minBorrow?: number; alert: number; tier: Tier }) {
  const liq = liquidation ?? 1.1;
  const LINE = 26,
    FLOOR = 78,
    TOP = 1.8;
  const y = (r: number) => LINE + (FLOOR - LINE) * Math.max(0, Math.min(1, (r - liq) / (TOP - liq)));
  const sea = ratio <= liq ? LINE - 6 : y(ratio);
  const wave = 'M0 18 Q 50 4 100 18 T 200 18 T 300 18 T 400 18 T 500 18 T 600 18 T 700 18 T 800 18 V 40 H 0 Z';
  return (
    <div className="gauge-wrap">
      <div
        className={`gauge t-${tier}`}
        role="img"
        aria-label={`Risk ratio ${ratio.toFixed(3)}. Liquidation at ${liquidation?.toFixed(2) ?? 'unknown'}, minimum borrow ${minBorrow?.toFixed(2) ?? 'unknown'}, your alert ${alert.toFixed(2)}.`}
      >
        <span className="moon-dot" aria-hidden="true" />
        <span className="liq-line" style={{ top: `${LINE}%` }}>
          <em>Liquidation {liquidation?.toFixed(2) ?? '—'}</em>
        </span>
        {minBorrow != null && (
          <span className="mark-line" style={{ top: `${y(minBorrow)}%` }}>
            <em>Min borrow {minBorrow.toFixed(2)}</em>
          </span>
        )}
        <span className="mark-line alert" style={{ top: `${y(alert)}%` }}>
          <em>Your alert {alert.toFixed(2)}</em>
        </span>
        <div className="sea" style={{ top: `${sea}%` }}>
          <svg className="wave back" viewBox="0 0 800 40" preserveAspectRatio="none" aria-hidden="true">
            <path d={wave} />
          </svg>
          <svg className="wave front" viewBox="0 0 800 40" preserveAspectRatio="none" aria-hidden="true">
            <path d={wave} />
          </svg>
          <span className="sea-label num">
            {ratio >= 1000 ? '1000 · max' : ratio.toFixed(3)} now{ratio > TOP ? ' · above this scale' : ''}
          </span>
        </div>
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
    <div className="status" ref={ref}>
      <button className="keys-btn" aria-expanded={open} aria-controls="keys-panel" onClick={() => setOpen((v) => !v)}>
        <span>Keys</span>
        <span className="dots" aria-hidden="true">
          {keys.map((k) => (
            <i key={k.label} className={`d-${k.level}`} />
          ))}
        </span>
        <span className="keys-sum">{error ? 'Server unreachable' : keys.length ? (missing ? `${missing} to set` : 'All set') : '…'}</span>
      </button>
      {open && (
        <div className="keys-panel" id="keys-panel" role="dialog" aria-label="Keys and services">
          <p className="keys-title">Keys and services</p>
          {error && <p className="error">Server unreachable: {error}</p>}
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
          <p className="keys-foot">Set these in the server environment. Nothing is faked while one is missing.</p>
        </div>
      )}
    </div>
  );
}

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="steps" aria-label="Tool calls">
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

function Fact({ k, v, unit, text }: { k: string; v: string; unit?: string; text?: boolean }) {
  return (
    <div className={text ? 'is-text' : ''}>
      <dt>{k}</dt>
      <dd className="num">
        {v}
        {unit && <small>{unit}</small>}
      </dd>
    </div>
  );
}

function Empty({ art, title, text, detail }: { art: string; title: string; text: string; detail?: string }) {
  return (
    <div className="empty">
      <img src={art} alt="" width={140} height={140} />
      <div>
        <b>{title}</b>
        {detail && <code>{detail}</code>}
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
