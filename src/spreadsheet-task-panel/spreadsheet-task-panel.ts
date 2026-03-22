import { TemplateResult, html, render } from 'lit-html';
import { live } from 'lit-html/directives/live.js';
import { ExplanMain } from '../explanMain/explanMain';
import { Task } from '../chart/chart';
import { reportErrorMsg } from '../report-error/report-error';
import {
  TaskMetricValueChangeDetails,
  TaskNameChangeDetails,
  TaskResourceValueChangeDetails,
} from '../selected-task-panel/selected-task-panel';

export class SpreadsheetTaskPanel extends HTMLElement {
  explanMain: ExplanMain | null = null;
  planDefinitionChangedCallback: () => void;

  constructor() {
    super();
    this.planDefinitionChangedCallback = () => this.render();
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

  setConfig(explanMain: ExplanMain) {
    this.explanMain = explanMain;
    this.render();
  }

  render() {
    render(this.template(), this);
  }

  humanDurationValue(task: Task): string {
    if (this.explanMain === null) return '';
    const ret =
      this.explanMain.plan.durationUnits.durationToHuman(task.duration);
    if (!ret.ok) {
      reportErrorMsg(ret.error);
      return '';
    }
    return ret.value;
  }

  template(): TemplateResult {
    if (this.explanMain === null) {
      return html`<p>Loading...</p>`;
    }

    const plan = this.explanMain.plan;
    const tasks = plan.chart.Vertices;

    const metricKeys = Object.keys(plan.metricDefinitions)
      .filter((key) => plan.metricDefinitions[key].hideEditor === false)
      .sort();

    const resourceKeys = Object.keys(plan.resourceDefinitions).sort();

    return html`
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Duration</th>
            ${resourceKeys.map((k) => html`<th>${k}</th>`)}
            ${metricKeys.map((k) => html`<th>${k}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${tasks.map(
            (task: Task, taskIndex: number) => html`
              <tr>
                <td>${taskIndex}</td>
                <td>
                  <input
                    type="text"
                    .value=${live(task.name)}
                    @change=${(e: Event) =>
                      this.dispatchEvent(
                        new CustomEvent<TaskNameChangeDetails>(
                          'task-name-change',
                          {
                            bubbles: true,
                            detail: {
                              taskIndex,
                              name: (e.target as HTMLInputElement).value,
                            },
                          }
                        )
                      )}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    spellcheck="false"
                    .value=${live(this.humanDurationValue(task))}
                    @change=${(e: Event) => {
                      const humanDuration = (e.target as HTMLInputElement)
                        .value;
                      const ret =
                        plan.durationUnits.parseHumanDuration(humanDuration);
                      if (!ret.ok) {
                        reportErrorMsg(ret.error);
                        return;
                      }
                      this.dispatchEvent(
                        new CustomEvent<TaskMetricValueChangeDetails>(
                          'task-metric-value-change',
                          {
                            bubbles: true,
                            detail: {
                              taskIndex,
                              value: ret.value,
                              name: 'Duration',
                            },
                          }
                        )
                      );
                    }}
                  />
                </td>
                ${resourceKeys.map(
                  (resourceKey) => html`
                    <td>
                      <select
                        @change=${(e: Event) =>
                          this.dispatchEvent(
                            new CustomEvent<TaskResourceValueChangeDetails>(
                              'task-resource-value-change',
                              {
                                bubbles: true,
                                detail: {
                                  taskIndex,
                                  value: (e.target as HTMLInputElement).value,
                                  name: resourceKey,
                                },
                              }
                            )
                          )}
                      >
                        ${plan.resourceDefinitions[resourceKey].values.map(
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
                  `
                )}
                ${metricKeys.map(
                  (key) => html`
                    <td>
                      <input
                        type="number"
                        .value=${live(task.metrics[key])}
                        @change=${(e: Event) =>
                          this.dispatchEvent(
                            new CustomEvent<TaskMetricValueChangeDetails>(
                              'task-metric-value-change',
                              {
                                bubbles: true,
                                detail: {
                                  taskIndex,
                                  value: +(e.target as HTMLInputElement).value,
                                  name: key,
                                },
                              }
                            )
                          )}
                      />
                    </td>
                  `
                )}
              </tr>
            `
          )}
        </tbody>
      </table>
    `;
  }
}

customElements.define('spreadsheet-task-panel', SpreadsheetTaskPanel);
