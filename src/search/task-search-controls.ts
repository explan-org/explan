import { TemplateResult, html, render } from 'lit-html';
import fuzzysort from 'fuzzysort';
import { Task } from '../chart/chart.ts';

interface TaskChangeDetail {
  taskIndex: number;
  focus: boolean;
}

declare global {
  interface GlobalEventHandlersEventMap {
    'task-change': CustomEvent<TaskChangeDetail>;
    'task-focus': CustomEvent<null>;
  }
}

/** The indexes returned by fuzzysort is just a list of the indexes of the the
 *  individual chars that have been matched. We need to turn that into pairs of
 *  numbers we can pass to String.prototype.slice().
 *
 *  The observation here is that if the target string is "Hello" and the indices
 *  are [2,3] then it doesn't matter if we markup the highlighted target as
 *  "He<b>ll</b>o" or "He<b>l</b><b>l</b>o". That is, we can simplify if we
 *  always slice out each character in the target string that needs to be
 *  highlighted.
 *
 *  So indexesToRanges returns an array of indexes, that if taken in pairs, will
 *  alternately slice off parts of target that need to be emphasized.
 *
 *  In the above example target = "Hello" and indexes = [2,3], then
 *  indexesToRanges will return"
 *
 *     [0,2,3,3,4,5]
 *
 *  which will generate the following pairs as args to slice:
 *
 *     [0,2] He
 *     [2,3] l   #
 *     [3,3]
 *     [3,4] l   #
 *     [4,5] o
 *
 * Note that if we alternate bolding then only the two 'l's get emphasized,
 * which is what we want (Denoted by # above).
 */
const indexesToRanges = (
  indexes: Readonly<number[]>,
  len: number
): number[] => {
  // Convert each index of a highlighted char into a pair of numbers we can pass
  // to slice, and then flatten.
  const ranges = indexes.map((x: number) => [x, x + 1]).flat();

  // Now prepend with 0 and append 'len' so that we have pairs that will slice
  // target fully into substrings. Remember that slice returns chars in [a, b),
  // i.e. String.slice(a,b) where b is one beyond the last char in the string we
  // want to include.
  return [0, ...ranges, len];
};

/** Returns the target string highlighted around the given character indexes in
 *  the ranges array.
 *
 *  We don't use the highlighting from fuzzysort.
 */
const highlight = (ranges: number[], target: string): TemplateResult[] => {
  const ret: TemplateResult[] = [];
  let inHighlight = false;

  // Run down ranges with a sliding window of length 2 and use that as the
  // arguments to slice. Alternate highlighting each segment.
  for (let i = 0; i < ranges.length - 1; i++) {
    const sub = target.slice(ranges[i], ranges[i + 1]);
    if (inHighlight) {
      ret.push(html`<b>${sub}</b>`);
    } else {
      ret.push(html`${sub}`);
    }
    inHighlight = !inHighlight;
  }
  return ret;
};

/** Returns the target string highlighted around the given character indexes.
 *  Note that we don't use fuzzysort's highlight because we haven't sanitized
 *  the names.
 */
const highlightedTarget = (
  indexes: Readonly<number[]>,
  target: string
): TemplateResult[] => {
  return highlight(indexesToRanges(indexes, target.length), target);
};

const searchResults = (searchTaskPanel: TaskSearchControl): TemplateResult[] =>
  searchTaskPanel.searchResults.map(
    (task: SearchResult, index: number) =>
      html` <li
        tabindex="-1"
        @click="${() => searchTaskPanel.selectSearchResult(index, false)}"
        ?data-focus=${index === searchTaskPanel.focusIndex}
        data-index=${index}
      >
        ${highlightedTarget(task.indexes, task.target)}
      </li>`
  );

const template = (searchTaskPanel: TaskSearchControl): TemplateResult => html`
  <input
    autocomplete="off"
    name="task_search"
    id="search_input"
    placeholder="Search"
    type="text"
    @input="${(e: InputEvent) =>
      searchTaskPanel.onInput((e.target as HTMLInputElement).value)}"
    @keydown="${(e: KeyboardEvent) => searchTaskPanel.onKeyDown(e)}"
    @focus="${() => searchTaskPanel.searchInputReceivedFocus()}"
  />
  <ul>
    ${searchResults(searchTaskPanel)}
  </ul>
`;

export type SearchType = 'name-only' | 'full-info';

const searchStringFromTaskBuilder = (
  fullTaskList: Task[],
  searchType: SearchType,
  includedIndexes: Set<number>,
  maxNameLength: number
): ((task: Task) => string) => {
  if (searchType === 'full-info') {
    return (task: Task): string => {
      if (includedIndexes.size !== 0) {
        const taskIndex = fullTaskList.indexOf(task);
        if (!includedIndexes.has(taskIndex)) {
          return '';
        }
      }
      const resourceKeys = Object.keys(task.resources);
      resourceKeys.sort();
      return `${task.name} ${'-'.repeat(maxNameLength - task.name.length + 2)} ${resourceKeys
        .map((key: string) => task.resources[key])
        .join(' ')}`;
    };
  } else {
    return (task: Task): string => {
      if (includedIndexes.size !== 0) {
        const taskIndex = fullTaskList.indexOf(task);
        if (!includedIndexes.has(taskIndex)) {
          return '';
        }
      }
      return task.name;
    };
  }
};

interface SearchResult {
  obj: Task;
  indexes: ReadonlyArray<number>;
  target: string;
}

const taskListToSearchResults = (
  tasks: Task[],
  taskToSearchString: (task: Task) => string,
  includedIndexes: Set<number>
): SearchResult[] => {
  return tasks
    .filter((_task: Task, index: number) => includedIndexes.has(index))
    .map((t: Task) => {
      return {
        obj: t,
        indexes: [],
        target: taskToSearchString(t),
      };
    });
};

/**
 * Control for using fuzzy search on a list of tasks.
 *
 */
export class TaskSearchControl extends HTMLElement {
  _tasks: Task[] = [];
  _includedIndexes: Set<number> = new Set();
  focusIndex: number = 0;
  searchResults: ReadonlyArray<SearchResult> = [];
  searchType: SearchType = 'name-only';
  taskToSearchString: (task: Task) => string = () => '';

  connectedCallback(): void {
    render(template(this), this);
  }

  onInput(inputString: string) {
    if (inputString === '') {
      this.searchResults = taskListToSearchResults(
        this._tasks,
        this.taskToSearchString,
        this._includedIndexes
      );
    } else {
      this.searchResults = fuzzysort.go<Task>(
        inputString,
        this._tasks.slice(1, -1), // Remove Start and Finish from search range.
        {
          key: this.taskToSearchString,
          limit: this._tasks.length,
          threshold: 0.2,
        }
      );
    }
    this.focusIndex = 0;
    render(template(this), this);
  }

  onKeyDown(e: KeyboardEvent) {
    if (this.searchResults.length === 0) {
      return;
    }
    // TODO - extract from the two places we do this.
    const keyname = `${e.shiftKey ? 'shift-' : ''}${e.ctrlKey ? 'ctrl-' : ''}${e.metaKey ? 'meta-' : ''}${e.altKey ? 'alt-' : ''}${e.key}`;
    switch (keyname) {
      case 'ArrowDown':
        this.focusIndex = (this.focusIndex + 1) % this.searchResults.length;
        e.stopPropagation();
        e.preventDefault();
        break;
      case 'ArrowUp':
        this.focusIndex =
          (this.focusIndex - 1 + this.searchResults.length) %
          this.searchResults.length;
        e.stopPropagation();
        e.preventDefault();
        break;
      case 'Enter':
        if (this.searchResults.length === 0) {
          return;
        }
        this.selectSearchResult(this.focusIndex, false);
        e.stopPropagation();
        e.preventDefault();
        break;
      case 'ctrl-Enter':
        if (this.searchResults.length === 0) {
          return;
        }
        this.selectSearchResult(this.focusIndex, true);
        e.stopPropagation();
        e.preventDefault();
        break;

      default:
        break;
    }
    render(template(this), this);
  }

  selectSearchResult(index: number, focus: boolean) {
    const taskIndex = this._tasks.indexOf(this.searchResults[index].obj);
    this.dispatchEvent(
      new CustomEvent<TaskChangeDetail>('task-change', {
        bubbles: true,
        detail: {
          taskIndex: taskIndex,
          focus: focus,
        },
      })
    );
    this.searchResults = [];
    render(template(this), this);
  }

  searchInputReceivedFocus() {
    this.dispatchEvent(
      new CustomEvent<number>('task-focus', {
        bubbles: true,
      })
    );
  }

  setKeyboardFocusToInput(searchType: SearchType) {
    this.searchType = searchType;
    const inputControl = this.querySelector<HTMLInputElement>('input')!;
    inputControl.focus();
    inputControl.select();
    this.onInput(inputControl.value);
    render(template(this), this);
  }

  public set tasks(tasks: Task[]) {
    this._tasks = tasks;
    this.buildTaskToSearchString();
  }

  public set includedIndexes(v: number[]) {
    this._includedIndexes = new Set(v);
    this.buildTaskToSearchString();
  }

  private buildTaskToSearchString() {
    const maxNameLength = this._tasks.reduce<number>(
      (prev: number, task: Task): number =>
        task.name.length > prev ? task.name.length : prev,
      0
    );
    this.taskToSearchString = searchStringFromTaskBuilder(
      this._tasks,
      this.searchType,
      this._includedIndexes,
      maxNameLength
    );
    this.onInput('');
  }
}

customElements.define('task-search-control', TaskSearchControl);
