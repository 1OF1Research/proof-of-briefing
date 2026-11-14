// Change detection between two snapshots' observed pictures.
//
// "What changed in the public restriction picture, and can I verify the
// exact information behind that answer?" Both snapshots are anchored, so
// every change line traces to two verifiable records.

function programKey(p, e) {
  return `${p.type}|${e.ARPT || e.Program_Name || "national"}|${e.Reason || ""}`;
}

export function diffObserved(prev, next) {
  const changes = [];
  if (!prev) return changes;

  const prevMap = new Map();
  for (const p of prev.programs) for (const e of p.entries) prevMap.set(programKey(p, e), { p, e });
  const nextMap = new Map();
  for (const p of next.programs) for (const e of p.entries) nextMap.set(programKey(p, e), { p, e });

  for (const [k, { p, e }] of nextMap) {
    if (!prevMap.has(k)) {
      changes.push(`NEW ${p.type} — ${e.ARPT || e.Program_Name || "national"}${e.Reason ? `: ${e.Reason}` : ""}`);
    }
  }
  for (const [k, { p, e }] of prevMap) {
    if (!nextMap.has(k)) {
      changes.push(`ENDED (no longer listed in the feed) ${p.type} — ${e.ARPT || e.Program_Name || "national"}`);
    }
  }

  for (const code of Object.keys(next.airports).sort()) {
    const a = prev.airports[code] && prev.airports[code].metar;
    const b = next.airports[code] && next.airports[code].metar;
    if (a && b && a.flight_category !== b.flight_category) {
      changes.push(`${code} flight category ${a.flight_category} -> ${b.flight_category}`);
    }
    if (!a && b) changes.push(`${code} observations resumed`);
    if (a && !b) changes.push(`${code} observations missing in the new read`);
  }

  if (prev.faa_update_time !== next.faa_update_time) {
    changes.push(`FAA feed update time advanced: ${prev.faa_update_time} -> ${next.faa_update_time}`);
  }
  return changes;
}
