/**
 * Small Bootstrap overlay API fallback for offline/CDN blocked sessions.
 * The app keeps using Bootstrap's public Modal and Offcanvas entry points.
 */
export function installOverlayFallback() {
  if (window.bootstrap) return;

  const modalInstances = new WeakMap();
  let activeModal = null;

  const dispatch = (element, name) => {
    const event = new Event(`${name}.bs.modal`, { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event;
  };

  class Modal {
    constructor(element) {
      this.element = element;
      this.backdrop = null;
      this.returnFocus = null;
      modalInstances.set(element, this);
      this.element.addEventListener('click', (event) => {
        if (event.target === this.element && this.element.getAttribute('data-bs-backdrop') !== 'static') this.hide();
      });
      this.handleBackdropClick = () => {
        if (this.element.getAttribute('data-bs-backdrop') !== 'static') this.hide();
      };
    }

    static getInstance(element) {
      return element ? modalInstances.get(element) ?? null : null;
    }

    static getOrCreateInstance(element) {
      if (!element) return null;
      return this.getInstance(element) ?? new Modal(element);
    }

    show() {
      if (!this.element || this.element.classList.contains('show')) return;
      if (!dispatch(this.element, 'show').defaultPrevented) {
        if (activeModal && activeModal !== this) activeModal.hide();
        activeModal = this;
        this.returnFocus = document.activeElement;
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'modal-backdrop show';
        this.backdrop.addEventListener('click', this.handleBackdropClick);
        document.body.append(this.backdrop);
        this.element.classList.add('show');
        this.element.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        requestAnimationFrame(() => {
          const focusTarget = this.element.querySelector('[autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])')
            || this.element;
          focusTarget.focus?.({ preventScroll: true });
          dispatch(this.element, 'shown');
        });
      }
    }

    hide() {
      if (!this.element?.classList.contains('show') || dispatch(this.element, 'hide').defaultPrevented) return;
      this.element.classList.remove('show');
      this.element.setAttribute('aria-hidden', 'true');
      this.backdrop?.remove();
      this.backdrop = null;
      if (activeModal === this) activeModal = null;
      if (!activeModal) document.body.classList.remove('modal-open');
      dispatch(this.element, 'hidden');
      if (this.returnFocus instanceof HTMLElement && this.returnFocus.isConnected) {
        this.returnFocus.focus({ preventScroll: true });
      }
    }
  }

  const offcanvasInstances = new WeakMap();
  class Offcanvas {
    constructor(element) { this.element = element; }
    static getInstance(element) { return element ? offcanvasInstances.get(element) ?? null : null; }
    static getOrCreateInstance(element) {
      if (!element) return null;
      const current = this.getInstance(element);
      if (current) return current;
      const instance = new Offcanvas(element);
      offcanvasInstances.set(element, instance);
      return instance;
    }
    show() { this.element?.classList.add('show'); }
    hide() { this.element?.classList.remove('show'); }
  }

  window.bootstrap = { Modal, Offcanvas };
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const dismiss = event.target.closest('[data-bs-dismiss="modal"]');
    if (dismiss) {
      event.preventDefault();
      Modal.getOrCreateInstance(dismiss.closest('.modal'))?.hide();
      return;
    }
    const trigger = event.target.closest('[data-bs-toggle="modal"][data-bs-target]');
    if (!trigger) return;
    const target = document.querySelector(trigger.getAttribute('data-bs-target'));
    if (target) Modal.getOrCreateInstance(target)?.show();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && activeModal) activeModal.hide();
  });
}
