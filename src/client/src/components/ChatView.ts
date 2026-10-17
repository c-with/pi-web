import { LocalizedLitElement } from "../i18n/LocalizedLitElement";
import { t } from "../i18n/i18n";
import { html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { keyed } from "lit/directives/keyed.js";
import { ChatDisclosureController } from "../chatDisclosure";
import { writeClipboardText } from "../clipboard";
import { queuedMessageAttachmentLabel, type QueuedMessageAction, type QueuedMessageActionTarget } from "../queuedMessageActions";
import type { DisplayedMessageActionAvailabilityContext, MessageActionAvailabilityContext, MessageActionFeedback, MessageActionResult } from "../../../plugin-api";
import { displayedMessageActionMessage, messageActionMessage, MessageActionAvailabilityCache, type RegisteredMessageAction } from "../plugins/messageActions";
import { machineSessionKey } from "../machineKeys";
import { canonicalEntryActionHeaders, chatMessageHasHeader, groupChatMessages, summarizeChatGroup, type ChatGroup } from "../chatGroups";
import { openTranscriptQuestion, transcriptQuestionOutcomes } from "../chatQuestions";
import { ChatScrollFlows } from "../ChatScrollFlows";
import { ChatRenderKeys } from "../chatRenderKeys";
import { DEFAULT_CHAT_BEHAVIORS, type ChatBehaviors } from "../chatBehaviors";
import type { AskUserSubmission, PendingExtensionDialog, QueuedSessionMessage, SessionActivity, SessionRef, SessionStatus, SessionWarningSeverity } from "../api";
import type { ClosedExtensionDialog } from "../appState";
import {
  notificationAnnouncementLabel,
  notificationDismissLabel,
  notificationFocusTargetAfterDismiss,
  notificationInboxOverflowLabel,
  notificationInboxTotalCount,
  notificationMessageTruncationLabel,
  notificationSeverityLabel,
  notificationTargetKey,
  notificationTrayHeading,
  notificationTrayIsCollapsed,
  setNotificationTrayCollapsed,
  type NotificationFocusTarget,
  type SelectedSessionNotificationView,
  type SessionNotificationTarget,
} from "../sessionNotifications";
import type { ChatLine, ChatPart } from "./shared";
import { chatStyles, renderSessionWarningIcon } from "./shared";
import { renderCopyIcon, renderGoBackIcon, renderTrashIcon } from "./messageActionIcons";
import { renderQueueIcon, renderSteerIcon } from "./promptEditorIcons";
import "./AskUserCard";
import "./ExtensionDialogCard";
import type { ExtensionDialogAnswerCallback, ExtensionDialogCancelCallback, ExtensionDialogDismissCallback } from "./ExtensionDialogCard";
import { registerRenderedModal, type RenderedModalRegistration } from "./modalLayerRegistry";
import "./FormattedText";
import type { MarkdownWorkspaceContext } from "../formatting/workspaceLinks";
import "./ToolExecutionView";
import { transcriptImageSource } from "./TranscriptImage";
import type { ImageOpenDetail } from "./ImagePresentation";

const messageTimestampFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });
const notificationTimestampFormatter = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

function renderNotificationDisclosureIcon(collapsed: boolean) {
  return html`
    <svg class=${`notification-icon notification-disclosure-icon${collapsed ? "" : " expanded"}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m9 18 6-6-6-6"></path>
    </svg>
  `;
}

function renderNotificationCloseIcon() {
  return html`
    <svg class="notification-icon notification-close-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 6l12 12"></path>
      <path d="M18 6 6 18"></path>
    </svg>
  `;
}

function isSessionNotificationTarget(value: unknown): value is SessionNotificationTarget {
  return typeof value === "object"
    && value !== null
    && typeof Reflect.get(value, "machineId") === "string"
    && typeof Reflect.get(value, "cwd") === "string"
    && typeof Reflect.get(value, "sessionId") === "string";
}

interface PendingNotificationFocus {
  chatKey: string;
  focusTarget: NotificationFocusTarget;
}

export interface QueuedMessageSection {
  source: "client" | "server";
  heading: string;
  detail: string;
  messages: QueuedSessionMessage[];
}

export function chatQueuedMessageSections(clientQueued: QueuedSessionMessage[], serverQueued: QueuedSessionMessage[]): QueuedMessageSection[] {
  return [
    clientQueued.length === 0 ? undefined : { source: "client", heading: "Queued until session starts", detail: "Will send once the backend session is ready", messages: clientQueued },
    serverQueued.length === 0 ? undefined : { source: "server", heading: "Queued messages", detail: `${String(serverQueued.length)} pending`, messages: serverQueued },
  ].filter((section): section is QueuedMessageSection => section !== undefined);
}

export type ChatImagePart = Extract<ChatPart, { type: "image" }>;

/** Derive the `<img>` source URL and alt text for a rendered image part. */
export function chatImagePartSource(part: ChatImagePart, session?: SessionRef, machineId = "local"): { src: string; alt: string } | undefined {
  return transcriptImageSource(part, session, machineId);
}

/** The message-header label used when a tool message renders as an image output. */
export function chatToolOutputLabel(toolName?: string): string {
  return toolName === undefined || toolName === "" ? "tool output" : `${toolName} output`;
}

function chatLineIdentity(index: number, message?: ChatLine): string {
  return chatLineScrollIdentity(message) ?? String(index);
}

function chatLineScrollIdentity(message?: ChatLine): string | undefined {
  if (message?.entryId === undefined || message.entryId === "") return undefined;
  // Page offsets count raw entries, whereas display indexes count normalized
  // lines. Only durable entry identity survives coalescing during a prepend.
  // Skill invocations can also produce a user-text line from the same entry.
  const slice = message.parts.some((part) => part.type === "skillInvocation") ? "skill-invocation" : "message";
  return JSON.stringify([message.entryId, message.role, slice]);
}

/** Scroll identities never fall back to normalized display indexes. */
export function chatMessageAnchorKey(_index: number, message?: ChatLine): string | undefined {
  const identity = chatLineScrollIdentity(message);
  return identity === undefined ? undefined : `m:${identity}`;
}

export function chatGroupAnchorKey(_startIndex: number, message?: ChatLine): string | undefined {
  const identity = chatLineScrollIdentity(message);
  return identity === undefined ? undefined : `g:${identity}`;
}

/** Event identity is separate from the readable slice of the same entry. */
export function chatEventAnchorKey(_index: number, message?: ChatLine): string | undefined {
  const identity = chatLineScrollIdentity(message);
  return identity === undefined ? undefined : `e:${identity}`;
}

/** The CSS class list for an event-group `<details>`, distinguishing the live tail. */
export function chatMessageGroupClassName(defaultOpen: boolean): string {
  return defaultOpen ? "msg event-group live" : "msg event-group";
}

/** The disclosure summary label for an event group, distinguishing the live tail. */
export function chatMessageGroupLabel(defaultOpen: boolean): string {
  return defaultOpen ? "live events" : "events";
}

/** Whether a queued-message section shows the server clear-queue action. */
export function chatQueuedSectionShowsClearAction(section: QueuedMessageSection, hasClearHandler: boolean): boolean {
  return section.source === "server" && hasClearHandler;
}

/** A rendered session-warning row derived from live status warnings. */
export interface ChatSessionWarningRow {
  severity: SessionWarningSeverity;
  severityClass: string;
  message: string;
  source?: string;
  path?: string;
  dismissId?: string;
}

/** Derive one severity-tagged warning row per live status warning, in order. */
export function chatSessionWarningRows(status: SessionStatus | undefined): ChatSessionWarningRow[] {
  return (status?.warnings ?? []).map((warning) => ({
    severity: warning.severity,
    severityClass: `session-warning ${warning.severity}`,
    message: warning.message,
    ...(warning.source === undefined ? {} : { source: warning.source }),
    ...(warning.path === undefined ? {} : { path: warning.path }),
    ...(warning.dismiss === undefined ? {} : { dismissId: warning.dismiss.id }),
  }));
}

export function chatMessageMetadataLabel(message: ChatLine): string {
  const timestamp = message.meta?.timestamp;
  const time = timestamp === undefined ? undefined : formatMessageTimestamp(timestamp);
  const model = chatMessageModelLabel(message);
  const parts = [time, model, message.meta?.thinkingLevel].filter((part): part is string => part !== undefined && part !== "");
  return parts.length === 0 ? "No Pi message metadata available" : parts.join(" · ");
}

function formatMessageTimestamp(timestamp: string): string | undefined {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return undefined;
  return messageTimestampFormatter.format(date);
}

function chatMessageModelLabel(message: ChatLine): string | undefined {
  const model = message.meta?.model;
  if (model === undefined) return undefined;
  const id = model.responseId ?? model.id;
  if (id === undefined || id === "") return model.provider;
  return model.provider !== undefined && model.provider !== "" ? `${model.provider}/${id}` : id;
}

@customElement("chat-view")
export class ChatView extends LocalizedLitElement {
  @property({ attribute: false }) messages: ChatLine[] = [];
  @property() sessionId = "";
  @property() sessionCwd = "";
  @property({ attribute: false }) workspaceContext: MarkdownWorkspaceContext | undefined;
  @property({ attribute: false }) contentRendering: import("../formatting/contentRendering").ChatContentRendering | undefined;
  @property() machineId = "local";
  @property({ attribute: false }) messageActions: readonly RegisteredMessageAction[] = [];
  @property({ attribute: false }) messageActionContext?: Omit<MessageActionAvailabilityContext, "message">;
  @property({ attribute: false }) onMessageAction?: (input: MessageActionAvailabilityContext, actionId: string) => Promise<MessageActionResult>;
  @property({ attribute: false }) onDisplayedMessageAction?: (input: DisplayedMessageActionAvailabilityContext, actionId: string) => Promise<MessageActionResult>;
  private readonly messageActionAvailability = new MessageActionAvailabilityCache();
  @state() private messageActionPending = false;
  @state() private displayedMessageActionsPending: ReadonlySet<string> = new Set();
  @state() private messageActionError: { machineId: string; sessionId: string; key: string; message: string } | undefined;
  @state() private messageActionFeedback: { machineId: string; sessionId: string; key: string; actionId: string; presentation: MessageActionFeedback } | undefined;
  private messageActionFeedbackTimer: number | undefined;
  private messageActionGeneration = 0;
  @property({ type: Number }) messageStart = 0;
  @property({ type: Number }) messageEnd = 0;
  @property({ type: Number }) messageTotal = 0;
  @property({ type: Boolean }) hasMore = false;
  @property({ type: Boolean }) historyReady = true;
  @property({ type: Boolean }) loadingMore = false;
  @property({ type: Boolean }) isSendingPrompt = false;
  @property({ type: Boolean }) isCompacting = false;
  @property({ type: Number }) pendingMessageCount = 0;
  @property({ attribute: false }) clientQueuedMessages: QueuedSessionMessage[] = [];
  @property({ attribute: false }) status?: SessionStatus;
  @property({ type: Boolean }) suggestedInputPending = false;
  @property({ attribute: false }) suppressedSuggestedInput: string | undefined;
  @property({ attribute: false }) onUseSuggestedInput: ((machineId: string, sessionId: string) => void) | undefined;
  @property({ attribute: false }) onDismissSuggestedInput: ((machineId: string, sessionId: string, text: string) => void) | undefined;
  @property({ attribute: false }) activity?: SessionActivity;
  @property({ attribute: false }) askDraftSessionId = "";
  @property({ attribute: false }) onSubmitAsk: ((askId: string, submission: AskUserSubmission) => void | Promise<void>) | undefined;
  @property({ attribute: false }) pendingDialogs: PendingExtensionDialog[] = [];
  @property({ attribute: false }) closedDialogs: ClosedExtensionDialog[] = [];
  @property({ attribute: false }) onAnswerDialog?: ExtensionDialogAnswerCallback;
  @property({ attribute: false }) onCancelDialog?: ExtensionDialogCancelCallback;
  @property({ attribute: false }) onDismissClosedDialog?: ExtensionDialogDismissCallback;
  @property({ attribute: false }) notificationInbox?: SelectedSessionNotificationView;
  @property({ attribute: false }) onClearServerQueue?: () => void;
  @property({ attribute: false }) onQueuedMessageAction?: (target: QueuedMessageActionTarget) => Promise<void>;
  @property({ type: Boolean }) queuedMessageActionPending = false;
  @state() private queuedCopyFeedback = "";
  @property({ attribute: false }) onDismissWarning?: (dismissId: string) => void;
  @property({ attribute: false }) onDismissNotification?: (notificationId: string) => void;
  @property({ attribute: false }) onDismissAllNotifications?: () => void;
  @property({ type: Boolean }) warningsVisible = true;
  @property({ attribute: false }) onToggleWarnings?: () => void;
  @property({ attribute: false }) onLoadMore?: () => void;
  @property({ attribute: false }) behaviors: ChatBehaviors = DEFAULT_CHAT_BEHAVIORS;
  @query(".chat") private chat?: HTMLDivElement;
  @query("dialog.image-zoom") private imageZoomDialog?: HTMLDialogElement;
  @state() private followingLive = false;
  @state() private zoomedImage: { src: string; alt: string } | undefined = undefined;
  @state() private expandedMetaKey: string | undefined;
  @state() private collapsedNotificationTargetKeys: ReadonlySet<string> = new Set();
  @state() private retainedEmptyNotificationTrayTargetKey: string | undefined;
  private pendingNotificationFocus: PendingNotificationFocus | undefined;
  private imageZoomModalRegistration: RenderedModalRegistration | undefined;
  private readonly disclosures = new ChatDisclosureController();
  private readonly scrollFlows = new ChatScrollFlows({
    getScroller: () => this.chat ?? undefined,
    onFollowingChange: (following) => { this.followingLive = following; },
    getAnchors: () => this.scrollAnchorElements(),
    getSessionId: () => this.sessionId,
    getBehaviors: () => this.behaviors,
    hasMore: () => this.hasMore,
    isHistoryReady: () => this.historyReady,
    isLoadingMore: () => this.loadingMore || this.loadMoreRequested,
    canRequestEarlier: () => this.onLoadMore !== undefined,
    requestEarlier: () => { this.requestLoadMore(); },
    getOpenForm: (kind) => this.renderRoot.querySelector<HTMLElement>(kind === "dialog"
      ? ".chat > extension-dialog-card.open-dialog-card"
      : kind === "ask" ? ".chat ask-user-card.open-question-card"
      : ".chat ask-user-card.open-question-card, .chat > extension-dialog-card.open-dialog-card") ?? undefined,
  });
  private lastOpenQuestionId: string | undefined;
  private questionOutcomes = transcriptQuestionOutcomes([]);
  private questionIds: ReadonlySet<string> = new Set();
  private groupedMessagesInput?: ChatLine[];
  private groupedMessagesStart = 0;
  private groupedMessagesCache: ChatGroup[] = [];
  private readonly messageMetaCache = new WeakMap<ChatLine, string>();
  private imageSession: SessionRef | undefined;
  private touchY: number | undefined;
  private loadMoreRequested = false;
  private readonly onViewportResize = () => { this.scrollFlows.onViewportResize(); };
  private readonly handleScroll = () => { this.scrollFlows.onScroll(); };
  // Native details toggles do not bubble; capture layout changes independently
  // of the listener that remembers a group's disclosure choice.
  private readonly handleDisclosureToggle = {
    capture: true,
    handleEvent: (event: Event): void => {
      if (event.target instanceof HTMLDetailsElement) this.scrollFlows.onContentLayoutChanged();
    },
  };
  private readonly handleWheel = (event: WheelEvent) => {
    if (event.deltaY !== 0) this.scrollFlows.onInteraction();
    if (event.deltaY < 0) this.scrollFlows.onUpIntent();
  };
  private readonly handleTouchStart = (event: TouchEvent) => {
    this.touchY = event.touches[0]?.clientY;
    this.scrollFlows.onInteraction();
  };
  private readonly handleTouchMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY;
    if (this.touchY !== undefined && y !== undefined && y > this.touchY) this.scrollFlows.onUpIntent();
    this.touchY = y;
  };
  private readonly handleTouchEnd = () => { this.touchY = undefined; };
  private readonly handleJumpTop = () => { this.scrollFlows.jumpToTop(); };
  private readonly handleJumpEnd = () => { this.scrollFlows.jumpToEnd(); };
  private readonly openImageZoom = (src: string, alt: string): void => {
    this.zoomedImage = { src, alt };
  };
  private readonly closeImageZoom = (): void => {
    if (this.zoomedImage !== undefined) this.zoomedImage = undefined;
  };
  private readonly onImageZoomDialogClick = (event: MouseEvent): void => {
    if (event.target === this.imageZoomDialog) this.closeImageZoom();
  };
  private readonly onPageHide = () => {
    this.saveScrollPosition();
  };
  private readonly handleClearServerQueue = (): void => {
    this.onClearServerQueue?.();
  };
  private readonly handleToggleWarnings = (): void => {
    this.onToggleWarnings?.();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("resize", this.onViewportResize);
    window.addEventListener("pagehide", this.onPageHide);
    window.visualViewport?.addEventListener("resize", this.onViewportResize);
  }

  override disconnectedCallback(): void {
    this.scrollFlows.dispose();
    this.releaseImageZoomModal();
    this.messageActionGeneration += 1;
    this.clearMessageActionFeedback();
    window.removeEventListener("resize", this.onViewportResize);
    window.removeEventListener("pagehide", this.onPageHide);
    window.visualViewport?.removeEventListener("resize", this.onViewportResize);
    super.disconnectedCallback();
  }

  private prepareSessionUiState(): void {
    if (this.behaviors.rememberDisclosures) this.disclosures.syncSession(this.sessionId);
    this.pendingNotificationFocus = undefined;
    this.retainedEmptyNotificationTrayTargetKey = undefined;
    this.loadMoreRequested = false;
  }

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("messages")) {
      this.questionOutcomes = transcriptQuestionOutcomes(this.messages);
      this.questionIds = new Set(this.messages.flatMap((line) => line.parts.flatMap((part) => part.type === "askUserQuestion" ? [part.ask.askId] : [])));
    }
    if (changed.has("sessionId") || changed.has("machineId")) this.lastOpenQuestionId = undefined;
    if (changed.has("sessionId") || changed.has("machineId")) {
      this.messageActionGeneration += 1;
      this.clearMessageActionFeedback();
      this.messageActionError = undefined;
    }
    if (changed.has("sessionId")) {
      this.prepareSessionUiState();
    } else if (changed.has("notificationInbox") && this.notificationTargetChanged(changed.get("notificationInbox"))) {
      this.pendingNotificationFocus = undefined;
      this.retainedEmptyNotificationTrayTargetKey = undefined;
    }
    if (changed.has("behaviors")) {
      this.scrollFlows.configure();
      if (this.behaviors.rememberDisclosures) this.disclosures.syncSession(this.sessionId);
    }
  }

  protected override update(changed: Map<string, unknown>): void {
    const previousStart = changed.get("messageStart");
    this.scrollFlows.beforeRender({
      sessionChanged: changed.has("sessionId") || changed.has("machineId"),
      previousSessionId: changed.get("sessionId"),
      prepend: typeof previousStart === "number" && this.messageStart < previousStart,
    });
    super.update(changed);
  }

  protected override updated(changed: Map<string, unknown>): void {
    if (changed.has("loadingMore") && !this.loadingMore) this.loadMoreRequested = false;
    if (changed.has("hasMore") && !this.hasMore) this.loadMoreRequested = false;
    const openQuestionId = this.openQuestion()?.askId;
    this.scrollFlows.afterRender({
      sessionChanged: changed.has("sessionId") || changed.has("machineId"),
      contentChanged: this.scrollContentChanged(changed),
      historyChanged: changed.has("messages") || changed.has("messageStart") || changed.has("hasMore") || changed.has("loadingMore") || changed.has("historyReady"),
      openedForm: changed.has("pendingDialogs") && this.isNewOpenDialog(changed.get("pendingDialogs")) ? "dialog"
        : openQuestionId !== undefined && openQuestionId !== this.lastOpenQuestionId ? "ask" : false,
    });
    this.lastOpenQuestionId = openQuestionId;
    if (changed.has("notificationInbox") && this.pendingNotificationFocus !== undefined) this.focusPendingNotificationTarget();
    if (changed.has("zoomedImage")) this.syncImageZoomDialog();
  }

  private syncImageZoomDialog(): void {
    const dialog = this.imageZoomDialog;
    if (dialog === undefined) return;
    if (this.zoomedImage !== undefined) {
      if (this.imageZoomModalRegistration === undefined) {
        const registration = registerRenderedModal({
          element: dialog,
          nativeTopLayer: true,
          focus: () => {
            const close = this.renderRoot.querySelector<HTMLElement>(".image-zoom-close");
            (close ?? dialog).focus();
          },
        });
        this.imageZoomModalRegistration = registration;
        try {
          if (!dialog.open) dialog.showModal();
        } catch (error) {
          this.imageZoomModalRegistration = undefined;
          registration.unregister();
          throw error;
        }
      }
      this.imageZoomModalRegistration.focus();
      return;
    }
    if (dialog.open) dialog.close();
    this.releaseImageZoomModal();
  }

  private releaseImageZoomModal(): void {
    const registration = this.imageZoomModalRegistration;
    this.imageZoomModalRegistration = undefined;
    registration?.unregister();
  }

  private notificationTargetChanged(previous: unknown): boolean {
    const currentInbox = this.notificationInbox;
    if (!isSessionNotificationTarget(previous) || currentInbox === undefined) return previous !== currentInbox;
    return notificationTargetKey(previous) !== notificationTargetKey(currentInbox);
  }

  private readonly renderKeys = new ChatRenderKeys();

  override render() {
    const groups = this.groupedMessages();
    const entryActionHeaders = canonicalEntryActionHeaders(groups);
    // Keep incremental updates within one transcript, but dispose the whole
    // repeat part when the transcript changes. Besides preventing cross-session
    // DOM reuse, clearing the part reclaims the end markers that the current Lit
    // build retains when repeat items are removed.
    const transcriptIdentity = machineSessionKey(this.machineId, this.sessionId);
    const keys = this.renderKeys.reconcile(transcriptIdentity, groups.map((group) => {
      const index = group.kind === "group" ? group.startIndex : group.index;
      const message = group.kind === "group" ? group.messages[0]?.message : group.message;
      const identity = chatLineScrollIdentity(message);
      return {
        slot: JSON.stringify([group.kind, index, message?.role]),
        ...(identity === undefined ? {} : { identity: JSON.stringify([group.kind, identity]) }),
      };
    }));
    const following = this.behaviors.followTail && this.followingLive;
    return html`
      ${this.renderTopNotices()}
      ${this.renderNotificationLiveRegions()}
      <div class=${this.behaviors.visualEffects ? "chat-wrap" : "chat-wrap plain"}>
        <div class="chat" @image-open=${(event: CustomEvent<ImageOpenDetail>) => { this.openImageZoom(event.detail.src, event.detail.alt); }}
          @scroll=${this.behaviors.rememberPosition || this.behaviors.followTail || this.behaviors.automaticHistory ? this.handleScroll : undefined}
          @toggle=${this.behaviors.followTail ? this.handleDisclosureToggle : undefined}
          @wheel=${this.handlesScrollIntent ? this.handleWheel : undefined}
          @touchstart=${this.handlesScrollIntent ? this.handleTouchStart : undefined}
          @touchmove=${this.handlesScrollIntent ? this.handleTouchMove : undefined}
          @touchend=${this.handlesScrollIntent ? this.handleTouchEnd : undefined}
          @touchcancel=${this.handlesScrollIntent ? this.handleTouchEnd : undefined}>
          ${this.renderHistoryBoundary()}
          ${keyed(transcriptIdentity, repeat(
            groups,
            (_group, index) => keys[index],
            (group, index) => {
              if (group.kind === "group") return this.renderMessageGroup(group, this.isLiveTailGroup(groups, index), entryActionHeaders);
              if (group.kind === "tool-image") return this.renderToolImageOutput(group.message, group.index, entryActionHeaders, group.toolName);
              return this.renderMessage(group.message, group.index, entryActionHeaders);
            },
          ))}
          ${this.renderQueuedMessages()}
          ${this.renderSessionActivity()}
          ${this.renderSuggestedInput()}
          ${this.renderExtensionDialogs()}
        </div>
        ${this.renderActivityDock()}
        <nav class="chat-jumps" aria-label="Chat navigation">
          <button type="button" title="Jump to top" aria-label="Jump to top" @click=${this.handleJumpTop}>↑</button>
          <button type="button" class=${following ? "following" : ""}
            title=${!this.behaviors.followTail ? "Jump to end" : following ? "Following live — jump to end" : "Jump to end and follow live"}
            aria-label="Jump to end" aria-describedby="chat-follow-state" @click=${this.handleJumpEnd}>↓</button>
          <span id="chat-follow-state" class="visually-hidden">${!this.behaviors.followTail ? "Automatic following disabled" : following ? "Following live" : "Live following paused"}</span>
        </nav>
      </div>
      ${this.renderImageZoom()}
    `;
  }

  private renderTopNotices() {
    const warnings = this.renderWarnings();
    const notifications = this.renderNotificationTray();
    if (warnings === null && notifications === null) return null;
    return html`<div class="top-notices">${warnings}${notifications}</div>`;
  }

  private renderNotificationTray() {
    const inbox = this.notificationInbox;
    if (inbox?.sessionId !== this.sessionId) return null;
    const chatKey = notificationTargetKey(inbox);
    const hasPendingOverlay = inbox.pendingDismissedIds.size > 0 || inbox.dismissAllPending;
    const retainsFocusTarget = this.retainedEmptyNotificationTrayTargetKey === chatKey;
    const totalCount = notificationInboxTotalCount(inbox);
    if (totalCount === 0 && !hasPendingOverlay && !retainsFocusTarget) return null;
    const collapsed = notificationTrayIsCollapsed(this.collapsedNotificationTargetKeys, inbox);
    const toggleLabel = collapsed ? t("Expand notifications") : t("Collapse notifications");
    return html`
      <section class=${`notification-tray${collapsed ? " collapsed" : ""}`} role="region" aria-labelledby="session-notifications-heading" @focusout=${(event: FocusEvent) => { this.releaseEmptyNotificationTray(event); }}>
        <header class="notification-header" data-notification-focus="header" tabindex="-1">
          <strong class="notification-heading" id="session-notifications-heading">${notificationTrayHeading(inbox)}</strong>
          <div class="notification-header-actions">
            <button
              type="button"
              class="notification-control notification-clear"
              aria-label=${t("Clear all notifications")}
              title=${t("Clear all notifications")}
              ?disabled=${inbox.dismissAllPending || totalCount === 0 || this.onDismissAllNotifications === undefined}
              @click=${() => { this.dismissAllNotifications(); }}
            >${t("Clear")}</button>
            <button
              type="button"
              class="notification-control notification-toggle"
              aria-label=${toggleLabel}
              title=${toggleLabel}
              aria-expanded=${String(!collapsed)}
              aria-controls="session-notification-list"
              @click=${() => { this.toggleNotificationTray(inbox, collapsed); }}
            >${renderNotificationDisclosureIcon(collapsed)}</button>
          </div>
        </header>
        <div class="notification-list" id="session-notification-list" ?hidden=${collapsed}>
          ${inbox.discardedCount === 0 ? null : html`
            <p class="notification-overflow">${notificationInboxOverflowLabel(inbox.discardedCount)}</p>
          `}
          ${inbox.notifications.map((notification) => {
            const label = notificationSeverityLabel(notification.severity);
            const truncationLabel = notificationMessageTruncationLabel(notification);
            return html`
              <article class=${`notification-row ${notification.severity}`} data-notification-id=${notification.id} tabindex="-1">
                <div class="notification-metadata">
                  <strong class="notification-severity">${label}</strong>
                  <span aria-hidden="true">·</span>
                  <time datetime=${notification.receivedAt}>${notificationTimestampFormatter.format(new Date(notification.receivedAt))}</time>
                </div>
                <p class="notification-message" dir="auto">${notification.message}</p>
                ${truncationLabel === undefined ? null : html`<p class="notification-truncated">${truncationLabel}</p>`}
                <button
                  type="button"
                  class="notification-row-dismiss"
                  aria-label=${notificationDismissLabel(notification)}
                  title=${t("Dismiss notification")}
                  ?disabled=${inbox.pendingDismissedIds.has(notification.id) || inbox.dismissAllPending || this.onDismissNotification === undefined}
                  @click=${() => { this.dismissNotification(notification.id); }}
                >${renderNotificationCloseIcon()}</button>
              </article>
            `;
          })}
        </div>
      </section>
    `;
  }

  private renderNotificationLiveRegions() {
    const announcements = this.notificationInbox?.sessionId === this.sessionId ? this.notificationInbox.announcements : [];
    const polite = announcements.filter((announcement) => announcement.severity !== "error");
    const assertive = announcements.filter((announcement) => announcement.severity === "error");
    return html`
      <div class="visually-hidden notification-live" aria-live="polite" aria-atomic="false">${repeat(polite, (announcement) => announcement.id, (announcement) => html`<span data-announcement-id=${announcement.id}>${notificationAnnouncementLabel(announcement)}</span>`)}</div>
      <div class="visually-hidden notification-live" aria-live="assertive" aria-atomic="false">${repeat(assertive, (announcement) => announcement.id, (announcement) => html`<span data-announcement-id=${announcement.id}>${notificationAnnouncementLabel(announcement)}</span>`)}</div>
    `;
  }

  private toggleNotificationTray(inbox: SelectedSessionNotificationView, collapsed: boolean): void {
    this.collapsedNotificationTargetKeys = setNotificationTrayCollapsed(this.collapsedNotificationTargetKeys, inbox, !collapsed);
  }

  private dismissNotification(notificationId: string): void {
    const inbox = this.notificationInbox;
    if (inbox === undefined || this.onDismissNotification === undefined) return;
    const focusTarget = notificationFocusTargetAfterDismiss(inbox.notifications, notificationId);
    const chatKey = notificationTargetKey(inbox);
    this.pendingNotificationFocus = { chatKey, focusTarget };
    if (focusTarget.kind === "header") this.retainedEmptyNotificationTrayTargetKey = chatKey;
    this.onDismissNotification(notificationId);
  }

  private dismissAllNotifications(): void {
    const inbox = this.notificationInbox;
    if (inbox === undefined || this.onDismissAllNotifications === undefined) return;
    const chatKey = notificationTargetKey(inbox);
    this.pendingNotificationFocus = { chatKey, focusTarget: { kind: "header" } };
    this.retainedEmptyNotificationTrayTargetKey = chatKey;
    this.onDismissAllNotifications();
  }

  private releaseEmptyNotificationTray(event: FocusEvent): void {
    const tray = event.currentTarget;
    const next = event.relatedTarget;
    if (tray instanceof HTMLElement && next instanceof Node && tray.contains(next)) return;
    // Removing the activated row can emit focusout before updated() moves focus.
    if (this.pendingNotificationFocus !== undefined) return;
    const inbox = this.notificationInbox;
    if (inbox !== undefined
      && this.retainedEmptyNotificationTrayTargetKey === notificationTargetKey(inbox)
      && notificationInboxTotalCount(inbox) === 0) this.retainedEmptyNotificationTrayTargetKey = undefined;
  }

  private focusPendingNotificationTarget(): void {
    const pending = this.pendingNotificationFocus;
    this.pendingNotificationFocus = undefined;
    const inbox = this.notificationInbox;
    if (pending === undefined || inbox === undefined || notificationTargetKey(inbox) !== pending.chatKey) return;
    const target = pending.focusTarget;
    if (target.kind === "header") {
      this.renderRoot.querySelector<HTMLElement>("[data-notification-focus='header']")?.focus();
      return;
    }
    const row = Array.from(this.renderRoot.querySelectorAll<HTMLElement>("[data-notification-id]"))
      .find((candidate) => candidate.dataset["notificationId"] === target.notificationId);
    if (row !== undefined) {
      row.focus();
      return;
    }
    if (notificationInboxTotalCount(inbox) === 0) this.retainedEmptyNotificationTrayTargetKey = pending.chatKey;
    this.renderRoot.querySelector<HTMLElement>("[data-notification-focus='header']")?.focus();
  }

  private renderWarnings() {
    const rows = chatSessionWarningRows(this.status);
    if (!this.warningsVisible || rows.length === 0) return null;
    return html`
      <aside class="session-warnings" role="alert" aria-live="polite">
        ${this.onToggleWarnings === undefined ? null : html`
          <div class="session-warnings-controls">
            <button
              type="button"
              class="session-warnings-collapse"
              title=${t("Minimise warnings")}
              aria-label=${t("Minimise warnings")}
              @click=${this.handleToggleWarnings}
            >
              <svg class="session-warnings-collapse-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="m18 15-6-6-6 6"></path>
              </svg>
              <span>${t("Minimise")}</span>
            </button>
          </div>
        `}
        ${rows.map((row) => {
          const dismissId = row.dismissId;
          return html`
          <div class=${row.severityClass}>
            <div class="session-warning-head">
              ${renderSessionWarningIcon(row.severity, "session-warning-icon")}
              ${row.source === undefined ? null : html`<span class="session-warning-source">${row.source}</span>`}
            </div>
            <div class="session-warning-body">
              <p class="session-warning-message">${row.message}</p>
              ${row.path === undefined ? null : html`<p class="session-warning-path">${row.path}</p>`}
            </div>
            ${dismissId === undefined ? null : html`
              <button
                type="button"
                class="session-warning-dismiss"
                title=${t("Don't show this warning again")}
                aria-label=${t("Dismiss warning")}
                @click=${() => { this.onDismissWarning?.(dismissId); }}
              >×</button>
            `}
          </div>
        `;
        })}
      </aside>
    `;
  }

  private renderImageZoom() {
    return html`
      <dialog class="image-zoom" @click=${this.onImageZoomDialogClick} @close=${this.closeImageZoom} @cancel=${this.closeImageZoom}>
        ${this.zoomedImage === undefined ? null : html`
          <button type="button" class="image-zoom-close" aria-label=${t("Close image")} @click=${this.closeImageZoom}>×</button>
          <img class="image-zoom-full" src=${this.zoomedImage.src} alt=${this.zoomedImage.alt} />
        `}
      </dialog>
    `;
  }

  private groupedMessages(): ChatGroup[] {
    if (this.groupedMessagesInput === this.messages && this.groupedMessagesStart === this.messageStart) return this.groupedMessagesCache;
    this.groupedMessagesInput = this.messages;
    this.groupedMessagesStart = this.messageStart;
    this.groupedMessagesCache = groupChatMessages(this.messages, this.messageStart);
    return this.groupedMessagesCache;
  }

  private isLiveTailGroup(groups: ChatGroup[], index: number): boolean {
    return index === groups.length - 1 && this.isSessionLive();
  }

  private isSessionLive(): boolean {
    return this.isSendingPrompt
      || this.status?.isStreaming === true
      || this.status?.isCompacting === true
      || this.status?.isBashRunning === true
      || this.activity?.phase === "active";
  }

  private renderActivityDock() {
    if (this.isSendingPrompt) {
      return html`
        <div class="activity-dock active" aria-live="polite">
          <span class="dot"></span>
          <span class="activity-text">${t("Sending your message…")}</span>
        </div>
      `;
    }
    const state = this.activityState();
    if (state === undefined) return null;
    if (state === "idle" && this.activity?.phase !== "active") return null;
    return html`
      <div class="activity-dock active" aria-live="polite">
        <span class="dot"></span>
        <span class="activity-text">${this.activityText(state)}</span>
      </div>
    `;
  }

  private renderQueuedMessages() {
    const serverQueued = this.status?.queuedMessages ?? [];
    return html`${chatQueuedMessageSections(this.clientQueuedMessages, serverQueued).map((section) => this.renderQueuedMessageList(section))}
      ${this.queuedCopyFeedback === "" ? nothing : html`<small role="status">${this.queuedCopyFeedback}</small>`}`;
  }

  private renderQueuedMessageList(section: QueuedMessageSection) {
    const canClear = chatQueuedSectionShowsClearAction(section, this.onClearServerQueue !== undefined);
    const actionsUnavailable = section.source === "server" ? this.status?.queueMessageActionsUnavailable : undefined;
    const unavailableReason = actionsUnavailable === undefined ? undefined : actionsUnavailable === "" ? "Individual queue controls are unavailable with this runtime." : actionsUnavailable;
    const actionsDisabled = this.queuedMessageActionPending || actionsUnavailable !== undefined;
    return html`
      <aside class="queued-messages" aria-live="polite">
        <div class="queued-header">
          <div class="queued-heading">
            <strong>${section.heading}</strong>
            <small>${section.detail}</small>
          </div>
          ${canClear ? html`
            <button type="button" class="queued-clear-button" ?disabled=${this.queuedMessageActionPending} aria-label=${t("Clear queue")} title=${t("Clear queued messages without stopping active work")} @click=${this.handleClearServerQueue}>${renderTrashIcon()}</button>
          ` : null}
        </div>
        ${unavailableReason === undefined ? nothing : html`<small role="status">${unavailableReason}</small>`}
        ${section.messages.map((message, index) => html`
          <div class="queued-message">
            <div class="queued-message-header">
              <div class="queued-message-meta">
                <span class="queued-kind">${message.kind === "steer" ? t("Steer") : t("Queue")} ${String(section.messages.slice(0, index + 1).filter((entry) => entry.kind === message.kind).length)}</span>
                ${queuedMessageAttachmentLabel(message) === undefined ? nothing : html`
                  <span class="queued-attachments" title=${t("Attachments included with this queued message")}><span aria-hidden="true">📎</span> ${queuedMessageAttachmentLabel(message)}</span>
                `}
              </div>
              <div class="queued-message-actions">
                <button type="button" class="queued-action" aria-label=${t("Copy queued message")} title=${t("Copy message")} @click=${async () => {
                  this.queuedCopyFeedback = await writeClipboardText(message.text) ? t("Copied") : t("Could not copy message");
                }}>${renderCopyIcon()}</button>
                ${section.source !== "server" || this.onQueuedMessageAction === undefined ? nothing : html`
                  <button type="button" class="queued-action" ?disabled=${actionsDisabled} title=${unavailableReason ?? (message.kind === "steer" ? t("Move to the end of the follow-up queue") : t("Move to the end of the steering queue"))} aria-label=${message.kind === "steer" ? t("Switch to Queue") : t("Switch to Steer")} @click=${() => { this.actOnQueuedMessage("toggle", index, section.messages); }}>${message.kind === "steer" ? renderQueueIcon() : renderSteerIcon()}</button>
                  <button type="button" class="queued-action" ?disabled=${actionsDisabled} aria-label=${t("Recall queued message")} title=${unavailableReason ?? t("Recall this message's text and clear later queued messages")} @click=${() => { this.actOnQueuedMessage("edit", index, section.messages); }}>${renderGoBackIcon()}</button>
                  <button type="button" class="queued-action" ?disabled=${actionsDisabled} aria-label=${t("Remove queued message")} title=${unavailableReason ?? t("Remove only this message")} @click=${() => { this.actOnQueuedMessage("remove", index, section.messages); }}>${renderTrashIcon()}</button>
                `}
              </div>
            </div>
            <formatted-text .imagesEnabled=${this.behaviors.loadImages} .codeBlocks=${this.behaviors.codeBlocks} .intentKey=${JSON.stringify([this.machineId, this.sessionId, "queue", section.source, index, message.kind])} .contentRendering=${this.contentRendering} .machineId=${this.machineId} .workspaceContext=${this.workspaceContext} .text=${message.text}></formatted-text>
          </div>
        `)}
      </aside>
    `;
  }

  private actOnQueuedMessage(action: QueuedMessageAction, index: number, messages: QueuedSessionMessage[]): void {
    if (this.queuedMessageActionPending || this.status?.queueMessageActionsUnavailable !== undefined) return;
    void this.onQueuedMessageAction?.({ machineId: this.machineId, sessionId: this.sessionId, action, index, expectedQueue: messages.map((message) => ({ ...message })) });
  }

  private renderSuggestedInput() {
    const text = this.status?.sessionId === this.sessionId ? this.status.suggestedInput : undefined;
    if (text === undefined || this.onUseSuggestedInput === undefined
      || this.suggestedInputPending || this.suppressedSuggestedInput === text) return null;
    return html`
      <aside class="suggested-input">
        <div class="suggested-input-header">
          <strong>Suggested input</strong>
          ${this.onDismissSuggestedInput === undefined ? null : html`
            <button type="button" class="suggested-input-dismiss" aria-label="Dismiss suggested input" title="Dismiss suggested input in this browser"
              @click=${() => { this.onDismissSuggestedInput?.(this.machineId, this.sessionId, text); }}>×</button>
          `}
        </div>
        <p class="suggested-input-text" dir="auto">${text === "" ? "Empty input" : text}</p>
        <small>Replaces your current draft. Nothing is sent.</small>
        <button type="button" class="suggested-input-use" @click=${() => { this.onUseSuggestedInput?.(this.machineId, this.sessionId); }}>Use suggested input</button>
      </aside>
    `;
  }

  private renderExtensionDialogs() {
    const open = this.pendingDialogs[0];
    if (open === undefined && this.closedDialogs.length === 0) return null;
    const queuedCount = this.pendingDialogs.length - 1;
    return html`
      ${repeat(
        this.closedDialogs,
        (closed) => closed.dialog.dialogId,
        (closed) => html`
          <extension-dialog-card
            class="closed-dialog-card"
            .outcome=${closed}
            .onDismiss=${this.onDismissClosedDialog}
          ></extension-dialog-card>
        `,
      )}
      ${open === undefined ? null : html`
        <extension-dialog-card
          class="open-dialog-card"
          .dialog=${open}
          .onAnswer=${this.onAnswerDialog}
          .onCancel=${this.onCancelDialog}
        ></extension-dialog-card>
        ${queuedCount > 0
          ? html`<p class="queued-dialogs" role="status">${String(queuedCount)} more extension ${queuedCount === 1 ? "dialog" : "dialogs"} queued</p>`
          : null}
      `}
    `;
  }

  private renderSessionActivity() {
    if (!this.isCompacting) return null;
    return html`
      <aside class="session-activity compacting" aria-live="polite">
        <strong>${t("Compacting history…")}</strong>
        <span>${t("The agent is summarizing earlier context. New prompts will be queued until compaction finishes.")}</span>
        ${this.pendingMessageCount > 0 ? html`<small>${this.pendingMessageCount} queued ${this.pendingMessageCount === 1 ? "message" : "messages"}</small>` : null}
      </aside>
    `;
  }

  private activityState(): string | undefined {
    const status = this.status;
    if (status === undefined) return this.activity?.label;
    if (status.isCompacting) return "compacting";
    if (status.isBashRunning) return "bash";
    if (status.isStreaming) return "running";
    if (status.pendingMessageCount > 0) return "queued";
    return "idle";
  }

  private activityText(state: string): string {
    const activity = this.activity;
    if (activity === undefined) return state;
    if (state !== "idle" && activity.phase === "idle") return state;
    return activity.detail !== undefined && activity.detail !== "" ? `${activity.label}: ${activity.detail}` : activity.label;
  }

  private renderHistoryBoundary() {
    const range = this.historyRangeLabel();
    if (this.loadingMore) return html`<div class="history-boundary"><span>${t("Loading earlier messages…")}</span>${range}</div>`;
    if (this.hasMore) return html`
      <div class="history-boundary">
        <button type="button" class="history-load-button" ?disabled=${this.loadMoreRequested} @click=${() => { this.requestLoadMore(); }}>${t("Load earlier messages")}</button>
        ${this.behaviors.automaticHistory ? html`<span>${t("Scroll up to load earlier messages")}</span>` : null}
        ${range}
      </div>
    `;
    if (this.messages.length) return html`<div class="history-boundary"><span>${t("Beginning of session")}</span>${range}</div>`;
    return null;
  }

  private historyRangeLabel() {
    if (!this.messages.length || this.messageTotal <= 0) return null;
    const from = this.messageStart + 1;
    const to = this.loadedRawMessageEnd();
    const total = Math.max(this.messageTotal, to);
    return html`<small>Showing messages ${from}–${to} of ${total}</small>`;
  }

  private loadedRawMessageEnd(): number {
    return Math.max(this.messageEnd, this.messageStart + this.messages.length);
  }

  private renderMessage(message: ChatLine, index: number, entryActionHeaders: ReadonlySet<ChatLine>) {
    const toolOnly = this.isToolExecutionOnlyMessage(message);
    const hasHeader = chatMessageHasHeader(message);
    const shellClass = toolOnly ? "msg tool-execution-shell" : "msg ask-user-record-shell";
    return html`
      <article class=${hasHeader ? `msg ${message.role}` : shellClass} data-index=${index} data-scroll-anchor-id=${chatMessageAnchorKey(index, message) ?? nothing}>
        ${hasHeader ? this.renderMessageHeader(message, String(index), index, entryActionHeaders) : null}
        ${message.parts.map((part, partIndex) => this.renderPart(part, message, index, partIndex))}
      </article>
    `;
  }

  private renderToolImageOutput(message: ChatLine, index: number, entryActionHeaders: ReadonlySet<ChatLine>, toolName?: string) {
    const label = chatToolOutputLabel(toolName);
    return html`
      <article class="msg tool-image-output" data-index=${index} data-scroll-anchor-id=${chatMessageAnchorKey(index, message) ?? nothing}>
        ${this.renderMessageHeader(message, String(index), index, entryActionHeaders, label)}
        ${message.parts.map((part, partIndex) => this.renderPart(part, message, index, partIndex))}
      </article>
    `;
  }

  private isToolExecutionOnlyMessage(message: ChatLine): boolean {
    return message.role === "tool" && message.parts.length > 0 && message.parts.every((part) => part.type === "toolExecution");
  }

  private renderMessageGroup(group: Extract<ChatGroup, { kind: "group" }>, defaultOpen: boolean, entryActionHeaders: ReadonlySet<ChatLine> = new Set()) {
    const { messages, startIndex } = group;
    const disclosureKey = this.groupDisclosureKey(group, defaultOpen);
    const open = this.behaviors.rememberDisclosures ? this.disclosures.isOpen(disclosureKey, defaultOpen) : defaultOpen;
    return html`
      <details class=${chatMessageGroupClassName(defaultOpen)} data-index=${startIndex} data-scroll-anchor-id=${this.groupAnchorKey(group, defaultOpen) ?? nothing} ?open=${open} @toggle=${this.behaviors.rememberDisclosures ? (event: Event) => { this.onGroupToggle(disclosureKey, event, defaultOpen); } : undefined}>
        <summary>
          <b class="label">${chatMessageGroupLabel(defaultOpen)}</b>
          <span>${summarizeChatGroup(messages.map((event) => event.message))}</span>
        </summary>
        ${this.renderMessageGroupBody(group, entryActionHeaders)}
      </details>
    `;
  }

  private renderMessageGroupBody({ messages, startIndex }: Extract<ChatGroup, { kind: "group" }>, entryActionHeaders: ReadonlySet<ChatLine> = new Set()) {
    return html`
      <div class="group-body">
        ${messages.map(({ message, index }, offset) => {
          const toolOnly = this.isToolExecutionOnlyMessage(message);
          return html`
            <section class=${toolOnly ? "group-msg tool-execution-shell" : `group-msg ${message.role}`} data-index=${index} data-scroll-anchor-id=${chatEventAnchorKey(index, message) ?? nothing}>
              ${chatMessageHasHeader(message) ? this.renderMessageHeader(message, `${String(startIndex)}:${String(offset)}`, index, entryActionHeaders) : null}
              ${message.parts.map((part, partIndex) => this.renderPart(part, message, index, partIndex))}
            </section>
          `;
        })}
      </div>
    `;
  }

  private renderMessageHeader(message: ChatLine, key: string, index: number, entryActionHeaders: ReadonlySet<ChatLine>, label: string = message.role) {
    const meta = this.messageMetaLabel(message);
    const expanded = this.expandedMetaKey === key;
    return html`
      <div class="msg-header">
        <b class="label">${label}</b>
        <div class="msg-header-trailing">
          ${this.renderMessageActions(message, key, this.messages[index - this.messageStart] ?? message, entryActionHeaders.has(message))}
          <span class=${expanded ? "msg-meta expanded" : "msg-meta"} role="button" tabindex="0" title=${meta} aria-label=${meta} aria-expanded=${String(expanded)} @click=${() => { this.expandedMetaKey = expanded ? undefined : key; }} @keydown=${(event: KeyboardEvent) => { this.onMetaKeydown(event, key, expanded); }}>${meta}</span>
        </div>
      </div>
    `;
  }

  private renderMessageActions(message: ChatLine, key: string, source: ChatLine, includeEntryActions: boolean) {
    const actions = this.messageActionContext === undefined ? []
      : this.messageActionAvailability.get(source, this.messageActions, this.messageActionContext, message, includeEntryActions)
        .filter(({ action }) => action.target === "display" ? this.onDisplayedMessageAction !== undefined : this.onMessageAction !== undefined);
    if (actions.length === 0) return null;
    const feedback = this.messageActionFeedback;
    return html`
      <div class="msg-actions" aria-label=${t("Message actions")}>
        ${actions.map(({ action, enabled, ariaLabel }) => {
          const presentation = feedback?.machineId === this.machineId && feedback.sessionId === this.sessionId && feedback.key === key && feedback.actionId === action.id
            ? feedback.presentation : undefined;
          const pending = action.target === "display" ? this.displayedMessageActionsPending.has(this.messageActionKey(key, action.id)) : this.messageActionPending;
          return html`<button type="button" class="msg-action" title=${presentation?.title ?? action.title} aria-label=${presentation?.ariaLabel ?? presentation?.title ?? ariaLabel} ?disabled=${!enabled || pending} @click=${(event: MouseEvent) => { void this.actOnMessage(source, message, key, action, event); }}>${presentation?.icon ?? action.icon ?? action.title}</button>`;
        })}
        ${this.messageActionError?.machineId === this.machineId && this.messageActionError.sessionId === this.sessionId && this.messageActionError.key === key ? html`<span role="alert">${this.messageActionError.message}</span>` : null}
      </div>
    `;
  }

  private messageActionKey(key: string, actionId: string): string {
    return JSON.stringify([this.machineId, this.sessionId, this.messageActionGeneration, key, actionId]);
  }

  private async actOnMessage(source: ChatLine, displayed: ChatLine, key: string, action: RegisteredMessageAction, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    const context = this.messageActionContext;
    if (context === undefined) return;
    const pendingKey = this.messageActionKey(key, action.id);
    if (action.target === "display" ? this.displayedMessageActionsPending.has(pendingKey) : this.messageActionPending) return;
    const entry = messageActionMessage(source, displayed.role);
    const onEntry = this.onMessageAction;
    const onDisplay = this.onDisplayedMessageAction;
    const run = action.target === "display"
      ? onDisplay === undefined ? undefined : () => onDisplay({ ...context, message: displayedMessageActionMessage(displayed) }, action.id)
      : entry === undefined || onEntry === undefined ? undefined : () => onEntry({ ...context, message: entry }, action.id);
    if (run === undefined) return;
    const sessionId = this.sessionId;
    const machineId = this.machineId;
    const generation = this.messageActionGeneration;
    if (action.target === "display") this.displayedMessageActionsPending = new Set([...this.displayedMessageActionsPending, pendingKey]);
    else this.messageActionPending = true;
    this.messageActionError = undefined;
    try {
      const presentation = await run();
      if (presentation !== undefined && this.isConnected && this.messageActionGeneration === generation && this.sessionId === sessionId && this.machineId === machineId) {
        this.clearMessageActionFeedback();
        this.messageActionFeedback = { machineId, sessionId, key, actionId: action.id, presentation };
        this.messageActionFeedbackTimer = window.setTimeout(() => { this.clearMessageActionFeedback(); }, 1200);
      }
    } catch (error) {
      if (this.isConnected && this.messageActionGeneration === generation && this.sessionId === sessionId && this.machineId === machineId) this.messageActionError = { machineId, sessionId, key, message: error instanceof Error ? error.message : String(error) };
    } finally {
      if (action.target === "display") this.displayedMessageActionsPending = new Set([...this.displayedMessageActionsPending].filter((item) => item !== pendingKey));
      else this.messageActionPending = false;
    }
  }

  private clearMessageActionFeedback(): void {
    if (this.messageActionFeedbackTimer !== undefined) window.clearTimeout(this.messageActionFeedbackTimer);
    this.messageActionFeedbackTimer = undefined;
    this.messageActionFeedback = undefined;
  }

  private onMetaKeydown(event: KeyboardEvent, key: string, expanded: boolean) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    this.expandedMetaKey = expanded ? undefined : key;
  }

  private messageMetaLabel(message: ChatLine): string {
    const cached = this.messageMetaCache.get(message);
    if (cached !== undefined) return cached;
    const label = chatMessageMetadataLabel(message);
    this.messageMetaCache.set(message, label);
    return label;
  }

  private transcriptSession(): SessionRef {
    if (this.imageSession?.id !== this.sessionId || this.imageSession.cwd !== this.sessionCwd) {
      this.imageSession = { id: this.sessionId, cwd: this.sessionCwd };
    }
    return this.imageSession;
  }

  private renderPart(part: ChatPart, message: ChatLine, messageIndex: number, partIndex: number) {
    const intentKey = JSON.stringify([this.machineId, this.sessionId, message.entryId ?? messageIndex, partIndex]);
    if (part.type === "text" || part.type === "thinking") {
      const text = part.displayText ?? part.text;
      if (text === "") return null;
      if (part.type === "thinking") return html`<details class="part"><summary>${t("Thinking")}</summary><formatted-text .imagesEnabled=${this.behaviors.loadImages} .codeBlocks=${this.behaviors.codeBlocks} .intentKey=${intentKey} .contentRendering=${this.contentRendering} .machineId=${this.machineId} .workspaceContext=${this.workspaceContext} .text=${text}></formatted-text></details>`;
      if (message.role === "bash") return html`<pre class="part shell-output">${text}</pre>`;
      return html`<formatted-text .imagesEnabled=${this.behaviors.loadImages} .codeBlocks=${this.behaviors.codeBlocks} .intentKey=${intentKey} class="part" .contentRendering=${this.contentRendering} .machineId=${this.machineId} .workspaceContext=${this.workspaceContext} .text=${text}></formatted-text>`;
    }
    if (part.type === "skillInvocation") return html`
      <details class="part skill-invocation">
        <summary><b>[skill]</b> ${part.name}</summary>
        <small>${part.location}</small>
        <formatted-text .imagesEnabled=${this.behaviors.loadImages} .codeBlocks=${this.behaviors.codeBlocks} .intentKey=${intentKey} .contentRendering=${this.contentRendering} .machineId=${this.machineId} .workspaceContext=${this.workspaceContext} .text=${part.content}></formatted-text>
      </details>
    `;
    if (part.type === "skillRead") return html`
      <div class="part skill-read">
        <strong>Loaded ${part.name}</strong>
        <small>read ${part.path}</small>
      </div>
    `;
    if (part.type === "askUserQuestion") {
      const open = this.openQuestion()?.askId === part.ask.askId;
      return html`<ask-user-card
        class=${open ? "part open-question-card" : "part closed-question-card"}
        .ask=${part.ask} .open=${open}
        .outcomes=${this.questionOutcomes.get(part.ask.askId) ?? []}
        .draftSessionId=${this.askDraftSessionId}
        .onSubmit=${open ? this.onSubmitAsk : undefined}
      ></ask-user-card>`;
    }
    if (part.type === "askUserRecord") return html`
      <ask-user-card
        class="part"
        .outcome=${part.outcome}
        .compact=${this.questionIds.has(part.outcome.askId)}
        .draftSessionId=${this.askDraftSessionId}
      ></ask-user-card>
    `;
    if (part.type === "image") {
      return html`<pi-web-transcript-image class="part chat-image" .imagePart=${part} .loadingDisabled=${!this.behaviors.loadImages}
        .session=${this.transcriptSession()} .machineId=${this.machineId}
      ></pi-web-transcript-image>`;
    }
    if (part.type === "toolCall") return html`<div class="part tool-line">▶ ${part.toolName}<span class="summary">${part.summary}</span></div>`;
    if (part.type === "toolExecution") return html`<tool-execution-view class="part" .execution=${part}></tool-execution-view>`;
    if (part.type === "toolResult") return html`
      <details class="part" ?open=${part.isError}>
        <summary>${part.isError ? "✖" : "✓"} ${part.toolName} result</summary>
        <formatted-text .imagesEnabled=${this.behaviors.loadImages} .codeBlocks=${this.behaviors.codeBlocks} .intentKey=${intentKey} .contentRendering=${this.contentRendering} .machineId=${this.machineId} .workspaceContext=${this.workspaceContext} .text=${part.text}></formatted-text>
      </details>
    `;
    return null;
  }

  private onGroupToggle(key: string, event: Event, defaultOpen: boolean) {
    const details = event.currentTarget;
    if (!(details instanceof HTMLDetailsElement)) return;
    // The browser owns disclosure visibility; retain the choice without rebuilding
    // its body (and its native lazy images) when it opens or closes.
    this.disclosures.applyToggle(key, details.open, defaultOpen);
  }

  private get handlesScrollIntent(): boolean {
    return this.behaviors.followTail || this.behaviors.rememberPosition;
  }

  private scrollContentChanged(changed: Map<string, unknown>): boolean {
    return changed.has("messages") || changed.has("historyReady") || changed.has("messageEnd") || changed.has("messageTotal") || changed.has("onSubmitAsk") || changed.has("pendingDialogs") || changed.has("closedDialogs");
  }

  private requestLoadMore(): void {
    if (this.loadMoreRequested || !this.hasMore || this.loadingMore || this.onLoadMore === undefined) return;
    this.loadMoreRequested = true;
    this.onLoadMore();
  }

  private openQuestion() {
    return openTranscriptQuestion(this.messages, {
      historyReady: this.historyReady,
      messageEnd: this.messageEnd,
      messageTotal: this.messageTotal,
      writable: this.onSubmitAsk !== undefined,
    });
  }

  private isNewOpenDialog(previous: unknown): boolean {
    const oldest = this.pendingDialogs[0];
    if (oldest === undefined) return false;
    if (!Array.isArray(previous)) return true;
    const previousOldest: unknown = previous[0];
    return typeof previousOldest !== "object" || previousOldest === null || Reflect.get(previousOldest, "dialogId") !== oldest.dialogId;
  }

  /** Public navigation hooks; the position-memory flow owns their effects. */
  restoreScrollPosition(): void {
    this.scrollFlows.restorePosition();
  }

  saveScrollPosition(sessionId = this.sessionId): void {
    this.scrollFlows.savePosition(sessionId);
  }

  private scrollAnchorElements(): HTMLElement[] {
    return Array.from(this.renderRoot.querySelectorAll<HTMLElement>("[data-scroll-anchor-id]"));
  }

  private groupDisclosureKey(group: Extract<ChatGroup, { kind: "group" }>, defaultOpen: boolean): string {
    return defaultOpen
      ? `${this.sessionId}:live:${chatLineIdentity(group.startIndex, group.messages[0]?.message)}`
      : `${this.sessionId}:${chatLineIdentity(group.endIndex, group.messages.at(-1)?.message)}`;
  }


  private groupAnchorKey(group: Extract<ChatGroup, { kind: "group" }>, live: boolean): string | undefined {
    // Historical groups can absorb earlier events; live groups grow at the end.
    // Skip transient members rather than persisting their display indexes.
    const durableIdentities = group.messages
      .map(({ message }) => chatLineScrollIdentity(message))
      .filter((identity): identity is string => identity !== undefined);
    const identity = live ? durableIdentities[0] : durableIdentities.at(-1);
    if (identity === undefined) return undefined;
    return live ? `g:${identity}` : `g-end:${identity}`;
  }

  static override styles = chatStyles;
}
