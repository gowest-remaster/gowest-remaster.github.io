// Silence the game when a test harness drives it (Playwright and friends set navigator.webdriver):
// the headless QA browsers run on the machine the user plays on, and their music came out of its speakers.
// Everything keeps running exactly as before (media plays, audio graphs tick); only the output is muted.
export function muteUnderAutomation() {
  if (!navigator.webdriver) return;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    this.muted = true;
    return play.call(this);
  };
  const Base = (window as unknown as { BaseAudioContext?: typeof BaseAudioContext }).BaseAudioContext;
  const desc = Base && Object.getOwnPropertyDescriptor(Base.prototype, 'destination');
  if (!Base || !desc?.get) return;
  const realDestination = desc.get;
  const sinks = new WeakMap<BaseAudioContext, GainNode>();
  Object.defineProperty(Base.prototype, 'destination', {
    configurable: true,
    get(this: BaseAudioContext) {
      let g = sinks.get(this);
      if (!g) {
        g = this.createGain();
        g.gain.value = 0;
        g.connect(realDestination.call(this) as AudioDestinationNode);
        sinks.set(this, g);
      }
      return g;
    },
  });
}
