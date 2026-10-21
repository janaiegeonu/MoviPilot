/* ========================================================================
   MOVIPILOT PROFILE MARKS
   Add-on for the existing profile_modal.js. This file intentionally does not
   replace or intercept the original profile modal's open/close/copy/logout
   behaviour. It adds incoming/outgoing mark counts and clickable public cards.
   ======================================================================== */
(() => {
    "use strict";

    document.addEventListener("DOMContentLoaded", () => {
        const profileButton = document.getElementById("profileButton");
        const profileOverlay = document.getElementById("profileOverlay");
        const profileCloseButton = document.getElementById("profileCloseButton");
        const markTabs = Array.from(document.querySelectorAll("[data-profile-mark-list]"));
        const panel = document.getElementById("profileMarksPanel");
        const list = document.getElementById("profileMarksList");
        const listTitle = document.getElementById("profileMarksListTitle");
        const listSubtitle = document.getElementById("profileMarksListSubtitle");
        const listStatus = document.getElementById("profileMarksListStatus");
        const refreshButton = document.getElementById("profileMarksRefreshButton");
        const markedMeCount = document.getElementById("profileMarkedMeCount");
        const markedByMeCount = document.getElementById("profileMarkedByMeCount");
        const profileStatus = document.getElementById("profileStatus");

        // Older dashboard shells can safely keep running if the markup was not added yet.
        if (!profileOverlay || !markTabs.length || !panel || !list) return;

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const state = {
            counts: { markedMe: 0, markedByMe: 0 },
            activeList: "",
            listRequest: 0,
            countsRequest: 0,
            detailRequest: 0,
            activeMember: null,
            returnFocus: null,
            detailOverlay: null,
            detail: {}
        };

        const fmtCount = (value) => {
            const n = Number(value);
            return Number.isFinite(n) && n >= 0 ? Math.floor(n).toLocaleString() : "0";
        };

        const getInitials = (name) => {
            const parts = String(name || "MoviPilot member").trim().split(/\s+/).filter(Boolean);
            if (!parts.length) return "MP";
            if (parts.length === 1) {
                const letters = Array.from(parts[0]);
                return (letters[0] + (letters[1] || letters[0])).toLocaleUpperCase();
            }
            return (Array.from(parts[0])[0] + Array.from(parts[parts.length - 1])[0]).toLocaleUpperCase();
        };

        const formatJoinedDate = (value) => {
            if (!value) return "Date unavailable";
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return "Date unavailable";
            return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
        };

        const showListStatus = (message, isError = false) => {
            if (!listStatus) return;
            listStatus.textContent = message;
            listStatus.classList.toggle("is-error", isError);
        };

        const showProfileStatus = (message, isError = false) => {
            // Reuse the original profile toast only when it exists.
            if (!profileStatus || profileOverlay.hidden) return;
            profileStatus.hidden = false;
            profileStatus.textContent = message;
            profileStatus.classList.toggle("is-error", isError);
            profileStatus.setAttribute("aria-hidden", "false");
            requestAnimationFrame(() => profileStatus.classList.add("is-visible"));
            window.clearTimeout(showProfileStatus.timer);
            showProfileStatus.timer = window.setTimeout(() => {
                profileStatus.classList.remove("is-visible");
                window.setTimeout(() => {
                    if (!profileStatus.classList.contains("is-visible")) {
                        profileStatus.hidden = true;
                        profileStatus.setAttribute("aria-hidden", "true");
                    }
                }, 350);
            }, 2200);
        };

        const requestJSON = async (url, options = {}) => {
            const response = await fetch(url, {
                credentials: "same-origin",
                cache: "no-store",
                headers: { Accept: "application/json", ...(options.headers || {}) },
                ...options
            });
            let payload = {};
            try { payload = await response.json(); } catch (_) { /* handled below */ }
            if (!response.ok) {
                throw new Error(payload.error || "We couldn't complete that request. Please try again.");
            }
            return payload;
        };

        const paintCounts = () => {
            if (markedMeCount) markedMeCount.textContent = fmtCount(state.counts.markedMe);
            if (markedByMeCount) markedByMeCount.textContent = fmtCount(state.counts.markedByMe);
        };

        const refreshCounts = async () => {
            const requestID = ++state.countsRequest;
            try {
                const payload = await requestJSON("/api/profile/marks?list=summary");
                if (requestID !== state.countsRequest) return;
                state.counts = {
                    markedMe: Number(payload.counts?.markedMe) || 0,
                    markedByMe: Number(payload.counts?.markedByMe) || 0
                };
                paintCounts();
            } catch (error) {
                if (requestID !== state.countsRequest) return;
                if (markedMeCount) markedMeCount.textContent = "—";
                if (markedByMeCount) markedByMeCount.textContent = "—";
                showProfileStatus(error.message || "Mark counts are temporarily unavailable.", true);
            }
        };

        const resetTabs = () => {
            markTabs.forEach((button) => {
                button.classList.remove("is-active");
                button.setAttribute("aria-expanded", "false");
            });
        };

        const createMemberRow = (member, mode) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "mp-profile-mark-member";
            button.setAttribute("aria-label", `Open ${member.fullName || member.username || "member"}'s public profile`);
            button.dataset.publicId = String(member.publicId || "");

            const avatar = document.createElement("span");
            avatar.className = "mp-profile-mark-member-avatar";
            avatar.setAttribute("aria-hidden", "true");
            avatar.textContent = getInitials(member.fullName);

            const copy = document.createElement("span");
            copy.className = "mp-profile-mark-member-copy";
            const name = document.createElement("strong");
            name.textContent = String(member.fullName || "MoviPilot member");
            const handle = document.createElement("small");
            const username = String(member.username || "").trim();
            handle.textContent = username ? `@${username}` : String(member.publicId || "MoviPilot member");
            copy.append(name, handle);

            const chevron = document.createElement("span");
            chevron.className = "mp-profile-mark-member-chevron";
            chevron.setAttribute("aria-hidden", "true");
            chevron.textContent = "›";

            button.append(avatar, copy, chevron);
            button.addEventListener("click", () => openMemberDetail(member.publicId, button, mode));
            const item = document.createElement("div");
            item.setAttribute("role", "listitem");
            item.appendChild(button);
            return item;
        };

        const loadList = async (mode) => {
            if (!mode) return;
            const requestID = ++state.listRequest;
            state.activeList = mode;
            panel.hidden = false;
            list.replaceChildren();
            showListStatus("Finding your community members…");

            if (listTitle) listTitle.textContent = mode === "marked-me" ? "Marked me" : "I’ve marked";
            if (listSubtitle) listSubtitle.textContent = mode === "marked-me"
                ? "Members who have marked your account"
                : "Accounts you’ve marked as friends";
            if (refreshButton) refreshButton.disabled = true;

            try {
                const payload = await requestJSON(`/api/profile/marks?list=${encodeURIComponent(mode)}`);
                if (requestID !== state.listRequest || state.activeList !== mode) return;

                list.replaceChildren();
                const users = Array.isArray(payload.users) ? payload.users : [];
                const total = Number(payload.count) || 0;
                if (!users.length) {
                    showListStatus(mode === "marked-me"
                        ? "No one has marked your account yet. When members do, they’ll appear here."
                        : "You haven’t marked anyone yet. Visit Community to discover members.");
                } else {
                    showListStatus(total > users.length
                        ? `Showing ${users.length} of ${fmtCount(total)} members. Select a member to view their profile.`
                        : `${fmtCount(total)} ${total === 1 ? "member" : "members"}. Select a name to view their profile.`);
                    users.forEach((member) => list.appendChild(createMemberRow(member, mode)));
                }
            } catch (error) {
                if (requestID !== state.listRequest) return;
                list.replaceChildren();
                showListStatus(error.message || "We couldn’t load this list. Try refreshing.", true);
            } finally {
                if (requestID === state.listRequest && refreshButton) refreshButton.disabled = false;
            }
        };

        markTabs.forEach((button) => {
            button.addEventListener("click", () => {
                const mode = button.dataset.profileMarkList;
                if (!mode) return;
                if (state.activeList === mode && !panel.hidden) {
                    state.activeList = "";
                    panel.hidden = true;
                    list.replaceChildren();
                    resetTabs();
                    return;
                }
                resetTabs();
                button.classList.add("is-active");
                button.setAttribute("aria-expanded", "true");
                loadList(mode);
            });
        });

        refreshButton?.addEventListener("click", () => {
            if (state.activeList) loadList(state.activeList);
        });

        // The original script owns opening/closing. We only refresh our counts.
        profileButton?.addEventListener("click", () => {
            window.setTimeout(refreshCounts, 80);
        });

        profileCloseButton?.addEventListener("click", () => {
            state.activeList = "";
            panel.hidden = true;
            list.replaceChildren();
            resetTabs();
            closeMemberDetail(false);
        });

        // -----------------------------------------------------------------
        // Public member detail popup, opened from either marks list.
        // -----------------------------------------------------------------
        const ensureMemberDetail = () => {
            if (state.detailOverlay) return state.detailOverlay;

            const overlay = document.createElement("div");
            overlay.className = "mp-profile-mark-detail-overlay";
            overlay.id = "profileMarkMemberOverlay";
            overlay.hidden = true;
            overlay.innerHTML = `
                <section class="mp-profile-mark-detail-card" id="profileMarkMemberDialog" role="dialog" aria-modal="true" aria-labelledby="profileMarkMemberName" tabindex="-1">
                    <div class="mp-profile-mark-detail-cover">
                        <span class="mp-profile-mark-detail-kicker">MOVIPILOT MEMBER</span>
                        <h2 class="mp-profile-mark-detail-name" id="profileMarkMemberName">Loading member…</h2>
                        <button class="mp-profile-mark-detail-close" id="profileMarkMemberClose" type="button" aria-label="Close member profile" title="Close profile">
                            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                        </button>
                    </div>
                    <div class="mp-profile-mark-detail-body">
                        <div class="mp-profile-mark-detail-identity">
                            <span class="mp-profile-mark-detail-avatar" id="profileMarkMemberInitials" aria-hidden="true">MP</span>
                            <span class="mp-profile-mark-detail-identity-copy"><strong id="profileMarkMemberFullName">Loading profile…</strong><small id="profileMarkMemberUsername">@member</small></span>
                        </div>
                        <button class="mp-profile-mark-detail-copy" id="profileMarkMemberCopy" type="button"><span id="profileMarkMemberPublicID">Loading ID…</span><span id="profileMarkMemberCopyLabel">Copy ID</span></button>
                        <div class="mp-profile-mark-detail-stats">
                            <div class="mp-profile-mark-detail-stat"><small>Member since</small><strong id="profileMarkMemberJoined">Loading…</strong></div>
                            <div class="mp-profile-mark-detail-stat"><small>Marked by</small><strong id="profileMarkMemberMarkCount">—</strong></div>
                        </div>
                        <button class="mp-profile-mark-friend" id="profileMarkMemberFriend" type="button" disabled><span aria-hidden="true">✦</span><span id="profileMarkMemberFriendLabel">Mark as friend</span></button>
                        <p class="mp-profile-mark-detail-status" id="profileMarkMemberStatus" role="status" aria-live="polite"></p>
                    </div>
                </section>`;
            document.body.appendChild(overlay);

            state.detailOverlay = overlay;
            state.detail.dialog = overlay.querySelector("#profileMarkMemberDialog");
            state.detail.closeButton = overlay.querySelector("#profileMarkMemberClose");
            state.detail.name = overlay.querySelector("#profileMarkMemberName");
            state.detail.fullName = overlay.querySelector("#profileMarkMemberFullName");
            state.detail.initials = overlay.querySelector("#profileMarkMemberInitials");
            state.detail.username = overlay.querySelector("#profileMarkMemberUsername");
            state.detail.publicID = overlay.querySelector("#profileMarkMemberPublicID");
            state.detail.copy = overlay.querySelector("#profileMarkMemberCopy");
            state.detail.copyLabel = overlay.querySelector("#profileMarkMemberCopyLabel");
            state.detail.joined = overlay.querySelector("#profileMarkMemberJoined");
            state.detail.markCount = overlay.querySelector("#profileMarkMemberMarkCount");
            state.detail.friendButton = overlay.querySelector("#profileMarkMemberFriend");
            state.detail.friendLabel = overlay.querySelector("#profileMarkMemberFriendLabel");
            state.detail.status = overlay.querySelector("#profileMarkMemberStatus");

            state.detail.closeButton.addEventListener("click", () => closeMemberDetail(true));
            state.detail.copy.addEventListener("click", copyMemberID);
            state.detail.friendButton.addEventListener("click", toggleMemberMark);
            state.detail.dialog.addEventListener("keydown", (event) => {
                if (event.key !== "Tab") return;
                const focusable = Array.from(state.detail.dialog.querySelectorAll("button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"));
                if (!focusable.length) {
                    event.preventDefault();
                    state.detail.dialog.focus();
                    return;
                }
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            });
            // Intentionally do not close on backdrop click or Escape.
            return overlay;
        };

        const setMemberDetailStatus = (message, isError = false) => {
            if (!state.detail.status) return;
            state.detail.status.textContent = message;
            state.detail.status.style.color = isError ? "#ffcaca" : "rgba(183,226,227,.76)";
        };

        const openMemberDetail = async (publicID, sourceButton, sourceList) => {
            if (!publicID) return;
            const overlay = ensureMemberDetail();
            const requestID = ++state.detailRequest;
            state.returnFocus = sourceButton instanceof HTMLElement ? sourceButton : null;
            state.activeMember = null;

            state.detail.name.textContent = "Loading member…";
            state.detail.fullName.textContent = "Loading profile…";
            state.detail.initials.textContent = "MP";
            state.detail.username.textContent = "@member";
            state.detail.publicID.textContent = publicID;
            state.detail.copyLabel.textContent = "Copy ID";
            state.detail.joined.textContent = "Loading…";
            state.detail.markCount.textContent = "—";
            state.detail.friendButton.disabled = true;
            state.detail.friendButton.classList.remove("is-marked");
            state.detail.friendLabel.textContent = "Mark as friend";
            setMemberDetailStatus("Loading public profile…");

            overlay.hidden = false;
            requestAnimationFrame(() => overlay.classList.add("is-open"));
            state.detail.closeButton.focus({ preventScroll: true });

            try {
                const payload = await requestJSON(`/api/community/user?id=${encodeURIComponent(publicID)}`);
                if (requestID !== state.detailRequest) return;
                const member = payload.user || payload.profile || {};
                state.activeMember = {
                    publicId: String(member.publicId || publicID),
                    username: String(member.username || ""),
                    fullName: String(member.fullName || "MoviPilot member"),
                    createdAt: member.createdAt || "",
                    friendCount: Number(member.friendCount) || 0,
                    markedByMe: Boolean(member.markedByMe),
                    sourceList: sourceList || ""
                };
                renderMemberDetail();
                setMemberDetailStatus("");
            } catch (error) {
                if (requestID !== state.detailRequest) return;
                state.detail.name.textContent = "Profile unavailable";
                state.detail.fullName.textContent = "We couldn’t load this profile.";
                state.detail.friendButton.disabled = true;
                setMemberDetailStatus(error.message || "Please try again.", true);
            }
        };

        const renderMemberDetail = () => {
            const member = state.activeMember;
            if (!member) return;
            state.detail.name.textContent = member.fullName;
            state.detail.fullName.textContent = member.fullName;
            state.detail.initials.textContent = getInitials(member.fullName);
            state.detail.username.textContent = member.username ? `@${member.username}` : "MoviPilot member";
            state.detail.publicID.textContent = member.publicId;
            state.detail.joined.textContent = formatJoinedDate(member.createdAt);
            state.detail.markCount.textContent = fmtCount(member.friendCount);
            state.detail.friendButton.disabled = false;
            state.detail.friendButton.classList.toggle("is-marked", member.markedByMe);
            state.detail.friendLabel.textContent = member.markedByMe ? "Marked as friend · Remove mark" : "Mark as friend";
            state.detail.friendButton.setAttribute("aria-pressed", String(member.markedByMe));
        };

        const closeMemberDetail = (restoreFocus = true) => {
            if (!state.detailOverlay || state.detailOverlay.hidden) return;
            state.detailOverlay.classList.remove("is-open");
            state.detailOverlay.hidden = true;
            state.detailRequest += 1;
            state.activeMember = null;
            if (restoreFocus && state.returnFocus && state.returnFocus.isConnected) {
                state.returnFocus.focus({ preventScroll: true });
            } else if (restoreFocus && profileCloseButton && !profileOverlay.hidden) {
                profileCloseButton.focus({ preventScroll: true });
            }
        };

        const fallbackCopy = (value) => {
            const input = document.createElement("textarea");
            input.value = value;
            input.setAttribute("readonly", "");
            Object.assign(input.style, { position: "fixed", left: "-9999px", top: "0", opacity: "0" });
            document.body.appendChild(input);
            input.select();
            input.setSelectionRange(0, input.value.length);
            const copied = document.execCommand("copy");
            input.remove();
            if (!copied) throw new Error("Copy was blocked by this browser.");
        };

        const copyMemberID = async () => {
            const member = state.activeMember;
            if (!member) return;
            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(member.publicId);
                } else {
                    fallbackCopy(member.publicId);
                }
                state.detail.copyLabel.textContent = "Copied";
                setMemberDetailStatus("MoviPilot ID copied to your clipboard.");
                window.setTimeout(() => {
                    if (state.detail.copyLabel && state.activeMember) state.detail.copyLabel.textContent = "Copy ID";
                }, 1700);
            } catch (_) {
                setMemberDetailStatus("Copy was blocked. You can select the displayed ID and copy it manually.", true);
            }
        };

        const toggleMemberMark = async () => {
            const member = state.activeMember;
            if (!member || state.detail.friendButton.disabled) return;
            const nextMarked = !member.markedByMe;
            state.detail.friendButton.disabled = true;
            state.detail.friendLabel.textContent = nextMarked ? "Marking…" : "Removing mark…";
            setMemberDetailStatus("");

            try {
                const payload = await requestJSON("/api/community/friend", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify({ targetPublicId: member.publicId, marked: nextMarked })
                });
                member.markedByMe = Boolean(payload.markedByMe);
                member.friendCount = Number(payload.friendCount) || 0;
                renderMemberDetail();
                setMemberDetailStatus(member.markedByMe ? "You’ve marked this member as a friend." : "Your mark has been removed.");
                await refreshCounts();
                // Refresh the visible list after a mark update so the list and counts stay in sync.
                if (state.activeList === "marked-by-me" && panel && !panel.hidden) {
                    await loadList("marked-by-me");
                } else if (state.activeList === "marked-me" && panel && !panel.hidden) {
                    await loadList("marked-me");
                }
            } catch (error) {
                state.detail.friendButton.disabled = false;
                renderMemberDetail();
                setMemberDetailStatus(error.message || "We couldn’t update this mark.", true);
            }
        };

        // The profile card might have been opened before this add-on finished setup.
        if (!profileOverlay.hidden) refreshCounts();
    });
})();