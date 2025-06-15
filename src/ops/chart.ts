import { Result, ok, error } from '../result.ts';
import { DirectedEdge, edgesBySrcAndDstToMap } from '../dag/dag.ts';
import { Plan } from '../plan/plan.ts';
import { Chart, Task } from '../chart/chart.ts';
import { Op, SubOp, SubOpResult } from './ops.ts';
import { SetMetricValueSubOp } from './metrics.ts';
import { Span } from '../slack/slack.ts';
import { clamp } from '../metrics/range.ts';
import { TaskCompletion } from '../task_completion/task_completion.ts';
import { SetTaskCompletionSubOp } from './plan.ts';

export const DEFAULT_TASK_DURATION = 100;

export const splitDuration = (total: number): [number, number] => {
  const half = total / 2;
  return [Math.ceil(half), Math.floor(half)];
};

/** A value of -1 for j means the Finish Milestone. */
export function DirectedEdgeForPlan(
  i: number,
  j: number,
  plan: Plan
): Result<DirectedEdge> {
  const chart = plan.chart;
  if (j === -1) {
    j = chart.Vertices.length - 1;
  }
  if (i < 0 || i >= chart.Vertices.length) {
    return error(
      `i index out of range: ${i} not in [0, ${chart.Vertices.length - 1}]`
    );
  }
  if (j < 0 || j >= chart.Vertices.length) {
    return error(
      `j index out of range: ${j} not in [0, ${chart.Vertices.length - 1}]`
    );
  }
  if (i === j) {
    return error(`A Task can not depend on itself: ${i} === ${j}`);
  }
  return ok(new DirectedEdge(i, j));
}

export class AddEdgeSubOp implements SubOp {
  i: number = 0;
  j: number = 0;

  constructor(i: number, j: number) {
    this.i = i;
    this.j = j;
  }

  applyTo(plan: Plan): Result<SubOpResult> {
    if (this.i === -1) {
      this.i = plan.chart.Vertices.length - 1;
    }
    if (this.j === -1) {
      this.j = plan.chart.Vertices.length - 1;
    }

    const e = DirectedEdgeForPlan(this.i, this.j, plan);
    if (!e.ok) {
      return e;
    }

    // Only add the edge if it doesn't exists already.
    if (!plan.chart.Edges.find((value: DirectedEdge) => value.equal(e.value))) {
      plan.chart.Edges.push(e.value);
    }

    return ok({
      plan: plan,
      inverse: this.inverse(),
    });
  }

  inverse(): SubOp {
    return new RemoveEdgeSupOp(this.i, this.j);
  }
}

export class RemoveEdgeSupOp implements SubOp {
  i: number = 0;
  j: number = 0;

  constructor(i: number, j: number) {
    this.i = i;
    this.j = j;
  }

  applyTo(plan: Plan): Result<SubOpResult> {
    if (this.i === -1) {
      this.i = plan.chart.Vertices.length - 1;
    }
    if (this.j === -1) {
      this.j = plan.chart.Vertices.length - 1;
    }

    const e = DirectedEdgeForPlan(this.i, this.j, plan);
    if (!e.ok) {
      return e;
    }
    plan.chart.Edges = plan.chart.Edges.filter(
      (v: DirectedEdge): boolean => !v.equal(e.value)
    );

    return ok({
      plan: plan,
      inverse: this.inverse(),
    });
  }

  inverse(): SubOp {
    return new AddEdgeSubOp(this.i, this.j);
  }
}

function indexInRangeForVertices(index: number, chart: Chart): Result<null> {
  if (index < 0 || index > chart.Vertices.length - 2) {
    return error(`${index} is not in range [0, ${chart.Vertices.length - 2}]`);
  }
  return ok(null);
}

function indexInRangeForVerticesExclusive(
  index: number,
  chart: Chart
): Result<null> {
  if (index < 1 || index > chart.Vertices.length - 2) {
    return error(`${index} is not in range [1, ${chart.Vertices.length - 2}]`);
  }
  return ok(null);
}

export class AddTaskAfterSubOp implements SubOp {
  index: number = 0;
  fullTaskToBeRestored: FullTaskToBeRestored | null;

  constructor(
    index: number,
    fullTaskToBeRestored: FullTaskToBeRestored | null = null
  ) {
    this.index = index;
    this.fullTaskToBeRestored = fullTaskToBeRestored;
  }

  applyTo(plan: Plan): Result<SubOpResult> {
    const chart = plan.chart;
    const ret = indexInRangeForVertices(this.index, chart);
    if (!ret.ok) {
      return ret;
    }
    let task = plan.newTask();
    if (this.fullTaskToBeRestored !== null) {
      task = this.fullTaskToBeRestored.task;
    }
    plan.chart.Vertices.splice(this.index + 1, 0, task);

    // Update Edges.
    for (let i = 0; i < chart.Edges.length; i++) {
      const edge = chart.Edges[i];
      if (edge.i >= this.index + 1) {
        edge.i++;
      }
      if (edge.j >= this.index + 1) {
        edge.j++;
      }
    }

    if (this.fullTaskToBeRestored !== null) {
      chart.Edges.push(...this.fullTaskToBeRestored.edges);
    }

    return ok({ plan: plan, inverse: this.inverse() });
  }

  inverse(): SubOp {
    return new DeleteTaskSubOp(this.index + 1);
  }
}

export class DupTaskSubOp implements SubOp {
  index: number = 0;

  constructor(index: number) {
    this.index = index;
  }

  applyTo(plan: Plan): Result<SubOpResult> {
    const chart = plan.chart;
    const ret = indexInRangeForVerticesExclusive(this.index, chart);
    if (!ret.ok) {
      return ret;
    }

    const original = plan.chart.Vertices[this.index];
    const copy = original.dup();

    // Insert the duplicate immediately after the Task it is copied from.
    plan.chart.Vertices.splice(this.index, 0, copy);

    // Update Edges.
    for (let i = 0; i < chart.Edges.length; i++) {
      const edge = chart.Edges[i];
      if (edge.i > this.index) {
        edge.i++;
      }
      if (edge.j > this.index) {
        edge.j++;
      }
    }
    return ok({ plan: plan, inverse: this.inverse() });
  }

  inverse(): SubOp {
    return new DeleteTaskSubOp(this.index + 1);
  }
}

// Distributes the duration of the source Task equally between the source and
// target Tasks.
export class SplitDurationSubOp implements SubOp {
  sourceIndex: number;
  targetIndex: number;

  constructor(sourceIndex: number, targetIndex: number) {
    this.sourceIndex = sourceIndex;
    this.targetIndex = targetIndex;
  }

  applyTo(plan: Plan): Result<SubOpResult> {
    const chart = plan.chart;
    let ret = indexInRangeForVerticesExclusive(this.sourceIndex, chart);
    if (!ret.ok) {
      return ret;
    }
    ret = indexInRangeForVerticesExclusive(this.targetIndex, chart);
    if (!ret.ok) {
      return ret;
    }

    const source = plan.chart.Vertices[this.sourceIndex];
    const target = plan.chart.Vertices[this.targetIndex];
    const [sourceDuration, targetDuration] = splitDuration(source.duration);
    source.duration = sourceDuration;
    target.duration = targetDuration;
    return ok({
      plan: plan,
      inverse: new MergeDurationSubOp(this.sourceIndex, this.targetIndex),
    });
  }
}

// Distributes the duration of the source Task equally between the source and
// target Tasks.
export class MergeDurationSubOp implements SubOp {
  sourceIndex: number;
  targetIndex: number;

  constructor(sourceIndex: number, targetIndex: number) {
    this.sourceIndex = sourceIndex;
    this.targetIndex = targetIndex;
  }

  applyTo(plan: Plan): Result<SubOpResult> {
    const chart = plan.chart;
    let ret = indexInRangeForVerticesExclusive(this.sourceIndex, chart);
    if (!ret.ok) {
      return ret;
    }
    ret = indexInRangeForVerticesExclusive(this.targetIndex, chart);
    if (!ret.ok) {
      return ret;
    }

    const source = plan.chart.Vertices[this.sourceIndex];
    const target = plan.chart.Vertices[this.targetIndex];
    source.duration = source.duration + target.duration;
    return ok({
      plan: plan,
      inverse: new SplitDurationSubOp(this.sourceIndex, this.targetIndex),
    });
  }
}

type Substitution = Map<DirectedEdge, DirectedEdge>;

export class MoveAllOutgoingEdgesFromToSubOp implements SubOp {
  fromTaskIndex: number = 0;
  toTaskIndex: number = 0;
  actualMoves: Substitution;

  constructor(
    fromTaskIndex: number,
    toTaskIndex: number,
    actualMoves: Substitution = new Map()
  ) {
    this.fromTaskIndex = fromTaskIndex;
    this.toTaskIndex = toTaskIndex;
    this.actualMoves = actualMoves;
  }

  applyTo(plan: Plan): Result<SubOpResult> {
    const chart = plan.chart;
    let ret = indexInRangeForVerticesExclusive(this.fromTaskIndex, chart);
    if (!ret.ok) {
      return ret;
    }
    ret = indexInRangeForVerticesExclusive(this.toTaskIndex, chart);
    if (!ret.ok) {
      return ret;
    }

    if (this.actualMoves.values.length === 0) {
      const actualMoves: Substitution = new Map();
      // Update all Edges that start at 'fromTaskIndex' and change the start to 'toTaskIndex'.
      for (let i = 0; i < chart.Edges.length; i++) {
        const edge = chart.Edges[i];
        // Skip the corner case there fromTaskIndex points to TaskIndex.
        if (edge.i === this.fromTaskIndex && edge.j === this.toTaskIndex) {
          continue;
        }

        if (edge.i === this.fromTaskIndex) {
          actualMoves.set(
            new DirectedEdge(this.toTaskIndex, edge.j),
            new DirectedEdge(edge.i, edge.j)
          );
          edge.i = this.toTaskIndex;
        }
      }
      return ok({
        plan: plan,
        inverse: this.inverse(
          this.toTaskIndex,
          this.fromTaskIndex,
          actualMoves
        ),
      });
    } else {
      for (let i = 0; i < chart.Edges.length; i++) {
        const newEdge = this.actualMoves.get(plan.chart.Edges[i]);
        if (newEdge !== undefined) {
          plan.chart.Edges[i] = newEdge;
        }
      }

      return ok({
        plan: plan,
        inverse: new MoveAllOutgoingEdgesFromToSubOp(
          this.toTaskIndex,
          this.fromTaskIndex
        ),
      });
    }
  }

  inverse(
    toTaskIndex: number,
    fromTaskIndex: number,
    actualMoves: Substitution
  ): SubOp {
    return new MoveAllOutgoingEdgesFromToSubOp(
      toTaskIndex,
      fromTaskIndex,
      actualMoves
    );
  }
}

export class CopyAllEdgesFromToSubOp implements SubOp {
  fromIndex: number = 0;
  toIndex: number = 0;

  constructor(fromIndex: number, toIndex: number) {
    this.fromIndex = fromIndex;
    this.toIndex = toIndex;
  }

  applyTo(plan: Plan): Result<SubOpResult> {
    const ret = indexInRangeForVertices(this.fromIndex, plan.chart);
    if (!ret.ok) {
      return ret;
    }

    const newEdges: DirectedEdge[] = [];
    plan.chart.Edges.forEach((edge: DirectedEdge) => {
      if (edge.i === this.fromIndex) {
        newEdges.push(new DirectedEdge(this.toIndex, edge.j));
      }
      if (edge.j === this.fromIndex) {
        newEdges.push(new DirectedEdge(edge.i, this.toIndex));
      }
    });
    plan.chart.Edges.push(...newEdges);

    return ok({ plan: plan, inverse: new RemoveAllEdgesSubOp(newEdges) });
  }
}

export class RemoveAllEdgesSubOp implements SubOp {
  edges: DirectedEdge[];

  constructor(edges: DirectedEdge[]) {
    this.edges = edges;
  }

  applyTo(plan: Plan): Result<SubOpResult> {
    plan.chart.Edges = plan.chart.Edges.filter(
      (edge: DirectedEdge) =>
        -1 ===
        this.edges.findIndex((toBeRemoved: DirectedEdge) =>
          edge.equal(toBeRemoved)
        )
    );

    return ok({ plan: plan, inverse: new AddAllEdgesSubOp(this.edges) });
  }
}

export class AddAllEdgesSubOp implements SubOp {
  edges: DirectedEdge[];

  constructor(edges: DirectedEdge[]) {
    this.edges = edges;
  }

  applyTo(plan: Plan): Result<SubOpResult> {
    plan.chart.Edges.push(...this.edges);

    return ok({ plan: plan, inverse: new RemoveAllEdgesSubOp(this.edges) });
  }
}

interface FullTaskToBeRestored {
  edges: DirectedEdge[];
  task: Task;
}

export class DeleteTaskSubOp implements SubOp {
  index: number = 0;

  constructor(index: number) {
    this.index = index;
  }

  applyTo(plan: Plan): Result<SubOpResult> {
    const chart = plan.chart;
    const ret = indexInRangeForVertices(this.index, chart);
    if (!ret.ok) {
      return ret;
    }

    const edgesToBeRestored = chart.Edges.filter((de: DirectedEdge) => {
      if (de.i === this.index || de.j === this.index) {
        return true;
      }
      return false;
    });

    // First remove all edges to and from the task.
    chart.Edges = chart.Edges.filter((de: DirectedEdge) => {
      if (de.i === this.index || de.j === this.index) {
        return false;
      }
      return true;
    });

    // Update edges for tasks that will end up at a new index.
    for (let i = 0; i < chart.Edges.length; i++) {
      const edge = chart.Edges[i];
      if (edge.i > this.index) {
        edge.i--;
      }
      if (edge.j > this.index) {
        edge.j--;
      }
    }

    const taskToBeRestored = chart.Vertices.splice(this.index, 1);
    const fullTaskToBeRestored = {
      edges: edgesToBeRestored,
      task: taskToBeRestored[0],
    };
    return ok({ plan: plan, inverse: this.inverse(fullTaskToBeRestored) });
  }

  inverse(fullTaskToBeRestored: FullTaskToBeRestored): SubOp {
    return new AddTaskAfterSubOp(this.index - 1, fullTaskToBeRestored);
  }
}

export class RationalizeEdgesSubOp implements SubOp {
  constructor() {}

  applyTo(plan: Plan): Result<SubOpResult> {
    const srcAndDst = edgesBySrcAndDstToMap(plan.chart.Edges);
    const Start = 0;
    const Finish = plan.chart.Vertices.length - 1;

    // loop over all vertics from [Start, Finish) and look for their
    // destinations. If they have none then add in an edge to Finish. If they
    // have more than one then remove any links to Finish.
    for (let i = Start; i < Finish; i++) {
      const destinations = srcAndDst.bySrc.get(i);
      if (destinations === undefined) {
        const toBeAdded = new DirectedEdge(i, Finish);
        plan.chart.Edges.push(toBeAdded);
      } else {
        // Are there any uneeded Egdes to Finish? If so filter them out.
        if (
          destinations.length > 1 &&
          destinations.find((value: DirectedEdge) => value.j === Finish)
        ) {
          const toBeRemoved = new DirectedEdge(i, Finish);
          plan.chart.Edges = plan.chart.Edges.filter(
            (value: DirectedEdge) => !toBeRemoved.equal(value)
          );
        }
      }
    }

    // loop over all vertics from(Start, Finish] and look for their sources. If
    // they have none then add in an edge from Start. If they have more than one
    // then remove any links from Start.
    for (let i = Start + 1; i < Finish; i++) {
      const destinations = srcAndDst.byDst.get(i);
      if (destinations === undefined) {
        const toBeAdded = new DirectedEdge(Start, i);
        plan.chart.Edges.push(toBeAdded);
      } else {
        // Are there any un-needed Egdes from Start? If so filter them out.
        if (
          destinations.length > 1 &&
          destinations.find((value: DirectedEdge) => value.i === Start)
        ) {
          const toBeRemoved = new DirectedEdge(Start, i);
          plan.chart.Edges = plan.chart.Edges.filter(
            (value: DirectedEdge) => !toBeRemoved.equal(value)
          );
        }
      }
    }
    if (plan.chart.Edges.length === 0) {
      plan.chart.Edges.push(new DirectedEdge(Start, Finish));
    }

    return ok({ plan: plan, inverse: this.inverse() });
  }

  inverse(): SubOp {
    return new RationalizeEdgesSubOp();
  }
}

export class SetTaskNameSubOp implements SubOp {
  taskIndex: number;
  name: string;

  constructor(taskIndex: number, name: string) {
    this.taskIndex = taskIndex;
    this.name = name;
  }

  applyTo(plan: Plan): Result<SubOpResult> {
    const ret = indexInRangeForVertices(this.taskIndex, plan.chart);
    if (!ret.ok) {
      return ret;
    }
    const oldName = plan.chart.Vertices[this.taskIndex].name;
    plan.chart.Vertices[this.taskIndex].name = this.name;
    return ok({
      plan: plan,
      inverse: this.inverse(oldName),
    });
  }

  inverse(oldName: string): SubOp {
    return new SetTaskNameSubOp(this.taskIndex, oldName);
  }
}

export class SetTaskDescriptionSubOp implements SubOp {
  taskIndex: number;
  description: string;

  constructor(taskIndex: number, description: string) {
    this.taskIndex = taskIndex;
    this.description = description;
  }

  applyTo(plan: Plan): Result<SubOpResult> {
    const ret = indexInRangeForVertices(this.taskIndex, plan.chart);
    if (!ret.ok) {
      return ret;
    }
    const oldDescription = plan.chart.Vertices[this.taskIndex].description;
    plan.chart.Vertices[this.taskIndex].description = this.description;
    return ok({
      plan: plan,
      inverse: new SetTaskDescriptionSubOp(this.taskIndex, oldDescription),
    });
  }
}

// RestoreTaskCompletionsSubOp is the inverse of the CatchupSubOp, restoring the
// TaskCompletion's that were changed.
export class RestoreTaskCompletionsSubOp implements SubOp {
  taskCompletions: TaskCompletion[];
  today: number;
  spans: Span[];

  constructor(
    taskCompletions: TaskCompletion[],
    today: number = -1,
    spans: Span[] = []
  ) {
    this.taskCompletions = taskCompletions;
    this.today = today;
    this.spans = spans;
  }

  applyTo(plan: Plan): Result<SubOpResult> {
    plan.chart.Vertices.forEach((_task: Task, index: number) => {
      plan.setTaskCompletion(index, this.taskCompletions[index]);
    });

    return ok({
      plan: plan,
      inverse: new CatchupSubOp(this.today, this.spans),
    });
  }
}

export const taskPercentCompleteShouldBeChanged = (
  newPercentComplete: number,
  taskCompletion: TaskCompletion
): boolean => {
  switch (taskCompletion.stage) {
    case 'finished':
      // Don't update tasks that are already finished.
      return false;
      break;
    case 'started':
      // Don't update tasks that have larger percentComplete.
      if (taskCompletion.percentComplete > newPercentComplete) {
        return false;
      }
      break;
    case 'unstarted':
      break;
  }
  return true;
};

export class CatchupTaskSubOp implements SubOp {
  today: number;
  taskIndex: number;
  span: Span;

  constructor(today: number, taskIndex: number, span: Span) {
    this.today = today;
    this.taskIndex = taskIndex;
    this.span = span;
  }

  applyTo(plan: Plan): Result<SubOpResult> {
    // Make a backup of the current TaskCompletionSteps.
    const ret = plan.getTaskCompletion(this.taskIndex);
    if (!ret.ok) {
      return ret;
    }
    const originalTaskCompletion = ret.value;

    // Now update the TaskCompletions based on `today`.
    const task = plan.chart.Vertices[this.taskIndex];

    const start = this.span.start;
    const finish = this.span.finish;
    if (this.today <= start) {
      // Do nothing.
    } else if (this.today >= finish) {
      plan.setTaskCompletion(this.taskIndex, {
        stage: 'finished',
        span: this.span,
      });
    } else {
      const newPercentComplete = clamp(
        Math.floor((100 * (this.today - start)) / task.duration),
        1,
        99
      );
      const ret = plan.getTaskCompletion(this.taskIndex);
      if (!ret.ok) {
        return ret;
      }

      if (taskPercentCompleteShouldBeChanged(newPercentComplete, ret.value)) {
        plan.setTaskCompletion(this.taskIndex, {
          stage: 'started',
          start: start,
          percentComplete: clamp(
            Math.floor((100 * (this.today - start)) / task.duration),
            1,
            99
          ),
        });
      }
    }
    return ok({
      plan: plan,
      inverse: new SetTaskCompletionSubOp(
        this.taskIndex,
        originalTaskCompletion
      ),
    });
  }
}

// CatchupSubOp, aka "Boss Button", that brings the stage and percent complete
// of each task to correlate to being exactly on time today.
export class CatchupSubOp implements SubOp {
  today: number;
  spans: Span[];

  constructor(today: number, spans: Span[]) {
    this.today = today;
    this.spans = spans;
  }

  applyTo(plan: Plan): Result<SubOpResult> {
    // Make a backup of all the current TaskCompletionSteps.
    const originalTaskCompletions: TaskCompletion[] = plan.chart.Vertices.map(
      (_task: Task, index: number) => {
        const ret = plan.getTaskCompletion(index);
        if (!ret.ok) {
          return { stage: 'unstarted' };
        }
        return ret.value;
      }
    );

    // Now update the TaskCompletions based on `today`.
    plan.chart.Vertices.forEach((task: Task, index: number) => {
      const start = this.spans[index].start;
      const finish = this.spans[index].finish;
      if (this.today <= start) {
        return;
      } else if (this.today >= finish) {
        plan.setTaskCompletion(index, {
          stage: 'finished',
          span: this.spans[index],
        });
      } else {
        const newPercentComplete = clamp(
          Math.floor((100 * (this.today - start)) / task.duration),
          1,
          99
        );
        const ret = plan.getTaskCompletion(index);
        if (!ret.ok) {
          return;
        }
        if (taskPercentCompleteShouldBeChanged(newPercentComplete, ret.value)) {
          plan.setTaskCompletion(index, {
            stage: 'started',
            start: start,
            percentComplete: clamp(
              Math.floor((100 * (this.today - start)) / task.duration),
              1,
              99
            ),
          });
        }
      }
    });

    return ok({
      plan: plan,
      inverse: new RestoreTaskCompletionsSubOp(
        originalTaskCompletions,
        this.today,
        this.spans
      ),
    });
  }
}

// RecalculateDurationSubOp, which is only applied to started tasks,
// recalculates the duration of a task by presuming the percent complete is
// accurate for the given value of 'today'.
//
// For example, if a 10 day task is reported as 50% on day 2, then the total
// duration of the task should be updated to be only 4 days.
//
// A second example, fi the 10 day task is only 10% complete on day 2 then the
// total task duration should be updated to be 20 days.
export class RecalculateDurationSubOp implements SubOp {
  today: number;
  taskIndex: number;

  constructor(today: number, taskIndex: number) {
    this.today = today;
    this.taskIndex = taskIndex;
  }

  applyTo(plan: Plan): Result<SubOpResult> {
    const task = plan.chart.Vertices[this.taskIndex];
    const ret = plan.getTaskCompletion(this.taskIndex);
    if (!ret.ok) {
      return ret;
    }

    const taskStatus = ret.value;
    if (taskStatus.stage !== 'started') {
      return error(
        new Error(
          'Recalculating duration can only be applied to started tasks.'
        )
      );
    }

    // Record the current Task duration.
    const originalDuration: number =
      plan.chart.Vertices[this.taskIndex].duration;

    const percentComplete = taskStatus.percentComplete;
    const start = taskStatus.start;

    // We don't worry about divide by zero because started percentComplete's are
    // clamped to [1, 99].
    const newDuration = (this.today - start) / (percentComplete / 100);

    task.duration = plan
      .getStaticMetricDefinition('Duration')
      .clampAndRound(newDuration);

    return ok({
      plan: plan,
      inverse: new SetMetricValueSubOp(
        'Duration',
        originalDuration,
        this.taskIndex
      ),
    });
  }
}

export function InsertNewEmptyMilestoneAfterOp(taskIndex: number): Op {
  return new Op(
    [
      new RationalizeEdgesSubOp(),
      new AddTaskAfterSubOp(taskIndex),
      new AddEdgeSubOp(0, taskIndex + 1),
      new AddEdgeSubOp(taskIndex + 1, -1),
      new RationalizeEdgesSubOp(),
    ],
    'InsertNewEmptyMilestoneAfterOp'
  );
}

export function SetTaskNameOp(taskIndex: number, name: string): Op {
  return new Op([new SetTaskNameSubOp(taskIndex, name)], 'SetTaskNameOp');
}

export function SplitTaskOp(taskIndex: number): Op {
  const subOps: SubOp[] = [
    new DupTaskSubOp(taskIndex),
    new SplitDurationSubOp(taskIndex, taskIndex + 1),
    new MoveAllOutgoingEdgesFromToSubOp(taskIndex, taskIndex + 1),
    new AddEdgeSubOp(taskIndex, taskIndex + 1),
  ];

  return new Op(subOps, 'SplitTaskOp');
}

export function DupTaskOp(taskIndex: number): Op {
  const subOps: SubOp[] = [
    new DupTaskSubOp(taskIndex),
    new CopyAllEdgesFromToSubOp(taskIndex, taskIndex + 1),
  ];

  return new Op(subOps, 'DupTaskOp');
}

export function DeleteTaskOp(taskIndex: number): Op {
  return new Op(
    [
      new RationalizeEdgesSubOp(),
      new DeleteTaskSubOp(taskIndex),
      new RationalizeEdgesSubOp(),
    ],
    'DeleteTaskOp'
  );
}

export function AddEdgeOp(fromTaskIndex: number, toTaskIndex: number): Op {
  return new Op(
    [
      new RationalizeEdgesSubOp(),
      new AddEdgeSubOp(fromTaskIndex, toTaskIndex),
      new RationalizeEdgesSubOp(),
    ],
    'AddEdgeOp'
  );
}

export function RationalizeEdgesOp(): Op {
  return new Op([new RationalizeEdgesSubOp()], 'RationalizeEdgesOp');
}

export function RemoveEdgeOp(i: number, j: number): Op {
  return new Op(
    [
      new RationalizeEdgesSubOp(),
      new RemoveEdgeSupOp(i, j),
      new RationalizeEdgesSubOp(),
    ],
    'RemoveEdgeOp'
  );
}

let taskNumber = 0;

export const resetTaskNameCounter = () => {
  taskNumber = 0;
};

export function InsertNewEmptyTaskAfterOp(taskIndex: number): Op {
  return new Op(
    [
      new RationalizeEdgesSubOp(),
      new AddTaskAfterSubOp(taskIndex),
      new SetMetricValueSubOp('Duration', DEFAULT_TASK_DURATION, taskIndex + 1),
      new SetTaskNameSubOp(taskIndex + 1, `Task ${++taskNumber}`),
      new AddEdgeSubOp(0, taskIndex + 1),
      new AddEdgeSubOp(taskIndex + 1, -1),
      new RationalizeEdgesSubOp(),
    ],
    'InsertNewEmptyTaskAfterOp'
  );
}

export function CatchupOp(today: number, spans: Span[]) {
  return new Op([new CatchupSubOp(today, spans)], 'CatchupOp');
}

export function RecalculateDurationOp(today: number, taskIndex: number) {
  return new Op(
    [new RecalculateDurationSubOp(today, taskIndex)],
    'RecalculateDurationOp'
  );
}

export function CatchupTaskOp(
  today: number,
  taskIndex: number,
  span: Span
): Op {
  return new Op(
    [new CatchupTaskSubOp(today, taskIndex, span)],
    'CatchupTaskOp'
  );
}

export function SetTaskDescriptionOp(taskIndex: number, description: string) {
  return new Op(
    [new SetTaskDescriptionSubOp(taskIndex, description)],
    'SetTaskDescriptionOp'
  );
}
