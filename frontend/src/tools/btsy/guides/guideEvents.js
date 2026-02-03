export const BTSY_GUIDE_EVENT = 'btsy-guide-event';

export function emitGuideEvent(name, payload) {
  window.dispatchEvent(new CustomEvent(BTSY_GUIDE_EVENT, { detail: { name, payload } }));
}

