/**
 * Reservoir sampling: maintain a uniform random sample of k items from a stream
 * of unknown or unbounded length in a single pass, using O(k) memory.
 *
 * This module implements Algorithm R (Vitter, 1985), which is the classic
 * method: fill the reservoir with the first k items, then for each subsequent
 * item at index i (0-based), replace a random existing slot with probability
 * k / (i + 1). Each item ends up in the final sample with probability k / n.
 *
 * Why Algorithm R rather than a fancier variant (Algorithm L, etc.)? Algorithm R
 * is the simplest correct one-pass uniform sampler and needs only one random
 * number per item. Algorithm L is faster for very large streams but requires
 * a random number generator that can produce geometric variates and careful
 * handling of the skip counter. For a small library whose job is to be obviously
 * correct, Algorithm R is the right trade-off: the per-item cost is one call to
 * the supplied random source, and the correctness argument is a two-line
 * induction.
 */

/**
 * Uniformly sample up to k items from a stream without knowing its length in
 * advance.
 *
 * The sampler is stateful: call `add` once per stream item in order, then read
 * `items` (or call `sample`) to get the current reservoir. Because the reservoir
 * is always a valid uniform sample of everything seen so far, you can read it
 * at any point, not only at the end.
 *
 * @param {number} k Maximum number of items to keep. Must be a non-negative
 *   integer. `k = 0` is allowed and yields an empty reservoir.
 * @param {() => number} [random] Source of uniform random numbers in [0, 1).
 *   Defaults to `Math.random`. Injecting this is how tests stay deterministic.
 */
export class ReservoirSampler {
  constructor(k, random = Math.random) {
    if (!Number.isInteger(k) || k < 0) {
      throw new RangeError(`k must be a non-negative integer, got ${k}`);
    }
    if (typeof random !== 'function') {
      throw new TypeError('random must be a function returning a number in [0, 1)');
    }
    this.k = k;
    this.random = random;
    /** @type {any[]} */
    this.items = [];
    this.seen = 0;
  }

  /**
   * Offer one item to the sampler.
   *
   * @param {any} item
   * @returns {boolean} True if the item was admitted into the reservoir.
   *   For the first k items this is always true (when k > 0); afterwards it is
   *   true with probability k / seen.
   */
  add(item) {
    this.seen += 1;
    if (this.items.length < this.k) {
      this.items.push(item);
      return true;
    }
    // k === 0 falls through here every time and never admits anything.
    if (this.items.length === 0) {
      return false;
    }
    // Replace a uniformly chosen slot with probability k / seen.
    // `random()` is in [0, 1), so floor(random() * seen) is in [0, seen-1].
    const j = Math.floor(this.random() * this.seen);
    if (j < this.k) {
      this.items[j] = item;
      return true;
    }
    return false;
  }

  /**
   * The current reservoir, as a fresh array. Copying means callers cannot
   * accidentally mutate the sampler's internal state.
   *
   * @returns {any[]}
   */
  sample() {
    return this.items.slice();
  }
}

/**
 * Convenience wrapper: sample k items from any iterable in one call.
 *
 * This is the common case — the whole stream is already iterable and you just
 * want the sample. For streams you can only pull from (sockets, generators that
 * must be consumed lazily) use `ReservoirSampler` directly and call `add`.
 *
 * @param {Iterable<any>} iterable
 * @param {number} k
 * @param {() => number} [random]
 * @returns {any[]}
 */
export function sampleStream(iterable, k, random = Math.random) {
  const sampler = new ReservoirSampler(k, random);
  for (const item of iterable) {
    sampler.add(item);
  }
  return sampler.sample();
}
