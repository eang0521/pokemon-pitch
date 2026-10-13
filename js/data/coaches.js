// Coach tendencies (0..1):
//   tempo       how quickly the ball moves (short decision holds, early passes)
//   press       how high and how hard they press without the ball
//   width       how wide the team spreads in possession
//   directness  forward passes and long balls over safe recycling
//   shootRange  how far out they're happy to shoot from (about 16 m at 0 to 28 m at 1)
//   aggression  how hard they go into tackles (more turnovers, more fouls and cards)
export const COACH_PRESETS = {
  balanced: { style: 'Balanced', tempo: 0.5, press: 0.5, width: 0.5, directness: 0.5, shootRange: 0.5, aggression: 0.5 },
  possession: { style: 'Possession', tempo: 0.45, press: 0.6, width: 0.65, directness: 0.35, shootRange: 0.35, aggression: 0.45 },
  counter: { style: 'Counter-Attack', tempo: 0.75, press: 0.3, width: 0.45, directness: 0.8, shootRange: 0.55, aggression: 0.5 },
  highPress: { style: 'High Press', tempo: 0.65, press: 0.75, width: 0.55, directness: 0.5, shootRange: 0.5, aggression: 0.55 },
  longBall: { style: 'Long Ball', tempo: 0.6, press: 0.4, width: 0.5, directness: 0.85, shootRange: 0.65, aggression: 0.55 },
  parkBus: { style: 'Park the Bus', tempo: 0.4, press: 0.15, width: 0.35, directness: 0.7, shootRange: 0.6, aggression: 0.55 },
  wingPlay: { style: 'Wing Play', tempo: 0.55, press: 0.55, width: 0.85, directness: 0.6, shootRange: 0.45, aggression: 0.5 },
};
export const COACH_KEYS = ['tempo', 'press', 'width', 'directness', 'shootRange', 'aggression'];
export const coach = (name, preset) => ({ name, preset, ...COACH_PRESETS[preset] });
