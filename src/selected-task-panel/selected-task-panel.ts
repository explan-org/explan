import { TemplateResult, html, render } from 'lit-html';
import { Plan } from '../plan/plan';
import { live } from 'lit-html/directives/live.js';
import { icon } from '../icons/icons';
import { executeByName, executeOp } from '../action/execute';
import { ExplanMain } from '../explanMain/explanMain';
import { RecalculateDurationOp, SetTaskDescriptionOp } from '../ops/chart';
import { reportErrorMsg } from '../report-error/report-error';
import { Task } from '../chart/chart';
import linkifyStr from 'linkify-string';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { EditDescriptionDialog } from '../edit-description-dialog/edit-description-dialog';

export interface TaskNameChangeDetails {
  name: string;
  taskIndex: number;
}

export interface TaskResourceValueChangeDetails {
  name: string;
  value: string;
  taskIndex: number;
}

export interface TaskMetricValueChangeDetails {
  name: string;
  value: number;
  taskIndex: number;
}

declare global {
  interface GlobalEventHandlersEventMap {
    'task-name-change': CustomEvent<TaskNameChangeDetails>;
    'task-resource-value-change': CustomEvent<TaskResourceValueChangeDetails>;
    'task-metric-value-change': CustomEvent<TaskMetricValueChangeDetails>;
  }
}

export class SelectedTaskPanel extends HTMLElement {
  explanMain: ExplanMain | null = null;
  plan: Plan = new Plan();
  taskIndex: number = -1;
  planDefinitionChangedCallback: () => void;

  constructor() {
    super();
    this.planDefinitionChangedCallback = () => {
      this.render();
    };
  }

  connectedCallback(): void {
    this.render();
    document.addEventListener(
      'plan-definition-changed',
      this.planDefinitionChangedCallback
    );
  }

  disconnectedCallback(): void {
    document.removeEventListener(
      'plan-definition-changed',
      this.planDefinitionChangedCallback
    );
  }

  updateSelectedTaskPanel(explainMain: ExplanMain, taskIndex: number) {
    this.explanMain = explainMain;
    this.plan = explainMain.plan;
    this.taskIndex = taskIndex;
    this.render();
    /*
    TODO - Do the following when selecting a new task.
      window.setTimeout(() => {
        const input =
          selectedTaskPanel.querySelector<HTMLInputElement>("#task-name")!;
        input.focus();
        input.select();
      }, 0);
      */
  }

  render() {
    render(this.template(), this);
  }

  humanDurationValue(task: Task): string {
    const ret = this.plan.durationUnits.durationToHuman(task.duration);
    if (!ret.ok) {
      reportErrorMsg(ret.error);
      return '';
    }
    return ret.value;
  }

  template(): TemplateResult {
    const taskIndex = this.taskIndex;
    if (taskIndex === -1) {
      return html`
        <button
          class="icon-button"
          @click=${async () =>
            await executeByName('NewTaskAction', this.explanMain!)}
          title="Add Task"
        >
          ${icon('add-icon')}
        </button>
        <div>No task selected.</div>
      `;
    }
    if (this.explanMain === null) {
      return html``;
    }

    // Filter down to the sorted metric key names that are visible when editing a Task.
    const metricKeys = Object.keys(this.plan.metricDefinitions)
      .filter(
        (key: string) => this.plan.metricDefinitions[key].hideEditor === false
      )
      .sort();

    const resourceKeys = Object.keys(this.plan.resourceDefinitions).sort();

    const task = this.plan.chart.Vertices[taskIndex];
    return html`
      <button
        class="icon-button"
        @click=${async () =>
          await executeByName('NewTaskAction', this.explanMain!)}
        title="Add Task"
      >
        ${icon('add-icon')}
      </button>
      <button
        class="icon-button"
        @click=${async () =>
          await executeByName('DupTaskAction', this.explanMain!)}
        title="Duplicate Task"
      >
        ${icon('dup')}
      </button>
      <button
        class="icon-button"
        @click=${async () =>
          await executeByName('SplitTaskAction', this.explanMain!)}
        title="Split Task"
      >
        ${icon('split')}
      </button>

      <button
        class="icon-button"
        @click=${async () =>
          executeByName('DeleteTaskAction', this.explanMain!)}
        title="Delete Task"
      >
        ${icon('delete-icon')}
      </button>
      <table>
        <tr>
          <td class="underline-first-char">Name</td>
          <td>
            <input
              type="text"
              id="task-name"
              accesskey="n"
              .value="${live(task.name)}"
              @change=${(e: Event) =>
                this.dispatchEvent(
                  new CustomEvent<TaskNameChangeDetails>('task-name-change', {
                    bubbles: true,
                    detail: {
                      taskIndex: taskIndex,
                      name: (e.target as HTMLInputElement).value,
                    },
                  })
                )}
            />
          </td>
        </tr>
        <tr>
          <!-- 
          
          Should be a div with an edit button. Contents processed through linkify.

          Assure the linkify links open in another tab/window.

          Add an edit button to open a dialog for editing the description.
          
          -->
          <td>De<u>s</u>cription</td>
          <td class="task-description">
            <p>
              ${unsafeHTML(
                linkifyStr(task.description, {
                  target: '_blank',
                })
              )}
            </p>
            <button
              accesskey="s"
              class="icon-button"
              title="Edit description"
              @click=${() => this.editDescription()}
            >
              ${icon('edit-icon')}
            </button>
          </td>
        </tr>
        <tr>
          <td>D<u>u</u>ration</td>
          <td class="aligned-td">
            <input
              type="text"
              spellcheck="false"
              id="human-duration"
              accesskey="u"
              .value="${live(this.humanDurationValue(task))}"
              @change="${(e: Event) => {
                const humanDuration = (e.target as HTMLInputElement).value;
                const ret =
                  this.plan.durationUnits.parseHumanDuration(humanDuration);
                if (!ret.ok) {
                  reportErrorMsg(ret.error);
                  e.stopPropagation();
                  e.preventDefault();
                  return;
                }

                this.dispatchEvent(
                  new CustomEvent('task-metric-value-change', {
                    bubbles: true,
                    detail: {
                      taskIndex: taskIndex,
                      value: ret.value,
                      name: 'Duration',
                    },
                  })
                );
              }}"
            />
            ${this.optionalCalculateButton(taskIndex)}
          </td>
        </tr>

        ${resourceKeys.map(
          (resourceKey) =>
            html` <tr>
              <td>
                <label for="${resourceKey}">${resourceKey}</label>
              </td>
              <td>
                <select
                  id="${resourceKey}"
                  @change=${async (e: Event) =>
                    this.dispatchEvent(
                      new CustomEvent('task-resource-value-change', {
                        bubbles: true,
                        detail: {
                          taskIndex: taskIndex,
                          value: (e.target as HTMLInputElement).value,
                          name: resourceKey,
                        },
                      })
                    )}
                >
                  ${this.plan.resourceDefinitions[resourceKey].values.map(
                    (resourceValue: string) =>
                      html`<option
                        name=${resourceValue}
                        .selected=${task.resources[resourceKey] ===
                        resourceValue}
                      >
                        ${resourceValue}
                      </option>`
                  )}
                </select>
              </td>
            </tr>`
        )}
        ${metricKeys.map(
          (key: string) =>
            html` <tr>
              <td><label for="${key}">${key}</label></td>
              <td>
                <input
                  id="${key}"
                  .value=${live(task.metrics[key])}
                  type="number"
                  @change=${async (e: Event) =>
                    this.dispatchEvent(
                      new CustomEvent('task-metric-value-change', {
                        bubbles: true,
                        detail: {
                          taskIndex: taskIndex,
                          value: +(e.target as HTMLInputElement).value,
                          name: key,
                        },
                      })
                    )}
                />
              </td>
            </tr>`
        )}
      </table>
    `;
  }

  optionalCalculateButton(taskIndex: number): TemplateResult {
    if (this.plan.status.stage !== 'started') {
      return html``;
    }
    const ret = this.plan.getTaskCompletion(taskIndex);
    if (!ret.ok) {
      return html``;
    }
    if (ret.value.stage !== 'started') {
      return html``;
    }
    return html`
      <button
        class="icon-button"
        @click=${async () => {
          const ret = this.explanMain!.getToday();
          if (!ret.ok) {
            return;
          }

          await executeOp(
            RecalculateDurationOp(ret.value, taskIndex),
            'planDefinitionChanged',
            true,
            this.explanMain!
          );
        }}
        title="Recalculate Duration"
      >
        ${icon('calculate')}
      </button>
    `;
  }

  async editDescription() {
    const task = this.plan.chart.Vertices[this.taskIndex];
    const description = await document
      .querySelector<EditDescriptionDialog>('edit-description-dialog')
      ?.prompt(task.description);
    if (description === null || description === undefined) {
      return;
    }
    await executeOp(
      SetTaskDescriptionOp(this.taskIndex, description),
      'planDefinitionChanged',
      true,
      this.explanMain!
    );
  }
}

customElements.define('selected-task-panel', SelectedTaskPanel);
