import { useEffect, useMemo, useRef, useState } from 'react';
import { ANIMATION_BY_KEY, frameLabel } from '../core/animations';
import { cachedLayout, renderImage, settingsFor, type FigureContext } from '../core/pipeline';
import { projectOffset } from '../core/render';
import { DIRECTIONS, type DirectionIndex } from '../core/types';
import { Icon } from './Icon';

export type ViewMode = 'single' | 'compass' | 'sheet';
export type StageBackground = 'paper' | 'checker' | 'dark';

export interface RenderedImage { rgba: Uint8ClampedArray; width: number; height: number }

/** Per-document cache of rendered frames (rendering is cheap, but playback asks for the same frames repeatedly). */
export function useFrameCache(context: FigureContext) {
  return useMemo(() => {
    const cache = new Map<string, RenderedImage>();
    return (key: string, frame: number, direction: DirectionIndex): RenderedImage => {
      const id = `${key}:${frame}:${direction}`;
      let image = cache.get(id);
      if (!image) {
        image = renderImage(context, key, frame, direction);
        if (cache.size > 2000) cache.clear();
        cache.set(id, image);
      }
      return image;
    };
  }, [context]);
}

/** A 1× canvas shown at an integer CSS scale with nearest-neighbour pixels. */
export function PixelImage(props: { image: RenderedImage; scale: number; underlay?: RenderedImage | null; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = props.image.width;
    canvas.height = props.image.height;
    const context = canvas.getContext('2d')!;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (props.underlay) {
      const ghost = document.createElement('canvas');
      ghost.width = props.underlay.width;
      ghost.height = props.underlay.height;
      ghost.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(props.underlay.rgba), props.underlay.width, props.underlay.height), 0, 0);
      context.globalAlpha = 0.28;
      context.drawImage(ghost, 0, 0);
      context.globalAlpha = 1;
      const current = document.createElement('canvas');
      current.width = props.image.width;
      current.height = props.image.height;
      current.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(props.image.rgba), props.image.width, props.image.height), 0, 0);
      context.drawImage(current, 0, 0);
    } else {
      context.putImageData(new ImageData(new Uint8ClampedArray(props.image.rgba), props.image.width, props.image.height), 0, 0);
    }
  }, [props.image, props.underlay]);
  return (
    <canvas
      ref={ref}
      className={`pixel-image ${props.className ?? ''}`}
      style={{ width: props.image.width * props.scale, height: props.image.height * props.scale }}
    />
  );
}

/** Eight direction buttons laid out on screen as the figure would face. */
export function DirectionPad(props: { direction: DirectionIndex; onChange: (direction: DirectionIndex) => void }) {
  // Screen layout: NW N NE / W · E / SW S SE
  const cells: (DirectionIndex | null)[] = [3, 4, 5, 2, null, 6, 1, 0, 7];
  const arrows = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘'];
  return (
    <div className="direction-pad" role="radiogroup" aria-label="Direction">
      {cells.map((cell, index) => cell === null
        ? <span key={index} className="direction-centre">{DIRECTIONS[props.direction]}</span>
        : (
          <button
            key={index}
            type="button"
            role="radio"
            aria-checked={cell === props.direction}
            aria-label={DIRECTIONS[cell]}
            title={`${DIRECTIONS[cell]} (${cell})`}
            className={cell === props.direction ? 'is-active' : ''}
            onClick={() => props.onChange(cell)}
          >
            {arrows[cell]}
          </button>
        ))}
    </div>
  );
}

interface StageProps {
  context: FigureContext;
  getFrame: (key: string, frame: number, direction: DirectionIndex) => RenderedImage;
  animationKey: string;
  frame: number;
  direction: DirectionIndex;
  viewMode: ViewMode;
  onion: boolean;
  blockGuide: boolean;
  background: StageBackground;
  onDirection: (direction: DirectionIndex) => void;
  onFrame: (frame: number) => void;
  onViewMode: (mode: ViewMode) => void;
}

export function Stage(props: StageProps) {
  const { context, getFrame, animationKey, frame, direction, viewMode } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 600, height: 500 });
  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  const layout = cachedLayout(context, animationKey);
  const settings = settingsFor(context.document, animationKey);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => setBounds({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setZoomOverride(null), [layout.width, layout.height, viewMode]);

  // Integer zoom that fits the view.
  const columns = viewMode === 'single' ? 1 : viewMode === 'compass' ? 3 : settings.frames;
  const rows = viewMode === 'single' ? 1 : viewMode === 'compass' ? 3 : 8;
  const gap = viewMode === 'single' ? 0 : 2;
  const fitZoom = Math.max(1, Math.floor(Math.min(
    (bounds.width - 48) / (columns * layout.width + (columns - 1) * gap),
    (bounds.height - 48) / (rows * layout.height + (rows - 1) * gap),
  )));
  const zoom = Math.max(1, Math.min(32, zoomOverride ?? fitZoom));

  // Zooming past the fit keeps the view centred instead of pinned top-left.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollLeft = (container.scrollWidth - container.clientWidth) / 2;
    container.scrollTop = (container.scrollHeight - container.clientHeight) / 2;
  }, [zoom, viewMode]);

  // Gestures: one-finger/mouse horizontal drag turns the figure (single view);
  // pinch or ctrl/⌘-scroll zooms.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'turn'; startX: number; startDirection: number } | { kind: 'pinch'; distance: number; zoom: number } | null>(null);
  const onPointerDown = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('button')) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [first, second] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', distance: Math.hypot(first.x - second.x, first.y - second.y) || 1, zoom };
    } else if (viewMode === 'single') {
      gesture.current = { kind: 'turn', startX: event.clientX, startDirection: direction };
    }
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const tracked = pointers.current.get(event.pointerId);
    if (!tracked) return;
    tracked.x = event.clientX; tracked.y = event.clientY;
    const active = gesture.current;
    if (active?.kind === 'pinch' && pointers.current.size >= 2) {
      const [first, second] = [...pointers.current.values()];
      setZoomOverride(Math.round(active.zoom * Math.hypot(first.x - second.x, first.y - second.y) / active.distance));
    } else if (active?.kind === 'turn') {
      // Drag right spins the figure like a turntable (front moves right): S → SE → E …
      const steps = Math.round((event.clientX - active.startX) / 48);
      const next = (((active.startDirection - steps) % 8) + 8) % 8;
      if (next !== direction) props.onDirection(next as DirectionIndex);
    }
  };
  const onPointerUp = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
  };
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      setZoomOverride((current) => Math.max(1, Math.min(32, Math.round((current ?? fitZoom) * Math.exp(-event.deltaY * 0.01)) || 1)));
    };
    const stopGesture = (event: Event) => event.preventDefault();
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('gesturestart', stopGesture);
    return () => { container.removeEventListener('wheel', onWheel); container.removeEventListener('gesturestart', stopGesture); };
  }, [fitZoom]);

  const definition = ANIMATION_BY_KEY.get(animationKey)!;
  const previous = settings.loop ? (frame - 1 + settings.frames) % settings.frames : frame - 1;

  let content: React.ReactNode;
  if (viewMode === 'single') {
    const image = getFrame(animationKey, frame, direction);
    const underlay = props.onion && previous >= 0 && settings.frames > 1 ? getFrame(animationKey, previous, direction) : null;
    content = (
      <div className="single-view" style={{ width: layout.width * zoom, height: layout.height * zoom }}>
        {props.blockGuide && <BlockGuide context={context} zoom={zoom} anchorX={layout.anchorX} anchorY={layout.anchorY} width={layout.width} height={layout.height} />}
        <PixelImage image={image} scale={zoom} underlay={underlay} />
      </div>
    );
  } else if (viewMode === 'compass') {
    const cells: (DirectionIndex | null)[] = [3, 4, 5, 2, null, 6, 1, 0, 7];
    content = (
      <div className="compass-view" style={{ gridTemplateColumns: `repeat(3, ${layout.width * zoom}px)`, gap }}>
        {cells.map((cell, index) => cell === null
          ? <div key={index} className="compass-centre" style={{ width: layout.width * zoom, height: layout.height * zoom }}>
              <strong>{definition.label}</strong><small>frame {frame + 1}/{settings.frames}</small>
            </div>
          : (
            <button key={index} type="button" className={`cell ${cell === direction ? 'is-current' : ''}`} onClick={() => { props.onDirection(cell); props.onViewMode('single'); }} aria-label={`Open ${DIRECTIONS[cell]}`}>
              <PixelImage image={getFrame(animationKey, frame, cell)} scale={zoom} />
              <span className="cell-tag">{DIRECTIONS[cell]}</span>
            </button>
          ))}
      </div>
    );
  } else {
    content = (
      <div className="sheet-view" style={{ gridTemplateColumns: `auto repeat(${settings.frames}, ${layout.width * zoom}px)`, gap }}>
        <span />
        {Array.from({ length: settings.frames }, (_, column) => (
          <span key={column} className={`sheet-heading ${column === frame ? 'is-current' : ''}`}>
            {frameLabel(definition, column, settings.frames, settings.loop) ?? column + 1}
          </span>
        ))}
        {DIRECTIONS.map((name, row) => [
          <span key={`label-${name}`} className={`sheet-row-label ${row === direction ? 'is-current' : ''}`}>{name}</span>,
          ...Array.from({ length: settings.frames }, (_, column) => (
            <button
              key={`${name}-${column}`}
              type="button"
              className={`cell ${row === direction && column === frame ? 'is-current' : ''}`}
              onClick={() => { props.onDirection(row as DirectionIndex); props.onFrame(column); }}
              aria-label={`${name} frame ${column + 1}`}
            >
              <PixelImage image={getFrame(animationKey, column, row as DirectionIndex)} scale={zoom} />
            </button>
          )),
        ])}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`stage-canvas bg-${props.background}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      data-testid="stage"
    >
      <div className="stage-content">{content}</div>
      <div className="stage-readout">
        <span>{layout.width}×{layout.height}px</span>
        <span>{zoom}×</span>
        {viewMode === 'single' && <span>drag sideways to turn</span>}
      </div>
      <div className="stage-zoom">
        <button type="button" className="icon-button" aria-label="Zoom out" onClick={() => setZoomOverride(Math.max(1, zoom - 1))}><Icon name="minus" /></button>
        <button type="button" className="icon-button" aria-label="Fit" onClick={() => setZoomOverride(null)}><Icon name="fit" /></button>
        <button type="button" className="icon-button" aria-label="Zoom in" onClick={() => setZoomOverride(Math.min(32, zoom + 1))}><Icon name="plus" /></button>
      </div>
    </div>
  );
}

/** Wireframe of the tile and a column of blocks as tall as the figure — a size check against plinth blocks. */
function BlockGuide(props: { context: FigureContext; zoom: number; anchorX: number; anchorY: number; width: number; height: number }) {
  const { context, zoom, anchorX, anchorY } = props;
  const levels = Math.ceil(context.document.shape.heightLevels - 1e-6);
  const point = (x: number, y: number, z: number) => {
    const [sx, sy] = projectOffset(context.projection, [x, y, z]);
    return `${(anchorX + sx) * zoom},${(anchorY + sy) * zoom}`;
  };
  const diamond = (z: number) => [point(-0.5, -0.5, z), point(0.5, -0.5, z), point(0.5, 0.5, z), point(-0.5, 0.5, z)].join(' ');
  return (
    <svg className="block-guide" width={props.width * zoom} height={props.height * zoom} aria-hidden="true">
      {Array.from({ length: levels + 1 }, (_, level) => (
        <polygon key={level} points={diamond(level)} className={level === 0 ? 'ground' : 'level'} />
      ))}
      {[[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, y]) => (
        <polyline key={`${x},${y}`} points={`${point(x, y, 0)} ${point(x, y, levels)}`} className="level" />
      ))}
    </svg>
  );
}
