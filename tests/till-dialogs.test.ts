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
