import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DocumentValidationError, validateDocument } from '../../src/lib/document';
import { isCanonicalVideo, isUploadedPoster, mayAnimateImage, normaliseVideoUrl } from '../../src/lib/media-url';
import { renderDocument } from '../../src/lib/server/render';

const src = '/api/v1/media/abcdefghijklmnopqrstuvwxyzABCDEF.webp';
const poster = '/api/v1/media/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef.webp';
const video = '/api/v1/media/abcdefghijklmnopqrstuvwxyzABCDEF.mp4';
const doc = (type: string, attrs: object) => ({ type: 'doc', content: [{ type, attrs }] });

test('uploaded animation retains metadata and SSR starts with its still poster', () => {
  const content = validateDocument(doc('image', { src, animated: true, posterSrc: poster, width: 640, height: 360, alt: 'Application demo' }));
  assert.equal(content.content[0].attrs?.animated, true);
  assert.equal(content.content[0].attrs?.posterSrc, poster);
  const html = renderDocument(content);
  assert.match(html, new RegExp(`data-vm-src="${src}"`));
  assert.match(html, new RegExp(`<img src="${poster}"`));
  assert.match(html, /class="vm-motion-toggle" aria-pressed="false" aria-label="Play animation"/u);
  assert.match(html, /alt="Application demo"/u);
  assert.doesNotMatch(html, /<img src="\/api\/v1\/media\/abcdefghijklmnopqrstuvwxyzABCDEF\.webp"/u);
});

test('old uploaded still images keep the existing image markup without motion controls', () => {
  const html = renderDocument(validateDocument(doc('image', { src, alt: 'Static diagram' })));
  assert.match(html, new RegExp(`<img src="${src}"`));
  assert.doesNotMatch(html, /vm-motion|vm-image-source/u);
  assert.equal(mayAnimateImage(src), false);
});

test('legacy remote GIF, WebP and APNG are recognized without a server network request', context => {
  const fetch = context.mock.method(globalThis, 'fetch', () => { throw new Error('Reader rendering must not fetch remote media.'); });
  for (const ext of ['gif', 'webp', 'png', 'apng']) {
    const url = `https://example.test/demo.${ext}?version=2`;
    const html = renderDocument(validateDocument(doc('image', { src: url, alt: 'Legacy animation' })));
    assert.equal(mayAnimateImage(url), true);
    assert.match(html, /data-vm-motion="image"/u);
    assert.match(html, /vm-motion-toggle/u);
  }
  assert.equal(mayAnimateImage('https://example.test/photo.jpg'), false);
  assert.equal(fetch.mock.callCount(), 0);
});

test('animation metadata refuses remote, executable and malformed poster URLs', () => {
  for (const posterSrc of ['https://example.test/poster.webp', 'javascript:alert(1)', '/api/v1/media/short.webp', `${poster}?x=1`, '/api/v1/media/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef.mp4']) {
    assert.equal(isUploadedPoster(posterSrc), false);
    assert.throws(() => validateDocument(doc('image', { src, animated: true, posterSrc })), DocumentValidationError);
  }
  assert.throws(() => validateDocument(doc('image', { src, animated: false, posterSrc: poster })), DocumentValidationError);
  assert.throws(() => validateDocument(doc('image', { src, animated: 'true' })), DocumentValidationError);
});

test('local video and poster survive publication with controls, seeking preload and no autoplay', () => {
  assert.deepEqual(normaliseVideoUrl(video), { provider: 'file', src: video });
  const content = validateDocument(doc('video', { provider: 'file', src: video, posterSrc: poster }));
  const html = renderDocument(content);
  assert.match(html, new RegExp(`<video src="${video}" controls playsinline preload="metadata" poster="${poster}"`));
  assert.doesNotMatch(html, /autoplay|loop|muted/u);
  assert.equal(isCanonicalVideo({ provider: 'file', src: video, posterSrc: poster }), true);
  assert.equal(isCanonicalVideo({ provider: 'file', src: video, posterSrc: 'https://example.test/poster.webp' }), false);
  assert.equal(isCanonicalVideo({ provider: 'youtube', src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', posterSrc: poster }), false);
  for (const suffix of ['?x=1', '/other', '.exe', '#hash']) assert.equal(normaliseVideoUrl(`${video}${suffix}`), null);
});
