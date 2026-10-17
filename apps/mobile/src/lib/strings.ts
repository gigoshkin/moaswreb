// UI copy, ka and en. Screens are being redesigned (andro); add keys as they
// are built. Every Georgian string must follow
// knowledge-base/georgian-glossary.md (npm run ka-check).

const ka = {
  leaveNow: 'გასვლა ახლა',
  alertsChannel: 'გასვლის შეხსენებები',
};

const en: typeof ka = {
  leaveNow: 'Leave now',
  alertsChannel: 'Departure reminders',
};

export type Lang = 'ka' | 'en';
export const strings: Record<Lang, typeof ka> = { ka, en };

// Georgian first (06-design-direction.md §0 rule 1); language switching comes with settings.
export const t = strings.ka;
