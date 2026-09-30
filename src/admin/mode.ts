/** Mock mode serves fixture data without sign-in. Development builds only. */
export const isMockMode: boolean =
  import.meta.env.DEV &&
  (import.meta.env.VITE_ADMIN_MOCK === '1' ||
    new URLSearchParams(window.location.search).get('mock') === '1')
