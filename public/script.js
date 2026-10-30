"use strict";

/* ============================================================
   NOVA AI — MAIN FRONTEND APPLICATION
   Compatible with:
   - Node.js + Express backend
   - Groq chat endpoint:     POST /api/chat
   - Research endpoint:     POST /api/research
   - Health endpoint:       GET  /api/health
   - HTML:                  public/index.html

   Existing storage key preserved:
   nova_ai_conversations_v1
============================================================ */


/* ============================================================
   1. CONFIGURATION
============================================================ */

const NOVA_CONFIG = {
    chatEndpoint: "/api/chat",
    researchEndpoint: "/api/research",
    healthEndpoint: "/api/health",

    storageKey: "nova_ai_conversations_v1",
    themeKey: "nova_ai_theme_v1",

    maxMessageLength: 30000,
    maxHistoryMessages: 60,
    healthCheckInterval: 60000
};


/* ============================================================
   2. DOM ELEMENTS
============================================================ */

const $ = (selector) => document.querySelector(selector);

const elements = {
    app: $("#app"),

    sidebar: $("#sidebar"),
    sidebarOpen: $("#sidebar-open"),
    sidebarClose: $("#sidebar-close"),
    sidebarBackdrop: $("#sidebar-backdrop"),

    newChat: $("#new-chat"),
    topbarNewChat: $("#topbar-new-chat"),
    composerNewChat: $("#composer-new-chat"),

    searchChatsButton: $("#search-chats-button"),
    chatSearchPanel: $("#chat-search-panel"),
    chatSearchInput: $("#chat-search-input"),
    closeChatSearch: $("#close-chat-search"),

    chatList: $("#chat-list"),
    refreshHistory: $("#refresh-history"),

    profileButton: $("#profile-button"),
    profileMenu: $("#profile-menu"),
    themeMenuButton: $("#theme-menu-button"),
    clearAllChats: $("#clear-all-chats"),
    aboutNova: $("#about-nova"),

    conversationTitle: $("#conversation-title"),
    connectionStatus: $("#connection-status"),
    statusDot: $("#status-dot"),
    statusText: $("#status-text"),

    chatViewport: $("#chat-viewport"),
    chatContent: $("#chat-content"),
    welcomeScreen: $("#welcome-screen"),
    chat: $("#chat"),

    loadingIndicator: $("#loading-indicator"),
    loadingText: $("#loading-text"),

    chatForm: $("#chat-form"),
    messageInput: $("#message"),
    sendButton: $("#send-button"),
    stopButton: $("#stop-generation"),

    researchToggle: $("#research-toggle"),
    researchShortcut: $("#research-shortcut"),
    composerResearch: $("#composer-research"),
    researchNotice: $("#research-notice"),
    disableResearch: $("#disable-research"),

    themeToggle: $("#theme-toggle"),

    confirmationDialog: $("#confirmation-dialog"),
    dialogTitle: $("#dialog-title"),
    dialogMessage: $("#dialog-message"),
    dialogCancel: $("#dialog-cancel"),
    dialogConfirm: $("#dialog-confirm"),

    renameDialog: $("#rename-dialog"),
    renameForm: $("#rename-form"),
    renameInput: $("#rename-input"),
    renameCancel: $("#rename-cancel"),

    aboutDialog: $("#about-dialog"),
    aboutClose: $("#about-close"),

    toastContainer: $("#toast-container")
};


/* ============================================================
   3. APPLICATION STATE
============================================================ */

const state = {
    conversations: [],
    activeConversationId: null,

    researchEnabled: false,

    isGenerating: false,
    currentController: null,
    requestSequence: 0,

    pendingConfirmation: null,
    pendingRenameId: null,

    toastTimers: new Set(),

    isMobileSidebarOpen: false,

    healthTimer: null
};


/* ============================================================
   4. GENERAL UTILITIES
============================================================ */

function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
    }

    return (
        Date.now().toString(36) +
        Math.random().toString(36).slice(2)
    );
}


function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return entities[character];
    });
}


function normaliseText(value) {
    if (typeof value === "string") {
        return value;
    }

    if (value == null) {
        return "";
    }

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}


function isPlainObject(value) {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
    );
}


function safeParseJSON(value, fallback = null) {
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}


function formatDate(timestamp) {
    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    const now = new Date();

    const sameDay =
        date.getDate() === now.getDate() &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear();

    if (sameDay) {
        return date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    return date.toLocaleDateString([], {
        day: "numeric",
        month: "short"
    });
}


function scrollToBottom(smooth = true) {
    if (!elements.chatViewport) {
        return;
    }

    elements.chatViewport.scrollTo({
        top: elements.chatViewport.scrollHeight,
        behavior: smooth ? "smooth" : "auto"
    });
}


function focusMessageInput() {
    if (!elements.messageInput) {
        return;
    }

    if (window.matchMedia("(pointer: fine)").matches) {
        elements.messageInput.focus();
    }
}


function autoResizeTextarea() {
    const input = elements.messageInput;

    if (!input) {
        return;
    }

    input.style.height = "auto";

    const maximumHeight = 240;

    input.style.height =
        Math.min(input.scrollHeight, maximumHeight) + "px";

    input.style.overflowY =
        input.scrollHeight > maximumHeight ? "auto" : "hidden";
}


/* ============================================================
   5. TOAST NOTIFICATIONS
============================================================ */

function showToast(message, type = "info", duration = 3000) {
    if (!elements.toastContainer) {
        console.log("[NOVA]", message);
        return;
    }

    const toast = document.createElement("div");

    toast.className = "toast toast-" + type;
    toast.setAttribute("role", "status");
    toast.textContent = message;

    elements.toastContainer.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add("toast-visible");
    });

    const timer = window.setTimeout(() => {
        toast.classList.remove("toast-visible");

        window.setTimeout(() => {
            toast.remove();
        }, 250);

        state.toastTimers.delete(timer);
    }, duration);

    state.toastTimers.add(timer);
}


/* ============================================================
   6. LOCAL STORAGE AND CONVERSATION NORMALISATION
============================================================ */

/*
   This loader supports several common conversation formats.

   It deliberately preserves existing conversation IDs and
   messages whenever possible, so previous saved chats can
   remain accessible after the frontend upgrade.
*/

function normaliseMessage(message) {
    if (typeof message === "string") {
        return {
            role: "user",
            content: message,
            timestamp: Date.now()
        };
    }

    if (!isPlainObject(message)) {
        return null;
    }

    let role =
        message.role ||
        message.sender ||
        message.type ||
        "assistant";

    role = String(role).toLowerCase();

    if (role === "ai" || role === "bot" || role === "nova") {
        role = "assistant";
    }

    if (role === "human") {
        role = "user";
    }

    if (!["user", "assistant", "system"].includes(role)) {
        role = "assistant";
    }

    const content =
        message.content ??
        message.text ??
        message.message ??
        message.response ??
        "";

    return {
        ...message,
        role,
        content: normaliseText(content),
        timestamp:
            message.timestamp ||
            message.createdAt ||
            Date.now()
    };
}


function normaliseConversation(conversation, index = 0) {
    if (!isPlainObject(conversation)) {
        return null;
    }

    const id =
        conversation.id ||
        conversation.conversationId ||
        createId();

    let rawMessages =
        conversation.messages ??
        conversation.history ??
        conversation.chat ??
        [];

    if (!Array.isArray(rawMessages)) {
        rawMessages = [];
    }

    const messages = rawMessages
        .map(normaliseMessage)
        .filter(Boolean);

    const firstUserMessage = messages.find(
        (message) => message.role === "user"
    );

    const defaultTitle = firstUserMessage
        ? firstUserMessage.content.slice(0, 45)
        : "New conversation";

    return {
        ...conversation,

        id: String(id),

        title:
            typeof conversation.title === "string" &&
            conversation.title.trim()
                ? conversation.title.trim()
                : defaultTitle,

        messages,

        updatedAt:
            conversation.updatedAt ||
            conversation.timestamp ||
            conversation.createdAt ||
            Date.now(),

        createdAt:
            conversation.createdAt ||
            conversation.timestamp ||
            Date.now()
    };
}


function loadConversations() {
    try {
        const saved = localStorage.getItem(NOVA_CONFIG.storageKey);

        if (!saved) {
            state.conversations = [];
            return;
        }

        const parsed = JSON.parse(saved);

        let list = [];

        if (Array.isArray(parsed)) {
            list = parsed;
        } else if (isPlainObject(parsed)) {
            if (Array.isArray(parsed.conversations)) {
                list = parsed.conversations;
            } else if (Array.isArray(parsed.chats)) {
                list = parsed.chats;
            }
        }

        state.conversations = list
            .map(normaliseConversation)
            .filter(Boolean);

    } catch (error) {
        console.error("Unable to load saved conversations:", error);

        showToast(
            "Saved conversations could not be loaded.",
            "error"
        );

        state.conversations = [];
    }
}


function saveConversations() {
    try {
        localStorage.setItem(
            NOVA_CONFIG.storageKey,
            JSON.stringify(state.conversations)
        );

        return true;

    } catch (error) {
        console.error("Unable to save conversations:", error);

        showToast(
            "Chat history could not be saved. Browser storage may be full.",
            "error",
            5000
        );

        return false;
    }
}


function getActiveConversation() {
    return state.conversations.find(
        (conversation) =>
            conversation.id === state.activeConversationId
    ) || null;
}


function createConversation() {
    const now = Date.now();

    const conversation = {
        id: createId(),
        title: "New conversation",
        messages: [],
        createdAt: now,
        updatedAt: now
    };

    state.conversations.unshift(conversation);

    state.activeConversationId = conversation.id;

    saveConversations();

    return conversation;
}


function updateConversationTimestamp(conversation) {
    if (!conversation) {
        return;
    }

    conversation.updatedAt = Date.now();

    state.conversations.sort(
        (a, b) => b.updatedAt - a.updatedAt
    );
}


function generateConversationTitle(conversation) {
    const firstUserMessage = conversation.messages.find(
        (message) => message.role === "user"
    );

    if (!firstUserMessage) {
        return "New conversation";
    }

    let title = firstUserMessage.content
        .replace(/\s+/g, " ")
        .trim();

    if (title.length > 45) {
        title = title.slice(0, 42).trim() + "...";
    }

    return title || "New conversation";
}


/* ============================================================
   7. THEME MANAGEMENT
============================================================ */

function applyTheme(theme, persist = true) {
    const selectedTheme = theme === "dark" ? "dark" : "light";

    document.documentElement.dataset.theme = selectedTheme;

    document.documentElement.style.colorScheme = selectedTheme;

    const darkMode = selectedTheme === "dark";

    if (elements.themeToggle) {
        elements.themeToggle.setAttribute(
            "aria-label",
            darkMode
                ? "Switch to light mode"
                : "Switch to dark mode"
        );

        elements.themeToggle.setAttribute(
            "title",
            darkMode ? "Switch to light mode" : "Switch to dark mode"
        );
    }

    const themeColor = document.querySelector(
        'meta[name="theme-color"]'
    );

    if (themeColor) {
        themeColor.content = darkMode ? "#111111" : "#ffffff";
    }

    if (persist) {
        try {
            localStorage.setItem(NOVA_CONFIG.themeKey, selectedTheme);
        } catch (error) {
            console.warn("Could not save theme preference:", error);
        }
    }
}


function toggleTheme() {
    const currentTheme =
        document.documentElement.dataset.theme || "light";

    applyTheme(currentTheme === "dark" ? "light" : "dark");
}


function loadTheme() {
    let savedTheme = null;

    try {
        savedTheme = localStorage.getItem(NOVA_CONFIG.themeKey);
    } catch {
        // Continue with the default theme.
    }

    if (savedTheme !== "light" && savedTheme !== "dark") {
        savedTheme = "light";
    }

    applyTheme(savedTheme, false);
}


/* ============================================================
   8. CONNECTION STATUS
============================================================ */

function setConnectionStatus(status, text) {
    if (elements.statusText) {
        elements.statusText.textContent = text;
    }

    if (elements.connectionStatus) {
        elements.connectionStatus.dataset.status = status;
    }

    if (elements.statusDot) {
        elements.statusDot.dataset.status = status;
    }
}


async function checkBackendHealth() {
    try {
        const response = await fetch(NOVA_CONFIG.healthEndpoint, {
            method: "GET",
            cache: "no-store",
            headers: {
                "Accept": "application/json"
            }
        });

        if (!response.ok) {
            throw new Error("Health endpoint returned " + response.status);
        }

        setConnectionStatus("online", "Online");

        return true;

    } catch (error) {
        setConnectionStatus("offline", "Offline");

        return false;
    }
}


function startHealthChecks() {
    checkBackendHealth();

    if (state.healthTimer) {
        clearInterval(state.healthTimer);
    }

    state.healthTimer = window.setInterval(
        checkBackendHealth,
        NOVA_CONFIG.healthCheckInterval
    );
}


/* ============================================================
   9. SIDEBAR
============================================================ */

function openSidebar() {
    if (!elements.sidebar) {
        return;
    }

    if (window.matchMedia("(max-width: 760px)").matches) {
        state.isMobileSidebarOpen = true;

        elements.sidebar.classList.add("sidebar-mobile-open");

        if (elements.sidebarBackdrop) {
            elements.sidebarBackdrop.hidden = false;
        }

        document.body.classList.add("sidebar-is-open");

    } else {
        elements.sidebar.classList.remove("sidebar-collapsed");

        elements.app?.classList.remove("sidebar-collapsed");

        try {
            localStorage.setItem("nova_ai_sidebar_collapsed", "false");
        } catch {
            // Sidebar still works without storage.
        }
    }
}


function closeSidebar() {
    if (!elements.sidebar) {
        return;
    }

    if (window.matchMedia("(max-width: 760px)").matches) {
        state.isMobileSidebarOpen = false;

        elements.sidebar.classList.remove("sidebar-mobile-open");

        if (elements.sidebarBackdrop) {
            elements.sidebarBackdrop.hidden = true;
        }

        document.body.classList.remove("sidebar-is-open");

    } else {
        elements.sidebar.classList.add("sidebar-collapsed");

        elements.app?.classList.add("sidebar-collapsed");

        try {
            localStorage.setItem("nova_ai_sidebar_collapsed", "true");
        } catch {
            // Sidebar still works without storage.
        }
    }
}


function restoreSidebarState() {
    let collapsed = false;

    try {
        collapsed =
            localStorage.getItem("nova_ai_sidebar_collapsed") === "true";
    } catch {
        // Use default state.
    }

    if (
        collapsed &&
        !window.matchMedia("(max-width: 760px)").matches
    ) {
        elements.sidebar?.classList.add("sidebar-collapsed");
        elements.app?.classList.add("sidebar-collapsed");
    }
}


/* ============================================================
   10. CHAT HISTORY RENDERING
============================================================ */

function createHistoryButton(label, className, handler) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.setAttribute("aria-label", label);

    button.addEventListener("click", handler);

    return button;
}


function renderConversationList(searchTerm = "") {
    if (!elements.chatList) {
        return;
    }

    elements.chatList.replaceChildren();

    const query = searchTerm.trim().toLowerCase();

    const conversations = [...state.conversations]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .filter((conversation) => {
            if (!query) {
                return true;
            }

            const messageText = conversation.messages
                .map((message) => message.content)
                .join(" ");

            return (
                conversation.title.toLowerCase().includes(query) ||
                messageText.toLowerCase().includes(query)
            );
        });

    if (conversations.length === 0) {
        const empty = document.createElement("div");

        empty.className = "chat-list-empty";

        empty.textContent = query
            ? "No matching conversations"
            : "Your conversations will appear here.";

        elements.chatList.appendChild(empty);

        return;
    }

    conversations.forEach((conversation) => {
        const item = document.createElement("div");

        item.className = "chat-history-item";

        item.dataset.conversationId = conversation.id;

        item.setAttribute("role", "listitem");

        if (conversation.id === state.activeConversationId) {
            item.classList.add("active");
        }

        const mainButton = document.createElement("button");

        mainButton.type = "button";

        mainButton.className = "chat-history-main";

        mainButton.title = conversation.title;

        const title = document.createElement("span");

        title.className = "chat-history-title";

        title.textContent = conversation.title;

        const date = document.createElement("span");

        date.className = "chat-history-date";

        date.textContent = formatDate(conversation.updatedAt);

        mainButton.append(title, date);

        mainButton.addEventListener("click", () => {
            openConversation(conversation.id);
            closeSidebar();
        });


        const menuButton = document.createElement("button");

        menuButton.type = "button";

        menuButton.className = "chat-history-menu-button";

        menuButton.textContent = "⋯";

        menuButton.setAttribute(
            "aria-label",
            "Conversation options"
        );

        menuButton.title = "Conversation options";


        const menu = document.createElement("div");

        menu.className = "chat-history-menu";

        menu.hidden = true;


        const renameButton = createHistoryButton(
            "Rename",
            "chat-history-menu-option",
            () => {
                menu.hidden = true;
                openRenameDialog(conversation.id);
            }
        );


        const deleteButton = createHistoryButton(
            "Delete",
            "chat-history-menu-option danger-option",
            () => {
                menu.hidden = true;
                deleteConversation(conversation.id);
            }
        );


        menu.append(renameButton, deleteButton);

        menuButton.addEventListener("click", (event) => {
            event.stopPropagation();

            const shouldOpen = menu.hidden;

            document.querySelectorAll(".chat-history-menu").forEach(
                (otherMenu) => {
                    otherMenu.hidden = true;
                }
            );

            menu.hidden = !shouldOpen;
        });

        item.append(mainButton, menuButton, menu);

        elements.chatList.appendChild(item);
    });
}


function openConversation(conversationId) {
    const conversation = state.conversations.find(
        (item) => item.id === conversationId
    );

    if (!conversation) {
        showToast("Conversation not found.", "error");
        return;
    }

    state.activeConversationId = conversation.id;

    renderConversation();

    renderConversationList(elements.chatSearchInput?.value || "");

    saveConversations();
}


function startNewChat() {
    if (state.isGenerating) {
        stopGeneration(false);
    }

    state.activeConversationId = null;

    state.researchEnabled = false;

    updateResearchUI();

    if (elements.chatSearchInput) {
        elements.chatSearchInput.value = "";
    }

    renderConversation();

    renderConversationList();

    focusMessageInput();
}


function ensureActiveConversation() {
    let conversation = getActiveConversation();

    if (!conversation) {
        conversation = createConversation();

        state.activeConversationId = conversation.id;
    }

    return conversation;
}


/* ============================================================
   11. DELETE AND CLEAR CONVERSATIONS
============================================================ */

function deleteConversation(conversationId) {
    const conversation = state.conversations.find(
        (item) => item.id === conversationId
    );

    if (!conversation) {
        return;
    }

    showConfirmation(
        "Delete conversation?",
        "Delete \"" + conversation.title +
            "\"? This removes its locally saved conversation history.",
        "Delete",
        () => {
            state.conversations = state.conversations.filter(
                (item) => item.id !== conversationId
            );

            if (state.activeConversationId === conversationId) {
                if (state.isGenerating) {
                    stopGeneration(false);
                }

                state.activeConversationId = null;
            }

            saveConversations();

            renderConversationList();

            renderConversation();

            showToast("Conversation deleted.", "success");
        }
    );
}


function clearAllConversations() {
    if (state.conversations.length === 0) {
        showToast("There are no saved conversations.", "info");
        return;
    }

    showConfirmation(
        "Clear all conversations?",
        "This permanently removes all locally saved NOVA AI conversations from this browser.",
        "Clear all",
        () => {
            if (state.isGenerating) {
                stopGeneration(false);
            }

            state.conversations = [];

            state.activeConversationId = null;

            saveConversations();

            renderConversationList();

            renderConversation();

            closeProfileMenu();

            showToast("All conversations cleared.", "success");
        }
    );
}


/* ============================================================
   12. RENAME CONVERSATIONS
============================================================ */

function openRenameDialog(conversationId) {
    const conversation = state.conversations.find(
        (item) => item.id === conversationId
    );

    if (!conversation || !elements.renameDialog) {
        return;
    }

    state.pendingRenameId = conversationId;

    elements.renameInput.value = conversation.title;

    elements.renameDialog.showModal();

    elements.renameInput.focus();

    elements.renameInput.select();
}


function closeRenameDialog() {
    state.pendingRenameId = null;

    if (elements.renameDialog?.open) {
        elements.renameDialog.close();
    }
}


function saveRenamedConversation(event) {
    event.preventDefault();

    const conversation = state.conversations.find(
        (item) => item.id === state.pendingRenameId
    );

    if (!conversation) {
        closeRenameDialog();
        return;
    }

    const title = elements.renameInput.value.trim();

    if (!title) {
        showToast("Enter a conversation title.", "error");
        return;
    }

    conversation.title = title;

    updateConversationTimestamp(conversation);

    saveConversations();

    renderConversationList();

    renderConversation();

    closeRenameDialog();

    showToast("Conversation renamed.", "success");
}


/* ============================================================
   13. CONFIRMATION DIALOG
============================================================ */

function showConfirmation(title, message, confirmText, callback) {
    if (!elements.confirmationDialog) {
        const accepted = window.confirm(message);

        if (accepted) {
            callback();
        }

        return;
    }

    state.pendingConfirmation = callback;

    elements.dialogTitle.textContent = title;

    elements.dialogMessage.textContent = message;

    elements.dialogConfirm.textContent = confirmText;

    elements.confirmationDialog.showModal();
}


function closeConfirmationDialog() {
    state.pendingConfirmation = null;

    if (elements.confirmationDialog?.open) {
        elements.confirmationDialog.close();
    }
}


function confirmDialogAction() {
    const callback = state.pendingConfirmation;

    closeConfirmationDialog();

    if (typeof callback === "function") {
        callback();
    }
}


/* ============================================================
   14. PROFILE MENU
============================================================ */

function toggleProfileMenu() {
    if (!elements.profileMenu) {
        return;
    }

    elements.profileMenu.hidden = !elements.profileMenu.hidden;
}


function closeProfileMenu() {
    if (elements.profileMenu) {
        elements.profileMenu.hidden = true;
    }
}


/* ============================================================
   15. RESEARCH MODE
============================================================ */

function updateResearchUI() {
    const enabled = state.researchEnabled;

    const toggles = [
        elements.researchToggle,
        elements.composerResearch
    ];

    toggles.forEach((button) => {
        if (!button) {
            return;
        }

        button.classList.toggle("is-active", enabled);

        button.setAttribute(
            "aria-pressed",
            enabled ? "true" : "false"
        );
    });

    if (elements.researchNotice) {
        elements.researchNotice.hidden = !enabled;
    }

    if (elements.researchShortcut) {
        elements.researchShortcut.classList.toggle(
            "is-active",
            enabled
        );
    }

    if (elements.loadingText && state.isGenerating) {
        elements.loadingText.textContent = enabled
            ? "NOVA is researching online..."
            : "NOVA is thinking...";
    }
}


function setResearchMode(enabled) {
    state.researchEnabled = Boolean(enabled);

    updateResearchUI();
}


function toggleResearchMode() {
    setResearchMode(!state.researchEnabled);

    showToast(
        state.researchEnabled
            ? "Online research enabled."
            : "Online research disabled.",
        "info"
    );
}


/* ============================================================
   16. MESSAGE RENDERING
============================================================ */

function getMessageText(message) {
    if (typeof message === "string") {
        return message;
    }

    if (!isPlainObject(message)) {
        return normaliseText(message);
    }

    return normaliseText(
        message.content ??
        message.text ??
        message.message ??
        ""
    );
}


function renderMarkdown(content) {
    const text = normaliseText(content);

    if (window.marked && window.DOMPurify) {
        try {
            const html = window.marked.parse(text, {
                gfm: true,
                breaks: true
            });

            return window.DOMPurify.sanitize(html, {
                USE_PROFILES: {
                    html: true
                }
            });

        } catch (error) {
            console.error("Markdown rendering failed:", error);
        }
    }

    return escapeHTML(text).replace(/\n/g, "<br>");
}


function createIconButton(label, icon, className = "") {
    const button = document.createElement("button");

    button.type = "button";

    button.className = "message-action " + className;

    button.setAttribute("aria-label", label);

    button.title = label;

    button.innerHTML = icon;

    return button;
}


const NOVA_ICONS = {
    copy: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="8" y="8" width="12" height="12" rx="2"/>
            <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>
        </svg>
    `,

    regenerate: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 7v5h-5"/>
            <path d="M4 17v-5h5"/>
            <path d="M5.5 9a7 7 0 0 1 12-2L20 12"/>
            <path d="M18.5 15a7 7 0 0 1-12 2L4 12"/>
        </svg>
    `,

    check: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m5 12 4 4L19 6"/>
        </svg>
    `,

    assistant: `
        <span class="assistant-avatar" aria-hidden="true">✳</span>
    `
};


function enhanceCodeBlocks(messageBody) {
    if (!messageBody) {
        return;
    }

    messageBody.querySelectorAll("pre").forEach((pre) => {
        if (pre.dataset.novaEnhanced === "true") {
            return;
        }

        pre.dataset.novaEnhanced = "true";

        const code = pre.querySelector("code");

        if (!code) {
            return;
        }

        if (window.hljs) {
            try {
                window.hljs.highlightElement(code);
            } catch (error) {
                console.warn("Code highlighting failed:", error);
            }
        }

        const wrapper = document.createElement("div");

        wrapper.className = "code-block-wrapper";

        const toolbar = document.createElement("div");

        toolbar.className = "code-block-toolbar";

        const language = document.createElement("span");

        language.className = "code-language";

        const match = code.className.match(/language-([\w+-]+)/);

        language.textContent = match ? match[1] : "Code";

        const copyButton = createIconButton(
            "Copy code",
            NOVA_ICONS.copy,
            "copy-code-button"
        );

        const copyLabel = document.createElement("span");

        copyLabel.textContent = "Copy";

        copyButton.appendChild(copyLabel);

        copyButton.addEventListener("click", async () => {
            try {
                await copyText(code.textContent || "");

                copyLabel.textContent = "Copied";

                copyButton.title = "Copied";

                copyButton.classList.add("is-copied");

                window.setTimeout(() => {
                    copyLabel.textContent = "Copy";

                    copyButton.title = "Copy code";

                    copyButton.classList.remove("is-copied");
                }, 1800);

            } catch {
                showToast("Could not copy the code.", "error");
            }
        });

        toolbar.append(language, copyButton);

        pre.parentNode.insertBefore(wrapper, pre);

        wrapper.append(toolbar, pre);
    });
}


async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement("textarea");

    textarea.value = text;

    textarea.style.position = "fixed";

    textarea.style.opacity = "0";

    textarea.style.pointerEvents = "none";

    document.body.appendChild(textarea);

    textarea.select();

    const success = document.execCommand("copy");

    textarea.remove();

    if (!success) {
        throw new Error("Copy command failed.");
    }
}


function renderMessage(message, index) {
    const role = message.role === "user" ? "user" : "assistant";

    const wrapper = document.createElement("article");

    wrapper.className = "message message-" + role;

    wrapper.dataset.messageIndex = String(index);

    const inner = document.createElement("div");

    inner.className = "message-inner";

    const avatar = document.createElement("div");

    avatar.className = "message-avatar";

    if (role === "assistant") {
        avatar.innerHTML = NOVA_ICONS.assistant;
    } else {
        avatar.textContent = "You";
    }

    const contentArea = document.createElement("div");

    contentArea.className = "message-content-area";

    const header = document.createElement("div");

    header.className = "message-header";

    const sender = document.createElement("span");

    sender.className = "message-sender";

    sender.textContent = role === "user" ? "You" : "NOVA AI";

    header.appendChild(sender);

    const body = document.createElement("div");

    body.className = "message-body";

    body.innerHTML = renderMarkdown(getMessageText(message));

    enhanceCodeBlocks(body);

    contentArea.append(header, body);

    inner.append(avatar, contentArea);

    wrapper.appendChild(inner);


    if (role === "assistant" && message.content) {
        const actions = document.createElement("div");

        actions.className = "message-actions";

        const copyButton = createIconButton(
            "Copy response",
            NOVA_ICONS.copy,
            "copy-response-button"
        );

        copyButton.addEventListener("click", async () => {
            try {
                await copyText(getMessageText(message));

                showToast("Response copied.", "success", 1500);

            } catch {
                showToast("Could not copy response.", "error");
            }
        });

        actions.appendChild(copyButton);

        const conversation = getActiveConversation();

        const isLastAssistantMessage =
            conversation &&
            conversation.messages
                .filter((item) => item.role === "assistant")
                .slice(-1)[0] === message;

        if (isLastAssistantMessage) {
            const regenerateButton = createIconButton(
                "Regenerate response",
                NOVA_ICONS.regenerate,
                "regenerate-button"
            );

            regenerateButton.addEventListener("click", () => {
                regenerateLastResponse();
            });

            actions.appendChild(regenerateButton);
        }

        wrapper.appendChild(actions);
    }

    return wrapper;
}


function renderConversation() {
    const conversation = getActiveConversation();

    if (elements.chat) {
        elements.chat.replaceChildren();
    }

    const hasMessages =
        conversation &&
        conversation.messages.length > 0;

    if (elements.welcomeScreen) {
        elements.welcomeScreen.hidden = Boolean(hasMessages);
    }

    if (elements.conversationTitle) {
        elements.conversationTitle.textContent =
            conversation?.title || "New conversation";
    }

    if (conversation && elements.chat) {
        conversation.messages.forEach((message, index) => {
            elements.chat.appendChild(
                renderMessage(message, index)
            );
        });
    }

    renderConversationList(
        elements.chatSearchInput?.value || ""
    );

    scrollToBottom(false);
}


/* ============================================================
   17. LOADING STATE
============================================================ */

function setGenerating(isGenerating, label = "") {
    state.isGenerating = Boolean(isGenerating);

    if (elements.loadingIndicator) {
        elements.loadingIndicator.hidden = !state.isGenerating;
    }

    if (elements.loadingText && label) {
        elements.loadingText.textContent = label;
    }

    if (elements.sendButton) {
        elements.sendButton.disabled = state.isGenerating;

        elements.sendButton.setAttribute(
            "aria-label",
            state.isGenerating ? "Generating response" : "Send message"
        );
    }

    if (elements.stopButton) {
        elements.stopButton.hidden = !state.isGenerating;
    }

    if (elements.messageInput) {
        elements.messageInput.setAttribute(
            "aria-busy",
            state.isGenerating ? "true" : "false"
        );
    }

    updateResearchUI();
}


/* ============================================================
   18. API RESPONSE PARSING
============================================================ */

async function parseAPIResponse(response) {
    const raw = await response.text();

    const parsed = safeParseJSON(raw, null);

    if (!response.ok) {
        let message = "Request failed with status " + response.status;

        if (parsed && isPlainObject(parsed)) {
            message =
                parsed.error ||
                parsed.message ||
                parsed.details ||
                message;
        } else if (raw.trim()) {
            message = raw.slice(0, 500);
        }

        throw new Error(String(message));
    }

    if (parsed !== null) {
        return parsed;
    }

    if (!raw.trim()) {
        throw new Error("The server returned an empty response.");
    }

    return {
        response: raw
    };
}


function extractResponseText(data) {
    if (typeof data === "string") {
        return data;
    }

    if (!isPlainObject(data)) {
        return normaliseText(data);
    }

    const directFields = [
        "reply",
        "response",
        "answer",
        "output",
        "text",
        "content",
        "message"
    ];

    for (const field of directFields) {
        if (typeof data[field] === "string" && data[field].trim()) {
            return data[field];
        }
    }

    if (
        data.choices &&
        Array.isArray(data.choices) &&
        data.choices[0]
    ) {
        const choice = data.choices[0];

        if (typeof choice.text === "string") {
            return choice.text;
        }

        if (choice.message) {
            if (typeof choice.message.content === "string") {
                return choice.message.content;
            }

            if (Array.isArray(choice.message.content)) {
                return choice.message.content
                    .map((item) => item.text || "")
                    .join("\n");
            }
        }
    }

    if (data.data && isPlainObject(data.data)) {
        const nested = extractResponseText(data.data);

        if (nested) {
            return nested;
        }
    }

    if (data.result && isPlainObject(data.result)) {
        const nested = extractResponseText(data.result);

        if (nested) {
            return nested;
        }
    }

    return "";
}


/* ============================================================
   19. SOURCE LINKS FOR ONLINE RESEARCH
============================================================ */

function extractResearchSources(data) {
    if (!isPlainObject(data)) {
        return [];
    }

    const candidates = [
        data.sources,
        data.sourceLinks,
        data.source_links,
        data.references,
        data.citations,
        data.results,
        data.searchResults
    ];

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate;
        }
    }

    if (isPlainObject(data.data)) {
        return extractResearchSources(data.data);
    }

    if (isPlainObject(data.result)) {
        return extractResearchSources(data.result);
    }

    return [];
}


function normaliseSource(source) {
    if (typeof source === "string") {
        return {
            title: source,
            url: source
        };
    }

    if (!isPlainObject(source)) {
        return null;
    }

    const url =
        source.url ||
        source.link ||
        source.href ||
        source.sourceUrl ||
        source.source_url ||
        "";

    const title =
        source.title ||
        source.name ||
        source.label ||
        source.domain ||
        url;

    return {
        title: String(title || "Source"),
        url: String(url || ""),
        snippet: String(
            source.snippet ||
            source.description ||
            source.summary ||
            ""
        )
    };
}


function isSafeHTTPURL(value) {
    try {
        const url = new URL(value, window.location.origin);

        return url.protocol === "https:" || url.protocol === "http:";

    } catch {
        return false;
    }
}


function appendResearchSources(messageBody, sources) {
    if (!messageBody || !Array.isArray(sources) || sources.length === 0) {
        return;
    }

    const uniqueSources = [];

    const seenURLs = new Set();

    for (const rawSource of sources) {
        const source = normaliseSource(rawSource);

        if (!source || !isSafeHTTPURL(source.url)) {
            continue;
        }

        const parsedURL = new URL(source.url);

        if (seenURLs.has(parsedURL.href)) {
            continue;
        }

        seenURLs.add(parsedURL.href);

        uniqueSources.push(source);
    }

    if (uniqueSources.length === 0) {
        return;
    }

    const section = document.createElement("section");

    section.className = "research-sources";

    const heading = document.createElement("h4");

    heading.textContent = "Sources";

    const list = document.createElement("ol");

    uniqueSources.slice(0, 15).forEach((source) => {
        const item = document.createElement("li");

        const link = document.createElement("a");

        link.href = source.url;

        link.textContent = source.title;

        link.target = "_blank";

        link.rel = "noopener noreferrer";

        item.appendChild(link);

        if (source.snippet) {
            const description = document.createElement("p");

            description.textContent = source.snippet;

            item.appendChild(description);
        }

        list.appendChild(item);
    });

    section.append(heading, list);

    messageBody.appendChild(section);
}


/* ============================================================
   20. REQUEST CONSTRUCTION
============================================================ */

function getAPIHistory(conversation) {
    return conversation.messages
        .slice(-NOVA_CONFIG.maxHistoryMessages)
        .map((message) => ({
            role: message.role,
            content: message.content
        }))
        .filter((message) => {
            return (
                ["user", "assistant"].includes(message.role) &&
                typeof message.content === "string"
            );
        });
}


function buildRequestBody(conversation, message, researchEnabled) {
    const history = getAPIHistory(conversation);

    /*
       The last message is also sent separately as "message".

       History is provided under common field names to support
       backends that use any of these contracts.

       Your server may ignore fields it does not need.
    */

    const body = {
        message,

        history,

        conversationHistory: history,

        messages: history,

        conversationId: conversation.id
    };

    if (researchEnabled) {
        body.query = message;

        body.research = true;
    }

    return body;
}


/* ============================================================
   21. SEND MESSAGE
============================================================ */

async function sendMessage(rawMessage = null, options = {}) {
    if (state.isGenerating) {
        showToast("NOVA is already generating a response.", "info");
        return;
    }

    const inputMessage =
        rawMessage === null
            ? elements.messageInput.value
            : rawMessage;

    const message = String(inputMessage || "").trim();

    if (!message) {
        return;
    }

    if (message.length > NOVA_CONFIG.maxMessageLength) {
        showToast("Your message is too long.", "error");
        return;
    }

    const conversation = ensureActiveConversation();

    const researchEnabled =
        typeof options.researchEnabled === "boolean"
            ? options.researchEnabled
            : state.researchEnabled;

    if (rawMessage === null) {
        elements.messageInput.value = "";

        autoResizeTextarea();
    }

    const userMessage = {
        role: "user",
        content: message,
        timestamp: Date.now()
    };

    conversation.messages.push(userMessage);

    if (
        conversation.title === "New conversation" ||
        !conversation.title.trim()
    ) {
        conversation.title = generateConversationTitle(conversation);
    }

    updateConversationTimestamp(conversation);

    saveConversations();

    renderConversation();

    renderConversationList();

    setGenerating(
        true,
        researchEnabled
            ? "NOVA is researching online..."
            : "NOVA is thinking..."
    );

    const controller = new AbortController();

    state.currentController = controller;

    const sequence = ++state.requestSequence;

    const endpoint = researchEnabled
        ? NOVA_CONFIG.researchEndpoint
        : NOVA_CONFIG.chatEndpoint;

    try {
        const requestBody = buildRequestBody(
            conversation,
            message,
            researchEnabled
        );

        const response = await fetch(endpoint, {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },

            body: JSON.stringify(requestBody),

            signal: controller.signal
        });

        const data = await parseAPIResponse(response);

        if (sequence !== state.requestSequence) {
            return;
        }

        let answer = extractResponseText(data);

        if (!answer.trim()) {
            if (data && data.error) {
                throw new Error(data.error);
            }

            throw new Error(
                "The server returned no answer. Check the backend response format."
            );
        }

        /*
           Save the response to the conversation only after
           the request completes successfully.
        */

        const assistantMessage = {
            role: "assistant",
            content: answer,
            timestamp: Date.now()
        };

        conversation.messages.push(assistantMessage);

        updateConversationTimestamp(conversation);

        saveConversations();

        renderConversation();

        /*
           Attach research sources to the newly rendered answer.
        */

        if (researchEnabled) {
            const sources = extractResearchSources(data);

            const lastMessage = elements.chat?.lastElementChild;

            const messageBody = lastMessage?.querySelector(".message-body");

            appendResearchSources(messageBody, sources);

            if (sources.length === 0) {
                console.info(
                    "No structured research sources were returned by the server."
                );
            }
        }

        scrollToBottom();

    } catch (error) {
        if (
            error.name === "AbortError" ||
            sequence !== state.requestSequence
        ) {
            return;
        }

        console.error("NOVA request failed:", error);

        const errorMessage =
            error.message ||
            "An unexpected error occurred.";

        /*
           The user's message remains saved.

           We show the error separately rather than storing
           it as a successful AI response.
        */

        showToast(
            researchEnabled
                ? "Online research failed: " + errorMessage
                : "NOVA could not respond: " + errorMessage,
            "error",
            6000
        );

        renderConversation();

        appendErrorNotice(errorMessage);

    } finally {
        if (sequence === state.requestSequence) {
            state.currentController = null;

            setGenerating(false);

            renderConversation();

            focusMessageInput();
        }
    }
}


/* ============================================================
   22. ERROR NOTICE
============================================================ */

function appendErrorNotice(message) {
    if (!elements.chat) {
        return;
    }

    const notice = document.createElement("div");

    notice.className = "request-error-notice";

    notice.setAttribute("role", "alert");

    const text = document.createElement("span");

    text.textContent = "Request failed: " + message;

    const retryButton = document.createElement("button");

    retryButton.type = "button";

    retryButton.textContent = "Retry";

    retryButton.addEventListener("click", () => {
        notice.remove();

        retryLastUserMessage();
    });

    notice.append(text, retryButton);

    elements.chat.appendChild(notice);

    scrollToBottom();
}


/* ============================================================
   23. STOP GENERATION
============================================================ */

function stopGeneration(showNotice = true) {
    if (!state.isGenerating) {
        return;
    }

    /*
       Invalidate the request before aborting it so that
       a late response cannot be added to the chat.
    */

    state.requestSequence++;

    if (state.currentController) {
        state.currentController.abort();
    }

    state.currentController = null;

    setGenerating(false);

    if (showNotice) {
        showToast("Stopped waiting for the response.", "info");
    }

    renderConversation();
}


/* ============================================================
   24. RETRY AND REGENERATE
============================================================ */

function retryLastUserMessage() {
    if (state.isGenerating) {
        return;
    }

    const conversation = getActiveConversation();

    if (!conversation) {
        showToast("No conversation to retry.", "error");
        return;
    }

    const lastUserMessage = [...conversation.messages]
        .reverse()
        .find((message) => message.role === "user");

    if (!lastUserMessage) {
        showToast("No user message to retry.", "error");
        return;
    }

    /*
       Remove any failed assistant placeholder if one exists.
       The normal implementation does not save error messages
       as assistant responses.
    */

    sendMessage(lastUserMessage.content);
}


function regenerateLastResponse() {
    if (state.isGenerating) {
        return;
    }

    const conversation = getActiveConversation();

    if (!conversation || conversation.messages.length === 0) {
        return;
    }

    const lastAssistantIndex = conversation.messages
        .map((message) => message.role)
        .lastIndexOf("assistant");

    if (lastAssistantIndex >= 0) {
        conversation.messages.splice(lastAssistantIndex, 1);
    }

    const lastUserMessage = [...conversation.messages]
        .reverse()
        .find((message) => message.role === "user");

    if (!lastUserMessage) {
        renderConversation();
        return;
    }

    /*
       Preserve the original user message.

       sendMessage() creates a new user message, so we remove
       that original message first to prevent duplication.
    */

    const messageToRegenerate = lastUserMessage.content;

    const originalIndex = conversation.messages.lastIndexOf(
        lastUserMessage
    );

    if (originalIndex >= 0) {
        conversation.messages.splice(originalIndex, 1);
    }

    saveConversations();

    renderConversation();

    sendMessage(messageToRegenerate);
}


/* ============================================================
   25. CHAT SEARCH
============================================================ */

function openChatSearch() {
    if (!elements.chatSearchPanel) {
        return;
    }

    elements.chatSearchPanel.hidden = false;

    elements.chatSearchInput?.focus();

    renderConversationList(elements.chatSearchInput?.value || "");
}


function closeChatSearchPanel() {
    if (elements.chatSearchPanel) {
        elements.chatSearchPanel.hidden = true;
    }

    if (elements.chatSearchInput) {
        elements.chatSearchInput.value = "";
    }

    renderConversationList();
}


/* ============================================================
   26. SUGGESTED PROMPTS
============================================================ */

function handleSuggestedPrompt(button) {
    const prompt = button.dataset.prompt;

    if (!prompt) {
        return;
    }

    const shouldResearch = button.dataset.research === "true";

    if (shouldResearch) {
        setResearchMode(true);
    }

    sendMessage(prompt, {
        researchEnabled: shouldResearch || state.researchEnabled
    });
}


/* ============================================================
   27. EVENT LISTENERS
============================================================ */

function registerEventListeners() {

    /* New chat buttons */

    elements.newChat?.addEventListener("click", startNewChat);

    elements.topbarNewChat?.addEventListener("click", startNewChat);

    elements.composerNewChat?.addEventListener("click", startNewChat);


    /* Sidebar */

    elements.sidebarOpen?.addEventListener("click", openSidebar);

    elements.sidebarClose?.addEventListener("click", closeSidebar);

    elements.sidebarBackdrop?.addEventListener("click", closeSidebar);


    /* History */

    elements.refreshHistory?.addEventListener("click", () => {
        loadConversations();

        renderConversationList();

        renderConversation();

        showToast("Chat history refreshed.", "success");
    });


    /* Search */

    elements.searchChatsButton?.addEventListener(
        "click",
        openChatSearch
    );

    elements.closeChatSearch?.addEventListener(
        "click",
        closeChatSearchPanel
    );

    elements.chatSearchInput?.addEventListener("input", () => {
        renderConversationList(elements.chatSearchInput.value);
    });


    /* Profile menu */

    elements.profileButton?.addEventListener(
        "click",
        toggleProfileMenu
    );

    elements.themeMenuButton?.addEventListener("click", () => {
        toggleTheme();

        closeProfileMenu();
    });

    elements.clearAllChats?.addEventListener(
        "click",
        clearAllConversations
    );

    elements.aboutNova?.addEventListener("click", () => {
        closeProfileMenu();

        elements.aboutDialog?.showModal();
    });


    /* Theme */

    elements.themeToggle?.addEventListener("click", toggleTheme);


    /* Research */

    elements.researchToggle?.addEventListener(
        "click",
        toggleResearchMode
    );

    elements.composerResearch?.addEventListener(
        "click",
        toggleResearchMode
    );

    elements.researchShortcut?.addEventListener("click", () => {
        setResearchMode(true);

        showToast("Online research enabled.", "success");

        focusMessageInput();
    });

    elements.disableResearch?.addEventListener("click", () => {
        setResearchMode(false);

        showToast("Online research disabled.", "info");
    });


    /* Form submission */

    elements.chatForm?.addEventListener("submit", (event) => {
        event.preventDefault();

        if (state.isGenerating) {
            return;
        }

        sendMessage();
    });


    /*
       ENTER KEY FIX

       Enter:
         - prevents a newline
         - submits the message

       Shift + Enter:
         - preserves the browser's normal textarea behavior
         - inserts a newline

       IME composition is respected for languages that use
       an input composition method.
    */

    elements.messageInput?.addEventListener(
        "keydown",
        (event) => {
            if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.isComposing
            ) {
                event.preventDefault();

                if (!state.isGenerating) {
                    if (typeof elements.chatForm.requestSubmit === "function") {
                        elements.chatForm.requestSubmit();
                    } else {
                        sendMessage();
                    }
                }
            }
        }
    );


    /* Textarea resize */

    elements.messageInput?.addEventListener(
        "input",
        autoResizeTextarea
    );


    /* Stop */

    elements.stopButton?.addEventListener("click", () => {
        stopGeneration(true);
    });


    /* Confirmation dialog */

    elements.dialogCancel?.addEventListener(
        "click",
        closeConfirmationDialog
    );

    elements.dialogConfirm?.addEventListener(
        "click",
        confirmDialogAction
    );


    /* Rename dialog */

    elements.renameForm?.addEventListener(
        "submit",
        saveRenamedConversation
    );

    elements.renameCancel?.addEventListener(
        "click",
        closeRenameDialog
    );


    /* About dialog */

    elements.aboutClose?.addEventListener("click", () => {
        elements.aboutDialog?.close();
    });


    /* Suggested prompts */

    document.querySelectorAll(".suggestion-card").forEach((button) => {
        button.addEventListener("click", () => {
            handleSuggestedPrompt(button);
        });
    });


    /* Click outside the profile menu */

    document.addEventListener("click", (event) => {
        if (
            elements.profileMenu &&
            !elements.profileMenu.hidden &&
            !elements.profileMenu.contains(event.target) &&
            !elements.profileButton?.contains(event.target)
        ) {
            closeProfileMenu();
        }
    });


    /* Close chat action menus */

    document.addEventListener("click", (event) => {
        if (!event.target.closest(".chat-history-menu-button")) {
            document.querySelectorAll(".chat-history-menu").forEach(
                (menu) => {
                    menu.hidden = true;
                }
            );
        }
    });


    /* Escape key */

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeProfileMenu();

            if (state.isMobileSidebarOpen) {
                closeSidebar();
            }
        }
    });


    /* Window resize */

    window.addEventListener("resize", () => {
        if (
            !window.matchMedia("(max-width: 760px)").matches &&
            state.isMobileSidebarOpen
        ) {
            state.isMobileSidebarOpen = false;

            elements.sidebar?.classList.remove(
                "sidebar-mobile-open"
            );

            if (elements.sidebarBackdrop) {
                elements.sidebarBackdrop.hidden = true;
            }

            document.body.classList.remove("sidebar-is-open");
        }
    });


    /* Prevent accidental loss of unfinished text when refreshing. */

    window.addEventListener("beforeunload", () => {
        if (elements.messageInput?.value.trim()) {
            try {
                localStorage.setItem(
                    "nova_ai_draft_v1",
                    elements.messageInput.value
                );
            } catch {
                // Draft saving is best effort.
            }
        }
    });

}


/* ============================================================
   28. RESTORE UNSENT DRAFT
============================================================ */

function restoreDraft() {
    try {
        const draft = localStorage.getItem("nova_ai_draft_v1");

        if (draft && elements.messageInput) {
            elements.messageInput.value = draft;

            autoResizeTextarea();
        }
    } catch {
        // Draft restoration is optional.
    }
}


/* ============================================================
   29. APPLICATION INITIALISATION
============================================================ */

function initialiseNova() {
    console.log("NOVA AI initialising...");

    loadTheme();

    loadConversations();

    restoreSidebarState();

    restoreDraft();

    registerEventListeners();

    renderConversationList();

    renderConversation();

    updateResearchUI();

    autoResizeTextarea();

    startHealthChecks();

    /*
       Restore the most recently updated conversation,
       if one exists. Otherwise show the welcome screen.
    */

    if (state.conversations.length > 0) {
        const mostRecent = [...state.conversations].sort(
            (a, b) => b.updatedAt - a.updatedAt
        )[0];

        state.activeConversationId = mostRecent.id;

        renderConversation();

        renderConversationList();
    } else {
        state.activeConversationId = null;

        renderConversation();
    }

    console.log("NOVA AI ready.");
}


/* ============================================================
   30. START APPLICATION
============================================================ */

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        initialiseNova,
        { once: true }
    );
} else {
    initialiseNova();
}


/* ============================================================
   END OF NOVA AI SCRIPT
============================================================ */