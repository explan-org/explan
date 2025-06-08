import { Result, ok } from '../result.ts';
import { Plan } from '../plan/plan.ts';

// Operations on Plans. Note they are reversible, so we can have an 'undo' list.

// Also, some operations might have 'partials', i.e. return a list of valid
// options that can be passed to the operation. For example, adding a
// predecessor could list all the Tasks that would not form a loop, i.e. exclude
// all descendents, and the Task itself, from the list of options.
//
// * Change string value in a Task.
// * Change duration value in a Task.
// * Insert new empty Task after Index.
// * Split a Task. (Predecessor takes all incoming edges, source tasks all outgoing edges).
//
// * Duplicate a Task (all edges are duplicated from the source Task).
// * Delete predecessor to a Task.
// * Delete successor to a Task.
// * Delete a Task.

// Need Undo/Redo Stacks.
// These record the sub-ops for each large op. E.g. an insert task op is made
// of three sub-ops:
//    1. insert task into Vertices and renumber Edges
//    2. Add edge from Start to New Task
//    3. Add edge from New Task to Finish
//
// Each sub-op:
//    1. Records all the info it needs to work.
//    2. Can be "applied" to a Plan.
//    3. Can generate its inverse sub-op.

// The results from applying a SubOp. This is the only way to get the inverse of
// a SubOp since the SubOp inverse might depend on the state of the Plan at the
// time the SubOp was applied.
export interface SubOpResult {
  plan: Plan;
  inverse: SubOp;
}

export interface SubOp {
  // If the apply returns an error it is guaranteed not to have modified the
  // Plan.
  applyTo(plan: Plan): Result<SubOpResult>;
}

export interface OpResult {
  plan: Plan;
  inverse: Op;
}

// Op are operations are applied to make changes to a Plan.
export class Op {
  name: string;
  subOps: SubOp[] = [];

  constructor(subOps: SubOp[], name = 'unset') {
    this.subOps = subOps;
    this.name = name;
  }

  // Reverts all SubOps up to the given index.
  applyAllInverseSubOpsToPlan(
    plan: Plan,
    inverseSubOps: SubOp[]
  ): Result<Plan> {
    for (let i = 0; i < inverseSubOps.length; i++) {
      const e = inverseSubOps[i].applyTo(plan);
      if (!e.ok) {
        return e;
      }
      plan = e.value.plan;
    }

    return ok(plan);
  }

  // Applies the Op to a Plan.
  applyTo(plan: Plan): Result<OpResult> {
    const inverseSubOps: SubOp[] = [];
    for (let i = 0; i < this.subOps.length; i++) {
      const e = this.subOps[i].applyTo(plan);
      if (!e.ok) {
        // Revert all the SubOps applied up to this point to get the Plan back in a
        // good place.
        const revertErr = this.applyAllInverseSubOpsToPlan(plan, inverseSubOps);
        if (!revertErr.ok) {
          return revertErr;
        }
        return e;
      }
      plan = e.value.plan;
      inverseSubOps.unshift(e.value.inverse);
    }

    return ok({
      plan: plan,
      inverse: new Op(inverseSubOps, `-${this.name}`),
    });
  }
}

export type AllOpsResult = {
  ops: Op[];
  plan: Plan;
};

const applyAllInverseOpsToPlan = (inverses: Op[], plan: Plan): Result<Plan> => {
  for (let i = 0; i < inverses.length; i++) {
    const res = inverses[i].applyTo(plan);
    if (!res.ok) {
      return res;
    }
    plan = res.value.plan;
  }

  return ok(plan);
};

// Convenience function for applying multiple Ops to a plan, used mostly for
// testing.
export const applyAllOpsToPlan = (
  ops: Op[],
  plan: Plan
): Result<AllOpsResult> => {
  const inverses: Op[] = [];
  for (let i = 0; i < ops.length; i++) {
    const res = ops[i].applyTo(plan);
    if (!res.ok) {
      const inverseRes = applyAllInverseOpsToPlan(inverses, plan);
      if (!inverseRes.ok) {
        // TODO Can we wrap the Error in another error to make it clear this
        // error happened when trying to clean up from the previous Error when
        // the apply() failed.
        return inverseRes;
      }
      return res;
    }
    inverses.unshift(res.value.inverse);
    plan = res.value.plan;
  }

  return ok({
    ops: inverses,
    plan: plan,
  });
};

export const applyAllOpsToPlanAndThenInverse = (
  ops: Op[],
  plan: Plan
): Result<AllOpsResult> => {
  const res = applyAllOpsToPlan(ops, plan);
  if (!res.ok) {
    console.log(res);
    return res;
  }
  return applyAllOpsToPlan(res.value.ops, res.value.plan);
};
// NoOp is a no-op.
export function NoOp(): Op {
  return new Op([]);
}
