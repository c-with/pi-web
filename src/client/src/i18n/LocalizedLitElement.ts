import { LitElement } from "lit";
import { subscribeLocaleChange } from "./i18n";

export class LocalizedLitElement extends LitElement {
  private unsubscribeLocaleChange: (() => void) | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribeLocaleChange ??= subscribeLocaleChange(() => { this.requestUpdate(); });
  }

  override disconnectedCallback(): void {
    this.unsubscribeLocaleChange?.();
    this.unsubscribeLocaleChange = undefined;
    super.disconnectedCallback();
  }
}
