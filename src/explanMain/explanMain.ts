import { Task } from '../chart/chart.ts';
import { FilterFunc } from '../chart/filter/filter.ts';
import { DirectedEdge, edgesBySrcAndDstToMap } from '../dag/dag.ts';
import { SetMetricValueOp } from '../ops/metrics.ts';
import { SetResourceValueOp } from '../ops/resources.ts';
import { Plan } from '../plan/plan.ts';
import {
  DIVIDER_MOVE_EVENT,
  DividerMove,
  DividerMoveResult,
} from '../renderer/dividermove/dividermove.ts';
import {
  DRAG_RANGE_EVENT,
  DragRange,
  MouseDrag,
} from '../renderer/mousedrag/mousedrag.ts';
import { MouseMove } from '../renderer/mousemove/mousemove.ts';
import { DisplayRange } from '../renderer/range/range.ts';
import {
  RenderOptions,
  RenderResult,
  TaskLabel,
  UpdateHighlightFromMousePos,
  renderTasksToCanvas,
  suggestedCanvasHeight,
} from '../renderer/renderer.ts';
import { pt } from '../point/point.ts';
import { Scale } from '../renderer/scale/scale.ts';
import { error, ok, Result } from '../result.ts';
import { ComputeSlack, CriticalPath, Slack, Span } from '../slack/slack.ts';
import { Theme2 } from '../style/theme/theme.ts';
import { generateStarterPlan } from '../generate/generate.ts';
import { executeByName, executeOp } from '../action/execute.ts';
import { unmapUndoAndRedo, StartKeyboardHandling } from '../keymap/keymap.ts';
import { CatchupOp, RemoveEdgeOp, SetTaskNameOp } from '../ops/chart.ts';
import { DependenciesPanel } from '../dependencies/dependencies-panel.ts';
import { ActionNames } from '../action/registry.ts';
import {
  SelectedTaskPanel,
  TaskMetricValueChangeDetails,
  TaskNameChangeDetails,
  TaskResourceValueChangeDetails,
} from '../selected-task-panel/selected-task-panel.ts';
import {
  reportIfError,
  setErrorMessageReporting,
} from '../report-error/report-error.ts';
import { TaskDuration } from '../types/types.ts';
import { SimulationPanel } from '../simulation-panel/simulation-panel.ts';
import { applyStoredTheme } from '../style/toggler/toggler.ts';
import { EditResourcesPanel } from '../edit-resources-panel/edit-resources-panel.ts';
import { EditMetricsPanel } from '../edit-metrics-panel/edit-metrics-panel.ts';
import { TaskCompletionPanel } from '../task-completion-panel/task-completion-panel.ts';
import { PlanConfigPanel } from '../plan-config-panel/plan-config-panel.ts';
import { GroupByControl } from '../groupby-control/groupby-control.ts';
import {
  addExplanJSONChunkToPNG,
  getExplanJSONChunkFromPNG,
} from '../image/image.ts';
import { PngMetadata } from '../vendor/png-metadata/src/png-metadata.ts';
import { ImageExportPanel } from '../image-export-panel/image-export-panel.ts';

const FONT_SIZE_PX = 32;

const NUM_SIMULATION_LOOPS = 100;

const EXPORT_IMAGE_DEFAULT_PX = 1000;

export class ExplanMain extends HTMLElement {
  /** The Plan being edited. */
  plan: Plan = new Plan();

  /** The start and finish time for each Task in the Plan. */
  spans: Span[] = [];

  /** The task indices of tasks on the critical path. */
  criticalPath: number[] = [];

  /** The selection (in time) of the Plan currently being viewed. */
  displayRange: DisplayRange | null = null;

  /** Scale for the radar view, used for drag selecting a displayRange. */
  radarScale: Scale | null = null;

  /** Which Resource to group by when drawing the chart. */
  groupBySelection: string = '';

  /** The currently selected task, as an index. */
  selectedTask: number = -1;

  // UI features that can be toggled on and off.
  topTimeline: boolean = false;
  criticalPathsOnly: boolean = false;
  focusOnTask: boolean = false;
  mouseMove: MouseMove | null = null;

  dependenciesPanel: DependenciesPanel | null = null;

  downloadLink: HTMLAnchorElement | null = null;

  selectedTaskPanel: SelectedTaskPanel | null = null;

  taskCompletionPanel: TaskCompletionPanel | null = null;

  alternateTaskDurations: number[] | null = null;

  simulationPanel: SimulationPanel | null = null;

  // TODO should be saved in localStorage.
  _imageExportWidthPx: number = EXPORT_IMAGE_DEFAULT_PX;

  _imageExportBackgroundTransparent: boolean = false;

  /** Callback to call when a mouse moves over the chart. */
  updateHighlightFromMousePos: UpdateHighlightFromMousePos | null = null;

  connectedCallback() {
    this.simulationPanel =
      this.querySelector<SimulationPanel>('simulation-panel');
    this.simulationPanel!.addEventListener('simulation-select', (e) => {
      this.alternateTaskDurations = e.detail.durations;
      this.criticalPath = e.detail.criticalPath;
      this.recalculateSpansAndCriticalPath();
      this.paintChart();
    });

    this.downloadLink =
      this.querySelector<HTMLAnchorElement>('#download-link')!;
    this.querySelector('#download-button')!.addEventListener(
      'click',
      async () => await this.prepareDownload()
    );
    this.querySelector('#download-json')!.addEventListener(
      'click',
      async () => await this.prepareJSONDownload()
    );
    this.querySelector('#catchup')!.addEventListener(
      'click',
      async () => await this.catchUp()
    );

    this.dependenciesPanel = this.querySelector('dependencies-panel')!;

    this.dependenciesPanel!.addEventListener('add-dependency', async (e) => {
      let actionName: ActionNames = 'AddPredecessorAction';
      if (e.detail.depType === 'succ') {
        actionName = 'AddSuccessorAction';
      }
      const ret = await executeByName(actionName, this);
      reportIfError(ret);
    });

    this.dependenciesPanel!.addEventListener('delete-dependency', async (e) => {
      let [i, j] = [e.detail.taskIndex, this.selectedTask];
      if (e.detail.depType === 'succ') {
        [i, j] = [j, i];
      }
      const op = RemoveEdgeOp(i, j);
      const ret = await executeOp(op, 'planDefinitionChanged', true, this);
      reportIfError(ret);
    });

    this.selectedTaskPanel = this.querySelector('selected-task-panel')!;
    this.selectedTaskPanel.addEventListener(
      'task-name-change',
      async (e: CustomEvent<TaskNameChangeDetails>) => {
        const op = SetTaskNameOp(e.detail.taskIndex, e.detail.name);
        reportIfError(await executeOp(op, 'planDefinitionChanged', true, this));
      }
    );

    this.selectedTaskPanel.addEventListener(
      'task-resource-value-change',
      async (e: CustomEvent<TaskResourceValueChangeDetails>) => {
        const { name, value, taskIndex } = e.detail;
        const op = SetResourceValueOp(name, value, taskIndex);
        reportIfError(await executeOp(op, 'planDefinitionChanged', true, this));
      }
    );

    this.selectedTaskPanel.addEventListener(
      'task-metric-value-change',
      async (e: CustomEvent<TaskMetricValueChangeDetails>) => {
        const { name, value, taskIndex } = e.detail;
        const op = SetMetricValueOp(name, value, taskIndex);
        reportIfError(await executeOp(op, 'planDefinitionChanged', true, this));
      }
    );

    this.taskCompletionPanel = this.querySelector('task-completion-panel');

    // Dragging on the radar.
    const radar = this.querySelector<HTMLElement>('#radar')!;
    new MouseDrag(radar);
    radar.addEventListener(
      DRAG_RANGE_EVENT,
      this.dragRangeHandler.bind(this) as EventListener
    );

    // Divider dragging.
    const divider = this.querySelector<HTMLElement>('vertical-divider')!;
    new DividerMove(document.body, divider, 'column');

    document.body.addEventListener(DIVIDER_MOVE_EVENT, ((
      e: CustomEvent<DividerMoveResult>
    ) => {
      this.style.setProperty(
        'grid-template-columns',
        `calc(${e.detail.before}% - 15px) 10px auto`
      );
      this.paintChart();
    }) as EventListener);

    // Buttons
    this.querySelector('#dark-mode-toggle')!.addEventListener('click', () => {
      executeByName('ToggleDarkModeAction', this);
    });
    applyStoredTheme();

    this.querySelector<HTMLInputElement>('#radar-toggle')!.addEventListener(
      'input',
      (e: Event) => {
        this.setRadar((e.target as HTMLInputElement).checked);
      }
    );

    this.querySelector<HTMLInputElement>(
      '#critical-paths-toggle'
    )!.addEventListener('input', (e: Event) => {
      this.criticalPathsOnly = (e.target as HTMLInputElement).checked;
      this.paintChart();
    });

    const overlayCanvas = this.querySelector<HTMLCanvasElement>('#overlay')!;
    this.mouseMove = new MouseMove(overlayCanvas);
    window.requestAnimationFrame(this.onMouseMove.bind(this));

    overlayCanvas.addEventListener('mousedown', (e: MouseEvent) => {
      const p = pt(e.offsetX, e.offsetY);
      if (this.updateHighlightFromMousePos !== null) {
        this.setSelection(
          this.updateHighlightFromMousePos(p, 'mousedown') || -1,
          false
        );
      }
    });

    overlayCanvas.addEventListener('dblclick', (e: MouseEvent) => {
      const p = pt(e.offsetX, e.offsetY);
      if (this.updateHighlightFromMousePos !== null) {
        const taskIndex =
          this.updateHighlightFromMousePos(p, 'mousedown') || -1;
        if (taskIndex === -1) {
          executeByName('ResetZoomAction', this);
        }
        this.setSelection(taskIndex, true, true);
      }
    });

    // React to the upload input.
    const fileUpload =
      document.querySelector<HTMLInputElement>('#file-upload')!;
    fileUpload.addEventListener('change', async () => {
      const blob = fileUpload.files![0];
      const bytes = await blob.arrayBuffer();
      const ret = await this.fromUint8Array(new Uint8Array(bytes));
      reportIfError(ret);
    });

    this.querySelector('#simulate')!.addEventListener('click', () => {
      this.recalculateSpansAndCriticalPath();

      // Build a set of tasks that are finished.
      const finishedTasks: Set<number> = new Set();
      this.plan.chart.Vertices.filter((task: Task, index: number) => {
        if (this.plan.taskCompletion[task.id]?.stage === 'finished') {
          finishedTasks.add(index);
        }
      });
      this.criticalPath = this.simulationPanel!.simulate(
        this.plan,
        NUM_SIMULATION_LOOPS,
        this.criticalPath,
        finishedTasks
      );
      this.paintChart();
    });

    this.querySelector<EditResourcesPanel>('edit-resources-panel')!.setConfig(
      this
    );

    this.querySelector<PlanConfigPanel>('plan-config-panel')!.setConfig(this);

    this.querySelector<EditMetricsPanel>('edit-metrics-panel')!.setConfig(this);

    this.querySelector<ImageExportPanel>('image-export-panel')!.setConfig(this);

    const goupByControl =
      this.querySelector<GroupByControl>('groupby-control')!;
    goupByControl.setConfig(this);
    goupByControl.addEventListener(
      'group-by-resource-changed',
      (e: CustomEvent<string>) => {
        this.groupBySelection = e.detail;
        this.planDefinitionHasBeenChanged();
      }
    );

    this.plan = generateStarterPlan();
    this.updateTaskPanels(this.selectedTask);
    this.planDefinitionHasBeenChanged();

    window.addEventListener('resize', () => this.paintChart());
    StartKeyboardHandling(this);

    console.log('Finished Init');
    document.dispatchEvent(new CustomEvent('finished-init'));
  }

  /** @prop  {string}  */
  get imageExportWidthPx(): number {
    const widthAsString =
      window.localStorage.getItem('imageExportWidthPx') || '';
    if (widthAsString === '') {
      return EXPORT_IMAGE_DEFAULT_PX;
    }
    return +widthAsString;
  }

  set imageExportWidthPx(val: number) {
    window.localStorage.setItem('imageExportWidthPx', val.toString());
  }

  public get imageExportBackgroundTransparent(): boolean {
    const bAsString =
      window.localStorage.getItem('imageExportBackgroundTransparent') || '';
    return bAsString === 'true';
  }

  public set imageExportBackgroundTransparent(v: boolean) {
    window.localStorage.setItem(
      'imageExportBackgroundTransparent',
      v.toString()
    );
  }

  toggleTopTimeline() {
    this.topTimeline = !this.topTimeline;
    this.paintChart();
  }

  async prepareDownload() {
    //  const downloadBlob = new Blob([JSON.stringify(this.plan, null, '  ')], {
    //    type: 'application/json',
    //  });
    const ret = await this.toPNG();
    if (!ret.ok) {
      reportIfError(ret);
      return;
    }
    const downloadBlob = ret.value;
    this.downloadLink!.href = URL.createObjectURL(downloadBlob);
    this.downloadLink!.download = 'plan.png';
    this.downloadLink!.click();
  }

  async catchUp() {
    const dayRet = this.getToday();
    if (!dayRet.ok) {
      reportIfError(dayRet);
      return;
    }

    const ret = await executeOp(
      CatchupOp(dayRet.value, this.spans),
      'planDefinitionChanged',
      true,
      this
    );
    reportIfError(ret);
  }

  async prepareJSONDownload() {
    const downloadBlob = new Blob([JSON.stringify(this.plan, null, '  ')], {
      type: 'application/json',
    });
    this.downloadLink!.href = URL.createObjectURL(downloadBlob);
    this.downloadLink!.download = 'plan.json';
    this.downloadLink!.click();
  }

  async undo(): Promise<void> {
    const res = await executeByName('UndoAction', this);
    reportIfError(res);
  }

  async redo(): Promise<void> {
    const res = await executeByName('RedoAction', this);
    reportIfError(res);
  }

  // Call this if explanMain is embedded in another context.
  embedded(): void {
    // Disable the key bindings for undo and redo.
    unmapUndoAndRedo();

    // Hide controls that don't make sense when embedded.
    document.querySelector('#download-controls')!.classList.add('hidden');
    document.querySelector('#upload')!.classList.add('hidden');

    // Pass up error messages to be reported instead of displaying locally.
    setErrorMessageReporting('DocumentEvent');
  }

  toJSON(): string {
    return JSON.stringify(this.plan, null, '  ');
  }

  fromJSON(json: string): Result<null> {
    const ret = Plan.FromJSONText(json);
    if (!ret.ok) {
      return ret;
    }
    this.plan = ret.value;
    this.planDefinitionHasBeenChanged();
    return ok(null);
  }

  async fromUint8Array(bytes: Uint8Array): Promise<Result<null>> {
    let json: string = '';
    if (PngMetadata.isPNG(bytes)) {
      const ret = await getExplanJSONChunkFromPNG(new Uint8Array(bytes));
      if (!ret.ok) {
        return ret;
      }
      json = ret.value;
    } else {
      json = new TextDecoder('utf-8').decode(bytes);
    }
    const ret = this.fromJSON(json);
    if (!ret.ok) {
      return ret;
    }
    return ok(null);
  }

  async toUnit8Array(contentType: string): Promise<Result<Uint8Array>> {
    if (contentType === 'image/png') {
      const ret = await this.toPNG();
      if (!ret.ok) {
        return ret;
      }
      return ok(new Uint8Array(await ret.value.arrayBuffer()));
    }
    return ok(new TextEncoder().encode(this.toJSON()));
  }

  async toPNG(): Promise<Result<Blob>> {
    // First render the current plan to a canvas with the given render options.
    const ret = await this.renderChartToPNG();
    if (!ret.ok) {
      return ret;
    }

    // Attach JSON to PNG and return updated PNG as Blob.
    return ok(await addExplanJSONChunkToPNG(this.toJSON(), ret.value));
  }

  private async renderChartToPNG(): Promise<Result<Blob>> {
    const canvas = document.createElement('canvas');
    canvas.width = this.imageExportWidthPx;

    const theme2 = new Theme2();
    theme2.loadFromElement(document.body);
    if (this.imageExportBackgroundTransparent) {
      theme2.values.set('background', 'rgba(0,0,0,0)');
    }

    const durationDisplay = (t: number) =>
      this.plan.durationUnits.displayTime(t);

    const taskIsStarted = (taskIndex: number) => {
      const ret = this.plan.getTaskCompletion(taskIndex);
      if (!ret.ok) {
        return false;
      }
      return ret.value.stage !== 'unstarted';
    };

    const opts: RenderOptions = {
      fontSizePx: 16,
      hasText: true,
      displayRange: null,
      displayRangeUsage: 'restrict',
      colors: theme2,
      hasTimeline: true,
      hasTasks: true,
      hasEdges: true,
      drawTimeMarkersOnTasks: true,
      taskLabel: this.getTaskLabeller(),
      taskDuration: this.getTaskDurationFunc(),
      taskEmphasize: this.criticalPath,
      filterFunc: null,
      groupByResource: '',
      highlightedTask: null,
      selectedTaskIndex: -1,
      durationDisplay: durationDisplay,
      taskIsStarted: taskIsStarted,
      today: -1,
    };

    const newHeight = suggestedCanvasHeight(
      canvas,
      this.spans,
      opts,
      this.plan.chart.Vertices.length + 2 // TODO - Why do we need the +2 here!?
    );
    canvas.height = newHeight;
    const ctx = canvas.getContext('2d')!;
    const ret = renderTasksToCanvas(
      null,
      canvas,
      ctx,
      this.plan,
      this.spans,
      opts,
      null
    );
    if (!ret.ok) {
      return error(ret.error);
    }
    let resolveOutside: (value: Blob | PromiseLike<Blob>) => void;
    let rejectOutside: () => void;
    const p = new Promise<Blob>((resolve, reject) => {
      resolveOutside = resolve;
      rejectOutside = reject;
    });
    canvas.toBlob((blob: Blob | null) => {
      if (blob === null) {
        rejectOutside();
      } else {
        resolveOutside(blob);
      }
    }, 'image/png');
    return ok(await p);
  }

  updateTaskPanels(taskIndex: number) {
    this.selectedTask = taskIndex;
    this.selectedTaskPanel!.updateSelectedTaskPanel(this, this.selectedTask);
    this.taskCompletionPanel!.update(
      this,
      this.selectedTask,
      this.spans[this.selectedTask]
    );
    const edges = edgesBySrcAndDstToMap(this.plan.chart.Edges);
    this.dependenciesPanel!.setTasksAndIndices(
      this.plan.chart.Vertices,
      (edges.byDst.get(taskIndex) || [])
        .map((e: DirectedEdge) => e.i)
        .reverse(),
      (edges.bySrc.get(taskIndex) || []).map((e: DirectedEdge) => e.j).reverse()
    );
    this.dependenciesPanel!.classList.toggle(
      'hidden',
      this.selectedTask === -1
    );
  }

  setSelection(
    index: number,
    focus: boolean,
    scrollToSelected: boolean = false
  ) {
    this.selectedTask = index;
    if (focus) {
      this.forceFocusOnTask();
    }
    if (this.selectedTask === -1) {
      this.focusOnTask = false;
    }
    this.paintChart(scrollToSelected);
    this.updateTaskPanels(this.selectedTask);
  }

  // TODO - Turn this on and off based on mouse entering the canvas area.
  onMouseMove() {
    const location = this.mouseMove!.readLocation();
    if (location !== null && this.updateHighlightFromMousePos !== null) {
      this.updateHighlightFromMousePos(location, 'mousemove');
    }
    window.requestAnimationFrame(this.onMouseMove.bind(this));
  }

  planDefinitionHasBeenChanged() {
    this.radarScale = null;
    this.displayRange = null;
    this.alternateTaskDurations = null;
    this.recalculateSpansAndCriticalPath();
    this.paintChart();
    this.querySelector('#catchup')!.classList.toggle(
      'hidden',
      this.plan.status.stage !== 'started'
    );
    document.dispatchEvent(new CustomEvent('plan-definition-changed'));
  }

  getTaskDurationFunc(): TaskDuration {
    if (this.alternateTaskDurations !== null) {
      return (taskIndex: number) => this.alternateTaskDurations![taskIndex];
    } else {
      return (taskIndex: number) =>
        this.plan.chart.Vertices[taskIndex].duration;
    }
  }

  recalculateSpansAndCriticalPath() {
    let slacks: Slack[] = [];

    const rounder = this.plan
      .getStaticMetricDefinition('Duration')
      .precision.rounder();

    const earlyStartOverride = (taskIndex: number): number | undefined => {
      const ret = this.plan.getTaskCompletion(taskIndex);
      if (!ret.ok) {
        return undefined;
      }
      const completion = ret.value;
      switch (completion.stage) {
        case 'unstarted':
          return undefined;
          break;
        case 'started':
          return completion.start;
          break;
        case 'finished':
          return completion.span.start;
          break;
        default:
          completion satisfies never;
          break;
      }
    };

    const earlyFinishOverride = (taskIndex: number): number | undefined => {
      const ret = this.plan.getTaskCompletion(taskIndex);
      if (!ret.ok) {
        return undefined;
      }
      const completion = ret.value;
      switch (completion.stage) {
        case 'unstarted':
          return undefined;
          break;
        case 'started':
          return undefined;
          break;
        case 'finished':
          return completion.span.finish;
          break;
        default:
          completion satisfies never;
          break;
      }
    };

    const slackResult = ComputeSlack(
      this.plan.chart,
      this.getTaskDurationFunc(),
      rounder,
      earlyStartOverride,
      earlyFinishOverride
    );
    if (!slackResult.ok) {
      console.error(slackResult);
    } else {
      slacks = slackResult.value;
    }

    this.spans = slacks.map((value: Slack): Span => {
      return value.early;
    });
    this.criticalPath = CriticalPath(slacks, rounder);
    this.updateTaskPanels(this.selectedTask);
  }

  getTaskLabeller(): TaskLabel {
    return (taskIndex: number): string =>
      `${this.plan.chart.Vertices[taskIndex].name}`;
  }

  dragRangeHandler(e: CustomEvent<DragRange>) {
    if (this.radarScale === null) {
      return;
    }
    const begin = this.radarScale.dayRowFromPoint(e.detail.begin);
    const end = this.radarScale.dayRowFromPoint(e.detail.end);
    this.displayRange = new DisplayRange(begin.day, end.day);
    this.paintChart();
  }

  toggleRadar() {
    this.querySelector('radar-parent')!.classList.toggle('hidden');
  }

  setRadar(on: boolean) {
    this.querySelector('radar-parent')!.classList.toggle('hidden', !on);
  }

  toggleCriticalPathsOnly() {
    this.criticalPathsOnly = !this.criticalPathsOnly;
  }

  forceFocusOnTask() {
    this.focusOnTask = true;
  }

  getToday(): Result<number> {
    if (this.plan.status.stage !== 'started') {
      return error(new Error('Plan is not started.'));
    }
    if (this.plan.durationUnits.kind() == 'Unitless') {
      return error(new Error('Unitless plans have no start date.'));
    }
    return this.plan.durationUnits.dateStringToDuration(
      new Date().toISOString().slice(0, 10)
    );
  }

  paintChart(scrollToSelected: boolean = false) {
    // console.time('paintChart');

    const theme2 = new Theme2();
    theme2.loadFromElement(document.body);

    let filterFunc: FilterFunc | null = null;
    const startAndFinish = [0, this.plan.chart.Vertices.length - 1];
    if (this.criticalPathsOnly) {
      const highlightSet = new Set(this.criticalPath);
      filterFunc = (task: Task, taskIndex: number): boolean => {
        if (startAndFinish.includes(taskIndex)) {
          return true;
        }
        return highlightSet.has(taskIndex);
      };
    } else if (this.focusOnTask && this.selectedTask != -1) {
      // Find all predecessor and successors of the given task.
      const neighborSet = new Set();
      neighborSet.add(this.selectedTask);
      let earliestStart = this.spans[this.selectedTask].start;
      let latestFinish = this.spans[this.selectedTask].finish;
      this.plan.chart.Edges.forEach((edge: DirectedEdge) => {
        if (edge.i === this.selectedTask) {
          neighborSet.add(edge.j);
          if (latestFinish < this.spans[edge.j].finish) {
            latestFinish = this.spans[edge.j].finish;
          }
        }
        if (edge.j === this.selectedTask) {
          neighborSet.add(edge.i);
          if (earliestStart > this.spans[edge.i].start) {
            earliestStart = this.spans[edge.i].start;
          }
        }
      });
      // TODO - Since we overwrite displayRange that means dragging on the radar
      // will not work when focusing on a selected task. Bug or feature?
      this.displayRange = new DisplayRange(earliestStart - 1, latestFinish + 1);

      filterFunc = (_task: Task, taskIndex: number): boolean => {
        if (startAndFinish.includes(taskIndex)) {
          return true;
        }

        return neighborSet.has(taskIndex);
      };
    }

    const durationDisplay = (t: number) =>
      this.plan.durationUnits.displayTime(t);

    const taskIsStarted = (taskIndex: number) => {
      const ret = this.plan.getTaskCompletion(taskIndex);
      if (!ret.ok) {
        return false;
      }
      return ret.value.stage !== 'unstarted';
    };

    let today: number = -1;
    const dayRet = this.getToday();
    if (dayRet.ok) {
      today = dayRet.value;
    }

    const radarOpts: RenderOptions = {
      fontSizePx: 6,
      hasText: false,
      displayRange: this.displayRange,
      displayRangeUsage: 'highlight',
      colors: theme2,
      hasTimeline: false,
      hasTasks: true,
      hasEdges: false,
      drawTimeMarkersOnTasks: false,
      taskLabel: this.getTaskLabeller(),
      taskDuration: this.getTaskDurationFunc(),
      taskEmphasize: this.criticalPath,
      filterFunc: null,
      groupByResource: this.groupBySelection,
      highlightedTask: null,
      selectedTaskIndex: this.selectedTask,
      durationDisplay: durationDisplay,
      taskIsStarted: taskIsStarted,
      today: today,
    };

    const zoomOpts: RenderOptions = {
      fontSizePx: theme2.fontSize(),
      hasText: true,
      displayRange: this.displayRange,
      displayRangeUsage: 'restrict',
      colors: theme2,
      hasTimeline: this.topTimeline,
      hasTasks: true,
      hasEdges: true,
      drawTimeMarkersOnTasks: true,
      taskLabel: this.getTaskLabeller(),
      taskDuration: this.getTaskDurationFunc(),
      taskEmphasize: this.criticalPath,
      filterFunc: filterFunc,
      groupByResource: this.groupBySelection,
      highlightedTask: 1,
      selectedTaskIndex: this.selectedTask,
      durationDisplay: durationDisplay,
      taskIsStarted: taskIsStarted,
      today: today,
    };

    const timelineOpts: RenderOptions = {
      fontSizePx: theme2.fontSize(),
      hasText: true,
      displayRange: this.displayRange,
      displayRangeUsage: 'restrict',
      colors: theme2,
      hasTimeline: true,
      hasTasks: false,
      hasEdges: true,
      drawTimeMarkersOnTasks: true,
      taskLabel: this.getTaskLabeller(),
      taskDuration: this.getTaskDurationFunc(),
      taskEmphasize: this.criticalPath,
      filterFunc: filterFunc,
      groupByResource: this.groupBySelection,
      highlightedTask: null,
      selectedTaskIndex: this.selectedTask,
      durationDisplay: durationDisplay,
      taskIsStarted: taskIsStarted,
      today: today,
    };

    const ret = this.paintOneChart('#radar', radarOpts);
    if (!ret.ok) {
      return;
    }
    this.radarScale = ret.value.scale;

    this.paintOneChart('#timeline', timelineOpts);
    const zoomRet = this.paintOneChart('#zoomed', zoomOpts, '#overlay');
    if (zoomRet.ok) {
      this.updateHighlightFromMousePos =
        zoomRet.value.updateHighlightFromMousePos;
      if (zoomRet.value.selectedTaskLocation !== null && scrollToSelected) {
        let top = 0;
        if (!this.focusOnTask) {
          top = zoomRet.value.selectedTaskLocation.y;
        }
        document.querySelector('chart-parent')!.scrollTo({
          top: top,
          left: 0,
          behavior: 'smooth',
        });
      }
    }

    // console.timeEnd('paintChart');
  }

  prepareCanvas(
    canvas: HTMLCanvasElement,
    canvasWidth: number,
    canvasHeight: number,
    width: number,
    height: number
  ): CanvasRenderingContext2D {
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    return ctx;
  }

  paintOneChart(
    canvasID: string,
    opts: RenderOptions,
    overlayID: string = ''
  ): Result<RenderResult> {
    const canvas = this.querySelector<HTMLCanvasElement>(canvasID)!;
    const parent = canvas!.parentElement!;
    const ratio = window.devicePixelRatio;
    const width = parent.clientWidth - FONT_SIZE_PX;
    let height = parent.clientHeight;
    const canvasWidth = Math.ceil(width * ratio);
    let canvasHeight = Math.ceil(height * ratio);

    const newHeight = suggestedCanvasHeight(
      canvas,
      this.spans,
      opts,
      this.plan.chart.Vertices.length + 2 // TODO - Why do we need the +2 here!?
    );
    canvasHeight = newHeight;
    height = newHeight / window.devicePixelRatio;

    let overlay: HTMLCanvasElement | null = null;
    if (overlayID) {
      overlay = document.querySelector<HTMLCanvasElement>(overlayID)!;
      this.prepareCanvas(overlay, canvasWidth, canvasHeight, width, height);
    }
    const ctx = this.prepareCanvas(
      canvas,
      canvasWidth,
      canvasHeight,
      width,
      height
    );

    return renderTasksToCanvas(
      parent,
      canvas,
      ctx,
      this.plan,
      this.spans,
      opts,
      overlay
    );
  }
}

customElements.define('explan-main', ExplanMain);
