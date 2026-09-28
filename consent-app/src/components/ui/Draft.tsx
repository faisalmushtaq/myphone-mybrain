import { useStore } from '../../state/context';

/**
 * Marks wording that must be replaced with ethics-approved text. The marker
 * can be hidden from the prototype controls; it is never part of the
 * production interface.
 */
export function Draft({ label = 'Draft wording' }: { label?: string }) {
  const { state } = useStore();
  if (!state.prototype.showDraftMarkers) return null;
  return (
    <span className="mpmb-draft" title="Prototype text — to be replaced with the ethics-approved wording">
      {label}
    </span>
  );
}
