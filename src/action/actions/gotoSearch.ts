import { ExplanMain } from '../../explanMain/explanMain';
import { ok, Result } from '../../result';
import { SearchTaskPanel } from '../../search/search-task-panel';
import { Action, PostActonWork } from '../action';

export class GoToSearchAction implements Action {
  description: string = 'Moves focus to search control.';
  postActionWork: PostActonWork = '';
  undo: boolean = false;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async do(_explanMain: ExplanMain): Promise<Result<Action>> {
    document
      .querySelector<HTMLButtonElement>("button[data-target='task-tab']")!
      .click();
    document
      .querySelector<SearchTaskPanel>('search-task-panel')!
      .setKeyboardFocusToInput('name-only');
    return ok(this);
  }
}

export class GoToFullSearchAction implements Action {
  description: string =
    'Moves focus to search control and does a full search of all resource values.';
  postActionWork: PostActonWork = '';
  undo: boolean = false;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async do(_explanMain: ExplanMain): Promise<Result<Action>> {
    document
      .querySelector<HTMLButtonElement>("button[data-target='task-tab']")!
      .click();
    document
      .querySelector<SearchTaskPanel>('search-task-panel')!
      .setKeyboardFocusToInput('full-info');
    return ok(this);
  }
}
