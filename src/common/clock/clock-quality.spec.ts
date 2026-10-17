import {
  parseChronycTracking,
  qualityFromOffset,
} from './clock-quality.js';

describe('parseChronycTracking', () => {
  it('parses a fast system clock', () => {
    const stdout = `
Reference ID    : B97DBE7A
Stratum         : 3
System time     : 11.341898918 seconds fast of NTP time
Last offset     : -0.001488480 seconds
Leap status     : Normal
`;
    expect(parseChronycTracking(stdout)).toEqual({
      offsetSeconds: 11.341898918,
    });
  });

  it('parses a slow system clock', () => {
    const stdout =
      'System time     : 0.000123456 seconds slow of NTP time\n';
    expect(parseChronycTracking(stdout)).toEqual({
      offsetSeconds: -0.000123456,
    });
  });

  it('rejects missing System time', () => {
    expect(() => parseChronycTracking('Leap status : Normal\n')).toThrow(
      /missing System time/,
    );
  });
});

describe('qualityFromOffset', () => {
  it('marks ok inside tolerance', () => {
    expect(qualityFromOffset(0.05, 0.1)).toEqual({
      outOfTolerance: false,
      quality: 'ok',
    });
  });

  it('marks degraded above tolerance', () => {
    expect(qualityFromOffset(-0.2, 0.1)).toEqual({
      outOfTolerance: true,
      quality: 'degraded',
    });
  });
});
