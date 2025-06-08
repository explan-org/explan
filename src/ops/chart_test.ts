import { assert } from '@esm-bundle/chai';
import { T2Op, TOp, TestOpsForwardAndBack } from './opstestutil.ts';
import {
  AddEdgeOp,
  SplitTaskOp,
  InsertNewEmptyTaskAfterOp,
  SetTaskNameOp,
  DupTaskOp,
  splitDuration,
  DEFAULT_TASK_DURATION,
  CatchupOp,
  RecalculateDurationOp,
  CatchupTaskOp,
  SetTaskDescriptionOp,
  resetTaskNameCounter,
} from './chart.ts';
import { SetPlanStartStateOp, SetTaskCompletionOp } from './plan.ts';
import { Plan } from '../plan/plan.ts';
import { DEFAULT_TASK_NAME } from '../chart/chart.ts';
import { DirectedEdge } from '../dag/dag.ts';
import { Span } from '../slack/slack.ts';
import { SetMetricValueOp } from './metrics.ts';

const arrowSummary = (plan: Plan): string[] =>
  plan.chart.Edges.map(
    (d: DirectedEdge) =>
      `${plan.chart.Vertices[d.i].name}->${plan.chart.Vertices[d.j].name}`
  ).sort();

describe('Chart Ops Tests', () => {
  beforeEach(() => {
    resetTaskNameCounter();
  });

  describe('InsertNewEmptyTaskAfterOp', () => {
    it('Adds both a Task and Vertices.', () => {
      TestOpsForwardAndBack([
        T2Op((plan: Plan, forward: boolean) => {
          if (forward) {
            assert.deepEqual(plan.chart.Edges, [new DirectedEdge(0, 1)]);
            assert.equal(plan.chart.Vertices.length, 2);
          } else {
            assert.deepEqual(plan.chart.Edges, [new DirectedEdge(0, 1)]);
            assert.equal(plan.chart.Vertices.length, 2);
          }
        }),
        InsertNewEmptyTaskAfterOp(0),
        TOp((plan: Plan) => {
          assert.deepEqual(arrowSummary(plan), [
            'Start->Task 1',
            'Task 1->Finish',
          ]);
          assert.equal(plan.chart.Vertices.length, 3);
        }),
      ]);
    });

    it('Fails if the taskIndex is out of range', () => {
      const res = InsertNewEmptyTaskAfterOp(2).applyTo(new Plan());
      assert.isFalse(res.ok);
      assert.isTrue(res.error.message.includes('is not in range'));
    });

    it('Fails if the taskIndex is out of range', () => {
      const res = InsertNewEmptyTaskAfterOp(-1).applyTo(new Plan());
      assert.isFalse(res.ok);
      assert.isTrue(res.error.message.includes('is not in range'));
    });
  });

  describe('SetTaskName', () => {
    const newTaskName = 'An updated task name';
    it('Sets a tasks name.', () => {
      TestOpsForwardAndBack([
        InsertNewEmptyTaskAfterOp(0),
        T2Op((plan: Plan) => {
          assert.equal(plan.chart.Vertices[1].name, 'Task 1');
        }),
        SetTaskNameOp(1, newTaskName),
        TOp((plan: Plan) => {
          assert.equal(plan.chart.Vertices[1].name, newTaskName);
        }),
      ]);
    });

    it('Fails if the taskIndex is out of range', () => {
      const res = SetTaskNameOp(-1, 'foo').applyTo(new Plan());
      assert.isFalse(res.ok);
      assert.isTrue(res.error.message.includes('is not in range'));
    });

    it('Fails if the taskIndex is out of range', () => {
      const res = SetTaskNameOp(2, 'bar').applyTo(new Plan());
      assert.isFalse(res.ok);
      assert.isTrue(res.error.message.includes('is not in range'));
    });
  });

  describe('SplitTaskOp', () => {
    it('Adds both a Task and moves the Vertices.', () => {
      TestOpsForwardAndBack([
        T2Op((plan: Plan) => {
          assert.deepEqual(arrowSummary(plan), ['Start->Finish']);
          assert.equal(plan.chart.Vertices.length, 2);
        }),
        InsertNewEmptyTaskAfterOp(0),
        SetTaskNameOp(1, 'A'),
        InsertNewEmptyTaskAfterOp(1),
        SetTaskNameOp(2, 'B'),
        T2Op((plan: Plan) => {
          assert.deepEqual(arrowSummary(plan).sort(), [
            'A->Finish',
            'B->Finish',
            'Start->A',
            'Start->B',
          ]);
        }),

        InsertNewEmptyTaskAfterOp(2),
        SetTaskNameOp(3, 'C'),
        T2Op((plan: Plan, forward: boolean) => {
          assert.deepEqual(
            arrowSummary(plan).sort(),
            [
              'A->Finish',
              'B->Finish',
              'C->Finish',
              'Start->A',
              'Start->B',
              'Start->C',
            ],
            `Direction: ${forward ? 'forward' : 'backward'}`
          );
          assert.equal(plan.chart.Vertices.length, 5);
        }),

        AddEdgeOp(1, 3),
        AddEdgeOp(2, 3),
        T2Op((plan: Plan) => {
          assert.deepEqual(arrowSummary(plan), [
            'A->C',
            'B->C',
            'C->Finish',
            'Start->A',
            'Start->B',
          ]);
          assert.equal(plan.chart.Vertices.length, 5);
          assert.equal(plan.chart.Vertices[3].duration, DEFAULT_TASK_DURATION);
        }),
        SplitTaskOp(3), // Split "C".
        SetTaskNameOp(4, 'D'),
        TOp((plan: Plan) => {
          assert.deepEqual(arrowSummary(plan), [
            'A->C',
            'B->C',
            'C->D',
            'D->Finish',
            'Start->A',
            'Start->B',
          ]);
          assert.equal(plan.chart.Vertices.length, 6);
          const [d1, d2] = splitDuration(DEFAULT_TASK_DURATION);
          assert.equal(plan.chart.Vertices[3].duration, d1);
          assert.equal(plan.chart.Vertices[4].duration, d2);
        }),
      ]);
    });

    it('Fails if the taskIndex is out of range', () => {
      const res = InsertNewEmptyTaskAfterOp(2).applyTo(new Plan());
      assert.isFalse(res.ok);
      assert.isTrue(res.error.message.includes('is not in range'));
    });

    it('Fails if the taskIndex is out of range', () => {
      const res = InsertNewEmptyTaskAfterOp(-1).applyTo(new Plan());
      assert.isFalse(res.ok);
      assert.isTrue(res.error.message.includes('is not in range'));
    });
  });

  describe('DupTaskOp', () => {
    it('Fails if the taskIndex is out of range', () => {
      let res = InsertNewEmptyTaskAfterOp(0).applyTo(new Plan());
      assert.isTrue(res.ok);
      res = DupTaskOp(-1).applyTo(res.value.plan);
      assert.isFalse(res.ok);
      assert.isTrue(res.error.message.includes('is not in range'));
    });

    it('Fails if the taskIndex is out of range', () => {
      let res = InsertNewEmptyTaskAfterOp(0).applyTo(new Plan());
      assert.isTrue(res.ok);
      res = DupTaskOp(2).applyTo(res.value.plan);
      assert.isFalse(res.ok);
      assert.isTrue(res.error.message.includes('is not in range'));
    });

    it('Adds both a Task and moves the Vertices.', () => {
      TestOpsForwardAndBack([
        T2Op((plan: Plan) => {
          assert.deepEqual(arrowSummary(plan), ['Start->Finish']);
          assert.equal(plan.chart.Vertices.length, 2);
        }),
        InsertNewEmptyTaskAfterOp(0),
        SetTaskNameOp(1, 'A'),
        InsertNewEmptyTaskAfterOp(1),
        SetTaskNameOp(2, 'B'),
        T2Op((plan: Plan) => {
          assert.deepEqual(arrowSummary(plan).sort(), [
            'A->Finish',
            'B->Finish',
            'Start->A',
            'Start->B',
          ]);
        }),

        InsertNewEmptyTaskAfterOp(2),
        SetTaskNameOp(3, 'C'),
        T2Op((plan: Plan, forward: boolean) => {
          assert.deepEqual(
            arrowSummary(plan).sort(),
            [
              'A->Finish',
              'B->Finish',
              'C->Finish',
              'Start->A',
              'Start->B',
              'Start->C',
            ],
            `Direction: ${forward ? 'forward' : 'backward'}`
          );
          assert.equal(plan.chart.Vertices.length, 5);
        }),

        AddEdgeOp(1, 3),
        AddEdgeOp(2, 3),
        T2Op((plan: Plan) => {
          assert.deepEqual(arrowSummary(plan), [
            'A->C',
            'B->C',
            'C->Finish',
            'Start->A',
            'Start->B',
          ]);
          assert.equal(plan.chart.Vertices.length, 5);
        }),
        DupTaskOp(3),
        SetTaskNameOp(4, 'D'),
        TOp((plan: Plan) => {
          assert.deepEqual(arrowSummary(plan), [
            'A->C',
            'A->D',
            'B->C',
            'B->D',
            'C->Finish',
            'D->Finish',
            'Start->A',
            'Start->B',
          ]);
          assert.equal(plan.chart.Vertices.length, 6);
        }),
      ]);
    });

    it('Adds both a Task and moves the Vertices.', () => {
      TestOpsForwardAndBack([
        T2Op((plan: Plan) => {
          assert.deepEqual(arrowSummary(plan), ['Start->Finish']);
          assert.equal(plan.chart.Vertices.length, 2);
        }),
        InsertNewEmptyTaskAfterOp(0),
        SetTaskNameOp(1, 'A'),
        DupTaskOp(1),
        SetTaskNameOp(2, 'B'),
        TOp((plan: Plan) => {
          assert.deepEqual(arrowSummary(plan), [
            'A->Finish',
            'B->Finish',
            'Start->A',
            'Start->B',
          ]);
          assert.equal(plan.chart.Vertices.length, 4);
        }),
      ]);
    });
  });

  describe('splitDuration', () => {
    it('can divide odd numbers', () => {
      assert.deepEqual(splitDuration(5), [3, 2]);
    });

    it('can divide even numbers', () => {
      assert.deepEqual(splitDuration(16), [8, 8]);
    });
  });

  describe('CatchupOp', () => {
    it('Marks tasks stage correctly.', () => {
      TestOpsForwardAndBack([
        T2Op((plan: Plan) => {
          assert.deepEqual(arrowSummary(plan), ['Start->Finish']);
          assert.equal(plan.chart.Vertices.length, 2);
        }),

        // Set three tasks A -> B -> C.
        // Also set their duration to 10.
        InsertNewEmptyTaskAfterOp(0),
        SetTaskNameOp(1, 'A'),
        SetMetricValueOp('Duration', 10, 1),

        InsertNewEmptyTaskAfterOp(0),
        SetTaskNameOp(1, 'B'),
        SetMetricValueOp('Duration', 10, 1),

        InsertNewEmptyTaskAfterOp(0),
        SetTaskNameOp(1, 'C'),
        SetMetricValueOp('Duration', 10, 1),

        AddEdgeOp(3, 2),
        AddEdgeOp(2, 1),
        T2Op((plan: Plan) => {
          assert.deepEqual(arrowSummary(plan).sort(), [
            'A->B',
            'B->C',
            'C->Finish',
            'Start->A',
          ]);
          let comp = plan.getTaskCompletion(1);
          assert.isTrue(comp.ok);
          assert.equal(comp.value.stage, 'unstarted');

          comp = plan.getTaskCompletion(2);
          assert.isTrue(comp.ok);
          assert.equal(comp.value.stage, 'unstarted');

          comp = plan.getTaskCompletion(2);
          assert.isTrue(comp.ok);
          assert.equal(comp.value.stage, 'unstarted');
        }),

        // Now call Catchup to 15, which is in the middle of B.
        CatchupOp(15, [
          new Span(0, 0),
          new Span(0, 10),
          new Span(10, 20),
          new Span(20, 30),
          new Span(30, 30),
        ]),

        // The three tasks should be Finished (A) -> Started (B) -> Unstarted (C)
        TOp((plan: Plan) => {
          let comp = plan.getTaskCompletion(1);
          assert.isTrue(comp.ok);
          assert.equal(comp.value.stage, 'finished');

          comp = plan.getTaskCompletion(2);
          assert.isTrue(comp.ok);
          assert.equal(comp.value.stage, 'started');
          if (comp.value.stage === 'started') {
            assert.equal(comp.value.percentComplete, 50);
          }

          comp = plan.getTaskCompletion(3);
          assert.isTrue(comp.ok);
          assert.equal(comp.value.stage, 'unstarted');
        }),
      ]);
    });
  });

  describe('RecalculateDurationSubOp', () => {
    it('Changes duration correctly.', () => {
      TestOpsForwardAndBack([
        T2Op((plan: Plan) => {
          assert.deepEqual(arrowSummary(plan), ['Start->Finish']);
          assert.equal(plan.chart.Vertices.length, 2);
        }),

        SetPlanStartStateOp({ stage: 'started', start: Date.now() }),

        // Set three tasks A, B, C.
        // Also set their duration to 10.

        InsertNewEmptyTaskAfterOp(0),
        SetTaskNameOp(1, 'C'),
        SetMetricValueOp('Duration', 10, 1),
        SetTaskCompletionOp(1, {
          stage: 'started',
          percentComplete: 80,
          start: 0,
        }),

        InsertNewEmptyTaskAfterOp(0),
        SetTaskNameOp(1, 'B'),
        SetMetricValueOp('Duration', 10, 1),
        SetTaskCompletionOp(1, {
          stage: 'started',
          percentComplete: 50,
          start: 0,
        }),

        InsertNewEmptyTaskAfterOp(0),
        SetTaskNameOp(1, 'A'),
        SetMetricValueOp('Duration', 10, 1),
        SetTaskCompletionOp(1, {
          stage: 'started',
          percentComplete: 10,
          start: 0,
        }),

        T2Op((plan: Plan) => {
          assert.deepEqual(arrowSummary(plan).sort(), [
            'A->Finish',
            'B->Finish',
            'C->Finish',
            'Start->A',
            'Start->B',
            'Start->C',
          ]);
          let comp = plan.getTaskCompletion(1);
          assert.isTrue(comp.ok);
          assert.equal(comp.value.stage, 'started');
          assert.equal(plan.chart.Vertices[1].duration, 10);

          comp = plan.getTaskCompletion(2);
          assert.isTrue(comp.ok);
          assert.equal(comp.value.stage, 'started');
          assert.equal(plan.chart.Vertices[2].duration, 10);

          comp = plan.getTaskCompletion(3);
          assert.isTrue(comp.ok);
          assert.equal(comp.value.stage, 'started');
          assert.equal(plan.chart.Vertices[3].duration, 10);
        }),

        // Now call Catchup to 15, which is in the middle of B.
        RecalculateDurationOp(5, 1),
        RecalculateDurationOp(5, 2),
        RecalculateDurationOp(5, 3),

        // The three tasks should be Finished (A) -> Started (B) -> Unstarted (C)
        TOp((plan: Plan) => {
          assert.equal(plan.chart.Vertices[1].duration, 50);
          assert.equal(plan.chart.Vertices[2].duration, 10);
          assert.equal(plan.chart.Vertices[3].duration, 6);
        }),
      ]);
    });
  });

  describe('CatchupTaskOp', () => {
    it('Marks task stage correctly.', () => {
      TestOpsForwardAndBack([
        T2Op((plan: Plan) => {
          assert.deepEqual(arrowSummary(plan), ['Start->Finish']);
          assert.equal(plan.chart.Vertices.length, 2);
        }),

        // Set three tasks A -> B -> C.
        // Also set their duration to 10.
        InsertNewEmptyTaskAfterOp(0),
        SetTaskNameOp(1, 'A'),
        SetMetricValueOp('Duration', 10, 1),

        InsertNewEmptyTaskAfterOp(0),
        SetTaskNameOp(1, 'B'),
        SetMetricValueOp('Duration', 10, 1),

        InsertNewEmptyTaskAfterOp(0),
        SetTaskNameOp(1, 'C'),
        SetMetricValueOp('Duration', 10, 1),

        AddEdgeOp(3, 2),
        AddEdgeOp(2, 1),
        T2Op((plan: Plan) => {
          assert.deepEqual(arrowSummary(plan).sort(), [
            'A->B',
            'B->C',
            'C->Finish',
            'Start->A',
          ]);
          let comp = plan.getTaskCompletion(1);
          assert.isTrue(comp.ok);
          assert.equal(comp.value.stage, 'unstarted');

          comp = plan.getTaskCompletion(2);
          assert.isTrue(comp.ok);
          assert.equal(comp.value.stage, 'unstarted');

          comp = plan.getTaskCompletion(2);
          assert.isTrue(comp.ok);
          assert.equal(comp.value.stage, 'unstarted');
        }),

        // Now call Catchup to 15, which is in the middle of B.
        CatchupTaskOp(15, 2, new Span(10, 20)),

        // The three tasks should be Finished (A) -> Started (B) -> Unstarted (C)
        TOp((plan: Plan) => {
          let comp = plan.getTaskCompletion(1);
          assert.isTrue(comp.ok);
          assert.equal(comp.value.stage, 'unstarted');

          comp = plan.getTaskCompletion(2);
          assert.isTrue(comp.ok);
          assert.equal(comp.value.stage, 'started');
          if (comp.value.stage === 'started') {
            assert.equal(comp.value.percentComplete, 50);
          }

          comp = plan.getTaskCompletion(3);
          assert.isTrue(comp.ok);
          assert.equal(comp.value.stage, 'unstarted');
        }),
      ]);
    });
  });

  describe('SetTaskDescription', () => {
    const newTaskDescription = 'An updated description';
    it('Sets a tasks name.', () => {
      TestOpsForwardAndBack([
        InsertNewEmptyTaskAfterOp(0),
        T2Op((plan: Plan) => {
          assert.equal(plan.chart.Vertices[1].description, '');
        }),
        SetTaskDescriptionOp(1, newTaskDescription),
        TOp((plan: Plan) => {
          assert.equal(plan.chart.Vertices[1].description, newTaskDescription);
        }),
      ]);
    });

    it('Fails if the taskIndex is out of range', () => {
      const res = SetTaskDescriptionOp(-1, 'foo').applyTo(new Plan());
      assert.isFalse(res.ok);
      assert.isTrue(res.error.message.includes('is not in range'));
    });

    it('Fails if the taskIndex is out of range', () => {
      const res = SetTaskDescriptionOp(2, 'bar').applyTo(new Plan());
      assert.isFalse(res.ok);
      assert.isTrue(res.error.message.includes('is not in range'));
    });
  });
});
