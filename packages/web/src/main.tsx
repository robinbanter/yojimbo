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
  memoryError?: string;
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
  watcherCheckedAt?: string | null;
  alertRatio?: number;
  pending: string[];
};
type Step = { name: string; kind: string; pending: boolean; error: string; args: [string, string][]; result: [string, string][] };
type Message = { role: 'you' | 'yojimbo' | 'error'; text: string; at: string; steps?: Step[] };
type RecentManager = { managerId: string; owner: string; pool: string; lastActivity: string; activity: string; riskRatio: number; liquidationRatio: number };
type Cushion = { kind: 'none' } | { kind: 'at' } | { kind: 'move'; price: number; move: number; tier: 'danger' | 'watch' | 'safe' };
type Tier = 'danger' | 'watch' | 'safe';
type Route = 'home' | 'app' | 'memory' | 'log' | 'tx';

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
const ratioText = (r: number) => (r >= 1000 ? '999+' : r.toFixed(3));

/* ---------- tiny router ---------- */
const routeOf = (p: string): Route => (p.startsWith('/app') ? 'app' : p.startsWith('/memory') ? 'memory' : p.startsWith('/log') ? 'log' : p.startsWith('/tx/') ? 'tx' : 'home');
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
  const [unwind, setUnwind] = useState<{ busy: boolean; error?: string; steps?: { step: string; txDigest: string | null; status: string | null }[]; done?: boolean } | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [quote, setQuote] = useState<{ midPrice: number; lotSize: number; minSize: number; source: string } | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [opened, setOpened] = useState<{ label: string; text: string; ok: boolean; digest?: string; fork?: boolean }[]>([]);
  const [tick, setTick] = useState(() => Date.now());
  const [botWatched, setBotWatched] = useState<any>(null);
  const autoBot = useRef(false);

  const hadMemory = useRef(false);
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
          if (Array.isArray(v.hits) && v.hits.length) hadMemory.current = true;
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
          // A failed refresh keeps the last good memories on screen; only a first load that never succeeded shows the error.
          if (name === 'memory' && hadMemory.current) return;
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
    const load = () => api('/quote').then((q) => (setQuote(q), setQuoteError('')), (e) => setQuoteError(String((e as Error).message ?? e)));
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
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
      tx: 'Yojimbo · Fork transaction',
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
  // With no debt the chain reports its sentinel ratio (1000); the UI shows "No debt" instead of that number.
  const noDebt = !!state && Number(state.baseDebt) === 0 && Number(state.quoteDebt) === 0;
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
  const hits = memory ?? [];
  const gone = new Set<string>(hits.flatMap((h) => (h.memory.kind === 'retire' && Array.isArray(h.memory.ids) ? h.memory.ids : [])));
  const kept = hits.filter((h) => ['schedule', 'rule', 'override', 'retire'].includes(h.memory.kind));
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
  const unwindFork = async () => {
    if (unwind?.busy) return;
    setUnwind({ busy: true });
    try {
      const r = await post('/bot/unwind', {});
      setUnwind({ busy: false, steps: r.steps, done: r.done });
    } catch (e) {
      setUnwind({ busy: false, error: String((e as Error).message ?? e) });
    } finally {
      void refresh();
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

  // The guard at a glance, all from live state. The trigger and amount repeat the rule engine's own choice
  // (packages/core/src/policy.ts decide): the newest stated alert ratio (else the server default), and the matching
  // rule with the lowest threshold, its stated max (else 10) clamped by the server's per-defence cap.
  const liveHits = kept.filter((h) => h.memory.kind !== 'retire' && !gone.has(h.memory.id));
  const liveRules = liveHits.filter((h) => h.memory.kind === 'rule' || h.memory.kind === 'override');
  const liveSchedules = liveHits.filter((h) => h.memory.kind === 'schedule') as unknown as SchedHit[];
  const tz = mostCommon(liveSchedules.map((h) => h.memory.timezone)) ?? 'Asia/Kolkata';
  const ruleMems = liveRules.filter((h) => h.memory.kind === 'rule').map((h) => h.memory as any);
  const statedAlert = ruleMems.filter((r) => posNum(r.alertRatio)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]?.alertRatio as number | undefined;
  // The engine's personal alert: the newest stated alertRatio, else the server's YOJIMBO_ALERT_RATIO (default 1.5).
  const actsBelow: number = statedAlert ?? status?.alertRatio ?? watched?.decision?.alertRatio ?? botWatched?.decision?.alertRatio ?? decision?.alertRatio ?? 1.5;
  const chosen = ruleMems
    .filter((r) => (posNum(r.belowRatio) == null || actsBelow <= r.belowRatio) && posNum(r.movePercent) == null)
    .sort((a, b) => (posNum(a.belowRatio) ?? 99) - (posNum(b.belowRatio) ?? 99))[0];
  const ruleUsdc = chosen && chosen.action !== 'ignore' ? posNum(chosen.maxUsdc) ?? 10 : null;
  // Same as the engine's decide(): the tightest cap any live rule names limits every defence.
  const tightestCap = Math.min(...ruleMems.map((m) => posNum(m.maxUsdc) ?? Infinity));
  const engineUsdc = ruleUsdc != null ? Math.min(ruleUsdc, tightestCap) : null;
  const upTo = engineUsdc != null ? Math.min(engineUsdc, caps?.perActionUsdc ?? engineUsdc) : null;
  const verb = chosen?.action === 'reduce' ? 'trims' : chosen?.action === 'repay' ? 'repays' : 'adds';
  const sleepSched = liveSchedules.find((h) => h.memory.recurrence === 'daily' && /sleep|asleep|night|bed/i.test(h.memory.text)) ?? liveSchedules.find((h) => h.memory.recurrence === 'daily');
  const hasDebt = Number(position?.state?.quoteDebt) > 0 || Number(position?.state?.baseDebt) > 0;
  const guardWord =
    source === 'watch'
      ? 'Watching'
      : !status
        ? 'Checking…'
        : !status.wallet
          ? 'Not set up'
          : !hasDebt
            ? 'Not guarding yet'
            : writesLive
              ? 'Guarding'
              : 'Guarding · dry-run';
  const guardTone = source === 'watch' ? 'muted' : !status ? 'muted' : !status.wallet || !hasDebt ? 'off' : writesLive ? 'ok' : 'warn';
  const statusParts = [
    `acts below ${actsBelow.toFixed(2)}`,
    memory === null ? null : upTo != null ? `${verb} up to ${upTo} USDC` : 'no rule to act on yet',
    sleepSched ? `asleep ${sleepSched.memory.start}–${sleepSched.memory.end} ${tzLabel(sleepSched.memory.timezone)}` : null,
  ].filter(Boolean) as string[];
  const telegramOn = !!status && !status.telegram.startsWith('Setup');
  const checkedAt: string | null = source === 'watch' ? watched?.checkedAt ?? null : status?.watcherCheckedAt ?? null;
  const beat = checkedAt
    ? `${source === 'watch' ? 'Read' : 'Watcher checked'} ${agoShort(tick - new Date(checkedAt).getTime())} ago${
        source === 'bot' && status?.watcherError ? (/bot-owned MarginManager/.test(status.watcherError) ? ' · no bot position yet' : ' · read failed') : ''
      }`
    : source === 'watch' && watchId
      ? 'Reading…'
      : 'Waiting for the first check';
  const pose = tier === 'danger' || (ratio != null && ratio <= actsBelow) ? POSE.alert : POSE.seated;
  const steps3 = steps4.slice(0, 3);
  const nextStep = steps3.findIndex((s) => s !== 'done');
  const ruleChips = liveRules
    .slice()
    .sort((a, b) => String(b.memory.createdAt).localeCompare(String(a.memory.createdAt)))
    .slice(0, 4);

  // The cap a defence would use now, as the engine applies it: the server's per-defence cap and the tightest
  // cap any remembered rule names.
  const capNow = Math.min(caps?.perActionUsdc ?? Infinity, tightestCap);
  const defenceCap = Number.isFinite(capNow) ? capNow : null;
  const glance = (
    <div className="glance" data-film="hero-glance">
      <div className="glance-head">
        <span className="lbl">
          <span className="live-dot" aria-hidden="true" />
          Live guard
        </span>
        <span className="glance-beat">{beat}</span>
      </div>
      <div className="glance-row">
        <Gauge ratio={state ? Number(ratio) : null} noDebt={noDebt} liquidation={liquidation} actsBelow={actsBelow} tier={tier} loading={!state && !!watchId && !errors.watch} />
        <div className="glance-text">
          <p className={`glance-word g-${guardTone}`}>
            {guardWord}
            {source === 'watch' && watchId ? <small className="mono"> {short(watchId)}</small> : null}
          </p>
          <p className="glance-status">{memory === null && !errors.memory ? 'Reading its rules…' : statusParts.join(' · ')}</p>
          {!state && source === 'watch' && watchError && <p className="err-line">{watchError}</p>}
        </div>
      </div>
      <DayStrip schedules={liveSchedules} events={events ?? []} tz={tz} now={tick} days={1} />
    </div>
  );

  if (route === 'home')
    return (
      <div className="site">
        <a className="skip" href="#main">
          Skip to content
        </a>
        {forkBanner}
        <Landing status={status} memoryCount={memory ? kept.length : null} memoryError={errors.memory} memorySetup={memorySetup} events={events} watched={visiblePosition} registry={registry} defenceCap={defenceCap} glance={glance} />
      </div>
    );

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
          <div className="page page-guard">
            {/* What Yojimbo does, in three plain steps; wallet and rule setup stay in a drawer. */}
            <div className="explain-wrap" data-film="setup">
              <ol className="explain" data-film="explain">
                <li className={steps3[1] === 'done' ? 'done' : ''}>
                  <b>1</b>
                  <span>
                    <strong>You open a borrowed-money trade.</strong> Your USDC plus a loan buys SUI.
                  </span>
                </li>
                <li className={steps3[2] === 'done' ? 'done' : ''}>
                  <b>2</b>
                  <span>
                    <strong>You tell Yojimbo your hours and limits</strong> in chat. It keeps them on Walrus.
                  </span>
                </li>
                <li>
                  <b>3</b>
                  <span>
                    <strong>While you sleep, it watches the liquidation line</strong> and adds money before you lose everything, then texts you.
                  </span>
                </li>
              </ol>
              <button className="link-btn" aria-expanded={setupOpen} aria-controls="setup-drawer" onClick={() => setSetupOpen((v) => !v)}>
                {setupOpen ? 'Hide wallet and setup' : 'Wallet and setup'}
              </button>
            </div>
            {setupOpen && (
              <section className="card setup-drawer" id="setup-drawer" aria-label="Set up">
                {journey('panel')}
              </section>
            )}

            {status?.wallet && position && !hasDebt && (
              <Ticket quote={quote} quoteError={quoteError} status={status} registry={registry} actsBelow={actsBelow} caps={caps} hasManager={!!position?.managerId} onDone={() => void refresh()} onOpened={setOpened} />
            )}

            {hasDebt && opened.some((l) => l.digest) && (
              <p className="opened" data-film="opened">
                <b>Opened</b>
                {opened
                  .filter((l) => l.digest)
                  .map((l) =>
                    l.fork ? (
                      <Link key={l.digest} to={`/tx/${l.digest}`} className="ext" data-film="open-tx">
                        {l.label} <span className="mono">{short(l.digest!)}</span> <ForkTag />
                      </Link>
                    ) : (
                      <a key={l.digest} className="ext" href={`https://suiscan.xyz/mainnet/tx/${l.digest}`} target="_blank" rel="noreferrer">
                        {l.label} <ArrowOut />
                      </a>
                    ),
                  )}
              </p>
            )}

            {/* (1) The guard at a glance */}
            <section className={`card guard-hero ${tier ? `is-${tier}` : ''}`} id="position" aria-labelledby="guard-title" data-film="position">
              <div className="gh-grid">
                <Gauge ratio={state ? Number(ratio) : null} noDebt={noDebt} liquidation={liquidation} actsBelow={actsBelow} tier={tier} loading={!state && source === 'watch' && !!watchId && !errors.watch} />
                <div className="gh-mid">
                  <div className="seg" role="group" aria-label="Position source">
                    <button aria-pressed={source === 'watch'} className={source === 'watch' ? 'on' : ''} onClick={() => setSource('watch')}>
                      Watch any
                    </button>
                    <button aria-pressed={source === 'bot'} className={source === 'bot' ? 'on' : ''} onClick={() => setSource('bot')} data-film="source-bot">
                      Bot wallet
                    </button>
                  </div>
                  <h1 id="guard-title" className={`gh-word g-${guardTone}`} data-film="protection">
                    {guardWord}
                  </h1>
                  <p className="gh-status" data-film="status-line">
                    {statusParts.join(' · ')}
                  </p>
                  <p className="gh-beat" data-film="heartbeat" aria-live="polite">
                    <span className={`beat ${checkedAt ? 'on' : ''}`} aria-hidden="true" />
                    {beat}
                    <span className="gh-tg">
                      <span className={`dot ${telegramOn ? 'ok' : 'warn'}`} aria-hidden="true" />
                      {!status ? '…' : telegramOn ? 'Telegram on' : 'Telegram: setup required'}
                    </span>
                  </p>
                  {cushion && cushion.kind === 'move' && (
                    <p className="gh-cushion">
                      SUI can {cushion.move < 0 ? 'fall' : 'rise'} <b className="gold-num">{Math.abs(cushion.move * 100).toFixed(1)}%</b> before liquidation
                    </p>
                  )}
                  {cushion && cushion.kind === 'at' && <p className="gh-cushion bad">At the liquidation line now.</p>}
                  {!state && source === 'watch' && watchError && <p className="err-line">{watchError}</p>}
                  {!state && source === 'bot' && <p className="gh-cushion">{status && !status.wallet ? 'Setup required: YOJIMBO_BOT_KEY' : 'No open position yet. Set up step 2 opens one.'}</p>}
                </div>
                <figure className="gh-art">
                  <img src={pose.src} alt={pose.alt} width={768} height={768} />
                </figure>
              </div>
              <DayStrip schedules={liveSchedules} events={events ?? []} tz={tz} now={tick} days={1} />
            </section>

            <div className="duo">
              {/* (2) Position facts */}
              <section className="card mini-card" aria-labelledby="pos-title" data-film="position-card">
                <div className="mini-head">
                  <h2 id="pos-title">{source === 'watch' ? 'Watched position' : 'Your position'}</h2>
                  {visiblePosition?.managerId &&
                    (fork ? (
                      <span className="ext" title={`${visiblePosition.managerId} (local fork; not on Suiscan)`}>
                        <span className="mono">{short(visiblePosition.managerId)}</span> <ForkTag />
                      </span>
                    ) : (
                      <a className="ext" target="_blank" rel="noreferrer" href={`https://suiscan.xyz/mainnet/object/${visiblePosition.managerId}`} data-film="suiscan">
                        SuiScan <ArrowOut />
                      </a>
                    ))}
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
                              {short(m.managerId)} · {m.riskRatio >= 1000 ? 'no debt' : `ratio ${m.riskRatio.toFixed(3)}`} · {ago(m.lastActivity)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      !errors.managers && <p className="fine">No recent SUI/USDC positions found.</p>
                    )}
                    {errors.managers && <p className="err-line">Positions: {errors.managers}</p>}
                    <details className="paste-wrap">
                      <summary>Paste an ID · {atLiq.length ? `${atLiq.length} at liquidation now` : 'none at liquidation now'}</summary>
                      <form
                        className="paste"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (pastedId.trim()) selectManager(pastedId.trim());
                        }}
                      >
                        <input value={pastedId} onChange={(e) => setPastedId(e.target.value)} placeholder="0x… position ID" aria-label="MarginManager ID" spellCheck={false} />
                        <button className="pill pill-line pill-sm">Watch</button>
                      </form>
                      {atLiq.length > 0 && <p className="fine">{atLiq.map((m) => `${short(m.managerId)} (${m.riskRatio.toFixed(3)})`).join(', ')}</p>}
                    </details>
                  </div>
                )}
                {source === 'bot' && (
                  <p className="bot-line">
                    Bot wallet{' '}
                    {!status ? (
                      '…'
                    ) : status.wallet ? (
                      <a className="mono" href={`https://suiscan.xyz/mainnet/account/${status.wallet}`} target="_blank" rel="noreferrer">
                        {short(status.wallet)} <ArrowOut />
                      </a>
                    ) : (
                      <b className="setup">Setup required</b>
                    )}{' '}
                    · {status?.balanceMist ? `${(Number(status.balanceMist) / 1e9).toFixed(3)} SUI` : '— SUI'} · {status?.usdcBalance ? `${(Number(status.usdcBalance) / 1e6).toFixed(2)} USDC` : '— USDC'}
                  </p>
                )}
                {source === 'bot' && status?.watcherError && !/^(Error:\s*)?Setup required/.test(status.watcherError) && <p className="err-line">{status.watcherError.replace(/^Error:\s*/, '')}</p>}
                {state ? (
                  <dl className="mini-kv">
                    <Fact k="Collateral" v={fmtAmt(state.baseAsset)} unit="SUI" hint="SUI the trade holds" />
                    <Fact k="Debt" v={fmtAmt(state.quoteDebt)} unit="USDC" hint="USDC it borrowed" />
                    <Fact k="Cash held" v={fmtAmt(state.quoteAsset)} unit="USDC" hint="USDC not spent on SUI" />
                    <Fact k="SUI price" v={visiblePosition.price != null ? `$${Number(visiblePosition.price).toFixed(4)}` : '—'} unit="USD" hint="price now, from the oracle" />
                  </dl>
                ) : (
                  <p className="fine">{source === 'watch' ? (watchError ? '' : 'Reading the position…') : 'Nothing open yet.'}</p>
                )}
                {state && activeId && (
                  <div className="dry">
                    <button className="link-btn" onClick={dryRunDefence} disabled={dryBusy} data-film="dry-run">
                      {dryBusy ? 'Checking…' : 'Dry-run a defence'}
                    </button>
                    <span>never sends</span>
                  </div>
                )}
                {dryRun && (
                  <p className={`guardrail ${dryRun.ok ? 'ok' : 'refused'}`} role="status">
                    <b>{dryRun.ok ? 'Dry run' : 'Refused'}</b> {dryRun.text}
                  </p>
                )}
                {fork && source === 'bot' && position?.managerId && (hasDebt || unwind) && (
                  <div className="dry">
                    <button className="link-btn" onClick={unwindFork} disabled={!!unwind?.busy} data-film="unwind">
                      {unwind?.busy ? 'Unwinding…' : 'Unwind on the fork'}
                    </button>
                    <span>sell SUI, repay, withdraw</span>
                  </div>
                )}
                {unwind && !unwind.busy && (
                  <ul className="jrun" role="status" data-film="unwind-result">
                    {unwind.error && <li className="no">{unwind.error}</li>}
                    {(unwind.steps ?? []).map((st, i) => (
                      <li key={i} className={st.status === 'success' ? 'ok' : 'no'}>
                        <b>{st.step}</b> {st.status ?? '—'}
                        {st.txDigest && (
                          <Link to={`/tx/${st.txDigest}`} className="ext">
                            <span className="mono">{short(st.txDigest)}</span> <ForkTag />
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {errors.registry && source === 'bot' && <p className="err-line">Registry: {errors.registry}</p>}
              </section>

              {/* (3) Its rules */}
              <section className="card mini-card" aria-labelledby="rules-title" data-film="rules">
                <div className="mini-head">
                  <h2 id="rules-title">Its rules</h2>
                  <Link to="/memory" className="ext" data-film="to-memory">
                    {memory ? `All ${kept.length} memories` : 'Memory'} <Arrow />
                  </Link>
                </div>
                {memory === null && !errors.memory ? (
                  <div className="rchips">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="skeleton rchip-skel" />
                    ))}
                  </div>
                ) : ruleChips.length ? (
                  <ul className="rchips">
                    {ruleChips.map((h) => {
                      const r = ruleView(h.memory as any);
                      return (
                        <li key={h.blobId} className={`rchip r-${r.icon}`} title={h.memory.text}>
                          <RuleIcon kind={r.icon} />
                          {r.title}
                        </li>
                      );
                    })}
                  </ul>
                ) : localRules ? (
                  <p className="fine">Rules come from the local rules file (fork), not Walrus.</p>
                ) : (
                  <p className="fine">{memorySetup ? 'Setup required: Walrus Memory' : errors.memory || 'No rules yet. Tell it one below.'}</p>
                )}
                {visibleDecision && (
                  <p className="rnow" data-film="decision">
                    Now: would <b>{visibleDecision.action}</b>
                    {visibleDecision.amountUsdc ? ` ${visibleDecision.amountUsdc} USDC` : ''} · “{visibleDecision.quote}”
                  </p>
                )}
              </section>
            </div>

            {/* (4) Chat */}
            <section className="card chat-card" id="chat" aria-labelledby="chat-title" data-film="chat">
              <div className="chat-head">
                <img src={AVATAR} alt="" width={44} height={44} />
                <div>
                  <h2 id="chat-title">Talk to your bodyguard</h2>
                  <p>
                    <span className={`dot ${status?.openRouter === 'ready' ? 'ok' : 'warn'}`} aria-hidden="true" />
                    {status?.openRouter === 'ready' ? 'Tool calls show under each answer' : status?.openRouter ?? 'Connecting…'}
                  </p>
                </div>
              </div>
              <div className="thread" ref={thread} aria-live="polite" data-film="thread">
                {messages.length === 0 && (
                  <div className="welcome">
                    <p className="greet">Tell me when you sleep and what I may do.</p>
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
        )}

        {route === 'memory' && (
          <div className="page">
            <header className="dash-head">
              <div>
                <p className="lbl">{localRules ? 'Local rules file (fork)' : 'Walrus mainnet'}</p>
                <h1>What it remembers</h1>
                <p className="dash-sub">{localRules ? 'Read from docs/fork-rules.json on this machine. This is not Walrus Memory.' : 'Your hours, your rules and what you told it to forget. Each one is a Walrus blob.'}</p>
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
                  <dd>{liveHits.length}</dd>
                </div>
                <div>
                  <dt>Forgotten</dt>
                  <dd>{kept.filter((h) => gone.has(h.memory.id)).length}</dd>
                </div>
              </dl>
            )}
            {errors.memory && <State title="Couldn’t read memories" text={errors.memory} error />}
            {memory === null && !errors.memory ? (
              <div className="mem-grid">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="skeleton mem-skel" />
                ))}
              </div>
            ) : kept.length ? (
              <div className="mem-sections" id="memory" data-film="memories">
                {/* Schedules on the week */}
                <section className="card" aria-labelledby="sched-title" data-film="schedules">
                  <div className="card-title">
                    <div>
                      <h2 id="sched-title">Its week</h2>
                      <p>When you sleep, fly or work, from {liveSchedules.length} schedule memories · {tzLabel(tz)}</p>
                    </div>
                  </div>
                  <DayStrip schedules={liveSchedules} events={events ?? []} tz={tz} now={tick} days={7} />
                  <ul className="sched-list">
                    {liveSchedules
                      .slice()
                      .sort((a, b) => schedSortKey(a.memory).localeCompare(schedSortKey(b.memory)))
                      .map((h) => (
                        <li key={h.blobId} className={`sched k-${schedKind(h.memory)}`} data-film="memory">
                          <span className="sched-kind">{schedLabel(h.memory)}</span>
                          <span className="sched-when">{schedWhen(h.memory)}</span>
                          <span className="sched-text">{h.memory.text}</span>
                          <BlobLink id={h.blobId} />
                        </li>
                      ))}
                  </ul>
                </section>

                {/* Rules */}
                <section className="card" aria-labelledby="rules-title2" data-film="rule-cards">
                  <div className="card-title">
                    <div>
                      <h2 id="rules-title2">Rules it follows</h2>
                      <p>What it may do, in your words.</p>
                    </div>
                  </div>
                  <div className="rule-grid">
                    {liveRules
                      .slice()
                      .sort((a, b) => String(b.memory.createdAt).localeCompare(String(a.memory.createdAt)))
                      .map((h) => {
                        const r = ruleView(h.memory as any);
                        const old = h.memory.supersedes ? hits.find((x) => x.memory.id === h.memory.supersedes) : undefined;
                        return (
                          <article key={h.blobId} className={`rule-card r-${r.icon}`} data-film="memory">
                            <span className="rule-ic">
                              <RuleIcon kind={r.icon} />
                            </span>
                            <div className="rule-body">
                              <h3>{r.title}</h3>
                              <p>“{h.memory.text}”</p>
                              {h.memory.kind === 'override' && (
                                <p className="supersedes">
                                  Your correction · replaces <s>{old?.memory.text ?? h.memory.supersedes}</s>
                                </p>
                              )}
                              <div className="rule-foot">
                                {r.facts.map((f) => (
                                  <span key={f} className="rfact">
                                    {f}
                                  </span>
                                ))}
                                <BlobLink id={h.blobId} />
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    {liveRules.length === 0 && <p className="fine">No rules in use.</p>}
                  </div>
                </section>

                {/* Corrections: what you told it to forget */}
                {kept.some((h) => h.memory.kind === 'retire') && (
                  <section className="card forget" aria-labelledby="forget-title" data-film="forget-moment">
                    <div className="card-title">
                      <div>
                        <h2 id="forget-title">You told it to forget</h2>
                        <p>Walrus never deletes, so forgetting is a memory too. These are no longer used.</p>
                      </div>
                    </div>
                    {kept
                      .filter((h) => h.memory.kind === 'retire')
                      .map((h) => (
                        <div className="forget-moment" key={h.blobId}>
                          <div className="forget-says">
                            <span className="forget-who">Your request, as stored</span>
                            <p>“{h.memory.text}”</p>
                            <span className="forget-meta">
                              {ago(h.memory.createdAt)} · <BlobLink id={h.blobId} />
                            </span>
                          </div>
                          <ul className="forget-list">
                            {(h.memory.ids ?? []).map((id) => {
                              const t = hits.find((x) => x.memory.id === id);
                              return (
                                <li key={id}>
                                  <span className="forget-arrow" aria-hidden="true">
                                    →
                                  </span>
                                  <s>{t?.memory.text ?? id}</s>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                  </section>
                )}

                {/* Forgotten, collapsed */}
                {kept.some((h) => gone.has(h.memory.id)) && (
                  <details className="card forgotten-group" data-film="forgotten">
                    <summary>
                      <span>{kept.filter((h) => gone.has(h.memory.id)).length} forgotten</span>
                      <small>Struck through, kept for the record</small>
                    </summary>
                    <div className="mem-grid">
                      {kept
                        .filter((h) => gone.has(h.memory.id))
                        .map((h) => (
                          <article className={`memory kind-${h.memory.kind} forgotten`} key={h.blobId} data-film="memory-forgotten">
                            <div className="mem-top">
                              <span className="mem-tag">Forgotten · no longer used</span>
                              <time dateTime={h.memory.createdAt}>{ago(h.memory.createdAt)}</time>
                            </div>
                            <p className="mem-text">
                              <s>{h.memory.text}</s>
                            </p>
                            <BlobLink id={h.blobId} />
                          </article>
                        ))}
                    </div>
                  </details>
                )}
                {visibleDecision && visibleDecision.recalledBlobIds.length > 0 && (
                  <p className="recalled fine">
                    Last recall: {visibleDecision.recalledBlobIds.length} memories · next move {visibleDecision.action} · “{visibleDecision.quote}”
                  </p>
                )}
              </div>
            ) : localRules ? (
              <section className="card" id="memory" data-film="memories">
                <div className="mem-grid memories">
                  {localRuleIds.map((id) => (
                    <article className="memory kind-rule" key={id} data-film="memory">
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
              </section>
            ) : (
              !errors.memory && (
                <section className="card" id="memory" data-film="memories">
                  <State
                    art="/art/yojimbo-empty-memory.webp"
                    title={memorySetup ? 'Setup required: Walrus Memory' : 'No rules yet'}
                    detail={memorySetup ? 'MEMWAL_MAINNET_KEY / MEMWAL_MAINNET_ACCOUNT_ID' : undefined}
                    text="Your hours, rules and corrections are stored on Walrus. Every defence quotes the one it followed."
                  />
                </section>
              )
            )}
          </div>
        )}

        {route === 'tx' && <TxPage digest={decodeURIComponent(path.slice(4))} />}

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
                            {e.ruleIds.length ? (
                              e.ruleIds.map((id) => {
                                const h = hits.find((x) => x.memory.id === id);
                                return (
                                  <span key={id} className="ev-quote">
                                    <q>{h?.memory.text ?? id}</q>
                                    {h && <BlobLink id={h.blobId} />}
                                  </span>
                                );
                              })
                            ) : (
                              <span className="fine">No rule</span>
                            )}
                            <small>Recalled {e.recalledBlobIds.length} memories</small>
                          </div>
                          <div className="ev-links">
                            {e.txDigest &&
                              (fork || /fork/i.test(e.outcome) ? (
                                <Link to={`/tx/${e.txDigest}`} className="ext" title="This transaction exists only on the local fork; it is not on Suiscan" data-film="event-tx">
                                  <span className="mono">{short(e.txDigest)}</span> <ForkTag /> <Arrow />
                                </Link>
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
                            {!e.memoryBlobId && e.memoryError && <span className="fine">{/LOCAL FORK/.test(e.memoryError) ? 'Event memory not written on the fork' : `Event memory: ${e.memoryError.replace(/^Error:\s*/, '')}`}</span>}
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
  defenceCap: number | null;
  glance: React.ReactNode;
}) {
  const { status, memoryCount, events, watched, registry, defenceCap } = props;
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
            <p className="lede">If you borrow to trade and the price falls too far, the exchange sells your position to repay the loan. That is liquidation. Yojimbo watches while you sleep and adds money before it happens.</p>
            <div className="hero-cta">
              <Link to="/app" className="pill pill-navy pill-lg" data-film="hero-cta">
                Open the app <Arrow />
              </Link>
              <a href="#how" className="pill pill-line pill-lg">
                How it works
              </a>
            </div>
          </div>
          <div className="hero-visual">
            <figure className="hero-frame">
              <img src="/art/yojimbo-hero.webp" alt="A guard keeps watch on the veranda while the owner sleeps inside" width={1536} height={1024} loading="eager" />
            </figure>
            {props.glance}
          </div>
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
                <b>{defenceCap != null ? `${defenceCap} USDC` : '…'}</b>
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

/** A LOCAL FORK transaction from the fork RPC (sui_getTransactionBlock): Suiscan cannot show fork transactions. */
function TxPage({ digest }: { digest: string }) {
  const [tx, setTx] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setTx(null);
    setErr('');
    api(`/fork/tx/${digest}`).then(setTx, (e) => setErr(String((e as Error).message ?? e)));
  }, [digest]);
  const coin = (t: string) => (/::sui::SUI$/.test(t) ? 'SUI' : /::usdc::USDC$/i.test(t) ? 'USDC' : t.split('::').pop() ?? t);
  const dec = (t: string) => (coin(t) === 'SUI' ? 9 : coin(t) === 'USDC' ? 6 : 0);
  const typeShort = (t?: string) => (t ? t.replace(/0x[0-9a-f]{20,}/gi, (m) => short(m)).replace(/<.*>/, '<…>') : '');
  return (
    <div className="page">
      <header className="dash-head">
        <div>
          <p className="lbl">
            <ForkTag text="LOCAL FORK" /> of Sui mainnet · no real funds
          </p>
          <h1>Fork transaction</h1>
          <p className="dash-sub mono">{digest}</p>
        </div>
        <Link to="/log" className="pill pill-line pill-sm">
          Night log
        </Link>
      </header>
      {err ? (
        <State title="Couldn’t read this transaction" text={err} error />
      ) : !tx ? (
        <span className="skeleton mem-skel" aria-label="Reading the fork" />
      ) : (
        <section className="card tx-card" data-film="fork-tx">
          <dl className="tx-kv">
            <div>
              <dt>Status</dt>
              <dd className={tx.status?.status === 'success' ? 'ok' : 'bad'}>{tx.status?.status ?? '—'}{tx.status?.error ? ` · ${tx.status.error}` : ''}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>{tx.source}{tx.forkedAtCheckpoint ? ` @ checkpoint ${tx.forkedAtCheckpoint}` : ''}</dd>
            </div>
            <div>
              <dt>Checkpoint</dt>
              <dd className="mono">{tx.checkpoint ?? '—'}</dd>
            </div>
            <div>
              <dt>Sender</dt>
              <dd className="mono">{tx.sender ? short(tx.sender) : '—'}</dd>
            </div>
            <div>
              <dt>Gas</dt>
              <dd>{(tx.gasMist / 1e9).toFixed(6)} SUI</dd>
            </div>
            <div>
              <dt>Move calls</dt>
              <dd className="mono">{tx.calls.length ? tx.calls.join(' · ') : '—'}</dd>
            </div>
          </dl>
          {tx.balanceChanges.length > 0 && (
            <>
              <h2 className="tx-h">Balance changes</h2>
              <ul className="tx-list">
                {tx.balanceChanges.map((b: any, i: number) => (
                  <li key={i}>
                    <span className="mono">{b.owner === 'shared' ? 'shared' : short(b.owner)}</span>
                    <b className={Number(b.amount) < 0 ? 'bad' : 'ok'}>
                      {(Number(b.amount) / 10 ** dec(b.coinType)).toLocaleString('en-US', { maximumFractionDigits: 6, signDisplay: 'always' })} {coin(b.coinType)}
                    </b>
                  </li>
                ))}
              </ul>
            </>
          )}
          {tx.objectChanges.length > 0 && (
            <>
              <h2 className="tx-h">Objects</h2>
              <ul className="tx-list">
                {tx.objectChanges.map((o: any, i: number) => (
                  <li key={i}>
                    <span className="tx-type">{o.type}</span>
                    <span className="mono">{typeShort(o.objectType)}</span>
                    <span className="mono">{o.objectId ? short(o.objectId) : ''}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}

/** The trade ticket: Long SUI with your USDC and a leverage choice. The preview uses the pool's live mid price and lot
 * size and the same rule as openLong(): 90% of deposit + borrow buys SUI at market, the rest stays as USDC. Risk ratio =
 * (SUI × price + USDC) ÷ USDC debt, so the liquidation price is where that ratio meets the pool's line. Before fees. */
const LEVERAGES = [1.5, 2, 3];
function Ticket(props: {
  quote: { midPrice: number; lotSize: number; minSize: number; source: string } | null;
  quoteError: string;
  status: Status;
  registry: any;
  actsBelow: number;
  caps?: { perActionUsdc: number; dailyUsdc: number };
  hasManager: boolean;
  onDone: () => void;
  onOpened: (lines: { label: string; text: string; ok: boolean; digest?: string; fork?: boolean }[]) => void;
}) {
  const { quote, registry, actsBelow, caps, status } = props;
  const [deposit, setDeposit] = useState('6');
  const [lev, setLev] = useState(1.5);
  const [run, setRun] = useState<{ busy: boolean; lines: { label: string; text: string; ok: boolean; digest?: string; fork?: boolean }[] } | null>(null);
  const d = Number(deposit);
  const b = Number.isFinite(d) ? Math.round(d * (lev - 1) * 100) / 100 : NaN;
  const p = quote?.midPrice;
  const liqLine: number | undefined = registry?.liquidation;
  const minBorrow: number | undefined = registry?.minBorrow;
  const wallet = status.usdcBalance != null ? Number(status.usdcBalance) / 1e6 : null;
  const lot = quote?.lotSize ?? 0.1;
  const size = p && d > 0 ? Math.floor(((d + b) * 0.9) / p / lot) * lot : null;
  const left = size != null && p ? d + b - size * p : null;
  const ratio0 = b > 0 ? (d + b) / b : null;
  const priceAt = (r: number) => (size && left != null && b > 0 ? (r * b - left) / size : null);
  const liqPrice = liqLine != null ? priceAt(liqLine) : null;
  const alertPrice = priceAt(actsBelow);
  const cap = caps?.perActionUsdc;
  const problem = !(d > 0)
    ? 'Enter how much USDC you put in.'
    : wallet != null && d > wallet
      ? `The bot wallet holds ${wallet.toFixed(2)} USDC. Put in less, or fund it first (Wallet and setup).`
      : cap != null && (d > cap || b > cap)
        ? `Each amount must be at most ${cap} USDC, Yojimbo's per-action cap.`
        : minBorrow != null && ratio0 != null && ratio0 < minBorrow
          ? `At ${lev}× the trade would start under the pool's minimum ratio ${minBorrow.toFixed(2)}. Pick less leverage.`
          : size != null && quote && size < quote.minSize
            ? `That buys less than the pool's minimum order (${quote.minSize} SUI). Put in more.`
            : '';
  const open = async () => {
    if (problem || run?.busy || !p) return;
    const lines: { label: string; text: string; ok: boolean; digest?: string; fork?: boolean }[] = [];
    setRun({ busy: true, lines });
    try {
      if (!props.hasManager) {
        const r = await post('/bot/create', {});
        lines.push({ label: 'Create the margin account', text: outcome(r), ok: sent(r), digest: r.txDigest, fork: r.mode === 'fork' });
        setRun({ busy: true, lines: [...lines] });
        if (!sent(r)) return;
      }
      const o = await post('/bot/open', { depositUsdc: d, borrowUsdc: b });
      lines.push({ label: 'Deposit, borrow and buy SUI', text: outcome(o), ok: sent(o), digest: o.txDigest, fork: o.mode === 'fork' });
    } catch (e) {
      lines.push({ label: 'Refused', text: String((e as Error).message ?? e), ok: false });
    } finally {
      setRun({ busy: false, lines: [...lines] });
      props.onOpened([...lines]);
      props.onDone();
    }
  };
  const usd = (v: number | null | undefined, dp = 4) => (v == null || !Number.isFinite(v) ? '—' : `$${v.toFixed(dp)}`);
  return (
    <section className="card ticket" aria-labelledby="ticket-title" data-film="ticket">
      <div className="tk-head">
        <img src="/tokens/sui.svg" alt="" width={44} height={44} />
        <div>
          <h2 id="ticket-title">Long SUI</h2>
          <p>Borrow USDC to buy more SUI · DeepBook Margin, SUI/USDC</p>
        </div>
        <div className="tk-price">
          <b className="num">{usd(p)}</b>
          <span>{props.quoteError ? 'price unavailable' : `SUI price now · ${quote?.source ?? '…'}`}</span>
        </div>
      </div>
      {props.quoteError && <p className="err-line">Price: {props.quoteError}</p>}
      <div className="tk-grid">
        <div className="tk-in">
          <label className="tk-field">
            <span>Your money in</span>
            <span className="field">
              <img src="/tokens/usdc.svg" alt="" width={22} height={22} />
              <input inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} aria-label="Your money in, USDC" data-film="ticket-amount" />
              <em>USDC</em>
            </span>
            <small>{wallet != null ? `Bot wallet holds ${wallet.toFixed(2)} USDC` : 'Bot wallet balance unknown'}</small>
          </label>
          <div className="tk-field">
            <span>Leverage</span>
            <div className="tk-lev" role="group" aria-label="Leverage">
              {LEVERAGES.map((l) => (
                <button key={l} className={lev === l ? 'on' : ''} aria-pressed={lev === l} onClick={() => setLev(l)} data-film={`lev-${l}`}>
                  {l}×
                </button>
              ))}
            </div>
            <small>{Number.isFinite(b) ? `Borrows ${b.toFixed(2)} USDC. ${lev}× means every 1 USDC of yours trades as ${lev}.` : '—'}</small>
          </div>
        </div>
        <div className="tk-preview" data-film="ticket-preview">
          <dl>
            <div>
              <dt>Position size</dt>
              <dd className="num">{size != null && p ? `${size.toFixed(1)} SUI · ${usd(size * p, 2)}` : '—'}</dd>
            </div>
            <div>
              <dt>Entry price</dt>
              <dd className="num">{usd(p)}</dd>
            </div>
            <div>
              <dt>Liquidation price</dt>
              <dd className="num tk-liq">{usd(liqPrice)}</dd>
            </div>
            <div>
              <dt>Starting risk ratio</dt>
              <dd className="num">
                {ratio0 != null ? ratio0.toFixed(2) : '—'} <small>· Yojimbo's line {actsBelow.toFixed(2)}</small>
              </dd>
            </div>
          </dl>
          <p className="tk-plain" data-film="ticket-plain">
            {liqPrice != null && p ? (
              <>
                If SUI falls to <b>{usd(liqPrice)}</b>, this position is liquidated: the pool sells it to repay the loan.{' '}
                {alertPrice != null && alertPrice >= p ? (
                  <>
                    It starts under Yojimbo's {actsBelow.toFixed(2)} line, so Yojimbo adds collateral right after it opens.
                  </>
                ) : (
                  <>
                    Yojimbo steps in at <b>{usd(alertPrice)}</b>.
                  </>
                )}
              </>
            ) : (
              'Reading the pool price…'
            )}
          </p>
          <p className="fine">Before trading fees. 90% of the USDC buys SUI at market; the rest stays as cash.</p>
        </div>
      </div>
      {problem && <p className="err-line">{problem}</p>}
      <button className="pill pill-navy pill-lg pill-block" onClick={open} disabled={!!problem || !p || !!run?.busy} data-film="open-long">
        {run?.busy ? 'Opening…' : 'Open long'}
      </button>
      {run && run.lines.length > 0 && (
        <ul className="jrun" role="status" data-film="ticket-result">
          {run.lines.map((l, i) => (
            <li key={i} className={l.ok ? 'ok' : 'no'}>
              <b>{l.label}</b> {l.text}
              {l.digest && l.fork && (
                <Link to={`/tx/${l.digest}`} className="ext" data-film="open-tx">
                  Fork transaction <Arrow />
                </Link>
              )}
              {l.digest && !l.fork && (
                <a className="ext" href={`https://suiscan.xyz/mainnet/tx/${l.digest}`} target="_blank" rel="noreferrer">
                  SuiScan <ArrowOut />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Setup in three lines: fund the bot wallet, open the position, tell it the rules. Yojimbo acts only through its
 * own wallet because DeepBook Margin keeps a manager's caps inside the MarginManager and checks the sender. */
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
  const [run, setRun] = useState<{ busy: boolean; lines: { label: string; text: string; ok: boolean; digest?: string; fork?: boolean }[] } | null>(null);
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
    const lines: { label: string; text: string; ok: boolean; digest?: string; fork?: boolean }[] = [];
    setRun({ busy: true, lines });
    try {
      if (!hasManager) {
        const r = await post('/bot/create', {});
        lines.push({ label: 'Create the MarginManager', text: outcome(r), ok: sent(r), digest: r.txDigest, fork: r.mode === 'fork' });
        if (!sent(r)) {
          lines.push({ label: 'Deposit, borrow and buy SUI', text: 'Not run: the manager only exists on chain once the create transaction is sent.', ok: false });
          return;
        }
      }
      const o = await post('/bot/open', { depositUsdc: d, borrowUsdc: b });
      lines.push({ label: 'Deposit, borrow and buy SUI', text: outcome(o), ok: sent(o), digest: o.txDigest, fork: o.mode === 'fork' });
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
        {!status ? (
          <p className="fine">Checking…</p>
        ) : wallet ? (
          <>
            <p className="jtext">Send SUI for fees and only the USDC it may risk.</p>
            <div className="addr">
              <code>{wallet}</code>
              <button className="pill pill-line pill-sm" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="fine num">
              Now {status.balanceMist != null ? (Number(status.balanceMist) / 1e9).toFixed(3) : '—'} SUI · {status.usdcBalance != null ? (Number(status.usdcBalance) / 1e6).toFixed(2) : '—'} USDC
              {props.fork ? ' · fork-only hub funds' : ''}
            </p>
          </>
        ) : (
          <p className="jsetup">
            Setup required: <code>YOJIMBO_BOT_KEY</code> (a fresh key, never your main wallet)
          </p>
        )}
      </li>

      <li className={`jstep s-${states[1]}`}>
        <div className="jhead">
          <span className="jnum">2</span>
          <h3>Open the position</h3>
          {chip(1)}
        </div>
        {states[1] === 'done' ? (
          <p className="jdone">
            Open at ratio {Number(position.state.riskRatio).toFixed(3)} on {short(position.managerId)}.
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
            <p className="fine num">
              {leverage ? `${leverage.toFixed(2)}× leverage` : '—'} · starts at ratio {ratio ? ratio.toFixed(2) : '—'} · liquidation {liq != null ? liq.toFixed(2) : '—'}
            </p>
            {problem && <p className="err-line">{problem}</p>}
            <button className="pill pill-navy" onClick={open} disabled={!wallet || !!problem || run?.busy} data-film="open-position">
              {!status ? 'Checking…' : !wallet ? 'Setup required: YOJIMBO_BOT_KEY' : run?.busy ? 'Building…' : hasManager ? 'Open the position' : 'Create manager and open'}
            </button>
          </>
        )}
        {run && run.lines.length > 0 && (
          <ul className="jrun" role="status">
            {run.lines.map((l, i) => (
              <li key={i} className={l.ok ? 'ok' : 'no'}>
                <b>{l.label}</b> {l.text}
                {l.digest && l.fork && (
                  <Link to={`/tx/${l.digest}`} className="ext" data-film="open-tx">
                    Fork transaction <Arrow />
                  </Link>
                )}
                {l.digest && !l.fork && (
                  <a className="ext" href={`https://suiscan.xyz/mainnet/tx/${l.digest}`} target="_blank" rel="noreferrer">
                    SuiScan <ArrowOut />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </li>

      <li className={`jstep s-${states[2]}`}>
        <div className="jhead">
          <span className="jnum">3</span>
          <h3>Tell it your rules</h3>
          {chip(2)}
        </div>
        {props.localRules ? (
          <p className="fine">On this fork the rules come from docs/fork-rules.json, not Walrus Memory.</p>
        ) : props.memorySetup ? (
          <p className="jsetup">
            Setup required: <code>MEMWAL_MAINNET_KEY / MEMWAL_MAINNET_ACCOUNT_ID</code>
          </p>
        ) : null}
        <div className="chips">
          {RULE_CHIPS.map((c) => (
            <button key={c} className="chip" onClick={() => props.onRules(c)} disabled={props.busy}>
              {c}
            </button>
          ))}
        </div>
      </li>
    </ol>
  );
}

const SETUP_SHORT = ['Fund', 'Open', 'Rules'];
const SETUP_NEXT = ['fund the bot wallet', 'open the position', 'tell it your rules'];
const POSE = {
  seated: { src: '/art/yojimbo-guardian-seated.webp', alt: 'The guardian sits at rest' },
  alert: { src: '/art/yojimbo-guardian-alert.webp', alt: 'The guardian rises, hand on his sword' },
};

/* ---------- schedules and rules, from the structured Walrus memories ---------- */
type SchedMem = { kind: 'schedule'; id: string; createdAt: string; text: string; recurrence: 'daily' | 'weekdays' | 'weekends' | 'once'; start: string; end: string; timezone: string; mode: string };
type SchedHit = { blobId: string; memory: SchedMem };
const posNum = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
const mostCommon = (xs: string[]) => {
  const c = new Map<string, number>();
  xs.forEach((x) => c.set(x, (c.get(x) ?? 0) + 1));
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};
const tzLabel = (tz: string) => (tz === 'Asia/Kolkata' ? 'IST' : tz === 'UTC' || tz === 'Etc/UTC' ? 'UTC' : tz.split('/').pop()!.replace(/_/g, ' '));
const agoShort = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
};
function localParts(date: Date, timeZone: string) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  }
  const get = (n: string) => parts.find((p) => p.type === n)?.value ?? '';
  return { minutes: Number(get('hour')) * 60 + Number(get('minute')), weekday: get('weekday'), day: `${get('year')}-${get('month')}-${get('day')}`, dom: Number(get('day')) };
}
const hmToMin = (v: string) => {
  const m = /(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  const n = Number(m[1]) * 60 + Number(m[2]);
  return n === 1439 ? 1440 : n;
};
/** The minutes of one local day a schedule covers, the same windows scheduleActive() uses on the server. */
function segmentsFor(s: SchedMem, day: string, weekday: string, prevWeekday: string): [number, number][] {
  if (s.recurrence === 'once') {
    const start = s.start.slice(0, 16),
      end = s.end.slice(0, 16),
      ds = `${day}T00:00`,
      de = `${day}T24:00`;
    if (end <= ds || start >= de) return [];
    const a = start > ds ? hmToMin(start.slice(11)) : 0;
    const b = end < de ? hmToMin(end.slice(11)) : 1440;
    return a == null || b == null || b <= a ? [] : [[a, b]];
  }
  const a = hmToMin(s.start),
    b = hmToMin(s.end);
  if (a == null || b == null) return [];
  const ok = (wd: string) => s.recurrence === 'daily' || (s.recurrence === 'weekends') === ['Sat', 'Sun'].includes(wd);
  if (a < b) return ok(weekday) ? [[a, b]] : [];
  return [...(ok(prevWeekday) && b > 0 ? [[0, b] as [number, number]] : []), ...(ok(weekday) ? [[a, 1440] as [number, number]] : [])];
}
const schedKind = (s: SchedMem) =>
  /sleep|asleep|night|bed/i.test(s.text) ? 'sleep' : /fli|fly|plane|travel/i.test(s.text) ? 'flight' : /record|build|work|meeting|busy/i.test(s.text) ? 'busy' : s.recurrence === 'weekends' ? 'weekend' : 'away';
const KIND_WORD: Record<string, string> = { sleep: 'Asleep', flight: 'Flying', busy: 'Busy', weekend: 'Weekend', away: 'Away' };
const schedLabel = (s: SchedMem) => (schedKind(s) === 'busy' && /record/i.test(s.text) ? 'Recording' : KIND_WORD[schedKind(s)]);
const schedWhen = (s: SchedMem) => {
  const mode = s.mode === 'guard-alone' ? 'guards alone' : 'asks first';
  const z = tzLabel(s.timezone);
  if (s.recurrence === 'once') {
    const d = new Date(`${s.start.slice(0, 10)}T12:00:00Z`);
    const day = Number.isNaN(d.getTime()) ? s.start.slice(0, 10) : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    return `${day}, ${s.start.slice(11, 16)}–${s.end.slice(11, 16)} ${z} · ${mode}`;
  }
  const allDay = s.start === '00:00' && (s.end === '23:59' || s.end === '24:00');
  const rec = s.recurrence === 'daily' ? 'Every day' : s.recurrence === 'weekends' ? 'Weekends' : 'Weekdays';
  return `${rec}, ${allDay ? 'all day' : `${s.start}–${s.end} ${z}`} · ${mode}`;
};
const schedSortKey = (s: SchedMem) => (s.recurrence === 'once' ? `1${s.start}` : `0${s.recurrence}${s.start}`);

type RuleIconKind = 'add' | 'never-close' | 'cap' | 'trim' | 'repay';
/** A short label and an icon per rule, from its stored fields. Unstated 0s are ignored, as in cleanRule(). */
function ruleView(m: { kind: string; text: string; action?: string; belowRatio?: number; maxUsdc?: number; alertRatio?: number; mode?: string }): { icon: RuleIconKind; title: string; facts: string[] } {
  const below = posNum(m.belowRatio),
    max = posNum(m.maxUsdc),
    alert = posNum(m.alertRatio);
  const facts = [below ? `below ${below}` : '', max ? `max ${max} USDC` : '', alert ? `alert ${alert}` : '', m.mode ? (m.mode === 'guard-alone' ? 'guards alone' : 'asks first') : ''].filter(Boolean);
  if (/never clos|not clos|over closing|instead of clos/i.test(m.text)) return { icon: 'never-close', title: 'Add collateral, never close', facts };
  if (m.action === 'reduce') return { icon: 'trim', title: below ? `Below ${below}, trim the trade` : 'Trim the trade', facts };
  if (m.action === 'repay') return { icon: 'repay', title: below ? `Below ${below}, repay debt` : 'Repay debt', facts };
  if (max && !below) return { icon: 'cap', title: `At most ${max} USDC a defence`, facts };
  if (below && max) return { icon: 'add', title: `Below ${below}, add up to ${max} USDC`, facts };
  if (below) return { icon: 'add', title: `Below ${below}, add collateral`, facts };
  return { icon: 'add', title: m.kind === 'override' ? 'Your correction' : 'Add collateral', facts };
}
function RuleIcon({ kind }: { kind: RuleIconKind }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg className="ricon" width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
      {kind === 'add' && (
        <>
          <path {...p} d="M10 2.5 3.5 5v4.6c0 4 2.8 6.9 6.5 7.9 3.7-1 6.5-3.9 6.5-7.9V5z" />
          <path {...p} d="M10 7v6M7 10h6" />
        </>
      )}
      {kind === 'never-close' && (
        <>
          <rect {...p} x="4.5" y="9" width="11" height="8" rx="2" />
          <path {...p} d="M7 9V6.5a3 3 0 0 1 6 0V9" />
        </>
      )}
      {kind === 'cap' && (
        <>
          <path {...p} d="M3 4.5h14" />
          <circle {...p} cx="10" cy="12" r="4.5" />
          <path {...p} d="M10 10v4" />
        </>
      )}
      {kind === 'trim' && (
        <>
          <circle {...p} cx="5.5" cy="14.5" r="2.5" />
          <circle {...p} cx="14.5" cy="14.5" r="2.5" />
          <path {...p} d="M7 12.5 15 3M13 12.5 5 3" />
        </>
      )}
      {kind === 'repay' && <path {...p} d="M15.5 7H6l3-3M4.5 13H14l-3 3" />}
    </svg>
  );
}
const BlobLink = ({ id }: { id: string }) =>
  id.startsWith('local-file:') ? (
    <span className="ext">
      <span className="mono">{id}</span> <ForkTag text="local file" />
    </span>
  ) : (
    <a className="ext blob" target="_blank" rel="noreferrer" href={`https://walruscan.com/mainnet/blob/${id}`} data-film="blob-link">
      Blob <span className="mono">{short(id)}</span> <ArrowOut />
    </a>
  );

/* ---------- the gauge ---------- */
/** A semicircle risk meter: Liquidation (at or under the pool's line), Alert (up to the line where Yojimbo acts), Safe.
 * Log scale so the zones near liquidation stay readable; a ratio past the top (the chain caps it at 1000) pins right.
 * The marker and number ease to each new live read. */
function Gauge({ ratio: raw, noDebt, liquidation, actsBelow, tier, loading }: { ratio: number | null; noDebt?: boolean; liquidation?: number; actsBelow: number; tier: Tier | null; loading: boolean }) {
  const ratio = noDebt ? null : raw;
  const liq = liquidation ?? 1.1;
  const lo = liq * 0.9,
    hi = Math.max(actsBelow * 2.4, liq * 3);
  const f = (r: number) => Math.max(0, Math.min(1, (Math.log(Math.max(r, 1e-6)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))));
  const [shown, setShown] = useState<number | null>(ratio);
  const from = useRef<number | null>(ratio);
  useEffect(() => {
    if (ratio == null) {
      setShown(null);
      from.current = null;
      return;
    }
    const start = from.current ?? lo;
    if (RM() || start === ratio) {
      setShown(ratio);
      from.current = ratio;
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      const e = 1 - Math.pow(1 - k, 3);
      const v = Math.exp(Math.log(start) + (Math.log(ratio) - Math.log(start)) * e);
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = ratio;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      from.current = ratio;
    };
  }, [ratio]);
  const cx = 160,
    cy = 160,
    r = 128;
  const pt = (q: number) => {
    const a = Math.PI * (1 - q);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  };
  const arc = (q1: number, q2: number) => {
    const [x1, y1] = pt(q1),
      [x2, y2] = pt(q2);
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  const fl = f(liq),
    fa = f(actsBelow);
  const m = shown != null ? pt(f(shown)) : null;
  const tickAt = (q: number, label: string) => {
    const a = Math.PI * (1 - q);
    const [x, y] = [cx + (r + 26) * Math.cos(a), cy - (r + 26) * Math.sin(a)];
    return (
      <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="g-tick">
        {label}
      </text>
    );
  };
  return (
    <div className={`gauge ${tier ? `t-${tier}` : ''}`} data-film="gauge">
      <svg viewBox="0 0 320 178" role="img" aria-label={ratio != null ? `Risk ratio ${ratioText(ratio)}. Liquidation at ${liq.toFixed(2)}, Yojimbo acts below ${actsBelow.toFixed(2)}.` : noDebt ? 'No debt, nothing to guard' : 'No position read yet'}>
        <path d={arc(0, 1)} className="g-track" />
        {ratio != null && (
          <>
            <path d={arc(0, fl)} className="g-z g-liq" />
            <path d={arc(fl, fa)} className="g-z g-alert" />
            <path d={arc(fa, 1)} className="g-z g-safe" />
            {tickAt(fl, liq.toFixed(2))}
            {tickAt(fa, actsBelow.toFixed(2))}
          </>
        )}
        {m && (
          <g className="g-mark">
            <circle cx={m[0]} cy={m[1]} r="14" />
            <circle cx={m[0]} cy={m[1]} r="5" className="g-mark-in" />
          </g>
        )}
      </svg>
      <div className="g-center">
        {ratio != null ? (
          <>
            <b className="num" data-film="ratio">
              {ratio >= 1000 ? '999+' : (shown ?? ratio).toFixed(3)}
            </b>
            <span>risk ratio</span>
          </>
        ) : noDebt ? (
          <>
            <b className="g-calm" data-film="ratio">
              No debt
            </b>
            <span>nothing to guard</span>
          </>
        ) : loading ? (
          <span className="skeleton g-skel" aria-label="Reading the position" />
        ) : (
          <>
            <b className="num g-none">—</b>
            <span>no position</span>
          </>
        )}
      </div>
      {ratio != null && (
        <p className="g-mean">
          What it owns ÷ what it owes. At {liq.toFixed(2)} the pool sells you out.
        </p>
      )}
      {ratio != null && (
        <div className="g-legend" aria-hidden="true">
          <span className="lg-liq">Liquidation</span>
          <span className="lg-alert">Alert</span>
          <span className="lg-safe">Safe</span>
        </div>
      )}
    </div>
  );
}

/* ---------- the night timeline ---------- */
/** 24 h strips from the live schedule memories, in the schedules' own time zone, with a now marker and each defence
 * from the night log as a dot. days=1 is the Guard strip, days=7 the Memory week. */
function DayStrip({ schedules, events, tz, now, days }: { schedules: SchedHit[]; events: EventRow[]; tz: string; now: number; days: number }) {
  const today = localParts(new Date(now), tz);
  const rows = Array.from({ length: days }, (_, i) => {
    const date = new Date(now + i * 86400000);
    const p = localParts(date, tz);
    const prev = localParts(new Date(date.getTime() - 86400000), tz);
    // All-day and recurring windows first, one-off windows on top: a flight or a recording session wins its hours.
    const layer = (m: SchedMem) => (m.recurrence === 'once' ? 3 : m.start === '00:00' && (m.end === '23:59' || m.end === '24:00') ? 0 : m.recurrence === 'daily' ? 1 : 2);
    const segs = schedules
      .slice()
      .sort((x, y) => layer(x.memory) - layer(y.memory))
      .flatMap((h) => segmentsFor(h.memory, p.day, p.weekday, prev.weekday).map(([a, b]) => ({ a, b, h })));
    const dots = events.filter((e) => localParts(new Date(e.at), tz).day === p.day).map((e) => ({ e, m: localParts(new Date(e.at), tz).minutes }));
    return { p, segs, dots, i };
  });
  const nowPct = (today.minutes / 1440) * 100;
  const active = rows[0].segs.filter((s) => today.minutes >= s.a && today.minutes < s.b).sort((x, y) => String(y.h.memory.createdAt).localeCompare(String(x.h.memory.createdAt)))[0];
  const hhmm = `${String(Math.floor(today.minutes / 60)).padStart(2, '0')}:${String(today.minutes % 60).padStart(2, '0')}`;
  return (
    <div className={`strip ${days > 1 ? 'strip-week' : 'strip-day'}`} data-film="timeline">
      {days === 1 && (
        <p className="strip-now">
          <b>Now {hhmm} {tzLabel(tz)}</b>
          {active ? ` · ${schedLabel(active.h.memory).toLowerCase()} · it ${active.h.memory.mode === 'guard-alone' ? 'guards alone' : 'asks first'}` : ' · no window · it asks first'}
        </p>
      )}
      <div className="strip-rows">
        {rows.map(({ p, segs, dots, i }) => (
          <div className="strip-row" key={p.day}>
            {days > 1 && <span className="strip-day-l">{i === 0 ? 'Today' : `${p.weekday} ${p.dom}`}</span>}
            <div className="strip-track">
              {[6, 12, 18].map((h) => (
                <span key={h} className="strip-grid" style={{ left: `${(h / 24) * 100}%` }} />
              ))}
              {segs.map(({ a, b, h }, k) => (
                <span
                  key={`${h.blobId}-${k}`}
                  className={`seg-w k-${schedKind(h.memory)} ${h.memory.mode === 'guard-alone' ? 'm-alone' : 'm-ask'}`}
                  style={{ left: `${(a / 1440) * 100}%`, width: `${((b - a) / 1440) * 100}%` }}
                  title={`${schedLabel(h.memory)} · ${schedWhen(h.memory)} · “${h.memory.text}”`}
                >
                  {(b - a) / 1440 > (days > 1 ? 0.12 : 0.1) && <em>{schedLabel(h.memory)}</em>}
                </span>
              ))}
              {dots.map(({ e, m }) => (
                <span
                  key={e.id}
                  className={`strip-dot o-${/fail|error|refus/i.test(e.outcome) ? 'bad' : /dry/i.test(e.outcome) ? 'dry' : 'ok'}`}
                  style={{ left: `${(m / 1440) * 100}%` }}
                  title={`${e.action} ${e.amountUsdc} USDC · ratio ${e.beforeRatio.toFixed(3)} → ${e.afterRatio?.toFixed(3) ?? '—'} · ${e.outcome}`}
                />
              ))}
              {i === 0 && <span className="strip-nowline" style={{ left: `${nowPct}%` }} aria-hidden="true" />}
            </div>
          </div>
        ))}
      </div>
      <div className={`strip-axis ${days > 1 ? 'has-l' : ''}`} aria-hidden="true">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
      {schedules.length === 0 && <p className="fine">No schedule yet. Tell it when you sleep or fly.</p>}
    </div>
  );
}

const fmtAmt = (v: unknown) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '—');
  return n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 2 : 4 });
};

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

function Fact({ k, v, unit, hint }: { k: string; v: string; unit?: string; hint?: string }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd className="num">
        {v}
        {unit && <small>{unit}</small>}
      </dd>
      {hint && <span className="fact-hint">{hint}</span>}
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
