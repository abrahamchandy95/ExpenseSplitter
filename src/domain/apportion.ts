/**
 * Largest remainder apportionment of an integer total over integer weights.
 * Each share is floor(total * weight / sum); leftover cents go one each to the
 * largest fractional remainders, ties broken by lowest index. Shares always sum
 * to total. Throws RangeError on programmer errors (non-integer or negative
 * input, or weights summing to zero).
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError(`total must be a non-negative safe integer, got ${total}`);
  }
  let weightSum = 0n;
  for (const weight of weights) {
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw new RangeError(`weights must be non-negative safe integers, got ${weight}`);
    }
    weightSum += BigInt(weight);
  }
  if (weightSum === 0n) throw new RangeError("weights must not all be zero");

  const totalBigInt = BigInt(total);
  const shares: number[] = [];
  const remainders: bigint[] = [];
  let assigned = 0n;

  for (const weight of weights) {
    const product = totalBigInt * BigInt(weight);
    const floor = product / weightSum;
    shares.push(Number(floor));
    remainders.push(product % weightSum);
    assigned += floor;
  }

  const leftover = Number(totalBigInt - assigned);
  // Fast path: when `total` divides evenly across `weights`, skip index allocation and sorting.
  if (leftover > 0) {
    const indicesByRemainder = weights.map((_, index) => index);
    indicesByRemainder.sort((first, second) => {
      if (remainders[first] === remainders[second]) return first - second;
      return remainders[first] > remainders[second] ? -1 : 1;
    });
    for (let i = 0; i < leftover; i++) {
      shares[indicesByRemainder[i]] += 1;
    }
  }

  return shares;
}
