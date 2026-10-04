import { useMemo, useState } from 'react';
import { ANIMATIONS, ANIMATION_BY_KEY, type AnimationCategory } from '../core/animations';
import { animationGif, animationPsd, buildExport, framePsd, slug, type ExportFormat } from '../core/exporting';
import { cachedLayout, figureContext, renderImage, settingsFor, type FigureContext } from '../core/pipeline';
import { CLASS_PROFILES, defaultShape } from '../core/proportions';
import { DIRECTIONS, type AnimationSettings, type Build, type DirectionIndex, type FigureDocument, type FigureShape, type HeightClass } from '../core/types';
import { createZip } from '../core/zip';
import { upscale } from '../core/compose';
import { canShareFiles, deliverFile, encodePngInBrowser } from '../lib/files';
import { Icon } from './Icon';
import { NumberField, Segmented, Slider, Toggle } from './Fields';

type Update = (recipe: (document: FigureDocument) => FigureDocument) => void;

// ── Figure ──────────────────────────────────────────────────────────────────

export function FigurePanel(props: { document: FigureDocument; update: Update; context: FigureContext; animationKey: string }) {
  const { document, update } = props;
  const shape = document.shape;
  const setShape = (patch: Partial<FigureShape>) => update((current) => ({ ...current, shape: { ...current.shape, ...patch } }));
  // Picking a class/build resets proportions; an auto-generated name follows along.
  const choose = (heightClass: HeightClass, build: Build) => update((current) => ({
    ...current,
    name: /^(Child|Adult|Tall) · (thin|regular|wide)$/.test(current.name) ? `${heightClass[0].toUpperCase()}${heightClass.slice(1)} · ${build}` : current.name,
    shape: defaultShape(heightClass, build),
  }));
  const layout = cachedLayout(props.context, props.animationKey);
  const multiplier = (value: number) => `${Math.round(value * 100)}%`;
  const trueIso = Math.round(document.projection.tileWidthPixels * 0.6124);
  return (
    <div className="panel-body">
      <label className="field">
        <span className="field-label">Name</span>
        <input type="text" value={document.name} onChange={(event) => update((current) => ({ ...current, name: event.target.value }))} />
      </label>

      <Segmented<HeightClass>
        label="Height"
        value={shape.heightClass}
        onChange={(heightClass) => choose(heightClass, shape.build)}
        options={[
          { value: 'child', label: <span className="stacked">Child<small>1 block</small></span> },
          { value: 'adult', label: <span className="stacked">Adult<small>2 blocks</small></span> },
          { value: 'tall', label: <span className="stacked">Tall<small>3 blocks</small></span> },
        ]}
      />
      <Segmented<Build>
        label="Build"
        value={shape.build}
        onChange={(build) => choose(shape.heightClass, build)}
        options={[{ value: 'thin', label: 'Thin' }, { value: 'regular', label: 'Regular' }, { value: 'wide', label: 'Wide' }]}
      />

      <h3>Fine-tune</h3>
      <Slider label="Height (levels)" value={shape.heightLevels} min={0.5} max={4} step={0.125} format={(value) => value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} onChange={(heightLevels) => setShape({ heightLevels })} />
      <Slider label="Head" value={shape.headScale} min={0.6} max={1.5} step={0.05} format={multiplier} onChange={(headScale) => setShape({ headScale })} />
      <Slider label="Shoulders" value={shape.shoulderScale} min={0.6} max={1.6} step={0.05} format={multiplier} onChange={(shoulderScale) => setShape({ shoulderScale })} />
      <Slider label="Hips" value={shape.hipScale} min={0.6} max={1.6} step={0.05} format={multiplier} onChange={(hipScale) => setShape({ hipScale })} />
      <Slider label="Limb thickness" value={shape.limbScale} min={0.6} max={1.8} step={0.05} format={multiplier} onChange={(limbScale) => setShape({ limbScale })} />
      <Slider label="Leg length" value={shape.legScale} min={0.75} max={1.25} step={0.05} format={multiplier} onChange={(legScale) => setShape({ legScale })} />
      <Slider label="Arm length" value={shape.armScale} min={0.75} max={1.3} step={0.05} format={multiplier} onChange={(armScale) => setShape({ armScale })} />
      <button type="button" className="button" onClick={() => choose(shape.heightClass, shape.build)}>
        Reset to {shape.heightClass} · {shape.build} ({CLASS_PROFILES[shape.heightClass].headsTall} heads)
      </button>

      <h3>Tile (match plinth)</h3>
      <div className="grid-2">
        <NumberField label="Tile width" value={document.projection.tileWidthPixels} step={4} min={8} max={128} suffix="px"
          onChange={(tileWidthPixels) => update((current) => ({ ...current, projection: { ...current.projection, tileWidthPixels } }))} />
        <NumberField label="Level height" value={document.projection.levelHeightPixels} step={1} min={2} max={256} suffix="px"
          onChange={(levelHeightPixels) => update((current) => ({ ...current, projection: { ...current.projection, levelHeightPixels } }))} />
      </div>
      <div className="chip-row">
        <button type="button" className={`chip ${document.projection.levelHeightPixels === document.projection.tileWidthPixels / 2 ? 'is-active' : ''}`}
          onClick={() => update((current) => ({ ...current, projection: { ...current.projection, levelHeightPixels: current.projection.tileWidthPixels / 2 } }))}>
          Classic cube · {document.projection.tileWidthPixels / 2}px
        </button>
        <button type="button" className={`chip ${document.projection.levelHeightPixels === trueIso ? 'is-active' : ''}`}
          onClick={() => update((current) => ({ ...current, projection: { ...current.projection, levelHeightPixels: trueIso } }))}>
          True iso · {trueIso}px
        </button>
      </div>

      <h3>Frame</h3>
      <Segmented<FigureDocument['frame']['fit']>
        value={document.frame.fit}
        onChange={(fit) => update((current) => ({ ...current, frame: { ...current.frame, fit } }))}
        options={[
          { value: 'per-animation', label: 'Per animation', title: 'Tight frames, sized to each animation' },
          { value: 'shared', label: 'Fit all', title: 'One frame size for every included animation' },
          { value: 'custom', label: 'Custom' },
        ]}
      />
      {document.frame.fit === 'custom' ? (
        <div className="grid-2">
          <NumberField label="Width" value={document.frame.width} step={2} min={8} max={512} suffix="px" onChange={(width) => update((current) => ({ ...current, frame: { ...current.frame, width } }))} />
          <NumberField label="Height" value={document.frame.height} step={1} min={8} max={512} suffix="px" onChange={(height) => update((current) => ({ ...current, frame: { ...current.frame, height } }))} />
        </div>
      ) : (
        <NumberField label="Padding" value={document.frame.padding} step={1} min={0} max={32} suffix="px" onChange={(padding) => update((current) => ({ ...current, frame: { ...current.frame, padding } }))} />
      )}
      <div className="readout-card">
        <span>Frame</span>
        <strong>{layout.width} × {layout.height}px</strong>
        <small>Feet (tile centre) at {layout.anchorX}, {layout.anchorY}. Make your Procreate canvas this size, or a whole multiple of it.</small>
      </div>
    </div>
  );
}

// ── Look ────────────────────────────────────────────────────────────────────

export function LookPanel(props: { document: FigureDocument; update: Update }) {
  const look = props.document.look;
  const set = (patch: Partial<FigureDocument['look']>) => props.update((current) => ({ ...current, look: { ...current.look, ...patch } }));
  return (
    <div className="panel-body">
      <p className="muted small">These shape the preview and every export.</p>
      <Segmented<FigureDocument['look']['colourMode']>
        label="Colour"
        value={look.colourMode}
        onChange={(colourMode) => set({ colourMode })}
        options={[{ value: 'guide', label: 'Guide colours', title: 'Right side warm, left side cool' }, { value: 'grey', label: 'Values only' }]}
      />
      <NumberField label="Light bands" value={look.bands} step={1} min={2} max={6} onChange={(bands) => set({ bands })} />
      <Toggle label="Facing markers" hint="face, eyes, chest centre-line" checked={look.facingMarkers} onChange={(facingMarkers) => set({ facingMarkers })} />
      <Segmented<FigureDocument['look']['outline']>
        label="Outline"
        value={look.outline}
        onChange={(outline) => set({ outline })}
        options={[
          { value: 'outside', label: 'Outside', title: 'Wraps the shape; limbs keep full width' },
          { value: 'inside', label: 'Inside', title: 'Drawn on the shape’s own edge pixels' },
          { value: 'none', label: 'None' },
        ]}
      />
      {look.outline !== 'none' && (
        <Segmented<FigureDocument['look']['outlineScope']>
          label="Lines between"
          value={look.outlineScope}
          onChange={(outlineScope) => set({ outlineScope })}
          options={[{ value: 'parts', label: 'Body parts' }, { value: 'silhouette', label: 'Silhouette only' }]}
        />
      )}
      <Toggle label="Ground shadow" checked={look.shadow} onChange={(shadow) => set({ shadow })} />
      <Toggle label="Tile guide" hint="diamond under the feet (hidden layer in PSDs)" checked={look.tileGuide} onChange={(tileGuide) => set({ tileGuide })} />
    </div>
  );
}

// ── Animations ──────────────────────────────────────────────────────────────

export function AnimationPanel(props: { document: FigureDocument; update: Update; animationKey: string; onSelect: (key: string) => void }) {
  const { document, update, animationKey } = props;
  const definition = ANIMATION_BY_KEY.get(animationKey)!;
  const settings = settingsFor(document, animationKey);
  const set = (patch: Partial<AnimationSettings>) =>
    update((current) => ({ ...current, animations: { ...current.animations, [animationKey]: { ...settingsFor(current, animationKey), ...patch } } }));
  const categories: AnimationCategory[] = ['Locomotion', 'Emotes', 'Actions'];
  const milliseconds = Math.round(1000 / settings.fps);
  return (
    <div className="panel-body">
      <div className="animation-settings">
        <h2>{definition.label}</h2>
        <div className="grid-2">
          <NumberField label="Frames" value={settings.frames} step={1} min={1} max={48} onChange={(frames) => set({ frames })} />
          <NumberField label="Frame rate" hint={`${milliseconds} ms`} value={settings.fps} step={0.5} min={0.5} max={60} suffix="fps" onChange={(fps) => set({ fps })} />
        </div>
        <div className="chip-row">
          {[4, 6, 8, 10, 12, 15, 24].map((fps) => (
            <button key={fps} type="button" className={`chip ${settings.fps === fps ? 'is-active' : ''}`} onClick={() => set({ fps })}>{fps}</button>
          ))}
        </div>
        <Slider label="Intensity" value={settings.intensity} min={0.25} max={2} step={0.05} format={(value) => `${Math.round(value * 100)}%`} onChange={(intensity) => set({ intensity })} />
        <Toggle label="Loop" hint={settings.loop ? 'last frame flows into the first' : 'plays once, first and last frames included'} checked={settings.loop} onChange={(loop) => set({ loop })} />
        <button type="button" className="button" onClick={() => set({ ...definition.defaults, intensity: 1 })}>
          Reset · {definition.defaults.frames} frames @ {definition.defaults.fps} fps
        </button>
      </div>

      {categories.map((category) => (
        <section key={category} className="animation-list">
          <h3>{category}</h3>
          <ul>
            {ANIMATIONS.filter((candidate) => candidate.category === category).map((candidate) => {
              const candidateSettings = settingsFor(document, candidate.key);
              return (
                <li key={candidate.key} className={candidate.key === animationKey ? 'is-current' : ''}>
                  <button type="button" className="animation-pick" onClick={() => props.onSelect(candidate.key)}>
                    <strong>{candidate.label}</strong>
                    <small>{candidateSettings.frames}f · {candidateSettings.fps}fps{candidateSettings.loop ? ' · loop' : ''}</small>
                  </button>
                  <label className="include" title="Include in “all animations” exports and the shared frame size">
                    <input type="checkbox" checked={candidateSettings.include} onChange={(event) =>
                      update((current) => ({ ...current, animations: { ...current.animations, [candidate.key]: { ...settingsFor(current, candidate.key), include: event.target.checked } } }))} />
                    <span className="sr-only">Include {candidate.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ── Export ──────────────────────────────────────────────────────────────────

export function ExportPanel(props: {
  document: FigureDocument;
  animationKey: string;
  direction: DirectionIndex;
  frame: number;
  notify: (message: string) => void;
  onImport: (document: FigureDocument) => void;
}) {
  const { document, animationKey, direction, frame, notify } = props;
  const [scale, setScale] = useState(1);
  const [animationScope, setAnimationScope] = useState<'current' | 'all'>('current');
  const [directionScope, setDirectionScope] = useState<'current' | 'all'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const shareable = useMemo(() => canShareFiles(), []);
  const included = ANIMATIONS.filter((definition) => settingsFor(document, definition.key).include).map((definition) => definition.key);
  const animations = animationScope === 'current' ? [animationKey] : included;
  const directions: DirectionIndex[] = directionScope === 'current' ? [direction] : [0, 1, 2, 3, 4, 5, 6, 7];
  const base = slug(document.name);
  const suffix = scale > 1 ? `@${scale}x` : '';

  const run = async (label: string, make: () => Promise<{ bytes: Uint8Array; filename: string; type: string }>, share = false) => {
    setBusy(label);
    // Let the "Working…" state paint before the synchronous rendering starts.
    await new Promise((resolve) => setTimeout(resolve, 30));
    try {
      const { bytes, filename, type } = await make();
      const outcome = await deliverFile(bytes, filename, type, share);
      if (outcome !== 'cancelled') notify(`${outcome === 'shared' ? 'Shared' : 'Saved'} ${filename}`);
    } catch (error) {
      notify(`Export failed: ${(error as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const zipOf = async (formats: ExportFormat[], name: string) => {
    const entries = await buildExport(document, { animations, directions, scale, formats }, encodePngInBrowser);
    return { bytes: createZip(entries.map((entry) => ({ ...entry, name: `${base}/${entry.name}` }))), filename: `${base}_${name}${suffix}.zip`, type: 'application/zip' };
  };

  const single = animations.length === 1 && directions.length === 1;
  const actions: { label: string; detail: string; make: () => Promise<{ bytes: Uint8Array; filename: string; type: string }> }[] = [
    {
      label: 'Procreate animation',
      detail: single ? 'One .psd: a group per frame (Animation Assist), a layer per limb.' : 'A .psd per animation and direction, in a zip.',
      make: async () => single
        ? { bytes: animationPsd(figureContext(document), animations[0], directions[0], scale), filename: `${directions[0]}_${DIRECTIONS[directions[0]]}_${animations[0]}${suffix}.psd`, type: 'image/vnd.adobe.photoshop' }
        : zipOf(['psd'], 'procreate'),
    },
    { label: 'Sprite sheets', detail: 'Rows = directions, columns = frames, plus JSON with fps and anchor.', make: () => zipOf(['sheet'], 'sheets') },
    { label: 'Frames & strips', detail: 'Same folder layout as the guides: walk_frames/0_S_walk_0.png …', make: () => zipOf(['frames'], 'frames') },
    {
      label: 'Preview GIF',
      detail: directions.length === 8 ? 'All 8 directions in a compass, at the set frame rate.' : 'This direction, at the set frame rate.',
      make: async () => {
        if (animations.length === 1) {
          const bytes = animationGif(figureContext(document), animations[0], directions.length === 8 ? 'compass' : directions, Math.max(scale, 3));
          return { bytes, filename: `${animations[0]}_${directions.length === 8 ? '8way' : DIRECTIONS[directions[0]]}.gif`, type: 'image/gif' };
        }
        return zipOf(['gif'], 'previews');
      },
    },
    { label: 'Everything', detail: 'All of the above in one zip, plus figure.json.', make: () => zipOf(['psd', 'sheet', 'frames', 'gif'], 'all') },
  ];

  return (
    <div className="panel-body">
      <Segmented<'current' | 'all'>
        label="Animations"
        value={animationScope}
        onChange={setAnimationScope}
        options={[{ value: 'current', label: ANIMATION_BY_KEY.get(animationKey)!.label }, { value: 'all', label: `All included (${included.length})` }]}
      />
      <Segmented<'current' | 'all'>
        label="Directions"
        value={directionScope}
        onChange={setDirectionScope}
        options={[{ value: 'current', label: `${DIRECTIONS[direction]} only` }, { value: 'all', label: 'All 8' }]}
      />
      <Segmented<number> label="Scale" value={scale} onChange={setScale} options={[1, 2, 4, 8].map((value) => ({ value, label: `${value}×` }))} />
      <p className="muted small">1× is pixel-exact. Bigger scales are nearest-neighbour. GIF previews are at least 3×.</p>

      {actions.map((action) => (
        <div key={action.label} className="export-row">
          <div className="export-action">
            <button type="button" className="button primary" disabled={busy !== null} onClick={() => run(action.label, action.make)}>
              <Icon name="download" size={16} /> {busy === action.label ? 'Working…' : action.label}
            </button>
            {shareable && (
              <button type="button" className="button icon-only" aria-label={`Share ${action.label}`} disabled={busy !== null} onClick={() => run(action.label, action.make, true)}>
                <Icon name="share" size={16} />
              </button>
            )}
          </div>
          <small>{action.detail}</small>
        </div>
      ))}

      <h3>Current frame</h3>
      <div className="button-row">
        <button type="button" className="button" disabled={busy !== null} onClick={() => run('frame-psd', async () => ({
          bytes: framePsd(figureContext(document), animationKey, frame, direction, scale),
          filename: `${direction}_${DIRECTIONS[direction]}_${animationKey}_${frame}${suffix}.psd`, type: 'image/vnd.adobe.photoshop',
        }))}><Icon name="download" size={16} /> Layered PSD</button>
        <button type="button" className="button" disabled={busy !== null} onClick={() => run('frame-png', async () => {
          const image = renderImage(figureContext(document), animationKey, frame, direction);
          return {
            bytes: await encodePngInBrowser(upscale(image.rgba, image.width, image.height, scale), image.width * scale, image.height * scale),
            filename: `${direction}_${DIRECTIONS[direction]}_${animationKey}_${frame}${suffix}.png`, type: 'image/png',
          };
        })}><Icon name="download" size={16} /> PNG</button>
      </div>

      <h3>Figure file</h3>
      <div className="button-row">
        <button type="button" className="button" onClick={() => run('json', async () => ({
          bytes: new TextEncoder().encode(JSON.stringify(document, null, 2)), filename: `${base}.marionette.json`, type: 'application/json',
        }))}><Icon name="download" size={16} /> Export JSON</button>
        <label className="button">
          <Icon name="folder" size={16} /> Import JSON
          <input type="file" accept="application/json,.json" hidden onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            try {
              const parsed = JSON.parse(await file.text()) as FigureDocument;
              if (parsed.version !== 1 || !parsed.shape) throw new Error('not a marionette file');
              props.onImport(parsed);
              notify(`Imported ${parsed.name}`);
            } catch (error) {
              notify(`Import failed: ${(error as Error).message}`);
            }
          }} />
        </label>
      </div>
    </div>
  );
}
