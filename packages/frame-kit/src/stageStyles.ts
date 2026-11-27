/**
 * The styles of the stage dialog. They live in one constructable stylesheet for each document,
 * and each changing value is a retained rule that changes through CSSOM. No element gets a style
 * attribute, so a strict Content-Security-Policy has no effect on the dialog.
 */
const STAGE_CSS = `
.seams-stage-dialog {
  position: fixed;
  inset: auto;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  margin: 0;
  padding: 0;
  border: 0;
  max-width: none;
  max-height: none;
  box-sizing: border-box;
  display: block;
  overflow: visible;
  background: transparent;
  color: inherit;
  z-index: 2147483646;
}
.seams-stage-dialog:not([open]),
.seams-stage-dialog[data-state="hidden"],
.seams-stage-dialog[data-state="preparing"] {
  opacity: 0;
  pointer-events: none;
}
.seams-stage-dialog[data-presentation="modal"] {
  filter: drop-shadow(0 12px 24px rgb(0 0 0 / 0.22));
}
.seams-stage-dialog::backdrop {
  background: transparent;
}
.seams-stage-dialog[data-presentation="modal"][data-state="shown"]::backdrop {
  background: rgb(0 0 0 / 0.26);
}
.seams-stage-clip {
  position: absolute;
  inset: 0;
  overflow: hidden;
  overflow: clip;
  border-radius: var(--seams-shape-card, 16px);
}
.seams-stage-dialog[data-presentation="drawer"] .seams-stage-clip {
  border-radius: 0;
}
.seams-stage-layer {
  position: absolute;
  left: 0;
  top: 0;
  margin: 0;
  padding: 0;
  border: 0;
  box-sizing: border-box;
  display: block;
}
iframe.seams-stage-layer {
  width: 100%;
  height: 100%;
  background: transparent;
  color-scheme: normal;
}
div.seams-stage-layer {
  width: max-content;
  max-width: var(--seams-stage-room-width, 100%);
  outline: none;
}
.seams-stage-dialog[data-presentation="drawer"] div.seams-stage-layer {
  width: 100%;
  height: 100%;
  max-width: none;
}
.seams-stage-layer[data-layer="idle"] {
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}
div.seams-stage-layer[data-layer="idle"] {
  display: none;
}
.seams-stage-layer[data-layer="measuring"] {
  opacity: 0;
  pointer-events: none;
}
`;

const documentSheets = new WeakMap<Document, CSSStyleSheet>();

function stageSheet(doc: Document): CSSStyleSheet {
  const known = documentSheets.get(doc);
  if (known) return known;
  const view = doc.defaultView;
  if (!view) throw new Error('The stage dialog needs a document that has a window');
  const sheet = new view.CSSStyleSheet();
  sheet.replaceSync(STAGE_CSS);
  documentSheets.set(doc, sheet);
  return sheet;
}

/** The rules of one dialog. Each selector has one retained rule. */
export class StageRules {
  private readonly doc: Document;
  private readonly sheet: CSSStyleSheet;
  private readonly rules = new Map<string, CSSStyleRule>();

  constructor(doc: Document) {
    this.doc = doc;
    this.sheet = stageSheet(doc);
    this.adopt();
  }

  /** Adopts the sheet again if the page replaced the document's adopted sheets. */
  adopt(): void {
    const adopted = this.doc.adoptedStyleSheets;
    if (!adopted.includes(this.sheet)) this.doc.adoptedStyleSheets = [...adopted, this.sheet];
  }

  set(selector: string, declarations: Readonly<Record<string, string>>): void {
    let rule = this.rules.get(selector);
    if (!rule) {
      const index = this.sheet.insertRule(`${selector}{}`, this.sheet.cssRules.length);
      rule = this.sheet.cssRules[index] as CSSStyleRule;
      this.rules.set(selector, rule);
    }
    for (let i = rule.style.length - 1; i >= 0; i -= 1) {
      const property = rule.style.item(i);
      if (!(property in declarations)) rule.style.removeProperty(property);
    }
    for (const [property, value] of Object.entries(declarations)) {
      rule.style.setProperty(property, value);
    }
  }

  delete(selector: string): void {
    const rule = this.rules.get(selector);
    if (!rule) return;
    this.rules.delete(selector);
    const index = Array.prototype.indexOf.call(this.sheet.cssRules, rule);
    if (index >= 0) this.sheet.deleteRule(index);
  }

  clear(): void {
    for (const selector of [...this.rules.keys()]) this.delete(selector);
  }
}
