/**
 * One definition of "what a SpeakEdge membership gives you", shared by every
 * surface that lists it: the plan cards and comparison table on /plans, the
 * checkout order summary, and the member's dashboard panel. They used to each
 * carry their own list, which is how the dashboard ended up advertising
 * benefits that had nothing to do with the plan the student actually bought.
 */

/** The PlanConfig dimensions the benefit list is derived from. */
export interface PlanBenefitDims {
  plan: string;
  classes_per_week: number;
  conversation_per_week: number;
  community_days: number;
  support_days: number;
  cefr_tests: number;
  speaking_tests: number;
}

/**
 * Benefits that come with *every* membership, whatever the tier. These are not
 * PlanConfig dimensions — they are included across the board — so they live
 * here rather than being derived per plan.
 */
export const MEMBERSHIP_INCLUDES = [
  'Live Orientation session',
  'CEFR-aligned certificate as per Speaking Test',
  'Instruction videos',
  'Multilingual instruction options',
];

/**
 * The SpeakEdge Book ships with every membership (see the zeroed book line in
 * payments/service._book_quote). /plans renders it as a highlighted chip and
 * the dashboard as a list row, so the wording lives here rather than twice.
 */
export const SPEAKEDGE_BOOK_INCLUDED = 'SpeakEdge Book Included';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * A plan's day count as people read it: whole years stay "2 Years" (the launch
 * tiers), anything else is quoted in days so a short course reads "45 Days".
 */
export const daysLabel = (days: number) =>
  days > 0 && days % 365 === 0 ? plural(days / 365, 'Year') : plural(days, 'Day');

/**
 * The full benefit list for one plan, in the order the membership sheet lists
 * them: tier-specific benefits first, then what every membership includes.
 */
export function planBenefits(p: PlanBenefitDims): string[] {
  const out = [
    `Speaking Community Access: ${daysLabel(p.community_days)}`,
    p.conversation_per_week > 0
      ? `${p.conversation_per_week} Conversation Teams + Unlimited Individual Speaking Partners`
      : 'Unlimited Individual Speaking Partners',
    // Tiers without a teacher-led class are AI-guided off the SpeakEdge Book.
    p.classes_per_week > 0
      ? `${p.classes_per_week} Teacher-led Class${p.classes_per_week === 1 ? '' : 'es'}/Week`
      : 'AI-Guided Learning based on the SpeakEdge Book',
  ];
  if (p.cefr_tests > 0) out.push(plural(p.cefr_tests, 'CEFR Test'));
  if (p.speaking_tests > 0) out.push(plural(p.speaking_tests, 'Speaking Test'));
  if (p.support_days > 0) out.push(`Student Relation Support: ${daysLabel(p.support_days)}`);
  return [...out, ...MEMBERSHIP_INCLUDES];
}
