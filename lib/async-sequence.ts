export async function forEachSequentially<T>(
  items: readonly T[],
  visit: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const visitAt = async (index: number): Promise<void> => {
    if (index >= items.length) return;
    await visit(items[index]!, index);
    return visitAt(index + 1);
  };

  await visitAt(0);
}

export async function mapAsyncInBatches<T, Result>(
  items: readonly T[],
  batchSize: number,
  map: (item: T, index: number) => Promise<Result>,
): Promise<Result[]> {
  const size = Math.max(1, Math.floor(batchSize));
  const results = new Array<Result>(items.length);

  const mapBatch = async (start: number): Promise<void> => {
    if (start >= items.length) return;

    const end = Math.min(start + size, items.length);
    const batch = await Promise.all(
      items.slice(start, end).map((item, offset) => map(item, start + offset)),
    );
    batch.forEach((result, offset) => {
      results[start + offset] = result;
    });

    return mapBatch(end);
  };

  await mapBatch(0);
  return results;
}
