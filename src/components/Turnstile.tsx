import { useEffect, useRef } from 'react';

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<TurnstileApi> | null = null;

/** Load Cloudflare's script once per page and resolve with its API. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not initialise')));
    s.onerror = () => {
      scriptPromise = null; // allow a retry on the next mount
      reject(new Error('Could not load the security check'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

interface Props {
  siteKey: string;
  /** Called with a fresh single-use token once solved, and with null when it expires, errors, or is reset. */
  onToken: (token: string | null) => void;
  /** Change this value to get a new challenge (tokens can only be used once). */
  resetKey?: number;
}

export default function Turnstile({ siteKey, onToken, resetKey = 0 }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const cb = useRef(onToken);
  cb.current = onToken;

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !box.current) return;
        widget.current = api.render(box.current, {
          sitekey: siteKey,
          callback: (t: string) => cb.current(t),
          'expired-callback': () => cb.current(null),
          'error-callback': () => cb.current(null),
        });
      })
      .catch(() => cb.current(null));
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey]);

  // A token is spent by one request; ask for a new challenge whenever the parent bumps resetKey.
  useEffect(() => {
    if (resetKey === 0) return;
    cb.current(null);
    if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
  }, [resetKey]);

  return <div ref={box} aria-label="Security check" />;
}
