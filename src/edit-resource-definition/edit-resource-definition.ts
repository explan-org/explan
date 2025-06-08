import { TemplateResult, html, render } from 'lit-html';
import { ResourceDefinition } from '../resources/resources';
import { ExplanMain } from '../explanMain/explanMain';
import { icon } from '../icons/icons';
import { executeOp } from '../action/execute';
import {
  AddResourceOptionOp,
  DeleteResourceOptionOp,
  MoveResourceOptionOp,
  RenameResourceOp,
  RenameResourceOptionOp,
} from '../ops/resources';
import { Op } from '../ops/ops';
import { Result } from '../result';
import { live } from 'lit-html/directives/live.js';
import { reportIfError } from '../report-error/report-error';

export class EditResourceDefinition extends HTMLElement {
  explanMain: ExplanMain | null = null;
  resourceDefinition: ResourceDefinition = new ResourceDefinition();
  name: string = '';
  planDefinitionChangedCallback: () => void;
  newValueCounter = 0;

  constructor() {
    super();
    this.planDefinitionChangedCallback = () => {
      this.render();
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

  showModal(
    explanMain: ExplanMain,
    name: string,
    resourceDefinition: ResourceDefinition
  ) {
    this.explanMain = explanMain;
    this.resourceDefinition = resourceDefinition;
    this.name = name;
    this.render();
    this.querySelector<HTMLDialogElement>('dialog')!.showModal();
  }

  private render() {
    render(this.template(), this);
  }

  private cancel() {
    this.querySelector<HTMLDialogElement>('dialog')!.close();
  }

  private async executeOp(op: Op): Promise<Result<null>> {
    const ret = await executeOp(
      op,
      'planDefinitionChanged',
      true,
      this.explanMain!
    );
    reportIfError(ret);
    return ret;
  }

  private async changeResourceName(e: Event, newName: string, oldName: string) {
    const ret = await this.executeOp(RenameResourceOp(oldName, newName));
    reportIfError(ret);
    this.name = newName;
  }

  private async changeResourceValueName(
    e: Event,
    newValue: string,
    oldValue: string
  ) {
    const ret = await this.executeOp(
      RenameResourceOptionOp(this.name, oldValue, newValue)
    );
    reportIfError(ret);
  }

  private getProposedResourceName(): string {
    this.newValueCounter++;
    return `New Value ${this.newValueCounter}`;
  }

  private async newResourceValue() {
    this.newValueCounter = 0;
    // Come up with a unique name to add, since all resource values must be
    // unique for a given resource name.
    let newResourceName = this.getProposedResourceName();
    while (
      this.explanMain!.plan.resourceDefinitions[this.name].values.findIndex(
        (value: string) => value === newResourceName
      ) != -1
    ) {
      newResourceName = this.getProposedResourceName();
    }

    await this.executeOp(AddResourceOptionOp(this.name, newResourceName));
  }

  private async moveUp(value: string, valueIndex: number) {
    await this.executeOp(
      MoveResourceOptionOp(this.name, valueIndex, valueIndex - 1)
    );
  }

  private async moveDown(value: string, valueIndex: number) {
    await this.executeOp(
      MoveResourceOptionOp(this.name, valueIndex, valueIndex + 1)
    );
  }

  private async moveToTop(value: string, valueIndex: number) {
    await this.executeOp(MoveResourceOptionOp(this.name, valueIndex, 0));
  }

  private async moveToBottom(value: string, valueIndex: number) {
    await this.executeOp(
      MoveResourceOptionOp(
        this.name,
        valueIndex,
        this.explanMain!.plan.resourceDefinitions[this.name]!.values.length - 1
      )
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async deleteResourceValue(value: string, _valueIndex: number) {
    await this.executeOp(DeleteResourceOptionOp(this.name, value));
  }

  private template(): TemplateResult {
    return html`
      <dialog>
        <label>
          Name:
          <input
            type="text"
            .value=${live(this.name)}
            data-old-name=${this.name}
            @change=${(e: Event) => {
              const ele = e.target as HTMLInputElement;
              this.changeResourceName(e, ele.value, ele.dataset.oldName || '');
            }}
          />
        </label>
        <table>
          ${this.resourceDefinition.values.map(
            (value: string, valueIndex: number) => {
              return html`<tr>
                <td>${valueIndex === 0 ? '*' : ''}</td>
                <td>
                  <input
                    data-old-value=${value}
                    @change=${(e: Event) => {
                      const ele = e.target as HTMLInputElement;
                      this.changeResourceValueName(
                        e,
                        ele.value,
                        ele.dataset.oldValue || ''
                      );
                    }}
                    .value=${live(value)}
                    type="text"
                  />
                </td>
                <td>
                  <button
                    @click=${() => this.moveUp(value, valueIndex)}
                    class="icon-button"
                    .disabled=${valueIndex === 0}
                  >
                    ${icon('keyboard-up-icon')}
                  </button>
                </td>
                <td>
                  <button
                    .disabled=${valueIndex ===
                    this.resourceDefinition.values.length - 1}
                    class="icon-button"
                    @click=${() => this.moveDown(value, valueIndex)}
                  >
                    ${icon('keyboard-down-icon')}
                  </button>
                </td>
                <td>
                  <button
                    .disabled=${valueIndex ===
                    this.resourceDefinition.values.length - 1}
                    class="icon-button"
                    @click=${() => this.moveToBottom(value, valueIndex)}
                  >
                    ${icon('keyboard-double-down-icon')}
                  </button>
                </td>
                <td>
                  <button
                    .disabled=${valueIndex === 0}
                    class="icon-button"
                    @click=${() => this.moveToTop(value, valueIndex)}
                  >
                    ${icon('keyboard-double-up-icon')}
                  </button>
                </td>
                <td>
                  <button
                    .disabled=${this.resourceDefinition.values.length === 1}
                    class="icon-button"
                    @click=${() => this.deleteResourceValue(value, valueIndex)}
                  >
                    ${icon('delete-icon')}
                  </button>
                </td>
              </tr>`;
            }
          )}
          <tr>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td>
              <button
                @click=${() => {
                  this.newResourceValue();
                }}
              >
                New
              </button>
            </td>
          </tr>
        </table>
        <div class="dialog-footer">
          <button @click=${() => this.cancel()}>Close</button>
        </div>
        <p>* = default</p>
      </dialog>
    `;
  }
}

customElements.define('edit-resource-definition', EditResourceDefinition);
