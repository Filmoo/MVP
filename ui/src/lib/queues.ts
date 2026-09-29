/**
 * Queues played on Howling Abyss: ARAM, ARAM Clash, ARAM: Mayhem (2400), the Poro King, and
 * the older ARAM queues and Butcher's Bridge. No wards there, so nobody has a vision score, and
 * no roles.
 */
const HOWLING_ABYSS: ReadonlySet<number> = new Set([65, 100, 300, 450, 720, 920, 2400]);

/** Whether `queueId` is played on Howling Abyss. */
export function onHowlingAbyss(queueId: number): boolean {
  return HOWLING_ABYSS.has(queueId);
}
