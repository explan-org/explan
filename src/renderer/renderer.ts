import { ChartValidate, Task } from '../chart/chart.ts';
import { ChartLike, filter, FilterFunc } from '../chart/filter/filter.ts';
import { DirectedEdge, VertexIndices } from '../dag/dag.ts';
import { Plan } from '../plan/plan.ts';
import { ResourceDefinition } from '../resources/resources.ts';
import { Result, ok } from '../result.ts';
import { Span } from '../slack/slack.ts';
import { TaskDuration } from '../types/types.ts';
import { Rect } from '../rect/rect.ts';
import { DisplayRange } from './range/range.ts';
import { Point, difference, pt } from '../point/point.ts';
import { Feature, Metric, Scale } from './scale/scale.ts';
import { HitRect } from '../hitrect/hitrect.ts';
import { Theme2 } from '../style/theme/theme.ts';

type Direction = 'up' | 'down';

export type TaskIndexToRow = Map<number, number>;

/** Function use to produce a text label for a task and its slack. */
export type TaskLabel = (taskIndex: number) => string;

/** Controls of the displayRange in RenderOptions is used.
 *
 *  "restrict": Only display the parts of the chart that appear in the range.
 *
 *  "highlight": Display the full range of the data, but highlight the range.
 */
export type DisplayRangeUsage = 'restrict' | 'highlight';

export const defaultTaskLabel: TaskLabel = (taskIndex: number): string =>
  taskIndex.toFixed(0);

export interface RenderOptions {
  /** The text font size, this drives the size of all other chart features.
   * */
  fontSizePx: number;

  /** Display text if true. */
  hasText: boolean;

  /** If supplied then only the tasks in the given range will be displayed. */
  displayRange: DisplayRange | null;

  /** Controls how the `displayRange` is used if supplied. */
  displayRangeUsage: DisplayRangeUsage;

  /** The color theme. */
  colors: Theme2;

  /** If true then display times at the top of the chart. */
  hasTimeline: boolean;

  /** If true then display the task bars. */
  hasTasks: boolean;

  /** If true then draw vertical lines from the timeline down to task start and
   * finish points. */
  drawTimeMarkersOnTasks: boolean;

  /** Draw dependency edges between tasks if true. */
  hasEdges: boolean;

  /** Function that produces display text for a Task and its associated Slack. */
  taskLabel: TaskLabel;

  /** Returns the duration for a given task. */
  taskDuration: TaskDuration;

  /** The indices of tasks that should be emphasized when draw, typically used
   * to denote the critical path. */
  taskEmphasize: number[];

  /** Filter the Tasks to be displayed. */
  filterFunc: FilterFunc | null;

  /** Group the tasks together vertically based on the given resource. If the
   * empty string is supplied then just display by topological order.
   */
  groupByResource: string;

  /** Task to highlight. */
  highlightedTask: null | number;

  /** The index of the selected task, or -1 if no task is selected. This is
   * always an index into the original chart, and not an index into a filtered
   * chart.
   */
  selectedTaskIndex: number;

  /** Converts the times in a chart into a displayable string. */
  durationDisplay: (d: number) => string;

  /** Returns true if the given task has been started. */
  taskIsStarted: (taskIndex: number) => boolean;

  /** The offset from the start of the project to today. */
  today: number;
}

const verticalArrowStartFeatureFromTaskDuration = (
  task: Task,
  direction: Direction
): keyof typeof Feature => {
  if (task.duration === 0) {
    if (direction === 'down') {
      return Feature.verticalArrowStartFromMilestoneBottom;
    }
    return Feature.verticalArrowStartFromMilestoneTop;
  } else {
    return Feature.verticalArrowStart;
  }
};

const verticalArrowDestFeatureFromTaskDuration = (
  task: Task,
  direction: Direction
): keyof typeof Feature => {
  if (task.duration === 0) {
    if (direction === 'down') {
      return Feature.verticalArrowDestToMilestoneTop;
    }
    return Feature.verticalArrowDestToMilestoneBottom;
  } else {
    if (direction === 'down') {
      return Feature.verticalArrowDestTop;
    }
    return Feature.verticalArrowDestBottom;
  }
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const horizontalArrowStartFeatureFromTaskDuration = (
  task: Task
): keyof typeof Feature => {
  if (task.duration === 0) {
    return Feature.horizontalArrowStartFromMilestone;
  } else {
    return Feature.horizontalArrowStart;
  }
};

const horizontalArrowDestFeatureFromTaskDuration = (
  task: Task
): keyof typeof Feature => {
  if (task.duration === 0) {
    return Feature.horizontalArrowDestToMilestone;
  } else {
    return Feature.horizontalArrowDest;
  }
};

/**
 * Compute what the height of the canvas should be. Note that the value doesn't
 * know about `window.devicePixelRatio`, so if the canvas is already scaled by
 * `window.devicePixelRatio` then so will the result of this function.
 */
export function suggestedCanvasHeight(
  canvas: HTMLCanvasElement,
  spans: Span[],
  opts: RenderOptions,
  maxRows: number
): number {
  if (!opts.hasTasks) {
    maxRows = 0;
  }
  return new Scale(
    opts,
    canvas.width,
    spans[spans.length - 1].finish + 1
  ).height(maxRows);
}

// The location, in canvas pixel coordinates, of each task bar. Should use the
// text of the task label as the location, since that's always drawn in the view
// if possible.
export interface TaskLocation {
  x: number;
  y: number;

  // That index of the task in the unfiltered Chart.
  originalTaskIndex: number;
}

type UpdateType = 'mousemove' | 'mousedown';

// A func that takes a Point and redraws the highlighted task if needed, returns
// the index of the task that is highlighted.
export type UpdateHighlightFromMousePos = (
  point: Point,
  updateType: UpdateType
) => number | null;

export interface RenderResult {
  scale: Scale;
  updateHighlightFromMousePos: UpdateHighlightFromMousePos | null;
  selectedTaskLocation: Point | null;
}

// A span on the x-axis.
type xRange = [number, number];

// TODO - Pass in max rows, and a mapping that maps from taskIndex to row,
// because two different tasks might be placed on the same row. Also we should
// pass in max rows? Or should that come from the above mapping?
export function renderTasksToCanvas(
  parent: HTMLElement | null,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  plan: Plan,
  spans: Span[],
  opts: RenderOptions,
  overlay: HTMLCanvasElement | null = null
): Result<RenderResult> {
  const vret = ChartValidate(plan.chart);
  if (!vret.ok) {
    return vret;
  }

  const originalLabels = plan.chart.Vertices.map(
    (task: Task, taskIndex: number) => opts.taskLabel(taskIndex)
  );

  // Apply the filter and work with the ChartLike return from this point on.
  // Fitler also needs to be applied to spans.
  const fret = filter(
    plan.chart,
    opts.filterFunc,
    opts.taskEmphasize,
    spans,
    originalLabels,
    opts.selectedTaskIndex
  );
  if (!fret.ok) {
    return fret;
  }
  const chartLike = fret.value.chartLike;
  const labels = fret.value.labels;
  const resourceDefinition = plan.getResourceDefinition(opts.groupByResource);
  const fromFilteredIndexToOriginalIndex =
    fret.value.fromFilteredIndexToOriginalIndex;
  const fromOriginalIndexToFilteredIndex =
    fret.value.fromOriginalIndexToFilteredIndex;

  const fromFilteredIndexToPercentComplete = (
    filteredIndex: number
  ): number => {
    const taskIndex = fromFilteredIndexToOriginalIndex.get(filteredIndex);
    if (taskIndex === undefined) {
      return 0;
    }
    const ret = plan.getTaskCompletion(taskIndex);
    if (!ret.ok) {
      return 0;
    }
    const tc = ret.value;
    switch (tc.stage) {
      case 'unstarted':
        return 0;
      case 'started':
        return tc.percentComplete;
      case 'finished':
        return 100;
      default:
        tc satisfies never;
        return 0;
    }
  };

  // Selected task, as an index into the unfiltered Chart.
  let lastSelectedTaskIndex = opts.selectedTaskIndex;

  // Highlighted tasks.
  const emphasizedTasks: Set<number> = new Set(fret.value.emphasizedTasks);
  spans = fret.value.spans;

  // Calculate how wide we need to make the groupBy column.
  let maxGroupNameLength = 0;
  if (opts.groupByResource !== '' && opts.hasText) {
    maxGroupNameLength = opts.groupByResource.length;
    if (resourceDefinition !== undefined) {
      resourceDefinition.values.forEach((value: string) => {
        maxGroupNameLength = Math.max(maxGroupNameLength, value.length);
      });
    }
  }

  const totalNumberOfRows = spans.length;
  const totalNumberOfDays = spans[spans.length - 1].finish;
  const scale = new Scale(
    opts,
    canvas.width,
    totalNumberOfDays + 1,
    maxGroupNameLength
  );

  const taskLineHeight = scale.metric(Metric.taskLineHeight);
  const diamondDiameter = scale.metric(Metric.milestoneDiameter);
  const percentHeight = scale.metric(Metric.percentHeight);
  const arrowHeadHeight = scale.metric(Metric.arrowHeadHeight);
  const arrowHeadWidth = scale.metric(Metric.arrowHeadWidth);
  const minTaskWidthPx = scale.metric(Metric.minTaskWidthPx);

  const daysWithTimeMarkers: Set<number> = new Set();
  const tiret = taskIndexToRowFromGroupBy(
    opts,
    resourceDefinition,
    chartLike,
    fret.value.displayOrder
  );
  if (!tiret.ok) {
    return tiret;
  }
  const taskIndexToRow = tiret.value.taskIndexToRow;
  const rowRanges = tiret.value.rowRanges;

  // Set up canvas basics.
  clearCanvas(ctx, opts, canvas);
  setFontSize(ctx, opts);

  const clipRegion = new Path2D();
  const clipOrigin = scale.feature(0, 0, Feature.tasksClipRectOrigin);
  const clipWidth = canvas.width - clipOrigin.x;
  clipRegion.rect(clipOrigin.x, 0, clipWidth, canvas.height);

  // Draw big red rect over where the clip region will be.
  if (0) {
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.stroke(clipRegion);
  }

  ctx.fillStyle = opts.colors.get('on-surface');
  ctx.strokeStyle = opts.colors.get('on-surface');

  if (rowRanges !== null) {
    if (opts.hasTasks) {
      drawSwimLaneHighlights(
        ctx,
        scale,
        rowRanges,
        totalNumberOfDays,
        opts.colors.get('group-color')
      );
    }

    if (resourceDefinition !== undefined && opts.hasText) {
      drawSwimLaneLabels(ctx, opts, resourceDefinition, scale, rowRanges);
    }
  }

  ctx.fillStyle = opts.colors.get('on-surface');
  ctx.strokeStyle = opts.colors.get('on-surface');

  ctx.save();
  ctx.clip(clipRegion);

  interface RectWithFilteredTaskIndex extends Rect {
    filteredTaskIndex: number;
  }
  const taskIndexToTaskHighlightCorners: Map<
    number,
    RectWithFilteredTaskIndex
  > = new Map();

  // Keep track of where we draw timeline labels, to avoid overlaps.
  const timeMarkerRanges: xRange[] = [];

  // Reserve space to draw the timestamp for the Finish task,
  // which will be the only text that's drawn before the time
  // marker instead of after it.
  const finishTextStart = scale.feature(
    0,
    totalNumberOfDays,
    Feature.timeTextStartBefore
  );
  const label = opts.durationDisplay(totalNumberOfDays);
  const meas = ctx.measureText(label);
  finishTextStart.x = finishTextStart.x - meas.width;
  timeMarkerRanges.push([finishTextStart.x, clipOrigin.x + clipWidth]);

  // Draw tasks in their rows.
  chartLike.Vertices.forEach((task: Task, taskIndex: number) => {
    const row = taskIndexToRow.get(taskIndex)!;
    const span = spans[taskIndex];
    const taskStart = scale.feature(row, span.start, Feature.taskLineStart);
    const taskEnd = scale.feature(row, span.finish, Feature.taskLineStart);
    const percentComplete = fromFilteredIndexToPercentComplete(taskIndex);

    ctx.fillStyle = opts.colors.get('on-surface-muted');
    ctx.strokeStyle = opts.colors.get('on-surface-muted');

    // Draw in time markers if displayed.
    // TODO - Make sure they don't overlap.
    if (opts.drawTimeMarkersOnTasks) {
      drawTimeMarkerAtDayToTask(
        ctx,
        row,
        span.start,
        task,
        opts,
        scale,
        daysWithTimeMarkers,
        timeMarkerRanges,
        totalNumberOfDays
      );
    }

    ctx.lineWidth = 1;
    if (emphasizedTasks.has(taskIndex)) {
      if (plan._status.stage === 'started') {
        if (percentComplete === 100) {
          ctx.fillStyle = opts.colors.get('secondary-variant');
          ctx.strokeStyle = opts.colors.get('secondary-variant');
        } else if (percentComplete > 0) {
          ctx.fillStyle = getPattern(
            ctx,
            opts.colors.get('secondary'),
            opts.colors.get('surface'),
            'crosshatch'
          )!;
          ctx.strokeStyle = opts.colors.get('secondary');
        } else {
          ctx.fillStyle = getPattern(
            ctx,
            opts.colors.get('primary'),
            opts.colors.get('surface'),
            'crosshatch'
          )!;
          ctx.strokeStyle = opts.colors.get('primary');
        }
      } else {
        ctx.fillStyle = getPattern(
          ctx,
          opts.colors.get('primary'),
          opts.colors.get('surface'),
          'crosshatch'
        )!;
        ctx.strokeStyle = opts.colors.get('primary');
      }
    } else {
      if (plan._status.stage === 'started') {
        if (percentComplete === 100) {
          ctx.fillStyle = opts.colors.get('secondary-variant');
          ctx.strokeStyle = opts.colors.get('secondary-variant');
        } else if (percentComplete > 0) {
          ctx.fillStyle = getPattern(
            ctx,
            opts.colors.get('secondary'),
            opts.colors.get('surface')
          )!;
          ctx.strokeStyle = opts.colors.get('secondary');
        } else {
          ctx.fillStyle = getPattern(
            ctx,
            opts.colors.get('on-surface'),
            opts.colors.get('surface')
          )!;
        }
      } else {
        ctx.fillStyle = getPattern(
          ctx,
          opts.colors.get('on-surface'),
          opts.colors.get('surface')
        )!;
        ctx.strokeStyle = opts.colors.get('on-surface');
      }
    }

    const highlightTopLeft = scale.feature(
      row,
      span.start,
      Feature.taskEnvelopeTop
    );
    const highlightBottomRight = scale.feature(
      row + 1,
      span.finish,
      Feature.taskEnvelopeTop
    );

    // Pad highlightBottomRight if too small.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [width, _] = difference(highlightTopLeft, highlightBottomRight);
    if (width < minTaskWidthPx) {
      highlightBottomRight.x = highlightTopLeft.x + minTaskWidthPx;
    }

    taskIndexToTaskHighlightCorners.set(taskIndex, {
      topLeft: highlightTopLeft,
      bottomRight: highlightBottomRight,
      filteredTaskIndex: taskIndex,
    });
    if (opts.hasTasks) {
      if (taskStart.x === taskEnd.x) {
        drawMilestone(ctx, taskStart, diamondDiameter, percentHeight);
      } else {
        drawTaskBar(
          ctx,
          opts,
          taskStart,
          taskEnd,
          taskLineHeight,
          percentComplete,
          plan._status.stage === 'started'
        );
      }

      // Skip drawing the text of the Start and Finish tasks.
      if (taskIndex !== 0 && taskIndex !== totalNumberOfRows - 1) {
        drawTaskText(
          ctx,
          opts,
          scale,
          row,
          span,
          task,
          taskIndex,
          fromFilteredIndexToOriginalIndex.get(taskIndex)!,
          clipWidth,
          labels
        );
      }
    }
  });

  ctx.lineWidth = 1;
  ctx.strokeStyle = opts.colors.get('on-surface-muted');

  // Now draw all the arrows, i.e. edges.
  if (opts.hasEdges && opts.hasTasks) {
    const highlightedEdges: DirectedEdge[] = [];
    const normalEdges: DirectedEdge[] = [];
    chartLike.Edges.forEach((e: DirectedEdge) => {
      // Don't draw edges to a task if the task is unstarted.
      const origTaskIndex = fromFilteredIndexToOriginalIndex.get(e.j);
      if (origTaskIndex !== undefined && opts.taskIsStarted(origTaskIndex)) {
        return;
      }

      if (emphasizedTasks.has(e.i) && emphasizedTasks.has(e.j)) {
        highlightedEdges.push(e);
      } else {
        normalEdges.push(e);
      }
    });

    ctx.strokeStyle = opts.colors.get('on-surface-muted');
    drawEdges(
      ctx,
      opts,
      normalEdges,
      spans,
      chartLike.Vertices,
      scale,
      taskIndexToRow,
      arrowHeadWidth,
      arrowHeadHeight,
      emphasizedTasks
    );
    ctx.strokeStyle = opts.colors.get('primary');
    drawEdges(
      ctx,
      opts,
      highlightedEdges,
      spans,
      chartLike.Vertices,
      scale,
      taskIndexToRow,
      arrowHeadWidth,
      arrowHeadHeight,
      emphasizedTasks
    );
  }

  // Remove the clip region.
  ctx.restore();

  // Now draw the range highlights if required.
  if (opts.displayRange !== null && opts.displayRangeUsage === 'highlight') {
    // Draw a rect over each side that isn't in the range.
    if (opts.displayRange.begin > 0) {
      drawRangeOverlay(
        ctx,
        opts,
        scale,
        0,
        opts.displayRange.begin,
        totalNumberOfRows
      );
    }
    if (opts.displayRange.end < totalNumberOfDays) {
      drawRangeOverlay(
        ctx,
        opts,
        scale,
        opts.displayRange.end,
        totalNumberOfDays + 1,
        totalNumberOfRows
      );
    }
  }

  // Draw the "today" marker.
  if (opts.today !== -1) {
    drawTodayMarker(ctx, opts.today, opts.colors, totalNumberOfRows, scale);
  }

  let updateHighlightFromMousePos: UpdateHighlightFromMousePos | null = null;
  let selectedTaskLocation: Point | null = null;

  if (overlay !== null) {
    const overlayCtx = overlay.getContext('2d')!;

    const taskLocationKDTree = new HitRect<RectWithFilteredTaskIndex>([
      ...taskIndexToTaskHighlightCorners.values(),
    ]);

    // Always recored in the original unfiltered task index.
    let lastHighlightedTaskIndex = -1;

    updateHighlightFromMousePos = (
      point: Point,
      updateType: UpdateType
    ): number | null => {
      // First convert point in offset coords into canvas coords.
      point.x = point.x * window.devicePixelRatio;
      point.y = point.y * window.devicePixelRatio;
      const taskLocation = taskLocationKDTree.hit(point);
      const originalTaskIndex =
        taskLocation === null
          ? -1
          : fromFilteredIndexToOriginalIndex.get(
              taskLocation!.filteredTaskIndex
            )!;

      // Do not allow highlighting or clicking the Start and Finish tasks.
      if (
        originalTaskIndex === 0 ||
        originalTaskIndex === plan.chart.Vertices.length - 1
      ) {
        return null;
      }
      if (updateType === 'mousemove') {
        if (originalTaskIndex === lastHighlightedTaskIndex) {
          return originalTaskIndex;
        }
      } else {
        if (originalTaskIndex === lastSelectedTaskIndex) {
          return originalTaskIndex;
        }
      }

      if (updateType === 'mousemove') {
        lastHighlightedTaskIndex = originalTaskIndex;
      } else {
        lastSelectedTaskIndex = originalTaskIndex;
      }

      overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

      // Draw both highlight and selection.

      // Draw highlight.
      let corners = taskIndexToTaskHighlightCorners.get(
        fromOriginalIndexToFilteredIndex.get(lastHighlightedTaskIndex)!
      );
      if (corners !== undefined) {
        drawTaskHighlight(
          overlayCtx,
          corners.topLeft,
          corners.bottomRight,
          opts.colors.get('primary-variant'),
          taskLineHeight
        );
      }

      // Draw selection.
      corners = taskIndexToTaskHighlightCorners.get(
        fromOriginalIndexToFilteredIndex.get(lastSelectedTaskIndex)!
      );
      if (corners !== undefined) {
        drawSelectionHighlight(
          overlayCtx,
          corners.topLeft,
          corners.bottomRight,
          opts.colors.get('primary-variant')
        );
      }

      return originalTaskIndex;
    };

    // Draw selection.
    const corners = taskIndexToTaskHighlightCorners.get(
      fromOriginalIndexToFilteredIndex.get(lastSelectedTaskIndex)!
    );
    if (corners !== undefined) {
      drawSelectionHighlight(
        overlayCtx,
        corners.topLeft,
        corners.bottomRight,
        opts.colors.get('primary-variant')
      );
    }
  }

  // Find the highest task of all the tasks displayed.
  taskIndexToTaskHighlightCorners.forEach((rc: Rect) => {
    if (selectedTaskLocation === null) {
      selectedTaskLocation = rc.topLeft;
      return;
    }
    if (rc.topLeft.y < selectedTaskLocation.y) {
      selectedTaskLocation = rc.topLeft;
    }
  });

  if (
    opts.selectedTaskIndex !== -1 &&
    fromOriginalIndexToFilteredIndex.has(opts.selectedTaskIndex)
  ) {
    selectedTaskLocation = taskIndexToTaskHighlightCorners.get(
      fromOriginalIndexToFilteredIndex.get(opts.selectedTaskIndex)! // Convert
    )!.topLeft;
  }

  // Return the selected task location in screen coordinates, not in canvas
  // units.
  let returnedLocation: Point | null = null;
  if (selectedTaskLocation !== null) {
    returnedLocation = pt(
      selectedTaskLocation.x / window.devicePixelRatio,
      selectedTaskLocation.y / window.devicePixelRatio
    );
  }

  return ok({
    scale: scale,
    updateHighlightFromMousePos: updateHighlightFromMousePos,
    selectedTaskLocation: returnedLocation,
  });
}

function drawEdges(
  ctx: CanvasRenderingContext2D,
  opts: RenderOptions,
  edges: DirectedEdge[],
  spans: Span[],
  tasks: Task[],
  scale: Scale,
  taskIndexToRow: TaskIndexToRow,
  arrowHeadWidth: number,
  arrowHeadHeight: number,
  taskHighlights: Set<number>
) {
  edges.forEach((e: DirectedEdge) => {
    const srcSlack: Span = spans[e.i];
    const dstSlack: Span = spans[e.j];
    const srcTask: Task = tasks[e.i];
    const dstTask: Task = tasks[e.j];
    const srcRow = taskIndexToRow.get(e.i)!;
    const dstRow = taskIndexToRow.get(e.j)!;
    const srcDay = srcSlack.finish;
    const dstDay = dstSlack.start;

    if (taskHighlights.has(e.i) && taskHighlights.has(e.j)) {
      ctx.strokeStyle = opts.colors.get('primary');
      ctx.fillStyle = opts.colors.get('primary');
    } else {
      ctx.strokeStyle = opts.colors.get('on-surface-muted');
      ctx.fillStyle = opts.colors.get('on-surface-muted');
    }

    drawArrowBetweenTasks(
      ctx,
      srcDay,
      dstDay,
      scale,
      srcRow,
      srcTask,
      dstRow,
      dstTask,
      arrowHeadWidth,
      arrowHeadHeight
    );
  });
}

function drawRangeOverlay(
  ctx: CanvasRenderingContext2D,
  opts: RenderOptions,
  scale: Scale,
  beginDay: number,
  endDay: number,
  totalNumberOfRows: number
) {
  const topLeft = scale.feature(0, beginDay, Feature.displayRangeTop);
  const bottomRight = scale.feature(
    totalNumberOfRows,
    endDay,
    Feature.taskRowBottom
  );
  ctx.fillStyle = opts.colors.get('transparent-overlay');
  ctx.fillRect(
    topLeft.x,
    topLeft.y,
    bottomRight.x - topLeft.x,
    bottomRight.y - topLeft.y
  );
}

function drawArrowBetweenTasks(
  ctx: CanvasRenderingContext2D,
  srcDay: number,
  dstDay: number,
  scale: Scale,
  srcRow: number,
  srcTask: Task,
  dstRow: number,
  dstTask: Task,
  arrowHeadWidth: number,
  arrowHeadHeight: number
) {
  if (srcDay === dstDay) {
    drawVerticalArrowToTask(
      ctx,
      scale,
      srcRow,
      srcDay,
      srcTask,
      dstRow,
      dstDay,
      dstTask,
      arrowHeadWidth,
      arrowHeadHeight
    );
  } else {
    drawLShapedArrowToTask(
      ctx,
      scale,
      srcRow,
      srcDay,
      srcTask,
      dstRow,
      dstTask,
      dstDay,
      arrowHeadHeight,
      arrowHeadWidth
    );
  }
}

function clearCanvas(
  ctx: CanvasRenderingContext2D,
  opts: RenderOptions,
  canvas: HTMLCanvasElement
) {
  ctx.fillStyle = opts.colors.get('background');
  ctx.strokeStyle = opts.colors.get('on-background');
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function setFontSize(ctx: CanvasRenderingContext2D, opts: RenderOptions) {
  ctx.font = `${opts.fontSizePx}px serif`;
}

// Draw L shaped arrow, first going between rows, then going between days.
function drawLShapedArrowToTask(
  ctx: CanvasRenderingContext2D,
  scale: Scale,
  srcRow: number,
  srcDay: number,
  srcTask: Task,
  dstRow: number,
  dstTask: Task,
  dstDay: number,
  arrowHeadHeight: number,
  arrowHeadWidth: number
) {
  // Draw vertical part of the "L".
  ctx.beginPath();
  const direction: Direction = srcRow < dstRow ? 'down' : 'up';
  const vertLineStart = scale.feature(
    srcRow,
    srcDay,
    verticalArrowStartFeatureFromTaskDuration(srcTask, direction)
  );
  const vertLineEnd = scale.feature(
    dstRow,
    srcDay,
    horizontalArrowDestFeatureFromTaskDuration(dstTask)
  );
  ctx.moveTo(vertLineStart.x + 0.5, vertLineStart.y);
  ctx.lineTo(vertLineStart.x + 0.5, vertLineEnd.y);

  // Draw horizontal part of the "L".
  const horzLineStart = vertLineEnd;
  const horzLineEnd = scale.feature(
    dstRow,
    dstDay,
    horizontalArrowDestFeatureFromTaskDuration(dstTask)
  );
  ctx.moveTo(vertLineStart.x + 0.5, horzLineStart.y);
  ctx.lineTo(horzLineEnd.x + 0.5, horzLineEnd.y);

  ctx.stroke();

  // Draw the arrowhead. This arrow head will always point to the right
  // since that's how time flows.
  ctx.beginPath();
  ctx.moveTo(horzLineEnd.x + 0.5, horzLineEnd.y);
  ctx.lineTo(
    horzLineEnd.x - arrowHeadHeight + 0.5,
    horzLineEnd.y + arrowHeadWidth
  );
  ctx.lineTo(
    horzLineEnd.x - arrowHeadHeight + 0.5,
    horzLineEnd.y - arrowHeadWidth
  );
  ctx.fill();
}

function drawVerticalArrowToTask(
  ctx: CanvasRenderingContext2D,
  scale: Scale,
  srcRow: number,
  srcDay: number,
  srcTask: Task,
  dstRow: number,
  dstDay: number,
  dstTask: Task,
  arrowHeadWidth: number,
  arrowHeadHeight: number
) {
  const direction: Direction = srcRow < dstRow ? 'down' : 'up';
  const arrowStart = scale.feature(
    srcRow,
    srcDay,
    verticalArrowStartFeatureFromTaskDuration(srcTask, direction)
  );
  const arrowEnd = scale.feature(
    dstRow,
    dstDay,
    verticalArrowDestFeatureFromTaskDuration(dstTask, direction)
  );

  ctx.beginPath();
  ctx.moveTo(arrowStart.x + 0.5, arrowStart.y);
  ctx.lineTo(arrowEnd.x + 0.5, arrowEnd.y);

  ctx.stroke();

  // Draw the arrowhead.
  ctx.beginPath();
  const deltaY = direction === 'down' ? -arrowHeadHeight : arrowHeadHeight;
  ctx.moveTo(arrowEnd.x + 0.5, arrowEnd.y);
  ctx.lineTo(arrowEnd.x - arrowHeadWidth + 0.5, arrowEnd.y + deltaY);
  ctx.lineTo(arrowEnd.x + arrowHeadWidth + 0.5, arrowEnd.y + deltaY);
  ctx.fill();
}

function drawTaskText(
  ctx: CanvasRenderingContext2D,
  opts: RenderOptions,
  scale: Scale,
  row: number,
  span: Span,
  task: Task,
  taskIndex: number,
  originalTaskIndex: number,
  clipWidth: number,
  labels: string[]
) {
  if (!opts.hasText) {
    return;
  }
  const label = labels[taskIndex];

  let xStartInTime = span.start;
  let xPixelDelta = 0;
  // Determine where on the x-axis to start drawing the task text.
  if (opts.displayRange !== null && opts.displayRangeUsage === 'restrict') {
    if (opts.displayRange.in(span.start)) {
      xStartInTime = span.start;
      xPixelDelta = 0;
    } else if (opts.displayRange.in(span.finish)) {
      xStartInTime = span.finish;
      const meas = ctx.measureText(label);
      xPixelDelta = -meas.width - 2 * scale.metric(Metric.textXOffset);
    } else if (
      span.start < opts.displayRange.begin &&
      span.finish > opts.displayRange.end
    ) {
      xStartInTime = opts.displayRange.begin;
      xPixelDelta = clipWidth / 2;
    }
  }
  ctx.lineWidth = 1;
  ctx.fillStyle = opts.colors.get('on-surface');
  ctx.textBaseline = 'top';
  const textStart = scale.feature(row, xStartInTime, Feature.textStart);
  ctx.fillText(label, textStart.x + xPixelDelta, textStart.y);
}

function drawTaskBar(
  ctx: CanvasRenderingContext2D,
  opts: RenderOptions,
  taskStart: Point,
  taskEnd: Point,
  taskLineHeight: number,
  percentComplete: number,
  planStarted: boolean
) {
  ctx.fillRect(
    taskStart.x,
    taskStart.y,
    taskEnd.x - taskStart.x,
    taskLineHeight
  );

  ctx.strokeRect(
    taskStart.x,
    taskStart.y,
    taskEnd.x - taskStart.x,
    taskLineHeight
  );

  if (planStarted && percentComplete !== 100) {
    ctx.fillStyle = opts.colors.get('secondary');
    ctx.strokeStyle = opts.colors.get('secondary');

    ctx.fillRect(
      taskStart.x,
      taskStart.y,
      ((taskEnd.x - taskStart.x) * percentComplete) / 100,
      taskLineHeight
    );
  }
}

function drawTaskHighlight(
  ctx: CanvasRenderingContext2D,
  highlightStart: Point,
  highlightEnd: Point,
  color: string,
  borderWidth: number
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = borderWidth;
  ctx.strokeRect(
    highlightStart.x,
    highlightStart.y,
    highlightEnd.x - highlightStart.x,
    highlightEnd.y - highlightStart.y
  );
}

function drawSelectionHighlight(
  ctx: CanvasRenderingContext2D,
  highlightStart: Point,
  highlightEnd: Point,
  color: string
) {
  ctx.fillStyle = color;
  ctx.fillRect(
    highlightStart.x,
    highlightStart.y,
    highlightEnd.x - highlightStart.x,
    highlightEnd.y - highlightStart.y
  );
}

function drawMilestone(
  ctx: CanvasRenderingContext2D,
  taskStart: Point,
  diamondDiameter: number,
  percentHeight: number
) {
  ctx.beginPath();
  ctx.lineWidth = percentHeight / 2;
  ctx.moveTo(taskStart.x, taskStart.y - diamondDiameter);
  ctx.lineTo(taskStart.x + diamondDiameter, taskStart.y);
  ctx.lineTo(taskStart.x, taskStart.y + diamondDiameter);
  ctx.lineTo(taskStart.x - diamondDiameter, taskStart.y);
  ctx.closePath();
  ctx.stroke();
}

const drawTodayMarker = (
  ctx: CanvasRenderingContext2D,
  today: number,
  colors: Theme2,
  totalNumberOfRows: number,
  scale: Scale
) => {
  const timeMarkStart = scale.feature(0, today, Feature.timeMarkStart);
  const timeMarkEnd = scale.feature(
    totalNumberOfRows + 1,
    today,
    Feature.taskEnvelopeTop
  );

  ctx.beginPath();
  ctx.lineWidth = scale.metric('percentHeight');
  ctx.strokeStyle = colors.get('error');
  ctx.setLineDash([ctx.lineWidth * 2, ctx.lineWidth * 2]);
  ctx.moveTo(timeMarkStart.x, timeMarkStart.y);
  ctx.lineTo(timeMarkEnd.x, timeMarkEnd.y);
  ctx.stroke();
};

const drawTimeMarkerAtDayToTask = (
  ctx: CanvasRenderingContext2D,
  row: number,
  day: number,
  task: Task,
  opts: RenderOptions,
  scale: Scale,
  daysWithTimeMarkers: Set<number>,
  timeMarkerRanges: xRange[],
  totalNumberOfDays: number
) => {
  if (daysWithTimeMarkers.has(day)) {
    return;
  }

  daysWithTimeMarkers.add(day);
  const timeMarkStart = scale.feature(row, day, Feature.timeMarkStart);

  // Don't bother drawing the line if it's under an existing time label.
  // Since timeMarkerRanges is pre-populate with a reserved space
  // for the final time text, we can skip this check when day === totalNumberOfDays.
  if (
    day !== totalNumberOfDays &&
    timeMarkerRanges.findIndex(
      ([begin, end]) => timeMarkStart.x >= begin && timeMarkStart.x <= end
    ) !== -1
  ) {
    return;
  }

  const timeMarkEnd = scale.feature(
    row,
    day,
    verticalArrowDestFeatureFromTaskDuration(task, 'down')
  );
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = opts.colors.get('on-surface-muted');

  ctx.moveTo(timeMarkStart.x + 0.5, timeMarkStart.y);
  ctx.lineTo(timeMarkStart.x + 0.5, timeMarkEnd.y);
  ctx.stroke();

  ctx.setLineDash([]);

  ctx.fillStyle = opts.colors.get('on-surface');
  ctx.textBaseline = 'top';
  const label = opts.durationDisplay(day);
  const meas = ctx.measureText(label);

  let textStart = scale.feature(row, day, Feature.timeTextStart);
  let rightExtent = textStart.x;
  if (day === totalNumberOfDays) {
    textStart = scale.feature(row, day, Feature.timeTextStartBefore);
    textStart.x = textStart.x - meas.width;
  } else {
    rightExtent += meas.width;
  }
  const textBegin = textStart.x;
  const textEnd = textStart.x + meas.width;
  if (
    opts.hasText &&
    opts.hasTimeline &&
    // Don't draw the label if it overlaps any existing labels, but don't bother
    // checking for overlap if this is the Finish task which always gets time
    // label and has space preserved for it.
    (day === totalNumberOfDays ||
      timeMarkerRanges.findIndex(([begin, end]) => {
        return (
          (textBegin <= begin && textEnd >= begin) ||
          (textBegin <= end && textEnd >= end)
        );
      }) === -1)
  ) {
    ctx.fillText(`${label}`, textStart.x, textStart.y);
    timeMarkerRanges.push([textBegin, rightExtent]);
  }
};

/** Represents a half-open interval of rows, e.g. [start, finish). */
interface RowRange {
  start: number;
  finish: number;
}

interface TaskIndexToRowReturn {
  taskIndexToRow: TaskIndexToRow;

  /** Maps each resource value index to a range of rows. */
  rowRanges: Map<number, RowRange> | null;

  resourceDefinition: ResourceDefinition | null;
}

const taskIndexToRowFromGroupBy = (
  opts: RenderOptions,
  resourceDefinition: ResourceDefinition | undefined,
  chartLike: ChartLike,
  displayOrder: VertexIndices
): Result<TaskIndexToRowReturn> => {
  // displayOrder maps from row to task index, this will produce the inverse mapping.
  const taskIndexToRow = new Map(
    // This looks backwards, but it isn't. Remember that the map callback takes
    // (value, index) as its arguments.
    displayOrder.map((taskIndex: number, row: number) => [taskIndex, row])
  );

  if (resourceDefinition === undefined) {
    return ok({
      taskIndexToRow: taskIndexToRow,
      rowRanges: null,
      resourceDefinition: null,
    });
  }

  const startTaskIndex = 0;
  const finishTaskIndex = chartLike.Vertices.length - 1;
  const ignorable = [startTaskIndex, finishTaskIndex];

  // Group all tasks by their resource value, while preserving displayOrder
  // order with the groups.
  const groups = new Map<string, number[]>();
  displayOrder.forEach((taskIndex: number) => {
    const resourceValue =
      chartLike.Vertices[taskIndex].getResource(opts.groupByResource) || '';
    const groupMembers = groups.get(resourceValue) || [];
    groupMembers.push(taskIndex);
    groups.set(resourceValue, groupMembers);
  });

  const ret = new Map<number, number>();

  // Ugh, Start and Finish Tasks need to be mapped, but should not be done via
  // resource value, so Start should always be first.
  ret.set(0, 0);

  // Now increment up the rows as we move through all the groups.
  let row = 1;
  // And track how many rows are in each group.
  const rowRanges: Map<number, RowRange> = new Map();
  resourceDefinition.values.forEach(
    (resourceValue: string, resourceIndex: number) => {
      const startOfRow = row;
      (groups.get(resourceValue) || []).forEach((taskIndex: number) => {
        if (ignorable.includes(taskIndex)) {
          return;
        }
        ret.set(taskIndex, row);
        row++;
      });
      rowRanges.set(resourceIndex, { start: startOfRow, finish: row });
    }
  );
  ret.set(finishTaskIndex, row);

  return ok({
    taskIndexToRow: ret,
    rowRanges: rowRanges,
    resourceDefinition: resourceDefinition,
  });
};

const drawSwimLaneHighlights = (
  ctx: CanvasRenderingContext2D,
  scale: Scale,
  rowRanges: Map<number, RowRange>,
  totalNumberOfDays: number,
  groupColor: string
) => {
  ctx.fillStyle = groupColor;

  let group = 0;
  rowRanges.forEach((rowRange: RowRange) => {
    const topLeft = scale.feature(
      rowRange.start,
      0,
      Feature.groupEnvelopeStart
    );
    const bottomRight = scale.feature(
      rowRange.finish,
      totalNumberOfDays + 1,
      Feature.taskEnvelopeTop
    );
    group++;
    // Only highlight every other group backgroud with the groupColor.
    if (group % 2 == 1) {
      return;
    }
    ctx.fillRect(
      topLeft.x,
      topLeft.y,
      bottomRight.x - topLeft.x,
      bottomRight.y - topLeft.y
    );
  });
};

const drawSwimLaneLabels = (
  ctx: CanvasRenderingContext2D,
  opts: RenderOptions,
  resourceDefinition: ResourceDefinition,
  scale: Scale,
  rowRanges: Map<number, RowRange>
) => {
  if (rowRanges) ctx.lineWidth = 1;
  ctx.fillStyle = opts.colors.get('on-surface');
  const groupByOrigin = scale.feature(0, 0, Feature.groupByOrigin);

  if (opts.hasTimeline) {
    ctx.textBaseline = 'bottom';
    ctx.fillText(opts.groupByResource, groupByOrigin.x, groupByOrigin.y);
  }

  if (opts.hasTasks) {
    ctx.textBaseline = 'top';
    rowRanges.forEach((rowRange: RowRange, resourceIndex: number) => {
      if (rowRange.start === rowRange.finish) {
        return;
      }
      const textStart = scale.feature(
        rowRange.start,
        0,
        Feature.groupTextStart
      );
      ctx.fillText(
        resourceDefinition.values[resourceIndex],
        textStart.x,
        textStart.y
      );
    });
  }
};

// Keep patterns around for both light mode and dark mode.
const patterns: Map<string, CanvasPattern> = new Map();

type pattern = 'crosshatch' | 'singlehash';

const patternSize = 8;

const getPattern = (
  ctx: CanvasRenderingContext2D,
  color: string,
  background: string,
  pattern: pattern = 'singlehash'
): CanvasPattern | null => {
  const key = `${color}:${background}`;
  let ret = patterns.get(key);
  if (ret !== undefined) {
    return ret;
  }

  const canvas = document.createElement('canvas');
  canvas.width = patternSize;
  canvas.height = patternSize;

  const pCtx = canvas.getContext('2d')!;

  pCtx.fillStyle = background;
  pCtx.fillRect(0, 0, canvas.width, canvas.height);
  pCtx.strokeStyle = color;
  pCtx.lineWidth = 1;
  pCtx.moveTo(0, patternSize);
  pCtx.lineTo(patternSize, 0);
  if (pattern === 'crosshatch') {
    pCtx.moveTo(0, 0);
    pCtx.lineTo(patternSize, patternSize);
  }
  pCtx.stroke();

  ret = ctx.createPattern(canvas, 'repeat')!;
  patterns.set(key, ret);
  return ret;
};
