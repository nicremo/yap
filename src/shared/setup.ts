/** The setup wizard's steps, in order. Persisted so a restart forced by macOS resumes where the user was. */
export const SETUP_STEPS = ['welcome', 'engine', 'connect', 'permissions', 'shortcut', 'try'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
