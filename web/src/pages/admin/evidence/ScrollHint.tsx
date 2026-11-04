export const SCROLL_HINT = 'Scroll sideways to see all columns';

/**
 * Below md a wide table or chart scrolls sideways inside its card, which nothing on screen says. This line says it.
 * One component, used under every wide table and chart container in the Evidence Center.
 */
export function ScrollHint() {
  return (
    <p data-testid="scroll-hint" className="mt-1 text-xs text-secondary md:hidden">
      {SCROLL_HINT}
    </p>
  );
}
