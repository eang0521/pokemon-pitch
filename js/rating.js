// Player match ratings (3.0 .. 10.0) from the match stats, like a newspaper's marks out of ten.
export function matchRating(card, s) {
  if (!s || (!s.touches && !s.saves && !s.tackles)) return null;
  const gk = card.pos === 'GK';
  let r = 6.0;
  r += s.goals * 1.0 + s.assists * 0.6 + s.sot * 0.12 + s.keyPasses * 0.15 - s.ownGoals * 1.0;
  if (s.passes >= 5) r += Math.max(-0.6, Math.min(0.6, ((s.cmp / s.passes) - 0.78) * 2.5)) * Math.min(1, s.passes / 20);
  r += Math.min(1, s.tacklesWon * 0.07) - (s.tackles - s.tacklesWon) * 0.03 + Math.min(0.8, s.ints * 0.1);
  r += gk ? Math.min(2.2, s.saves * 0.22) - s.conceded * 0.35 : 0;
  r -= s.fouls * 0.1 + s.yellow * 0.3 + s.red * 1.5;
  r += Math.min(0.4, s.touches * 0.008);
  return Math.max(3, Math.min(10, Math.round(r * 10) / 10));
}
