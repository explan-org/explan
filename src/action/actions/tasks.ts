import { DirectedEdge, edgesBySrcAndDstToMap } from '../../dag/dag';
import { ExplanMain } from '../../explanMain/explanMain';
import {
  DeleteTaskOp,
  DupTaskOp,
  InsertNewEmptyTaskAfterOp,
  SplitTaskOp,
} from '../../ops/chart';
import { error, ok, Result } from '../../result';
import { Action, ActionFromOp, NOOPAction, PostActonWork } from '../action';

export class SplitTaskAction implements Action {
  description: string = 'Splits a task.';
  postActionWork: PostActonWork = 'planDefinitionChanged';
  undo: boolean = true;

  async do(explanMain: ExplanMain): Promise<Result<Action>> {
    if (explanMain.selectedTask === -1) {
      return error(new Error('A task must be selected first.'));
    }
    const ret = SplitTaskOp(explanMain.selectedTask).applyTo(explanMain.plan);
    if (!ret.ok) {
      return ret;
    }
    return ok(
      new ActionFromOp(ret.value.inverse, this.postActionWork, this.undo)
    );
  }
}

export class DupTaskAction implements Action {
  description: string = 'Duplicates a task.';
  postActionWork: PostActonWork = 'planDefinitionChanged';
  undo: boolean = true;

  async do(explanMain: ExplanMain): Promise<Result<Action>> {
    if (explanMain.selectedTask === -1) {
      return error(new Error('A task must be selected first.'));
    }
    const ret = DupTaskOp(explanMain.selectedTask).applyTo(explanMain.plan);
    if (!ret.ok) {
      return ret;
    }
    return ok(
      new ActionFromOp(ret.value.inverse, this.postActionWork, this.undo)
    );
  }
}

export class NewTaskAction implements Action {
  description: string = 'Creates a new task.';
  postActionWork: PostActonWork = 'planDefinitionChanged';
  undo: boolean = true;

  async do(explanMain: ExplanMain): Promise<Result<Action>> {
    const ret = InsertNewEmptyTaskAfterOp(0).applyTo(explanMain.plan);
    if (!ret.ok) {
      return ret;
    }
    return ok(
      new ActionFromOp(ret.value.inverse, this.postActionWork, this.undo)
    );
  }
}

export class DeleteTaskAction implements Action {
  description: string = 'Deletes a task.';
  postActionWork: PostActonWork = 'planDefinitionChanged';
  undo: boolean = true;

  async do(explanMain: ExplanMain): Promise<Result<Action>> {
    if (explanMain.selectedTask === -1) {
      return error(new Error('A task must be selected first.'));
    }
    const ret = DeleteTaskOp(explanMain.selectedTask).applyTo(explanMain.plan);
    if (!ret.ok) {
      return ret;
    }
    explanMain.selectedTask = -1;
    return ok(
      new ActionFromOp(ret.value.inverse, this.postActionWork, this.undo)
    );
  }
}

export class MoveFocusToPredecessor1 implements Action {
  description: string = 'Moves focus to the first predecessor task.';
  postActionWork: PostActonWork = 'planDefinitionChanged';
  undo: boolean = false;
  predIndex: number = 0;

  async do(explanMain: ExplanMain): Promise<Result<Action>> {
    if (explanMain.selectedTask === -1) {
      return error(new Error('A task must be selected first.'));
    }

    // Find all the predecessors. Then move the focus to it.
    const edges = edgesBySrcAndDstToMap(explanMain.plan.chart.Edges);
    const predecessors = (edges.byDst.get(explanMain.selectedTask) || []).map(
      (e: DirectedEdge) => e.i
    );
    predecessors.reverse();
    const selected =
      predecessors.length > this.predIndex && predecessors[this.predIndex];
    if (selected === false || selected === 0) {
      return error(new Error("Can't edit that task."));
    }

    explanMain.selectedTask = selected;

    return ok(new NOOPAction());
  }
}

export class MoveFocusToPredecessor2 extends MoveFocusToPredecessor1 {
  constructor() {
    super();
    this.predIndex = 1;
    this.description = 'Moves focus to the second predecessor task.';
  }
}

export class MoveFocusToPredecessor3 extends MoveFocusToPredecessor1 {
  constructor() {
    super();
    this.predIndex = 2;
    this.description = 'Moves focus to the third predecessor task.';
  }
}

export class MoveFocusToPredecessor4 extends MoveFocusToPredecessor1 {
  constructor() {
    super();
    this.predIndex = 3;
    this.description = 'Moves focus to the fourth predecessor task.';
  }
}

export class MoveFocusToPredecessor5 extends MoveFocusToPredecessor1 {
  constructor() {
    super();
    this.predIndex = 4;
    this.description = 'Moves focus to the fifth predecessor task.';
  }
}

export class MoveFocusToPredecessor6 extends MoveFocusToPredecessor1 {
  constructor() {
    super();
    this.predIndex = 5;
    this.description = 'Moves focus to the sixth predecessor task.';
  }
}

export class MoveFocusToPredecessor7 extends MoveFocusToPredecessor1 {
  constructor() {
    super();
    this.predIndex = 6;
    this.description = 'Moves focus to the seventh predecessor task.';
  }
}

export class MoveFocusToPredecessor8 extends MoveFocusToPredecessor1 {
  constructor() {
    super();
    this.predIndex = 7;
    this.description = 'Moves focus to the eighth predecessor task.';
  }
}

export class MoveFocusToPredecessor9 extends MoveFocusToPredecessor1 {
  constructor() {
    super();
    this.predIndex = 8;
    this.description = 'Moves focus to the ninth predecessor task.';
  }
}

export class MoveFocusToSuccessor1 implements Action {
  description: string = 'Moves focus to the first successor task.';
  postActionWork: PostActonWork = 'planDefinitionChanged';
  undo: boolean = false;
  succIndex: number = 0;

  async do(explanMain: ExplanMain): Promise<Result<Action>> {
    if (explanMain.selectedTask === -1) {
      return error(new Error('A task must be selected first.'));
    }

    // Find all the successors. Then move the focus to it.
    const edges = edgesBySrcAndDstToMap(explanMain.plan.chart.Edges);
    const successors = (edges.bySrc.get(explanMain.selectedTask) || []).map(
      (e: DirectedEdge) => e.j
    );
    successors.reverse();
    const selected =
      successors.length > this.succIndex && successors[this.succIndex];
    if (
      selected === false ||
      selected === explanMain.plan.chart.Vertices.length - 1
    ) {
      return error(new Error("Can't edit that task."));
    }

    explanMain.selectedTask = selected;

    return ok(new NOOPAction());
  }
}

export class MoveFocusToSuccessor2 extends MoveFocusToSuccessor1 {
  constructor() {
    super();
    this.succIndex = 1;
    this.description = 'Moves focus to the second successor task.';
  }
}

export class MoveFocusToSuccessor3 extends MoveFocusToSuccessor1 {
  constructor() {
    super();
    this.succIndex = 2;
    this.description = 'Moves focus to the third successor task.';
  }
}

export class MoveFocusToSuccessor4 extends MoveFocusToSuccessor1 {
  constructor() {
    super();
    this.succIndex = 3;
    this.description = 'Moves focus to the fourth successor task.';
  }
}

export class MoveFocusToSuccessor5 extends MoveFocusToSuccessor1 {
  constructor() {
    super();
    this.succIndex = 4;
    this.description = 'Moves focus to the fifth successor task.';
  }
}

export class MoveFocusToSuccessor6 extends MoveFocusToSuccessor1 {
  constructor() {
    super();
    this.succIndex = 5;
    this.description = 'Moves focus to the sixth successor task.';
  }
}

export class MoveFocusToSuccessor7 extends MoveFocusToSuccessor1 {
  constructor() {
    super();
    this.succIndex = 6;
    this.description = 'Moves focus to the seventh successor task.';
  }
}

export class MoveFocusToSuccessor8 extends MoveFocusToSuccessor1 {
  constructor() {
    super();
    this.succIndex = 7;
    this.description = 'Moves focus to the eighth successor task.';
  }
}

export class MoveFocusToSuccessor9 extends MoveFocusToSuccessor1 {
  constructor() {
    super();
    this.succIndex = 8;
    this.description = 'Moves focus to the ninth successor task.';
  }
}
