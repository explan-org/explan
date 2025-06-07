import { TemplateResult, html, render } from 'lit-html';
import {
  CriticalPathTaskEntry,
  SimulationResults,
  simulation,
} from '../simulation/simulation';
import { Chart } from '../chart/chart';
import { difference } from '../dag/algorithms/circular';
import { Plan } from '../plan/plan';
import { reportErrorMsg } from '../report-error/report-error';

export interface SimulationSelectDetails {
  durations: number[] | null;
  criticalPath: number[];
}

declare global {
  interface GlobalEventHandlersEventMap {
    'simulation-select': CustomEvent<SimulationSelectDetails>;
  }
}

export class SimulationPanel extends HTMLElement {
  results: SimulationResults = {
    paths: new Map(),
    tasks: [],
  };
  plan: Plan | null = null;
  chart: Chart | null = null;
  numSimulationLoops: number = 0;
  originalCriticalPath: number[] = [];

  connectedCallback(): void {
    this.render();
  }

  simulate(
    plan: Plan,
    numSimulationLoops: number,
    originalCriticalPath: number[],
    finishedTasks: Set<number>
  ): number[] {
    this.plan = plan;
    this.chart = plan.chart;
    this.results = simulation(
      this.chart,
      numSimulationLoops,
      originalCriticalPath,
      finishedTasks
    );
    this.numSimulationLoops = numSimulationLoops;
    this.originalCriticalPath = originalCriticalPath;

    this.render();
    return this.results.tasks.map(
      (taskEntry: CriticalPathTaskEntry) => taskEntry.taskIndex
    );
  }

  clear() {
    this.results = {
      paths: new Map(),
      tasks: [],
    };
    this.dispatchEvent(
      new CustomEvent<SimulationSelectDetails>('simulation-select', {
        bubbles: true,
        detail: {
          durations: null,
          criticalPath: [],
        },
      })
    );
    this.render();
  }

  pathClicked(key: string) {
    this.dispatchEvent(
      new CustomEvent<SimulationSelectDetails>('simulation-select', {
        bubbles: true,
        detail: {
          durations: this.results.paths.get(key)!.durations,
          criticalPath: this.results.paths.get(key)!.criticalPath,
        },
      })
    );
  }

  render() {
    render(this.template(), this);
  }

  displayCriticalPathDifferences(criticalPath: number[]): TemplateResult {
    const removed = difference(this.originalCriticalPath, criticalPath);
    const added = difference(criticalPath, this.originalCriticalPath);
    if (removed.length === 0 && added.length === 0) {
      return html`Original Critical Path`;
    }
    return html`
      ${added.map(
        (taskIndex: number) => html`
          <span class="added">+${this.chart!.Vertices[taskIndex].name}</span>
        `
      )}
      ${removed.map(
        (taskIndex: number) => html`
          <span class="removed">-${this.chart!.Vertices[taskIndex].name}</span>
        `
      )}
    `;
  }

  humanDurationValue(duration: number): string {
    const ret = this.plan!.durationUnits.durationToHuman(duration);
    if (!ret.ok) {
      reportErrorMsg(ret.error);
      return '';
    }
    return ret.value;
  }

  template(): TemplateResult {
    if (this.results.paths.size === 0) {
      return html``;
    }
    const pathKeys = [...this.results.paths.keys()];
    const sortedPathKeys = pathKeys.sort((a: string, b: string) => {
      return (
        this.results.paths.get(b)!.count - this.results.paths.get(a)!.count
      );
    });
    return html`
      <button
        @click=${() => {
          this.clear();
        }}
      >
        Clear
      </button>

      <table class="paths">
        <tr>
          <th>Count</th>
          <th>Critical Path</th>
        </tr>
        ${sortedPathKeys.map(
          (key: string) =>
            html`<tr @click=${() => this.pathClicked(key)}>
              <td>${this.results.paths.get(key)!.count}</td>
              <td>
                ${this.displayCriticalPathDifferences(
                  this.results.paths.get(key)!.criticalPath
                )}
              </td>
            </tr>`
        )}
      </table>
      <table>
        <tr>
          <th>Name</th>
          <th>Duration</th>
          <th>Frequency (%)</th>
        </tr>
        ${this.results.tasks.map(
          (taskEntry: CriticalPathTaskEntry) =>
            html`<tr>
              <td>${this.chart!.Vertices[taskEntry.taskIndex].name}</td>
              <td>${this.humanDurationValue(taskEntry.duration)}</td>
              <td>
                ${Math.floor(
                  (100 * taskEntry.numTimesAppeared) / this.numSimulationLoops
                )}
              </td>
            </tr>`
        )}
      </table>
    `;
  }
}

customElements.define('simulation-panel', SimulationPanel);
