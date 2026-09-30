import { LocalizedLitElement } from "../../i18n/LocalizedLitElement";
import { t } from "../../i18n/i18n";
import { css, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { PiWebConfigResponse, PiWebConfigValues } from "../../api";
import "./SettingsPanelFrame";
import type { SettingsNotice } from "./SettingsPanelFrame";
import { askUserConfigPatch, spawnSessionsConfigPatch, subsessionsConfigPatch } from "./settingsSessiondConfig";

@customElement("settings-sessiond-panel")
export class SettingsSessiondPanel extends LocalizedLitElement {
  @property({ attribute: false }) configResponse: PiWebConfigResponse | undefined;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) saving = false;
  @property() error = "";
  @property() savedMessage = "";
  @property() targetLabel = "local (local gateway)";
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  @property({ attribute: false }) onSave?: (config: PiWebConfigValues) => void | Promise<void>;

  override render(): TemplateResult {
    const config = this.configResponse;
    const spawnOverridden = config?.envOverrides.spawnSessions === true;
    // On by default: the effective config is the source of truth for the toggle
    // state, so an unset config file still shows the feature as enabled.
    const effectiveSpawn = config?.effectiveConfig.spawnSessions !== false;
    const subsessionsOverridden = config?.envOverrides.subsessions === true;
    // On by default; also requires spawn to be enabled.
    const effectiveSubsessions = config?.effectiveConfig.subsessions === true && effectiveSpawn;
    const askUserOverridden = config?.envOverrides.askUser === true;
    const effectiveAskUser = config?.effectiveConfig.askUser === true;
    return html`
      <settings-panel-frame
        heading="Session daemon"
        .description=${sessiondDescription(this.targetLabel)}
        actionLabel="Reload"
        .actionDisabled=${this.loading}
        .notices=${this.panelNotices()}
        .onAction=${this.onReload}
      >
        ${config === undefined ? this.renderUnavailableConfigState() : html`
          <div class="config-path-card">
            <span>${t("Config file")}</span>
            <code>${config.path}</code>
          </div>
          <div class="field">
            <span class="field-heading">
              <span>${t("Allow agents to start sessions")}</span>
              ${spawnOverridden ? html`<span class="override-badge">${t("environment override")}</span>` : null}
            </span>
            <label class="toggle">
              <input
                type="checkbox"
                .checked=${effectiveSpawn}
                ?disabled=${this.loading || this.saving || spawnOverridden}
                @change=${(event: Event) => { void this.toggleSpawnSessions(event); }}
              >
              <span>${t("Enable the {tool} tool", { tool: "spawn_session" })}</span>
            </label>
            <small>${t("When enabled, LLMs can start new sessions, constrained to a workspace (any worktree) of the same registered project so every spawned session stays visible here. On by default.")}</small>
          </div>
          <div class="field">
            <span class="field-heading">
              <span>${t("Allow agents to start tracked subsessions")}</span>
              ${subsessionsOverridden ? html`<span class="override-badge">${t("environment override")}</span>` : null}
            </span>
            <label class="toggle">
              <input
                type="checkbox"
                .checked=${effectiveSubsessions}
                ?disabled=${this.loading || this.saving || subsessionsOverridden || !effectiveSpawn}
                @change=${(event: Event) => { void this.toggleSubsessions(event); }}
              >
              <span>${t("Enable the {tool} tools", { tool: "spawn_subsession" })}</span>
            </label>
            <small>${t("Agents can start child sessions they stay attached to and are notified when a child finishes. Requires Allow agents to start sessions. On by default.")}</small>
          </div>
          <div class="field">
            <span class="field-heading">
              <span>${t("Allow agents to ask questions")}</span>
              ${askUserOverridden ? html`<span class="override-badge">${t("environment override")}</span>` : null}
            </span>
            <label class="toggle">
              <input
                type="checkbox"
                aria-label=${t("Enable Ask Questions")}
                .checked=${effectiveAskUser}
                ?disabled=${this.loading || this.saving || askUserOverridden}
                @change=${(event: Event) => { void this.toggleAskUser(event); }}
              >
              <span>${t("Enable the {tool} tool", { tool: "ask_user" })}</span>
            </label>
            <small>${t("Agents can post a structured question form and pause until the user responds. On by default.")}</small>
          </div>
          <section class="effective-card" aria-label=${t("Desired session daemon configuration summary")}>
            <h3>${t("Desired after environment overrides")}</h3>
            <dl>
              <div><dt>${t("Spawn sessions")}</dt><dd>${effectiveSpawn ? t("Enabled") : html`<span class="muted">${t("Disabled")}</span>`}</dd></div>
              <div><dt>${t("Subsessions")}</dt><dd>${effectiveSubsessions ? t("Enabled") : html`<span class="muted">${t("Disabled")}</span>`}</dd></div>
              <div><dt>${t("Ask questions")}</dt><dd>${effectiveAskUser ? t("Enabled") : html`<span class="muted">${t("Disabled")}</span>`}</dd></div>
            </dl>
          </section>
        `}
      </settings-panel-frame>
    `;
  }

  private panelNotices(): readonly SettingsNotice[] {
    return sessiondPanelNotices({
      error: this.error,
      savedMessage: this.savedMessage,
    });
  }

  private renderUnavailableConfigState(): TemplateResult {
    return html`<div class="loading-card">${this.loading ? t("Loading configuration…") : "Configuration is unavailable. Reload to try again."}</div>`;
  }

  private async toggleSpawnSessions(event: Event): Promise<void> {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    await this.onSave?.(spawnSessionsConfigPatch(enabled));
  }

  private async toggleSubsessions(event: Event): Promise<void> {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    await this.onSave?.(subsessionsConfigPatch(enabled));
  }

  private async toggleAskUser(event: Event): Promise<void> {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    await this.onSave?.(askUserConfigPatch(enabled));
  }

  static override styles = css`
    :host { display: block; }
    h3 { margin: 0; font-size: 13px; line-height: 1.3; }
    .loading-card, .config-path-card, .effective-card { border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); padding: 12px; }
    .loading-card { color: var(--pi-muted); }
    .config-path-card { display: grid; gap: 5px; }
    .config-path-card span, .field-heading, dt { color: var(--pi-muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
    code { border: 1px solid var(--pi-border-muted); border-radius: 5px; background: var(--pi-bg); padding: 1px 4px; color: var(--pi-text); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    .field { display: grid; gap: 7px; }
    .field small { color: var(--pi-muted); line-height: 1.45; }
    .field-heading { display: flex; align-items: center; gap: 8px; }
    .toggle { display: flex; align-items: center; gap: 9px; cursor: pointer; }
    .toggle input { width: 16px; height: 16px; }
    .toggle input:disabled { cursor: not-allowed; }
    .override-badge { border: 1px solid var(--pi-warning-border); border-radius: 999px; color: var(--pi-warning); background: var(--pi-warning-surface); padding: 2px 7px; font-size: 11px; font-weight: 600; text-transform: none; }
    .effective-card { display: grid; gap: 10px; }
    .effective-card dl { display: grid; gap: 8px; margin: 0; }
    .effective-card dl > div { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 12px; align-items: baseline; }
    dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .muted { color: var(--pi-muted); }

    @media (max-width: 760px) {
      .effective-card dl > div { grid-template-columns: minmax(0, 1fr); gap: 3px; }
    }
  `;
}

export function sessiondDescription(targetLabel: string): string {
  return `Agent tool capabilities for sessions on ${targetLabel}. Changes are saved immediately but only take effect after the session daemon on that machine restarts.`;
}

export interface SessiondPanelNoticeContext {
  readonly error: string;
  readonly savedMessage: string;
}

/**
 * Compute the session-daemon panel's notice stack (error, then saved
 * confirmation) as a pure, publicly testable seam so tests assert the dynamic
 * notice logic and ordering here instead of scraping rendered `TemplateResult`
 * internals.
 */
export function sessiondPanelNotices(context: SessiondPanelNoticeContext): readonly SettingsNotice[] {
  const notices: SettingsNotice[] = [];
  if (context.error !== "") notices.push({ type: "error", content: context.error });
  if (context.savedMessage !== "") notices.push({ type: "success", content: context.savedMessage });
  return notices;
}
