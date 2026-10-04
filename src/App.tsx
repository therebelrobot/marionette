import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ANIMATIONS } from './core/animations';
import { newFigure, normaliseFigure } from './core/document';
import { figureContext, settingsFor } from './core/pipeline';
import { makeId, type Build, type DirectionIndex, type FigureDocument, type HeightClass } from './core/types';
import { clearDraft, figureApi, lastId, loadDraft, rememberLast, saveDraft } from './lib/api';
import { useHistory } from './state/history';
import { FiguresDrawer } from './ui/FiguresDrawer';
import { Icon } from './ui/Icon';
import { AnimationPanel, ExportPanel, FigurePanel, LookPanel } from './ui/Panels';
import { DirectionPad, Stage, useFrameCache, type StageBackground, type ViewMode } from './ui/Stage';
import { Timeline } from './ui/Timeline';

type SaveState = 'idle' | 'saving' | 'saved' | 'local';
type LeftTab = 'figure' | 'look';
type RightTab = 'animations' | 'export';

function idFromHash(): string | null {
  const match = window.location.hash.match(/figure=([\w-]+)/);
  return match ? match[1] : null;
}

const capitalise = (text: string) => text[0].toUpperCase() + text.slice(1);

export function App() {
  const history = useHistory(newFigure());
  const document = history.document;
  const [figureId, setFigureId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [animationKey, setAnimationKey] = useState('walk');
  const [direction, setDirection] = useState<DirectionIndex>(0);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('single');
  const [onion, setOnion] = useState(false);
  const [blockGuide, setBlockGuide] = useState(false);
  const [background, setBackground] = useState<StageBackground>('paper');
  const [leftTab, setLeftTab] = useState<LeftTab>('figure');
  const [rightTab, setRightTab] = useState<RightTab>('animations');
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1100);
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth >= 1100);
  const [rightOpen, setRightOpen] = useState(() => window.innerWidth >= 1100);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const loaded = useRef(false);
  const savedSnapshot = useRef('');
  const toastTimer = useRef<number>(0);

  const context = useMemo(() => figureContext(document), [document]);
  const getFrame = useFrameCache(context);
  const settings = settingsFor(document, animationKey);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1099px)');
    const update = () => {
      setNarrow(query.matches);
      if (query.matches) { setLeftOpen(false); setRightOpen(false); }
    };
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // ── Playback ──────────────────────────────────────────────────────────────
  // Frame timing comes straight from the animation's fps. One-shots hold their
  // last frame briefly before replaying so the ending is readable.
  useEffect(() => {
    if (frame >= settings.frames) setFrame(0);
  }, [frame, settings.frames]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let accumulated = 0;
    let holding = 0;
    const tick = (now: number) => {
      const elapsed = (now - last) / 1000;
      last = now;
      const duration = 1 / settings.fps;
      setFrame((current) => {
        let next = current;
        if (holding > 0) {
          holding -= elapsed;
          if (holding <= 0) { accumulated = 0; return 0; }
          return current;
        }
        accumulated += elapsed;
        while (accumulated >= duration) {
          accumulated -= duration;
          if (next + 1 < settings.frames) next += 1;
          else if (settings.loop) next = 0;
          else { holding = 0.6; accumulated = 0; break; }
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, settings.fps, settings.frames, settings.loop]);

  // ── Loading & saving ──────────────────────────────────────────────────────
  const openFigure = useCallback(async (id: string) => {
    try {
      const { document: stored } = await figureApi.get(id);
      const loadedDocument = normaliseFigure(stored);
      savedSnapshot.current = JSON.stringify(loadedDocument);
      const draft = loadDraft(id);
      history.reset(draft && JSON.stringify(normaliseFigure(draft.document)) !== savedSnapshot.current ? normaliseFigure(draft.document) : loadedDocument);
      setFigureId(id);
      setSaveState('saved');
    } catch {
      const draft = loadDraft(id);
      if (!draft) throw new Error('not found');
      savedSnapshot.current = '';
      history.reset(normaliseFigure(draft.document));
      setFigureId(id);
      setSaveState('local');
    }
  }, [history]);

  const createFigure = useCallback(async (seed: FigureDocument) => {
    savedSnapshot.current = JSON.stringify(seed);
    history.reset(seed);
    try {
      const { id } = await figureApi.create(seed);
      setFigureId(id);
      setSaveState('saved');
    } catch {
      const id = `local-${makeId()}`;
      saveDraft(id, seed);
      setFigureId(id);
      setSaveState('local');
    }
  }, [history]);

  useEffect(() => {
    const initial = idFromHash() ?? lastId();
    (initial ? openFigure(initial) : Promise.reject()).catch(() => createFigure(newFigure()))
      .finally(() => { loaded.current = true; });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!figureId) return;
    rememberLast(figureId);
    if (!window.location.hash.includes(figureId)) window.history.replaceState(null, '', `#figure=${figureId}`);
  }, [figureId]);

  useEffect(() => {
    if (!figureId || !loaded.current) return;
    const serialised = JSON.stringify(document);
    if (serialised === savedSnapshot.current) return;
    saveDraft(figureId, document);
    setSaveState('saving');
    const timer = window.setTimeout(async () => {
      if (figureId.startsWith('local-')) { setSaveState('local'); return; }
      try {
        await figureApi.save(figureId, document);
        savedSnapshot.current = serialised;
        clearDraft(figureId);
        setSaveState('saved');
      } catch {
        setSaveState('local');
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [document, figureId]);

  // Slider drags would otherwise fill undo history with every pixel of travel:
  // coalesce edits that arrive within half a second into one undo step.
  const lastEdit = useRef(0);
  const update = useCallback((recipe: (current: FigureDocument) => FigureDocument) => {
    const now = performance.now();
    if (now - lastEdit.current < 500) history.replace(recipe);
    else history.commit(recipe);
    lastEdit.current = now;
  }, [history]);

  const selectAnimation = (key: string) => {
    setAnimationKey(key);
    setFrame(0);
    setPlaying(true);
  };

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, select, textarea')) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === 'z') { event.preventDefault(); if (event.shiftKey) history.redo(); else history.undo(); return; }
      if (mod && key === 'y') { event.preventDefault(); history.redo(); return; }
      if (mod) return;
      if (event.key === ' ') { event.preventDefault(); setPlaying((current) => !current); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); setPlaying(false); setFrame((current) => (current + 1) % settings.frames); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); setPlaying(false); setFrame((current) => (current - 1 + settings.frames) % settings.frames); }
      else if (event.key === 'ArrowUp' || key === 'e') { event.preventDefault(); setDirection((current) => ((current + 7) % 8) as DirectionIndex); }
      else if (event.key === 'ArrowDown' || key === 'q') { event.preventDefault(); setDirection((current) => ((current + 1) % 8) as DirectionIndex); }
      else if (/^[0-7]$/.test(event.key)) setDirection(Number(event.key) as DirectionIndex);
      else if (event.key === ']' || event.key === '[') {
        const index = ANIMATIONS.findIndex((definition) => definition.key === animationKey);
        const next = ANIMATIONS[(index + (event.key === ']' ? 1 : ANIMATIONS.length - 1)) % ANIMATIONS.length];
        selectAnimation(next.key);
      }
      else if (key === 'o') setOnion((current) => !current);
      else if (key === 'g') setBlockGuide((current) => !current);
      else if (key === 'v') setViewMode((current) => (current === 'single' ? 'compass' : current === 'compass' ? 'sheet' : 'single'));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const saveLabel: Record<SaveState, string> = { idle: '', saving: 'Saving…', saved: 'Saved', local: 'Saved on this device' };
  const toggleLeft = () => { setLeftOpen((open) => !open); if (narrow) setRightOpen(false); };
  const toggleRight = () => { setRightOpen((open) => !open); if (narrow) setLeftOpen(false); };

  return (
    <div className={`app ${leftOpen ? 'left-open' : 'left-closed'} ${rightOpen ? 'right-open' : 'right-closed'}`}>
      <header className="topbar">
        <button type="button" className={`icon-button ${leftOpen ? 'is-active' : ''}`} onClick={toggleLeft} aria-label="Figure panel" title="Figure & look">
          <Icon name="sliders" />
        </button>
        <div className="brand" aria-label="marionette">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 3h16" stroke="#a0a0a0" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M8 3v5M16 3v9M12 3v2" stroke="#6a6a6a" strokeWidth="1" />
            <circle cx="12" cy="7.5" r="2.5" fill="#e8ccb0" />
            <path d="M9 11h6l-.6 5H9.6z" fill="#9692a8" />
            <path d="M9.6 16l-.8 6M14.4 16l.8 6" stroke="#cc704a" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M9 11.5l-1 4.5M15 11.5l1 4" stroke="#4ea89a" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span>marionette</span>
        </div>
        <button type="button" className="scene-name" onClick={() => setDrawerOpen(true)} title="Figures">
          <Icon name="folder" size={16} />
          <span>{document.name}</span>
        </button>
        <span className={`save-state save-${saveState}`}>{saveLabel[saveState]}</span>
        <div className="topbar-spacer" />
        <div className="button-group">
          <button type="button" className="icon-button" onClick={history.undo} disabled={!history.canUndo} aria-label="Undo" title="Undo (⌘Z)"><Icon name="undo" /></button>
          <button type="button" className="icon-button" onClick={history.redo} disabled={!history.canRedo} aria-label="Redo" title="Redo (⇧⌘Z)"><Icon name="redo" /></button>
        </div>
        <button type="button" className={`icon-button ${rightOpen ? 'is-active' : ''}`} onClick={toggleRight} aria-label="Animation panel" title="Animations & export">
          <Icon name="film" />
        </button>
      </header>

      <aside className="panel panel-left" aria-label="Figure">
        <nav className="tabs" role="tablist">
          {(['figure', 'look'] as LeftTab[]).map((name) => (
            <button key={name} type="button" role="tab" aria-selected={leftTab === name} className={leftTab === name ? 'is-active' : ''} onClick={() => setLeftTab(name)}>{capitalise(name)}</button>
          ))}
          <button type="button" className="icon-button tabs-close" onClick={() => setLeftOpen(false)} aria-label="Close panel"><Icon name="close" size={18} /></button>
        </nav>
        <div className="panel-scroll">
          {leftTab === 'figure'
            ? <FigurePanel document={document} update={update} context={context} animationKey={animationKey} />
            : <LookPanel document={document} update={update} />}
        </div>
      </aside>

      <main className="stage">
        <div className="stage-toolbar">
          <div className="segmented compact" role="radiogroup" aria-label="View">
            {([['single', 'single', 'One'], ['compass', 'compass', '8-way'], ['sheet', 'sheet', 'Sheet']] as const).map(([mode, icon, label]) => (
              <button key={mode} type="button" role="radio" aria-checked={viewMode === mode} className={viewMode === mode ? 'is-active' : ''} onClick={() => setViewMode(mode)} title={`${label} (V)`}>
                <Icon name={icon} size={16} /><span>{label}</span>
              </button>
            ))}
          </div>
          <div className="stage-toggles">
            <button type="button" className={`chip ${onion ? 'is-active' : ''}`} onClick={() => setOnion((current) => !current)} aria-pressed={onion} title="Onion skin: previous frame (O)"><Icon name="onion" size={14} /> Onion</button>
            <button type="button" className={`chip ${blockGuide ? 'is-active' : ''}`} onClick={() => setBlockGuide((current) => !current)} aria-pressed={blockGuide} title="Block column guide (G)"><Icon name="block" size={14} /> Blocks</button>
            <select className="chip-select" value={background} onChange={(event) => setBackground(event.target.value as StageBackground)} aria-label="Stage background">
              <option value="paper">Paper</option>
              <option value="checker">Checker</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </div>
        <div className="stage-body">
          <Stage
            context={context}
            getFrame={getFrame}
            animationKey={animationKey}
            frame={Math.min(frame, settings.frames - 1)}
            direction={direction}
            viewMode={viewMode}
            onion={onion}
            blockGuide={blockGuide}
            background={background}
            onDirection={setDirection}
            onFrame={(next) => { setPlaying(false); setFrame(next); }}
            onViewMode={setViewMode}
          />
          {viewMode === 'single' && <div className="direction-dock"><DirectionPad direction={direction} onChange={setDirection} /></div>}
          {toast && <div className="toast" role="status">{toast}</div>}
        </div>
        <Timeline
          context={context}
          getFrame={getFrame}
          animationKey={animationKey}
          direction={direction}
          frame={Math.min(frame, settings.frames - 1)}
          playing={playing}
          onFrame={setFrame}
          onPlaying={setPlaying}
        />
      </main>

      <aside className="panel panel-right" aria-label="Animations">
        <nav className="tabs" role="tablist">
          {(['animations', 'export'] as RightTab[]).map((name) => (
            <button key={name} type="button" role="tab" aria-selected={rightTab === name} className={rightTab === name ? 'is-active' : ''} onClick={() => setRightTab(name)}>{capitalise(name)}</button>
          ))}
          <button type="button" className="icon-button tabs-close" onClick={() => setRightOpen(false)} aria-label="Close panel"><Icon name="close" size={18} /></button>
        </nav>
        <div className="panel-scroll">
          {rightTab === 'animations'
            ? <AnimationPanel document={document} update={update} animationKey={animationKey} onSelect={(key) => { selectAnimation(key); if (narrow) setRightOpen(false); }} />
            : <ExportPanel document={document} animationKey={animationKey} direction={direction} frame={Math.min(frame, settings.frames - 1)} notify={notify} onImport={(imported) => createFigure(normaliseFigure(imported))} />}
        </div>
      </aside>

      {drawerOpen && (
        <FiguresDrawer
          currentId={figureId}
          notify={notify}
          onClose={() => setDrawerOpen(false)}
          onOpen={(id) => { setDrawerOpen(false); openFigure(id).catch(() => notify('Could not open that figure')); }}
          onNew={(heightClass: HeightClass, build: Build) => { setDrawerOpen(false); createFigure(newFigure(`${capitalise(heightClass)} · ${build}`, heightClass, build)); }}
          onDuplicate={() => { setDrawerOpen(false); createFigure({ ...history.current(), name: `${history.current().name} copy` }); }}
        />
      )}
    </div>
  );
}
