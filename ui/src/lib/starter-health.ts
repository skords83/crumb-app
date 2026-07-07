// ui/src/lib/starter-health.ts
export function healthColor(health: number): string {
  if (health >= 90) return '#4ADE80';
  if (health >= 60) return '#F2C94C';
  if (health >= 30) return '#F5A360';
  return '#F85149';
}

export function healthStatusFromScore(health: number): string {
  if (health >= 90) return 'Topfit 🌟';
  if (health >= 60) return 'Gut';
  if (health >= 30) return 'Schwächelt';
  return 'Kritisch';
}

export function timeSinceFeeding(lastFedAt: string | null): string {
  if (!lastFedAt) return 'Noch nie gefüttert';
  const hours = (Date.now() - new Date(lastFedAt).getTime()) / 3600000;
  if (hours < 1) return 'Gerade eben gefüttert';
  if (hours < 24) return `Vor ${Math.round(hours)}h gefüttert`;
  return `Vor ${Math.round(hours / 24)} Tagen gefüttert`;
}
