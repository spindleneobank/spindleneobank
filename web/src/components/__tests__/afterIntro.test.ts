import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterIntro } from '../Preloader';

afterEach(() => {
  document.documentElement.classList.remove('sp-intro');
  document.getElementById('sp-preloader')?.remove();
});

describe('afterIntro', () => {
  it('runs right away when no intro is playing', () => {
    const run = vi.fn();
    afterIntro(run);
    expect(run).toHaveBeenCalledOnce();
  });

  it('waits for the preloader to finish while the intro locks the page', () => {
    document.documentElement.classList.add('sp-intro');
    const el = document.createElement('div');
    el.id = 'sp-preloader';
    document.body.append(el);
    const run = vi.fn();
    afterIntro(run);
    expect(run).not.toHaveBeenCalled();
    dispatchEvent(new Event('spindle:intro-done'));
    dispatchEvent(new Event('spindle:intro-done'));
    expect(run).toHaveBeenCalledOnce();
  });

  it('can be cancelled before the intro ends', () => {
    document.documentElement.classList.add('sp-intro');
    const el = document.createElement('div');
    el.id = 'sp-preloader';
    document.body.append(el);
    const run = vi.fn();
    afterIntro(run)();
    dispatchEvent(new Event('spindle:intro-done'));
    expect(run).not.toHaveBeenCalled();
  });
});
