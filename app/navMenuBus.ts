const EVENT_NAME = 'technowiz:nav-menu-open';

export function broadcastMenuOpen(id: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT_NAME, { detail: id }));
}

export function subscribeMenuOpen(onOpen: (id: string) => void) {
  function handler(event: Event) {
    onOpen((event as CustomEvent<string>).detail);
  }

  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
