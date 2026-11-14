// Freshness states — first-class, never smoothed over.
//
//   fresh        snapshot read within the freshness window
//   stale        snapshot older than the window (still served, labelled)
//   conflicting  the feed disagreed with itself during the read
//   unavailable  no snapshot could be produced; the serving layer refuses
//                to describe the airspace rather than guess
//
// A stale or missing picture is never presented as "restrictions ended."

export const FRESH_WINDOW_MS = 15 * 60 * 1000;

export function freshnessOf(snapshot, nowMs = Date.now()) {
  if (!snapshot) return { state: "unavailable", age_seconds: null };
  const age = Math.max(0, Math.round((nowMs - Date.parse(snapshot.observed_at)) / 1000));
  if (snapshot.feed_stability === "conflicting") {
    return { state: "conflicting", age_seconds: age };
  }
  if (age * 1000 <= FRESH_WINDOW_MS) return { state: "fresh", age_seconds: age };
  return { state: "stale", age_seconds: age };
}

export const REFUSAL =
  "UNAVAILABLE: no verified snapshot could be produced. The current restriction picture is unknown. " +
  "Missing information is never reported as restrictions ended. Official FAA systems remain authoritative.";
