'use client';

import { useEffect, useRef, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { X } from 'lucide-react';
import { usePreferences } from './preferences';

export function IconButton({ label, children, active, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return <button type="button" {...props} className={`icon-button ${active ? 'active' : ''} ${props.className ?? ''}`} aria-label={label} title={label} aria-pressed={active === undefined ? undefined : active}>{children}</button>;
}

export function Dialog({ title, children, onClose, dismissible = true }: { title: string; children: ReactNode; onClose: () => void; dismissible?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = usePreferences();
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      queueMicrotask(() => { if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus({ preventScroll: true }); });
    };
  }, []);
  return <dialog className="dialog" ref={ref} aria-label={title} onCancel={event => { event.preventDefault(); if (dismissible) onClose(); }} onClick={event => { if (dismissible && event.target === event.currentTarget) onClose(); }}><div className="dialog-content"><div className="dialog-header"><h2>{title}</h2>{dismissible && <IconButton label={t('Close')} onClick={onClose}><X size={19} /></IconButton>}</div>{children}</div></dialog>;
}

export function ErrorMessage({ children }: { children: ReactNode }) { return <p className="error-message" role="alert">{children}</p>; }
