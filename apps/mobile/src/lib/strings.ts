// UI copy. Georgian is the default language; English is secondary.
// Wording is a placeholder until andro writes the real copy.

const ka = {
  leaveIn: (min: number) => `გადი ${min} წუთში`,
  leaveNow: 'გადი ახლა',
  options: 'ვარიანტები',
  min: (n: number) => `${n} წთ`,
  walk: (n: number) => `${n} წთ ფეხით`,
  myTrips: 'ჩემი მარშრუტები',
  arriveBy: (time: string) => `ჩასვლა ${time}-მდე`,
  noOptions: 'ვარიანტი ვერ მოიძებნა',
  offline: 'კავშირი ვერ დამყარდა, ნაჩვენებია ბოლო შედეგი',
  sample: 'სანიმუშო მონაცემები (სერვერი არ არის მითითებული)',
};

const en: typeof ka = {
  leaveIn: (min) => `Leave in ${min} min`,
  leaveNow: 'Leave now',
  options: 'Options',
  min: (n) => `${n} min`,
  walk: (n) => `${n} min walk`,
  myTrips: 'My trips',
  arriveBy: (time) => `Arrive by ${time}`,
  noOptions: 'No options found',
  offline: "Couldn't connect; showing the last result",
  sample: 'Sample data (no server configured)',
};

export type Lang = 'ka' | 'en';
export const strings: Record<Lang, typeof ka> = { ka, en };

// Language switching comes with settings; until then everything is Georgian.
export const t = strings.ka;
