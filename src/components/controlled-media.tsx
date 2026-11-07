'use client';

import { useEffect, useRef, useState } from 'react';
import { isSafeUrl } from '@/lib/document';
import { usePreferences } from './preferences';

export type PlaybackPreference = 'system' | 'paused' | 'playing';
const preferenceKey = 'verso-animation-playback';
const preferenceEvent = 'verso-animation-playback-change';
const words = (ru: boolean) => ru ? {
  animation: 'Анимация', play: 'Воспроизвести анимацию', pause: 'Приостановить анимацию',
  settings: 'Воспроизведение анимаций', system: 'Как в системе', paused: 'Приостановлено', playing: 'Воспроизводить',
  unavailable: 'Нажмите, чтобы загрузить анимацию',
} : {
  animation: 'Animation', play: 'Play animation', pause: 'Pause animation',
  settings: 'Animation playback', system: 'Use system setting', paused: 'Paused', playing: 'Play animations',
  unavailable: 'Press play to load the animation',
};

export function getPlaybackPreference(): PlaybackPreference {
  try { const value = localStorage.getItem(preferenceKey); if (value === 'paused' || value === 'playing') return value; } catch {}
  return 'system';
}

function shouldPlay() {
  const preference = getPlaybackPreference();
  return preference === 'playing' || (preference === 'system' && !matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function isBrowserImageSource(src: string) { return src.startsWith('blob:') || isSafeUrl(src, true); }

/** A canvas can display a cross-origin image without reading or exporting its pixels. */
export function attachMotionImage(root: HTMLElement, ru = document.documentElement.lang === 'ru', onReady?: (width: number, height: number) => void) {
  const image = root.querySelector<HTMLImageElement>('img.vm-image-source');
  const button = root.querySelector<HTMLButtonElement>('button.vm-motion-toggle');
  const source = root.dataset.vmSrc ?? '';
  const poster = root.dataset.vmPoster;
  if (!image || !button || !isBrowserImageSource(source) || (poster && !isBrowserImageSource(poster))) return () => {};
  let labels = words(ru);
  const imageReady = () => { if (image.naturalWidth > 0 && image.naturalHeight > 0) onReady?.(image.naturalWidth, image.naturalHeight); };
  image.addEventListener('load', imageReady);
  // Cached/blob images may complete before this effect attaches its listener.
  imageReady();
  const placeholder = root.querySelector<HTMLElement>('.vm-image-placeholder');
  if (placeholder) placeholder.textContent = labels.animation;
  let playing = false;
  let destroyed = false;
  let revision = 0;
  let canvas: HTMLCanvasElement | null = null;
  let pendingLoad: (() => void) | null = null;

  const update = (play: boolean) => {
    const currentRevision = ++revision;
    if (pendingLoad) { image.removeEventListener('load', pendingLoad); pendingLoad = null; }
    playing = play;
    root.dataset.vmReady = 'true';
    root.dataset.vmState = play ? 'playing' : 'paused';
    button.textContent = play ? labels.pause : labels.play;
    button.setAttribute('aria-label', play ? labels.pause : labels.play);
    button.setAttribute('aria-pressed', String(play));
    if (canvas) { canvas.remove(); canvas = null; }
    if (play) { image.setAttribute('src', source); return; }
    if (poster) { image.setAttribute('src', poster); return; }
    // Unknown remote animations are hidden before hydration and while this frame is captured.
    root.dataset.vmState = 'capturing';
    const freeze = () => {
      if (destroyed || currentRevision !== revision || !image.naturalWidth || !image.naturalHeight) return;
      const scale = Math.min(1, 1600 / image.naturalWidth, 1600 / image.naturalHeight);
      const still = document.createElement('canvas');
      still.className = 'vm-image-still';
      still.width = Math.max(1, Math.round(image.naturalWidth * scale));
      still.height = Math.max(1, Math.round(image.naturalHeight * scale));
      still.setAttribute('role', 'img');
      still.setAttribute('aria-label', image.alt || labels.animation);
      const context = still.getContext('2d');
      if (!context) { root.dataset.vmState = 'unavailable'; if (placeholder) placeholder.textContent = labels.unavailable; return; }
      try {
        context.drawImage(image, 0, 0, still.width, still.height);
        image.insertAdjacentElement('afterend', still);
        canvas = still;
        root.dataset.vmState = 'frozen';
        image.removeAttribute('src');
      } catch { root.dataset.vmState = 'unavailable'; if (placeholder) placeholder.textContent = labels.unavailable; }
    };
    if (image.complete && image.naturalWidth > 0 && image.getAttribute('src') === source) freeze();
    else { pendingLoad = freeze; image.addEventListener('load', freeze, { once: true }); image.setAttribute('src', source); }
  };
  const followPreference = () => update(shouldPlay());
  const toggle = (event: Event) => { event.preventDefault(); event.stopPropagation(); update(!playing); };
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const languageObserver = new MutationObserver(() => {
    labels = words(document.documentElement.lang === 'ru');
    button.textContent = playing ? labels.pause : labels.play;
    button.setAttribute('aria-label', playing ? labels.pause : labels.play);
    if (placeholder) placeholder.textContent = root.dataset.vmState === 'unavailable' ? labels.unavailable : labels.animation;
  });
  languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  const storage = (event: StorageEvent) => { if (event.key === preferenceKey || event.key === null) followPreference(); };
  button.addEventListener('click', toggle);
  motion.addEventListener('change', followPreference);
  window.addEventListener(preferenceEvent, followPreference);
  window.addEventListener('storage', storage);
  followPreference();
  return () => {
    destroyed = true; revision++;
    if (pendingLoad) image.removeEventListener('load', pendingLoad);
    canvas?.remove();
    languageObserver.disconnect();
    image.removeEventListener('load', imageReady);
    button.removeEventListener('click', toggle);
    motion.removeEventListener('change', followPreference);
    window.removeEventListener(preferenceEvent, followPreference);
    window.removeEventListener('storage', storage);
  };
}

/** Enhances sanitized reader HTML. It never imports editor/TipTap code. */
export function MediaPlaybackEnhancer({ scope = '.article-prose', showPreference = true }: { scope?: string; showPreference?: boolean }) {
  const { language } = usePreferences();
  const [preference, setPreference] = useState<PlaybackPreference>('system');
  const [available, setAvailable] = useState(false);
  const labels = words(language === 'ru');
  useEffect(() => {
    setPreference(getPlaybackPreference());
    const controllers = new Map<HTMLElement, () => void>();
    const scan = () => {
      for (const [element, cleanup] of controllers) if (!element.isConnected) { cleanup(); controllers.delete(element); }
      document.querySelectorAll<HTMLElement>(scope).forEach(container => container.querySelectorAll<HTMLElement>('[data-vm-motion="image"]').forEach(element => {
        if (!controllers.has(element)) controllers.set(element, attachMotionImage(element, language === 'ru'));
      }));
      setAvailable(controllers.size > 0);
    };
    scan();
    const observer = new MutationObserver(scan);
    document.querySelectorAll(scope).forEach(container => observer.observe(container, { childList: true, subtree: true }));
    const syncPreference = () => setPreference(getPlaybackPreference());
    const storage = (event: StorageEvent) => { if (event.key === preferenceKey || event.key === null) syncPreference(); };
    window.addEventListener(preferenceEvent, syncPreference);
    window.addEventListener('storage', storage);
    return () => { observer.disconnect(); controllers.forEach(cleanup => cleanup()); window.removeEventListener(preferenceEvent, syncPreference); window.removeEventListener('storage', storage); };
  }, [scope, language]);
  if (!showPreference || !available) return null;
  return <label className="vm-playback-preference">{labels.settings}<select aria-label={labels.settings} value={preference} onChange={event => {
    const next = event.target.value as PlaybackPreference;
    setPreference(next);
    try { localStorage.setItem(preferenceKey, next); } catch {}
    window.dispatchEvent(new Event(preferenceEvent));
  }}><option value="system">{labels.system}</option><option value="paused">{labels.paused}</option><option value="playing">{labels.playing}</option></select></label>;
}

export function ControlledImagePreview({ src, alt, motion = true, onLoad, onError }: { src: string; alt: string; motion?: boolean; onLoad: (width: number, height: number) => void; onError: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { language } = usePreferences();
  const onReadyRef = useRef(onLoad);
  onReadyRef.current = onLoad;
  useEffect(() => motion && ref.current ? attachMotionImage(ref.current, language === 'ru', (width, height) => onReadyRef.current(width, height)) : undefined, [src, language, motion]);
  const labels = words(language === 'ru');
  if (!motion) return <img src={src} alt={alt} referrerPolicy="no-referrer" onLoad={event => { if (event.currentTarget.naturalWidth > 0) onLoad(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight); }} onError={onError} />;
  return <div ref={ref} className="vm-image vm-preview" data-vm-motion="image" data-vm-src={src}>
    <img className="vm-image-source" src={src} alt={alt} referrerPolicy="no-referrer" onLoad={event => { if (event.currentTarget.naturalWidth > 0) onLoad(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight); }} onError={event => { if (event.currentTarget.hasAttribute('src')) onError(); }} />
    <span className="vm-image-placeholder" aria-hidden="true">{labels.animation}</span>
    <button type="button" className="vm-motion-toggle" aria-pressed="false" aria-label={labels.play}>{labels.play}</button>
  </div>;
}
