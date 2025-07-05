const radarVisibleLocalStorageKey = 'explan-radar-visible';

export const getRadarVisible = (): boolean =>
  window.localStorage.getItem(radarVisibleLocalStorageKey) !== '0';

export const setRadarVisible = (value: boolean) =>
  window.localStorage.setItem(radarVisibleLocalStorageKey, value ? '1' : '0');
