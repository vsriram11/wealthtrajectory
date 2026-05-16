/**
 * Non-Independence financial goals: house down payment, kid's college,
 * sabbatical, wedding, etc. The Independence projection is the headline,
 * but most users have multiple goals layered on top. Tracking them
 * here keeps the user's mental model coherent — what they need,
 * by when.
 *
 * Independent of the Independence engine — goals don't affect projectIndependence
 * (they're optional milestones, not constraints). Future extension
 * could let users tag holdings as "earmarked for goal X" so the
 * goal pulls from a specific account's growth curve.
 */
export type Goal = {
  id: string;
  name: string;
  targetUSD: number;
  /** Optional target date — when this needs to be funded by. */
  targetDate: number | null;
  /** Current allocation toward the goal (manually tracked). */
  currentUSD: number;
  /** Optional monthly contribution earmarked for this goal. */
  monthlyContributionUSD: number;
  /** Optional category for visual grouping. */
  category:
    | "house"
    | "education"
    | "travel"
    | "vehicle"
    | "wedding"
    | "emergency_fund"
    | "other";
  createdAt: number;
};

export type GoalProgress = {
  goal: Goal;
  /** 0-1 fraction of target reached. */
  fractionComplete: number;
  /** $ remaining. */
  remainingUSD: number;
  /** Months to target at current monthly contribution. null if no rate / never reaches. */
  monthsToTarget: number | null;
  /**
   * True when monthsToTarget is set AND the target date is also set
   * AND the target date is reachable at current pace.
   */
  onPace: boolean;
};

export function computeGoalProgress(
  goal: Goal,
  now = Date.now(),
): GoalProgress {
  const targetUSD = Math.max(0, goal.targetUSD);
  const currentUSD = Math.max(0, goal.currentUSD);
  const remainingUSD = Math.max(0, targetUSD - currentUSD);
  const fractionComplete =
    targetUSD > 0 ? Math.min(1, currentUSD / targetUSD) : 0;
  let monthsToTarget: number | null = null;
  if (remainingUSD === 0) {
    monthsToTarget = 0;
  } else if (goal.monthlyContributionUSD > 0) {
    monthsToTarget = Math.ceil(remainingUSD / goal.monthlyContributionUSD);
  }
  let onPace = false;
  if (monthsToTarget != null && goal.targetDate != null) {
    const monthsRemaining =
      (goal.targetDate - now) / (30.44 * 24 * 60 * 60 * 1000);
    onPace = monthsToTarget <= monthsRemaining;
  }
  return {
    goal,
    fractionComplete,
    remainingUSD,
    monthsToTarget,
    onPace,
  };
}

export const GOAL_CATEGORY_LABELS: Record<Goal["category"], string> = {
  house: "House",
  education: "Education",
  travel: "Travel",
  vehicle: "Vehicle",
  wedding: "Wedding",
  emergency_fund: "Emergency fund",
  other: "Other",
};
