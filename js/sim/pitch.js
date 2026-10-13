// Pitch geometry (metres). x runs along the length (goal lines at x = 0 and x = L),
// y across the width (touchlines at y = 0 and y = W).
export const L = 60, W = 40;
export const GOAL_W = 5, GOAL_H = 2;
export const GOAL_Y0 = W / 2 - GOAL_W / 2, GOAL_Y1 = W / 2 + GOAL_W / 2;
export const POST_R = 0.06, BALL_R = 0.11;
export const BOX_D = 9, BOX_W = 20; // penalty area
export const GA_D = 3, GA_W = 10; // goal area
export const PEN_SPOT = 7, CIRCLE_R = 5;
export const DT = 0.05, G = 9.81;
export const HALF_SECS = 600;

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const hyp = Math.hypot;
export const dist = (a, b) => hyp(a.x - b.x, a.y - b.y);
export const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// Is (x, y) inside the penalty area in front of the goal on line goalX?
export const inBox = (x, y, goalX) => Math.abs(x - goalX) <= BOX_D && Math.abs(y - W / 2) <= BOX_W / 2;
export const inGoalArea = (x, y, goalX) => Math.abs(x - goalX) <= GA_D && Math.abs(y - W / 2) <= GA_W / 2;

// Angle (radians) the goal mouth subtends from (x, y) for the goal on line goalX.
export function goalAngle(x, y, goalX) {
  const dx = Math.abs(goalX - x) || 0.01;
  return Math.abs(Math.atan2(GOAL_Y1 - y, dx) - Math.atan2(GOAL_Y0 - y, dx));
}
