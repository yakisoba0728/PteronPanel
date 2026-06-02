export const dictionaries = {
  ko: {
    'nav.servers': '서버',
    'nav.admin': '관리자',
    'nav.account': '계정',
    'action.logout': '로그아웃',
    'common.loading': '불러오는 중...',
  },
  en: {
    'nav.servers': 'Servers',
    'nav.admin': 'Admin',
    'nav.account': 'Account',
    'action.logout': 'Log out',
    'common.loading': 'Loading...',
  },
} as const;

/** Union of all message keys available in the dictionaries. */
export type MessageKey = keyof (typeof dictionaries)['ko'];
