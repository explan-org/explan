import { TemplateResult, html, render } from 'lit-html';
import { Task } from '../chart/chart.ts';
import { icon } from '../icons/icons.ts';

export type DepType = 'pred' | 'succ';

export const depDisplayName: Record<DepType, string> = {
  pred: 'Predecessors',
  succ: 'Successors',
};

interface DepenencyEvent {
  taskIndex: number;
  depType: DepType;
}

declare global {
  interface GlobalEventHandlersEventMap {
    'delete-dependency': CustomEvent<DepenencyEvent>;
    'add-dependency': CustomEvent<DepenencyEvent>;
  }
}

const kindTemplate = (
  dependenciesControl: DependenciesPanel,
  depType: DepType,
  indexes: number[]
): TemplateResult => html`
  <tr>
    <th>${depDisplayName[depType]}</th>
    <th></th>
  </tr>
  ${indexes.map((taskIndex: number) => {
    const task = dependenciesControl.tasks[taskIndex];
    return html`<tr>
      <td>${task.name}</td>
      <td>
        <button
          class="icon-button"
          title="Delete the dependency on ${task.name}"
          @click=${() => dependenciesControl.deleteDep(taskIndex, depType)}
        >
          ${icon('delete-icon')}
        </button>
      </td>
    </tr>`;
  })}
  <tr>
    <td></td>
    <td>
      <button
        class="icon-button"
        @click=${() => dependenciesControl.addDep(depType)}
        title="Add dependency."
      >
        ${icon('add-icon')}
      </button>
    </td>
  </tr>
`;

const template = (
  dependenciesControl: DependenciesPanel
): TemplateResult => html`
  <table>
    ${kindTemplate(
      dependenciesControl,
      'pred',
      dependenciesControl.predIndexes
    )}
    ${kindTemplate(
      dependenciesControl,
      'succ',
      dependenciesControl.succIndexes
    )}
  </table>
`;

export class DependenciesPanel extends HTMLElement {
  tasks: Task[] = [];
  predIndexes: number[] = [];
  succIndexes: number[] = [];

  connectedCallback(): void {
    render(template(this), this);
  }

  public setTasksAndIndices(
    tasks: Task[],
    predIndexes: number[],
    succIndexes: number[]
  ) {
    this.tasks = tasks;
    const finishIndex = tasks.length - 1;
    this.predIndexes = predIndexes.filter(
      (index: number) => index !== 0 && index !== finishIndex
    );
    this.succIndexes = succIndexes.filter(
      (index: number) => index !== 0 && index !== finishIndex
    );
    render(template(this), this);
  }

  public deleteDep(taskIndex: number, depType: DepType) {
    this.dispatchEvent(
      new CustomEvent('delete-dependency', {
        bubbles: true,
        detail: {
          taskIndex: taskIndex,
          depType: depType,
        },
      })
    );
  }

  public addDep(depType: DepType) {
    this.dispatchEvent(
      new CustomEvent('add-dependency', {
        bubbles: true,
        detail: {
          taskIndex: -1,
          depType: depType,
        },
      })
    );
  }
}

customElements.define('dependencies-panel', DependenciesPanel);
