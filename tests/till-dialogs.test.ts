import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createDialogQueue, splitMessage } from '@/lib/dialog-queue';

describe('till dialogs', () => {
  it('confirm answers yes or no', async () => {
    const q = createDialogQueue();
    const yes = q.confirm('Çıxılsın?');
    q.answer(q.current()!.id, true);
    expect(await yes).toBe(true);

    const no = q.confirm('Çıxılsın?');
    q.answer(q.current()!.id, false);
    expect(await no).toBe(false);
    expect(q.current()).toBeNull();
  });

  it('a second popup waits for the first instead of replacing it', async () => {
    const q = createDialogQueue();
    const first = q.confirm('Birinci');
    void q.alert('İkinci');
    expect(q.current()!.title).toBe('Birinci');
    q.answer(q.current()!.id, true);
    expect(await first).toBe(true);
    expect(q.current()!.title).toBe('İkinci');
  });

  it('a late answer for a closed popup does not answer the next one', async () => {
    const q = createDialogQueue();
    const first = q.confirm('Birinci');
    const id = q.current()!.id;
    const second = q.confirm('İkinci');
    q.answer(id, false);
    q.answer(id, true);                    // stale: must not reach "İkinci"
    expect(await first).toBe(false);
    expect(q.current()!.title).toBe('İkinci');
    q.answer(q.current()!.id, true);
    expect(await second).toBe(true);
  });

  it('choose answers which button, or null for Ləğv et', async () => {
    const q = createDialogQueue();
    const picked = q.choose('Çek printeri necə qoşulub?', ['USB', 'IP (şəbəkə)']);
    expect(q.current()!.choices).toEqual(['USB', 'IP (şəbəkə)']);
    q.answer(q.current()!.id, 1);
    expect(await picked).toBe(1);

    const closed = q.choose('Çek printeri necə qoşulub?', ['USB', 'IP (şəbəkə)']);
    q.answer(q.current()!.id, null);
    expect(await closed).toBeNull();
  });

  it('ask starts from the current value and answers what was typed', async () => {
    const q = createDialogQueue();
    const typed = q.ask('Çek printerinin IP ünvanı', { value: '192.168.1.50' });
    expect(q.current()!.value).toBe('192.168.1.50');
    q.answer(q.current()!.id, '192.168.1.60');
    expect(await typed).toBe('192.168.1.60');
  });

  it('the exe has no window.prompt, so the printer code never calls it', () => {
    const src = readFileSync('lib/printer.ts', 'utf8');
    expect(src.match(/(?<![\w.])(window\.)?(alert|confirm|prompt)\(/g)).toBeNull();
  });

  it('the first paragraph is the title', () => {
    expect(splitMessage('1 ədəd silinmə hələ təsdiqlənməyib.\n\nÇıxsanız ləğv olunacaq. Davam edilsin?')).toEqual({
      title: '1 ədəd silinmə hələ təsdiqlənməyib.',
      message: 'Çıxsanız ləğv olunacaq. Davam edilsin?',
    });
    expect(splitMessage('İcazəniz yoxdur: Endirim')).toEqual({ title: 'İcazəniz yoxdur: Endirim', message: '' });
  });

  it('the till page uses its own popups, not the browser\'s', () => {
    const src = readFileSync('app/seller/page.tsx', 'utf8');
    expect(src.match(/(?<![\w.])(window\.)?(alert|confirm)\(/g)).toBeNull();
    expect(src).toContain('<DialogHost />');
  });
});
