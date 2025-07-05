const darkModeLocalStorageKey = 'explan-darkmode';

/** When the given element is clicked, then toggle the `darkmode` class on the
 * body element. */
export const toggleTheme = () => {
  window.localStorage.setItem(
    darkModeLocalStorageKey,
    document.body.classList.toggle('darkmode') ? '1' : '0'
  );
};

export const applyStoredTheme = () => {
  document.body.classList.toggle(
    'darkmode',
    window.localStorage.getItem(darkModeLocalStorageKey) === '1'
  );
};
