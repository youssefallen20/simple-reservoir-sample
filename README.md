# simple-reservoir-sample

One-pass uniform picks from streams of any size: keep a sample of `k` items while reading a stream once, without knowing its length in advance.

```js
import { ReservoirSampler, sampleStream } from './src/index.js';

// Short form: the whole stream is already iterable.
const picked = sampleStream([1, 2, 3, 4, 5], 2);
// picked is an array of 2 items, uniformly chosen from the 5.

// Long form: pull items one at a time (socket, generator, file reader, ...).
const sampler = new ReservoirSampler(2);
sampler.add('a');
sampler.add('b');
sampler.add('c');
// At any point sampler.sample() is a valid uniform sample of everything seen.
const current = sampler.sample();
```

## Why this exists

The problem is picking a uniform random sample from a stream you cannot store. If you know the length `n` up front, you can pick `k` distinct indices and go back for them; with a stream you cannot go back, and `n` may be unbounded. Reservoir sampling solves this in one pass with O(k) memory. This library implements Algorithm R (Vitter, 1985): keep the first `k` items, then for each later item at index `i` replace a random reservoir slot with probability `k / (i + 1)`.

The trade-off is speed against simplicity. Algorithm L and friends reduce the number of random draws for very large streams but need a geometric variate and a skip counter, which makes the code harder to verify and easy to get subtly wrong. Algorithm R draws exactly one random number per item and its correctness follows from a short induction, so it is the version worth shipping in a small library. If you are sampling billions of items per second, reach for Algorithm L; otherwise the constant factor will not matter.

## The awkward edge

The `random` argument is the one thing you will want to change. It must be a function returning a value in `[0, 1)`, and the default is `Math.random`. If you pass a generator that can return exactly `1.0`, the index calculation `Math.floor(random() * seen)` can produce `seen`, which is out of range; the implementation guards against this by comparing the drawn index against `k`, so a `1.0` simply means "do not replace". The contract is still `[0, 1)`, and the tests inject a deterministic generator so the suite never depends on `Math.random`.

`k` must be a non-negative integer. `k = 0` is allowed and yields an empty sample while still counting the stream via `sampler.seen`.

## API

- `new ReservoirSampler(k, random = Math.random)` — `k` is the maximum sample size; `random` is an optional `() => number` source in `[0, 1)`.
- `sampler.add(item)` — offer one item; returns `true` if it entered the reservoir.
- `sampler.sample()` — return a fresh array copy of the current reservoir.
- `sampler.seen` — how many items have been offered so far.
- `sampleStream(iterable, k, random = Math.random)` — convenience wrapper that consumes an iterable and returns the sample array.
