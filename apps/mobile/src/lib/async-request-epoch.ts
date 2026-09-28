export type AsyncRequestEpoch = ReturnType<typeof createAsyncRequestEpoch>;

export function createAsyncRequestEpoch() {
  let current = 0;

  return {
    begin() {
      current += 1;
      return current;
    },
    invalidate() {
      current += 1;
    },
    isCurrent(epoch: number) {
      return current === epoch;
    },
  };
}
