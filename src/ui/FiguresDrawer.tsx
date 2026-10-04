import { useEffect, useState } from 'react';
import type { Build, HeightClass } from '../core/types';
import { figureApi, type FigureSummary } from '../lib/api';
import { Icon } from './Icon';

export function FiguresDrawer(props: {
  currentId: string | null;
  onOpen: (id: string) => void;
  onNew: (heightClass: HeightClass, build: Build) => void;
  onDuplicate: () => void;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const [figures, setFigures] = useState<FigureSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [heightClass, setHeightClass] = useState<HeightClass>('adult');
  const [build, setBuild] = useState<Build>('regular');

  const refresh = () => {
    figureApi.list().then(setFigures).catch(() => setError('The server is unreachable — figures are kept on this device until it is back.'));
  };
  useEffect(refresh, []);

  const remove = async (figure: FigureSummary) => {
    if (!window.confirm(`Delete “${figure.name}”? This can't be undone.`)) return;
    try {
      await figureApi.remove(figure.id);
      props.notify(`Deleted ${figure.name}`);
      if (figure.id === props.currentId) props.onNew('adult', 'regular');
      refresh();
    } catch {
      props.notify('Delete failed');
    }
  };

  return (
    <div className="sheet-backdrop" onClick={props.onClose}>
      <div className="sheet" role="dialog" aria-label="Figures" onClick={(event) => event.stopPropagation()}>
        <header className="sheet-header">
          <h2>Figures</h2>
          <button type="button" className="icon-button" onClick={props.onClose} aria-label="Close"><Icon name="close" /></button>
        </header>
        <div className="new-figure">
          <div className="segmented">
            {(['child', 'adult', 'tall'] as HeightClass[]).map((value) => (
              <button key={value} type="button" className={heightClass === value ? 'is-active' : ''} onClick={() => setHeightClass(value)}>{value[0].toUpperCase() + value.slice(1)}</button>
            ))}
          </div>
          <div className="segmented">
            {(['thin', 'regular', 'wide'] as Build[]).map((value) => (
              <button key={value} type="button" className={build === value ? 'is-active' : ''} onClick={() => setBuild(value)}>{value[0].toUpperCase() + value.slice(1)}</button>
            ))}
          </div>
          <div className="button-row">
            <button type="button" className="button primary" onClick={() => props.onNew(heightClass, build)}><Icon name="plus" size={16} /> New figure</button>
            <button type="button" className="button" onClick={props.onDuplicate}><Icon name="copy" size={16} /> Duplicate current</button>
          </div>
        </div>
        {error && <p className="muted">{error}</p>}
        {!figures && !error && <p className="muted">Loading…</p>}
        <ul className="scene-list">
          {figures?.map((figure) => (
            <li key={figure.id} className={figure.id === props.currentId ? 'is-current' : ''}>
              <button type="button" className="scene-open" onClick={() => props.onOpen(figure.id)}>
                <strong>{figure.name}</strong>
                <small>{new Date(figure.updatedAt).toLocaleString()}</small>
              </button>
              <button type="button" className="icon-button" aria-label={`Delete ${figure.name}`} onClick={() => remove(figure)}><Icon name="trash" size={18} /></button>
            </li>
          ))}
          {figures?.length === 0 && <li className="muted">No saved figures yet.</li>}
        </ul>
      </div>
    </div>
  );
}
