/**
 * The team's permanent test accounts on the live site, for trying the break
 * study's pages (MyStory's chat above all) as a participant would. Kept, and
 * left out of every file of the export, so the research data holds only real
 * participants. Added 14 October 2026 at the team's request. They may also
 * tell MyStory more than once a phase (19 October 2026), which nobody else can.
 */
export const TEST_PARTICIPANTS: ReadonlySet<string> = new Set([
  'MP9C78C162BB9F', // the team's own, for checking MyStory by hand
  'MPEFE6E0593853', // used to test the AI chat live
]);

/** Whether this participant may tell MyStory more than once in a phase: only the team's test accounts. */
export const mayRetellStory = (code: string): boolean => TEST_PARTICIPANTS.has(code);
