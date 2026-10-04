import { useEffect, useRef } from 'react';
import { ANIMATION_BY_KEY, frameLabel } from '../core/animations';
import { settingsFor, type FigureContext } from '../core/pipeline';
import type { DirectionIndex } from '../core/types';
import { Icon } from './Icon';
import { PixelImage, type RenderedImage } from './Stage';

export function Timeline(props: {
  context: FigureContext;
  getFrame: (key: string, frame: number, direction: DirectionIndex) => RenderedImage;
  animationKey: string;
  direction: DirectionIndex;
  frame: number;
  playing: boolean;
  onFrame: (frame: number) => void;
  onPlaying: (playing: boolean) => void;
}) {
  const { context, animationKey, frame } = props;
  const settings = settingsFor(context.document, animationKey);
  const definition = ANIMATION_BY_KEY.get(animationKey)!;
  const stripRef = useRef<HTMLDivElement>(null);

  // Keep the current frame chip in view while playing.
  useEffect(() => {
    const chip = stripRef.current?.querySelector<HTMLElement>('.frame-chip.is-current');
    chip?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [frame]);

  const step = (delta: number) => {
    props.onPlaying(false);
    props.onFrame((frame + delta + settings.frames) % settings.frames);
  };

  return (
    <div className="timeline">
      <div className="transport">
        <button type="button" className="icon-button" onClick={() => step(-1)} aria-label="Previous frame" title="Previous frame (←)"><Icon name="stepBack" /></button>
        <button type="button" className="icon-button play" onClick={() => props.onPlaying(!props.playing)} aria-label={props.playing ? 'Pause' : 'Play'} title="Play / pause (Space)">
          <Icon name={props.playing ? 'pause' : 'play'} />
        </button>
        <button type="button" className="icon-button" onClick={() => step(1)} aria-label="Next frame" title="Next frame (→)"><Icon name="stepForward" /></button>
        <div className="transport-readout">
          <strong>{definition.label}</strong>
          <small>{frame + 1}/{settings.frames} · {settings.fps} fps · {Math.round(1000 / settings.fps)} ms</small>
        </div>
      </div>
      <div className="frame-strip" ref={stripRef}>
        {Array.from({ length: settings.frames }, (_, index) => {
          const label = frameLabel(definition, index, settings.frames, settings.loop);
          return (
            <button
              key={index}
              type="button"
              className={`frame-chip ${index === frame ? 'is-current' : ''}`}
              onClick={() => { props.onPlaying(false); props.onFrame(index); }}
              aria-label={`Frame ${index + 1}${label ? ` (${label})` : ''}`}
            >
              <PixelImage image={props.getFrame(animationKey, index, props.direction)} scale={1} />
              <span>{index + 1}{label ? ` ${label}` : ''}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
