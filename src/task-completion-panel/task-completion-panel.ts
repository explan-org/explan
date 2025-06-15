import { TemplateResult, html, render } from 'lit-html';
import {
  TaskCompletion,
  fromJSON,
  toJSON,
} from '../task_completion/task_completion.ts';
import { Span } from '../slack/slack.ts';
import { SetTaskCompletionOp } from '../ops/plan.ts';
import { executeOp } from '../action/execute.ts';
import { ExplanMain } from '../explanMain/explanMain.ts';
import { live } from 'lit-html/directives/live.js';
import { reportErrorMsg, reportIfError } from '../report-error/report-error.ts';
import { CatchupTaskOp } from '../ops/chart.ts';

export class TaskCompletionPanel extends HTMLElement {
  explanMain: ExplanMain | null = null;
  span: Span | null = null;
  taskIndex: number = 0;
  taskCompletion: TaskCompletion | null = null;
  planDefinitionChangedCallback: () => void;

  constructor() {
    super();
    this.planDefinitionChangedCallback = () => {
      this.updateOnInput();
    };
  }

  connectedCallback(): void {
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

  update(explanMain: ExplanMain, taskIndex: number, span: Span) {
    this.explanMain = explanMain;
    this.taskIndex = taskIndex;
    this.span = span;
    this.updateOnInput();
  }

  private updateOnInput() {
    const ret = this.explanMain!.plan!.getTaskCompletion(this.taskIndex);
    if (ret.ok) {
      this.taskCompletion = ret.value;
    }
    render(this.template(), this);
  }

  private template(): TemplateResult {
    if (this.taskCompletion === null) {
      return html``;
    }
    if (this.explanMain!.plan.status.stage === 'unstarted') {
      return html``;
    }
    if (this.taskIndex === -1) {
      return html``;
    }
    switch (this.taskCompletion.stage) {
      case 'unstarted':
        return html`<div>
          <label>
            <input type="checkbox" @change=${() => this.start()} />
            Started
          </label>
        </div>`;
        break;

      case 'started':
        return html`<div>
            <label>
              <input type="checkbox" checked @change=${() => this.unstart()} />
              Started
            </label>

            <date-picker
              .value=${{
                unit: this.explanMain!.plan!.durationUnits,
                dateOffset: this.taskCompletion.start,
              }}
              @date-picker-input=${(e: CustomEvent<number>) =>
                this.startDateChanged(e)}
            ></date-picker>

            <label>
              <input type="checkbox" @change=${() => this.finish()} />
              Finished
            </label>
          </div>
          <div>
            <label>
              <input
                type="number"
                min="1"
                max="99"
                step="1"
                .value=${live(this.taskCompletion.percentComplete)}
                @change=${(e: InputEvent) => this.percentChange(e)}
              />
              % Complete
              <button
                title="Set the completion of the task to match today."
                @click=${async () => {
                  const ret = await this.explanMain!.getToday();
                  if (!ret.ok) {
                    reportErrorMsg(ret.error);
                    return;
                  }
                  const today = ret.value;
                  const res = await executeOp(
                    CatchupTaskOp(today, this.taskIndex, this.span!),
                    'planDefinitionChanged',
                    true,
                    this.explanMain!
                  );
                  reportIfError(res);
                }}
              >
                Catch Up
              </button>
            </label>
          </div>`;
        break;

      case 'finished':
        return html`<div>
          <label>
            <input type="checkbox" checked @change=${() => this.unstart()} />
            Started
          </label>

          <date-picker
            .value=${{
              unit: this.explanMain!.plan!.durationUnits,
              dateOffset: this.taskCompletion.span.start,
            }}
            @date-picker-input=${(e: CustomEvent<number>) =>
              this.startDateChanged(e)}
          ></date-picker>

          <label>
            <input type="checkbox" checked @change=${() => this.unfinish()} />
            Finished
          </label>

          <date-picker
            .value=${{
              unit: this.explanMain!.plan!.durationUnits,
              dateOffset: this.taskCompletion.span.finish,
            }}
            @date-picker-input=${(e: CustomEvent<number>) =>
              this.finishDateChanged(e)}
          ></date-picker>
        </div>`;
        break;

      default:
        // Confirm we've covered all switch statement possibilites.
        this.taskCompletion satisfies never;
        return html``;
        break;
    }
  }

  private async taskCompletionChanged(t: TaskCompletion) {
    const ret = await executeOp(
      SetTaskCompletionOp(this.taskIndex, t),
      'planDefinitionChanged',
      true,
      this.explanMain!
    );
    if (!ret.ok) {
      this.updateOnInput();
      reportErrorMsg(ret.error);
    }
  }

  private async start() {
    this.taskCompletionChanged({
      stage: 'started',
      start: this.span!.start,
      percentComplete: 10,
    });
  }

  private unstart() {
    this.taskCompletionChanged({
      stage: 'unstarted',
    });
  }

  private finish() {
    if (this.taskCompletion!.stage === 'started') {
      this.taskCompletionChanged({
        stage: 'finished',
        // TODO Make sure finish > start.
        // TODO Make finish default to "today"?
        span: new Span(this.taskCompletion!.start, this.span!.finish),
      });
    }
  }

  private unfinish() {
    if (this.taskCompletion!.stage === 'finished') {
      this.taskCompletionChanged({
        stage: 'started',
        // TODO Make sure finish > start.
        // TODO Make finish default to "today"?
        percentComplete: 90,
        start: this.taskCompletion!.span.start,
      });
    }
  }

  private percentChange(e: InputEvent) {
    const dup = fromJSON(toJSON(this.taskCompletion!));
    if (dup.stage === 'started') {
      dup.percentComplete = (e.target as HTMLInputElement).valueAsNumber;
      this.taskCompletionChanged(dup);
    }
  }

  private startDateChanged(e: CustomEvent<number>) {
    const dup = fromJSON(toJSON(this.taskCompletion!));
    if (dup.stage === 'finished') {
      dup.span.start = e.detail;
    } else if (dup.stage === 'started') {
      dup.start = e.detail;
    }
    this.taskCompletionChanged(dup);
  }

  private finishDateChanged(e: CustomEvent<number>) {
    const dup = fromJSON(toJSON(this.taskCompletion!));
    if (dup.stage === 'finished') {
      dup.span.finish = e.detail;
    }
    this.taskCompletionChanged(dup);
  }
}

customElements.define('task-completion-panel', TaskCompletionPanel);
