import { durationToSeconds } from './duration.js';

describe('durationToSeconds', () => {
  it.each([
    ['3600s', 3_600],
    ['15m', 900],
    ['2h', 7_200],
    ['7d', 604_800],
  ])('%s -> %i', (value, seconds) => {
    expect(durationToSeconds(value)).toBe(seconds);
  });

  it.each(['', '15', 'm', '1.5h', '-1d', '7w'])('rejects %j', (value) => {
    expect(() => durationToSeconds(value)).toThrow(/Invalid duration/);
  });

  it('rejects zero', () => {
    expect(() => durationToSeconds('0s')).toThrow(/positive/);
  });
});
