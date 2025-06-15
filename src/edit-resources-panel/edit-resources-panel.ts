import { TemplateResult, html, render } from 'lit-html';
import { AddResourceOp, DeleteResourceOp } from '../ops/resources';
import { executeOp } from '../action/execute';
import { ExplanMain } from '../explanMain/explanMain';
import { EditResourceDefinition } from '../edit-resource-definition/edit-resource-definition';
import { icon } from '../icons/icons';
import { reportErrorMsg, reportIfError } from '../report-error/report-error';
import { PromptDialog } from '../prompt-dialog/prompt-dialog';

// Longest representation we'll show for all the options of a Resource.
const MAX_SHORT_STRING = 80;

export class EditResourcesPanel extends HTMLElement {
  explanMain: ExplanMain | null = null;
  planDefinitionChangedCallback: () => void;

  constructor() {
    super();
    this.planDefinitionChangedCallback = () => {
      if (this.explanMain !== null) {
        this.render();
      }
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

  setConfig(explanMain: ExplanMain) {
    this.explanMain = explanMain;
    this.render();
  }

  private render() {
    render(this.template(), this);
  }

  private valuesToShortString(values: string[]): string {
    let ret = values.join(', ');
    if (ret.length > MAX_SHORT_STRING) {
      ret = ret.slice(0, MAX_SHORT_STRING) + ' ...';
    }
    return ret;
  }

  private delButtonIfNotStatic(
    name: string,
    isStatic: boolean
  ): TemplateResult {
    if (isStatic) {
      return html``;
    }
    return html`<button
      class="icon-button"
      title="Delete this resource."
      @click=${() => this.deleteResource(name)}
    >
      ${icon('delete-icon')}
    </button>`;
  }

  private editButtonIfNotStatic(
    name: string,
    isStatic: boolean
  ): TemplateResult {
    if (isStatic) {
      return html``;
    }
    return html`<button
      class="icon-button"
      title="Edit the resource definition."
      @click=${() => this.editResource(name)}
    >
      ${icon('edit-icon')}
    </button>`;
  }

  private async deleteResource(name: string) {
    const ret = await executeOp(
      DeleteResourceOp(name),
      'planDefinitionChanged',
      true,
      this.explanMain!
    );
    reportIfError(ret);
    this.render();
  }

  private editResource(name: string) {
    this.explanMain!.querySelector<EditResourceDefinition>(
      'edit-resource-definition'
    )!.showModal(
      this.explanMain!,
      name,
      this.explanMain!.plan.resourceDefinitions[name]
    );
  }

  private async newResource() {
    let name = await document
      .querySelector<PromptDialog>('prompt-dialog')!
      .prompt('Resource Name');
    if (name === null) {
      return;
    }
    name = name.trim();
    if (name === '') {
      reportErrorMsg(
        new Error(
          'Resource names cannot be empty and must contain more than whitespace characters.'
        )
      );
      return;
    }
    const ret = await executeOp(
      AddResourceOp(name),
      'planDefinitionChanged',
      true,
      this.explanMain!
    );
    reportIfError(ret);
    this.render();
  }

  private template(): TemplateResult {
    const rd = this.explanMain!.plan.resourceDefinitions;
    const allKeysSorted = Object.keys(rd).sort(
      (keyA: string, keyB: string): number => {
        const a = rd[keyA];
        const b = rd[keyB];
        if (a.isStatic === b.isStatic) {
          return keyA.localeCompare(keyB);
        }
        if (a.isStatic) {
          return -1;
        }
        return 1;
      }
    );

    return html`
      <h3>Resources</h3>
      <table>
        <tr>
          <th>Name</th>
          <th>Values</th>
          <th>Delete</th>
          <th>Edit</th>
        </tr>
        ${allKeysSorted.map((name) => {
          const defn = rd[name];
          return html`<tr>
            <td>${name}</td>
            <td>${this.valuesToShortString(defn.values)}</td>
            <td>${this.delButtonIfNotStatic(name, defn.isStatic)}</td>
            <td>${this.editButtonIfNotStatic(name, defn.isStatic)}</td>
          </tr>`;
        })}
        <tr>
          <td></td>
          <td></td>
          <td></td>
          <td>
            <button
              class="icon-button"
              title="Add a new Resource."
              @click=${() => {
                this.newResource();
              }}
            >
              ${icon('add-icon')}
            </button>
          </td>
        </tr>
      </table>
    `;
  }
}

customElements.define('edit-resources-panel', EditResourcesPanel);
