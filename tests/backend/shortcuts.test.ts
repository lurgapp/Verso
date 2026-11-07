import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHORTCUTS, matchesShortcut, shortcutKeys, type ShortcutEvent } from '../../src/lib/shortcuts';
const event = (key:string, modifiers:Partial<ShortcutEvent> = {}):ShortcutEvent => ({key,ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,...modifiers});
test('registry has unique IDs and matching Ctrl/Command modifier forms',()=>{
  assert.equal(new Set(SHORTCUTS.map(value=>value.id)).size,SHORTCUTS.length);
  for(const shortcut of SHORTCUTS){
    for(const mod of ['ctrlKey','metaKey'] as const){
      assert.ok(matchesShortcut(event(shortcut.key,{[mod]:shortcut.mod,shiftKey:shortcut.shift}),shortcut.id));
    }
  }
});
test('app shortcuts require the documented modifiers and never match unrelated browser keys',()=>{
  assert.ok(matchesShortcut(event('F',{ctrlKey:true}),'find'));
  assert.ok(matchesShortcut(event('H',{metaKey:true}),'replace'));
  assert.ok(!matchesShortcut(event('f'),'find'));
  assert.ok(!matchesShortcut(event('f',{ctrlKey:true,shiftKey:true}),'find'));
  assert.ok(!matchesShortcut(event('f',{ctrlKey:true,altKey:true}),'find'));
  assert.ok(!matchesShortcut(event('a',{ctrlKey:true}),'find'));
  assert.ok(!SHORTCUTS.some(shortcut=>matchesShortcut(event('a',{ctrlKey:true}),shortcut.id)));
  assert.ok(matchesShortcut(event('Escape'),'escape'));
  assert.ok(!matchesShortcut(event('Escape',{ctrlKey:true}),'escape'));
});
test('help shows Command on Apple platforms and the same shift/key order as handlers',()=>{
  assert.deepEqual(shortcutKeys('publish','mac'),['⌘','Enter']);
  assert.deepEqual(shortcutKeys('redo','other'),['Ctrl','Shift','Z']);
  assert.deepEqual(shortcutKeys('pastePlain','mac'),['⌘','Shift','V']);
  assert.deepEqual(shortcutKeys('escape','mac'),['Esc']);
});
