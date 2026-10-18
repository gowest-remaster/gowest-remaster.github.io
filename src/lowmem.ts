// Low-memory profile (phones, small tablets, low deviceMemory; ?mobile=1 / ?mobile=0 to force), shared by the 3D
// world and the audio. iOS Safari kills a tab that goes over its budget (it looked like an endless loading screen,
// then like the game restarting between places), so these devices keep far less loaded at once.
export const LOW_MEMORY = (() => {
  if (typeof location === 'undefined') return false;
  const q = new URLSearchParams(location.search).get('mobile');
  if (q === '1') return true;
  if (q === '0') return false;
  try {
    // set by the boot splash after a start that ran out of memory, or by a lost GPU device (world fatal())
    if (localStorage.getItem('gw-lowmem') === '1') return true;
  } catch {
    /* storage blocked */
  }
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) <= 820;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return (coarse && small) || ios || (mem !== undefined && mem <= 4);
})();

/** decoded-audio bytes currently held (music / ambience / voice / sfx caches): for ?memdebug=1 */
export const memStats = { audioBytes: 0 };
