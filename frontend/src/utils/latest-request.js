export function createLatestRequest() {
  let version = 0
  return {
    begin() {
      version += 1
      return version
    },
    isLatest(candidate) {
      return candidate === version
    },
    invalidate() {
      version += 1
    },
  }
}
