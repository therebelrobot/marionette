import { defaultAnimationSettings } from './animations';
import { defaultShape } from './proportions';
import { DEFAULT_FRAME, DEFAULT_LOOK, DEFAULT_PROJECTION, type Build, type FigureDocument, type HeightClass } from './types';

export function newFigure(name = 'Adult · regular', heightClass: HeightClass = 'adult', build: Build = 'regular'): FigureDocument {
  return {
    version: 1,
    name,
    shape: defaultShape(heightClass, build),
    projection: { ...DEFAULT_PROJECTION },
    look: { ...DEFAULT_LOOK },
    frame: { ...DEFAULT_FRAME },
    animations: defaultAnimationSettings(),
  };
}

/** Fill in anything an older or hand-edited document is missing. */
export function normaliseFigure(document: FigureDocument): FigureDocument {
  const fresh = newFigure(document.name);
  return {
    ...fresh,
    ...document,
    shape: { ...fresh.shape, ...document.shape },
    projection: { ...fresh.projection, ...document.projection },
    look: { ...fresh.look, ...document.look },
    frame: { ...fresh.frame, ...document.frame },
    animations: { ...fresh.animations, ...document.animations },
  };
}
