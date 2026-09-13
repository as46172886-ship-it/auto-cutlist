export async function mapInBatches<T, R>(
  items: T[],
  concurrency: number,
  work: (item: T) => Promise<R>,
) {
  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  const results: R[] = [];
  for (let index = 0; index < items.length; index += safeConcurrency) {
    results.push(...await Promise.all(items.slice(index, index + safeConcurrency).map(work)));
  }
  return results;
}
