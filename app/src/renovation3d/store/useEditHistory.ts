import { useCallback, useRef, useState, type SetStateAction } from 'react';
import { EditHistory } from '../utils/edit-history';
import type { RenovationState } from '../types';

export function useEditHistory(initial: RenovationState) {
  const journal = useRef<EditHistory | null>(null); journal.current ??= new EditHistory(initial);
  const [state, render] = useState(initial), history = journal.current;
  const setState = useCallback((action: SetStateAction<RenovationState>) => { render(history.update(typeof action === 'function' ? action(history.current) : action)); }, [history]);
  const replace = useCallback((next: RenovationState) => { history.replace(next); render(next); }, [history]);
  const travel = useCallback((redo = false) => render(history.travel(redo)), [history]);
  return { state, setState, replace, travel, begin: () => history.begin(), end: () => history.end(), canUndo: !!history.past.length, canRedo: !!history.future.length };
}
