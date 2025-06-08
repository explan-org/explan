import { TaskSearchControl } from '../search/task-search-controls';
import { Chart } from '../chart/chart';
import { DepType, depDisplayName } from '../dependencies/dependencies-panel';
import {
  allPotentialSuccessors,
  allPotentialPredecessors,
} from '../dag/algorithms/circular';

export class AddDependencyDialog extends HTMLElement {
  private titleElement: HTMLElement | null = null;
  private taskSearchControl: TaskSearchControl | null = null;
  private dialog: HTMLDialogElement | null = null;
  private resolve: (value: number | undefined) => void = () => {};

  connectedCallback(): void {
    this.titleElement = this.querySelector('h2')!;
    this.taskSearchControl = this.querySelector('task-search-control')!;
    this.dialog = this.querySelector('dialog')!;
    this.dialog.addEventListener('cancel', () => this.resolve(undefined));
    this.taskSearchControl.addEventListener('task-change', (e) => {
      this.dialog!.close();
      this.resolve(e.detail.taskIndex);
    });
    this.querySelector('#dependency-cancel')!.addEventListener('click', () => {
      this.dialog!.close();
    });
  }

  /** Populates the dialog and shows it as a Modal dialog and returns a Promise
   *  that resolves on success to a taskIndex, or undefined if the user
   *  cancelled out of the flow.
   */
  public selectDependency(
    chart: Chart,
    taskIndex: number,
    depType: DepType
  ): Promise<number | undefined> {
    this.titleElement!.textContent = depDisplayName[depType];

    let includedIndexes = [];
    if (depType === 'pred') {
      includedIndexes = allPotentialPredecessors(taskIndex, chart);
    } else {
      includedIndexes = allPotentialSuccessors(taskIndex, chart);
    }
    this.taskSearchControl!.tasks = chart.Vertices;
    this.taskSearchControl!.includedIndexes = includedIndexes;

    // TODO - Allow both types of search in the dependency dialog.
    this.taskSearchControl!.setKeyboardFocusToInput('name-only');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const ret = new Promise<number | undefined>((resolve, _reject) => {
      this.resolve = resolve;
      this.dialog!.showModal();
    });
    return ret;
  }
}

customElements.define('add-dependency-dialog', AddDependencyDialog);
