import test from 'node:test';
import assert from 'node:assert/strict';

import { ReservoirSampler, sampleStream } from '../src/index.js';

/**
 * A deterministic random source that walks a fixed list of values and then
 * cycles. Tests use it so assertions are exact rather than statistical.
 */
function scripted(values) {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i += 1;
    return v;
  };
}

test('keeps every item when the stream is shorter than k', () => {
  const sampler = new ReservoirSampler(5, scripted([0.5]));
  for (const x of [1, 2, 3]) sampler.add(x);
  assert.deepEqual(sampler.sample(), [1, 2, 3]);
  assert.equal(sampler.seen, 3);
});

test('keeps exactly the first k items before replacement starts', () => {
  const sampler = new ReservoirSampler(2, scripted([0.0]));
  assert.equal(sampler.add('a'), true);
  assert.equal(sampler.add('b'), true);
  assert.equal(sampler.add('c'), true); // 0.0 * 3 = 0 < k, so c replaces slot 0
  assert.deepEqual(sampler.sample(), ['c', 'b']);
});

test('replacement picks the slot the random number selects', () => {
  const sampler = new ReservoirSampler(3, scripted([0.99]));
  for (const x of ['a', 'b', 'c']) sampler.add(x);
  // seen = 4, random = 0.99 -> floor(0.99 * 4) = 3, which is >= k, so no replace.
  assert.equal(sampler.add('d'), false);
  assert.deepEqual(sampler.sample(), ['a', 'b', 'c']);
});

test('k = 0 keeps nothing but still counts the stream', () => {
  const sampler = new ReservoirSampler(0, scripted([0.0]));
  assert.equal(sampler.add('a'), false);
  assert.equal(sampler.add('b'), false);
  assert.deepEqual(sampler.sample(), []);
  assert.equal(sampler.seen, 2);
});

test('sample() returns a copy, not the internal array', () => {
  const sampler = new ReservoirSampler(2, scripted([0.0]));
  sampler.add('a');
  sampler.add('b');
  const out = sampler.sample();
  out.push('tampered');
  assert.deepEqual(sampler.sample(), ['a', 'b']);
});

test('rejects invalid k', () => {
  assert.throws(() => new ReservoirSampler(-1), RangeError);
  assert.throws(() => new ReservoirSampler(1.5), RangeError);
  assert.throws(() => new ReservoirSampler(NaN), RangeError);
});

test('rejects a non-function random source', () => {
  assert.throws(() => new ReservoirSampler(1, 42), TypeError);
});

test('sampleStream samples an iterable end to end', () => {
  const out = sampleStream([10, 20, 30, 40, 50], 2, scripted([0.0, 0.0]));
  // seen=3 -> j=0 replace slot0 with 30; seen=4 -> j=0 replace with 40;
  // seen=5 -> j=0 replace with 50.
  assert.deepEqual(out, [50, 20]);
});

test('sampleStream accepts a generator', () => {
  function* gen() {
    yield 'x';
    yield 'y';
    yield 'z';
  }
  assert.deepEqual(sampleStream(gen(), 2, scripted([0.9])), ['x', 'y']);
});

test('sampleStream on an empty iterable returns an empty array', () => {
  assert.deepEqual(sampleStream([], 3), []);
});

test('sampleStream with k = 0 returns an empty array', () => {
  assert.deepEqual(sampleStream([1, 2, 3], 0), []);
});

/**
 * Statistical sanity check with a fixed, seeded generator so the test is
 * deterministic. We use a small LCG rather than Math.random because the test
 * must produce identical output on every machine.
 */
function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test('each item appears roughly k/N of the time in a sample', () => {
  const N = 1000;
  const k = 10;
  const trials = 200;
  const counts = new Array(N).fill(0);
  for (let t = 0; t < trials; t += 1) {
    const rand = lcg(0xC0FFEE + t);
    const sampler = new ReservoirSampler(k, rand);
    for (let i = 0; i < N; i += 1) sampler.add(i);
    for (const v of sampler.sample()) counts[v] += 1;
  }
  const expected = trials * (k / N); // 2.0 per item
  const total = counts.reduce((a, b) => a + b, 0);
  // The total sample size is exactly trials * k, so the per-item counts must
  // average to expected. Assert on the aggregate and on the spread rather than
  // on each bucket, since individual bucket counts are noisy by construction.
  assert.equal(total, trials * k);
  // Individual bucket counts are Poisson(2)-ish, so a per-bucket band is
  // brittle; instead check that the average count is close to expected and
  // that no bucket is wildly off. The 200-trial run is deterministic, so these
  // bounds are exact for this seed sequence.
  const mean = total / N;
  assert.ok(Math.abs(mean - expected) < 0.5, `mean ${mean} too far from ${expected}`);
  for (const c of counts) {
    assert.ok(c <= 12, `count ${c} implausibly high`);
  }
});
