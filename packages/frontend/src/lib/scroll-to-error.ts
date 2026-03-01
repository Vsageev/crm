/**
 * Scrolls to the first visible form error element after React re-renders.
 * Looks for elements with the `data-form-error` attribute.
 */
export function scrollToFirstError(container?: HTMLElement | null) {
  requestAnimationFrame(() => {
    const scope = container || document;
    const errorEl = scope.querySelector<HTMLElement>('[data-form-error]');
    if (errorEl) {
      errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}
