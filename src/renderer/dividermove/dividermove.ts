/**
 * Functionality for creating draggable dividers between elements on a page.
 */
import { clamp } from '../../metrics/range.ts';
import { Point, dup, equal, pt } from '../../point/point.ts';

// Values are returned as percentages around the current mouse location. That
// is, if we are in "column" mode then `before` would equal the mouse position
// as a % of the width of the parent element from the left hand side of the
// parent element. The `after` value is just 100-before.
export interface DividerMoveResult {
  before: number;
  after: number;
}

export type DividerType = 'column' | 'row';

export const DIVIDER_MOVE_EVENT = 'divider_move';

export const RESIZING_CLASS = 'resizing';
export const DIVIDER_MOVING_CLASS = 'dragging';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Returns a bounding rectangle for an element in Page coordinates, as opposed
 * to ViewPort coordinates, which is what getBoundingClientRect() returns.
 */
export const getPageRect = (ele: HTMLElement): Rect => {
  const viewportRect = ele.getBoundingClientRect();
  return {
    top: viewportRect.top + window.scrollY,
    left: viewportRect.left + window.scrollX,
    width: viewportRect.width,
    height: viewportRect.height,
  };
};

/** DividerMove is core functionality for creating draggable dividers between
 * elements on a page.
 *
 * Construct a DividerMode with a parent element and a divider element, where
 * the divider element is the element between other page elements that is
 * expected to be dragged. For example, in the following example #container
 * would be the `parent`, and #divider would be the `divider` element.
 *
 *  <div id=container>
 *    <div id=left></div>  <div id=divider></div> <div id=right></div?
 *  </div>
 *
 * DividerMode waits for a mousedown event on the `divider` element and then
 * watches mouse events for the given parent HTMLElement and emits events around
 * dragging.
 *
 * The emitted event is "divider_move" and is a CustomEvent<DividerMoveResult>.
 *
 * It is up to the user of DividerMove to listen for the "divider_move" events
 * and update the CSS of the page appropriately to reflect the position of the
 * divider.
 *
 * Once the mouse is down an event will be emitted periodically as the mouse
 * moves.
 *
 * Once the mouse is released, or if the mouse exits the parent HTMLElement, one
 * last event is emitted.
 *
 * While dragging the divider, the "resizing" class will be added to the parent
 * element. This can be used to set a style, e.g. 'user-select: none'.
 */
export class DividerMove {
  /** The point where dragging started, in Page coordinates. */
  begin: Point | null = null;

  /** The dimensions of the parent element in Page coordinates as of mousedown
   * on the divider.. */
  parentRect: Rect | null = null;

  /** The current mouse position in Page coordinates. */
  currentMoveLocation: Point = pt(0, 0);

  /** The last mouse position in Page coordinates reported via CustomEvent. */
  lastMoveSent: Point = pt(0, 0);

  /** The parent element that contains the divider. */
  parent: HTMLElement;

  /** The divider element to be dragged across the parent element. */
  divider: HTMLElement;

  /** The handle of the window.setInterval(). */
  internvalHandle: number = 0;

  /** The type of divider, either vertical ("column"), or horizontal ("row"). */
  dividerType: DividerType;

  constructor(
    parent: HTMLElement,
    divider: HTMLElement,
    dividerType: DividerType = 'column'
  ) {
    this.parent = parent;
    this.divider = divider;
    this.dividerType = dividerType;
    this.divider.addEventListener('mousedown', this.mousedown.bind(this));
  }

  detach() {
    this.parent.removeEventListener('mousemove', this.mousemove.bind(this));
    this.divider.removeEventListener('mousedown', this.mousedown.bind(this));
    this.parent.removeEventListener('mouseup', this.mouseup.bind(this));
    this.parent.removeEventListener('mouseleave', this.mouseleave.bind(this));
    window.clearInterval(this.internvalHandle);
  }

  onTimeout() {
    if (!equal(this.currentMoveLocation, this.lastMoveSent)) {
      let diffPercent: number = 0;
      if (this.dividerType === 'column') {
        diffPercent =
          (100 * (this.currentMoveLocation.x - this.parentRect!.left)) /
          this.parentRect!.width;
      } else {
        diffPercent =
          (100 * (this.currentMoveLocation.y - this.parentRect!.top)) /
          this.parentRect!.height;
      }
      // TODO - Should clamp be settable in the constructor?
      diffPercent = clamp(diffPercent, 5, 95);

      this.parent.dispatchEvent(
        new CustomEvent<DividerMoveResult>(DIVIDER_MOVE_EVENT, {
          detail: {
            before: diffPercent,
            after: 100 - diffPercent,
          },
        })
      );
      this.lastMoveSent = dup(this.currentMoveLocation);
    }
  }

  mousemove(e: MouseEvent) {
    if (this.begin === null) {
      return;
    }
    this.currentMoveLocation.x = e.pageX;
    this.currentMoveLocation.y = e.pageY;
  }

  mousedown(e: MouseEvent) {
    this.internvalHandle = window.setInterval(this.onTimeout.bind(this), 16);
    this.parentRect = getPageRect(this.parent);

    this.parent.classList.add(RESIZING_CLASS);
    this.divider.classList.add(DIVIDER_MOVING_CLASS);

    this.parent.addEventListener('mousemove', this.mousemove.bind(this));
    this.parent.addEventListener('mouseup', this.mouseup.bind(this));
    this.parent.addEventListener('mouseleave', this.mouseleave.bind(this));

    this.begin = pt(e.pageX, e.pageY);
  }

  mouseup(e: MouseEvent) {
    if (this.begin === null) {
      return;
    }
    this.finished(pt(e.pageX, e.pageY));
  }

  mouseleave(e: MouseEvent) {
    if (this.begin === null) {
      return;
    }
    this.finished(pt(e.pageX, e.pageY));
  }

  finished(end: Point) {
    window.clearInterval(this.internvalHandle);

    this.parent.classList.remove(RESIZING_CLASS);
    this.divider.classList.remove(DIVIDER_MOVING_CLASS);

    this.parent.removeEventListener('mousemove', this.mousemove.bind(this));
    this.parent.removeEventListener('mouseup', this.mouseup.bind(this));
    this.parent.removeEventListener('mouseleave', this.mouseleave.bind(this));

    this.currentMoveLocation = end;
    this.onTimeout();
    this.begin = null;
    this.currentMoveLocation = pt(0, 0);
    this.lastMoveSent = pt(0, 0);
  }
}
