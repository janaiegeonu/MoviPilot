(() => {
    "use strict";

    document.addEventListener("DOMContentLoaded", () => {
        const openButton = document.getElementById("profileButton");
        const overlay = document.getElementById("profileOverlay");
        const dialog = document.getElementById("profileDialog");
        const closeButton = document.getElementById("profileCloseButton");
        const copyButton = document.getElementById("profileCopyIDButton");
        const logoutForm = document.getElementById("profileLogoutForm");
        const statusLine = document.getElementById("profileStatus");
        const canvas = document.getElementById("profileAuroraCanvas");

        if (!openButton || !overlay || !dialog || !closeButton) return;

        const fullNameLine = document.getElementById("profileFullName");
        const initialsLine = document.getElementById("profileInitials");
        const accountIDLine = document.getElementById("profileAccountID");
        const emailLine = document.getElementById("profileEmail");
        const joinedLine = document.getElementById("profileJoinedAt");
        const copyLabel = document.getElementById("profileCopyLabel");
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        let previousFocus = null;
        let currentAccountID = "";
        let requestNumber = 0;
        let copyResetTimer = 0;
        let auroraFrame = 0;
        let auroraRunning = false;
        let canvasWidth = 0;
        let canvasHeight = 0;
        let pixelRatio = 1;
        let canvasContext = null;

        const showStatus = (message, isError = false) => {
            if (!statusLine) return;
            statusLine.textContent = message;
            statusLine.classList.toggle("is-error", isError);
            statusLine.hidden = !message;
        };

        const getInitials = (fullName) => {
            const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
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
            return new Intl.DateTimeFormat(undefined, {
                month: "long",
                year: "numeric"
            }).format(date);
        };

        const resetProfileFields = () => {
            currentAccountID = "";
            if (fullNameLine) fullNameLine.textContent = "Loading your profile…";
            if (initialsLine) initialsLine.textContent = "MP";
            if (accountIDLine) accountIDLine.textContent = "Loading account ID…";
            if (emailLine) emailLine.textContent = "Loading email…";
            if (joinedLine) joinedLine.textContent = "Finding your join date…";
            if (copyButton) copyButton.disabled = true;
            if (copyLabel) copyLabel.textContent = "Copy ID";
            showStatus("");
        };

        const renderProfile = (user) => {
            const fullName = String(user.fullName ?? user.full_name ?? "MoviPilot member").trim() || "MoviPilot member";
            const email = String(user.email ?? "").trim() || "Email unavailable";
            const accountID = String(user.publicID ?? user.publicId ?? user.public_id ?? "").trim();
            const createdAt = user.createdAt ?? user.created_at ?? "";

            if (fullNameLine) fullNameLine.textContent = fullName;
            if (initialsLine) initialsLine.textContent = getInitials(fullName);
            if (emailLine) emailLine.textContent = email;
            if (joinedLine) joinedLine.textContent = formatJoinedDate(createdAt);

            currentAccountID = accountID;
            if (accountIDLine) accountIDLine.textContent = accountID || "Account ID unavailable";
            if (copyButton) copyButton.disabled = !accountID;
            if (!accountID) showStatus("Your profile loaded, but an account ID was not returned. Check the profile API response.", true);
        };

        const loadProfile = async () => {
            const thisRequest = ++requestNumber;
            resetProfileFields();

            try {
                const response = await fetch("/api/profile", {
                    method: "GET",
                    credentials: "same-origin",
                    cache: "no-store",
                    headers: { "Accept": "application/json" }
                });

                if (thisRequest !== requestNumber) return;
                let payload = {};
                try {
                    payload = await response.json();
                } catch (_) {
                    payload = {};
                }

                if (!response.ok) {
                    if (response.status === 401 || response.status === 403) {
                        throw new Error("Your session could not be verified. Please sign in again.");
                    }
                    throw new Error(payload.error || "We couldn't load your profile just now. Please try again.");
                }

                const user = payload.user || payload.profile || payload;
                renderProfile(user);
            } catch (error) {
                if (thisRequest !== requestNumber) return;
                if (fullNameLine) fullNameLine.textContent = "Profile unavailable";
                if (initialsLine) initialsLine.textContent = "MP";
                if (accountIDLine) accountIDLine.textContent = "Unable to load account ID";
                if (emailLine) emailLine.textContent = "Unavailable";
                if (joinedLine) joinedLine.textContent = "Unavailable";
                if (copyButton) copyButton.disabled = true;
                showStatus(error instanceof Error ? error.message : "We couldn't load your profile just now.", true);
            }
        };

        /* ------------------------------------------------------------------
           Accessible modal behavior.
           Only the explicit X button closes the card. The blurred overlay does
           not respond to clicks, and Escape is intentionally not a close action.
           ------------------------------------------------------------------ */
        const focusableElements = () => Array.from(dialog.querySelectorAll(
            'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'
        )).filter((element) => !element.hasAttribute("hidden"));

        const openProfile = () => {
            if (!overlay.hidden) return;
            previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : openButton;
            overlay.hidden = false;
            document.body.classList.add("mp-profile-open");
            requestAnimationFrame(() => overlay.classList.add("is-open"));
            closeButton.focus({ preventScroll: true });
            startAurora();
            loadProfile();
        };

        const closeProfile = () => {
            if (overlay.hidden) return;
            overlay.classList.remove("is-open");
            overlay.hidden = true;
            document.body.classList.remove("mp-profile-open");
            requestNumber += 1;
            stopAurora();
            if (previousFocus && typeof previousFocus.focus === "function") {
                previousFocus.focus({ preventScroll: true });
            } else {
                openButton.focus({ preventScroll: true });
            }
        };

        openButton.addEventListener("click", openProfile);
        closeButton.addEventListener("click", closeProfile);

        // Do not bind a click handler to the overlay: clicking outside the card
        // must not dismiss the user's profile.
        dialog.addEventListener("keydown", (event) => {
            if (event.key !== "Tab") return;
            const focusable = focusableElements();
            if (!focusable.length) {
                event.preventDefault();
                dialog.focus();
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

        /* Copy public account ID. */
        const fallbackCopy = (value) => {
            const temporaryInput = document.createElement("textarea");
            temporaryInput.value = value;
            temporaryInput.setAttribute("readonly", "");
            temporaryInput.style.position = "fixed";
            temporaryInput.style.left = "-9999px";
            temporaryInput.style.top = "0";
            temporaryInput.style.opacity = "0";
            document.body.appendChild(temporaryInput);
            temporaryInput.select();
            temporaryInput.setSelectionRange(0, temporaryInput.value.length);
            const copied = document.execCommand("copy");
            temporaryInput.remove();
            if (!copied) throw new Error("The clipboard is unavailable");
        };

        copyButton?.addEventListener("click", async () => {
            if (!currentAccountID) return;
            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(currentAccountID);
                } else {
                    fallbackCopy(currentAccountID);
                }
                if (copyLabel) copyLabel.textContent = "Copied";
                showStatus("Your MoviPilot ID has been copied.");
                window.clearTimeout(copyResetTimer);
                copyResetTimer = window.setTimeout(() => {
                    if (copyLabel) copyLabel.textContent = "Copy ID";
                    if (!overlay.hidden) showStatus("");
                }, 2200);
            } catch (_) {
                showStatus("Copy was blocked by this browser. You can select and copy the ID shown above.", true);
            }
        });

        // Normal form submission lets the server destroy the session and return
        // the browser to the public homepage; JavaScript does not fake a logout.
        logoutForm?.addEventListener("submit", (event) => {
            const button = document.getElementById("profileLogoutButton");
            if (button) {
                button.disabled = true;
                const label = button.querySelector("span");
                if (label) label.textContent = "Signing out…";
            }
            showStatus("Signing you out securely…");
            // Let the native POST form continue to the Go logout handler.
            if (event.defaultPrevented) event.preventDefault();
        });

        /* ------------------------------------------------------------------
           Animated aurora cover. This is drawn locally and does not depend on
           remote images, a third-party library, or a network request.
           ------------------------------------------------------------------ */
        const resizeAurora = () => {
            if (!canvas || !canvasContext) return;
            const bounds = canvas.getBoundingClientRect();
            canvasWidth = Math.max(1, bounds.width);
            canvasHeight = Math.max(1, bounds.height);
            pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.round(canvasWidth * pixelRatio);
            canvas.height = Math.round(canvasHeight * pixelRatio);
            canvasContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
            drawAurora(performance.now());
        };

        const drawAurora = (time) => {
            if (!canvasContext || !canvasWidth || !canvasHeight) return;
            const ctx = canvasContext;
            const width = canvasWidth;
            const height = canvasHeight;
            const t = time * (reduceMotion ? 0 : 0.00024);

            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = "#071526";
            ctx.fillRect(0, 0, width, height);

            const blobs = [
                { x: .17, y: .30, rx: .42, ry: .78, phase: .1, color: [23, 127, 207], alpha: .72 },
                { x: .50, y: .70, rx: .37, ry: .74, phase: 2.0, color: [29, 203, 169], alpha: .60 },
                { x: .77, y: .20, rx: .34, ry: .75, phase: 4.1, color: [76, 124, 255], alpha: .57 },
                { x: .91, y: .76, rx: .31, ry: .58, phase: 5.2, color: [31, 184, 215], alpha: .48 }
            ];

            ctx.save();
            ctx.globalCompositeOperation = "screen";
            blobs.forEach((blob, index) => {
                const driftX = Math.sin(t + blob.phase) * width * .11;
                const driftY = Math.cos(t * 1.18 + blob.phase) * height * .16;
                const x = blob.x * width + driftX;
                const y = blob.y * height + driftY;
                const radius = Math.max(width, height) * blob.rx;
                const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
                const [red, green, blue] = blob.color;
                gradient.addColorStop(0, `rgba(${red}, ${green}, ${blue}, ${blob.alpha})`);
                gradient.addColorStop(.42, `rgba(${red}, ${green}, ${blue}, ${blob.alpha * .37})`);
                gradient.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, width, height);

                // Ribbon-like light paths give the gradient a liquid, flowing edge.
                ctx.beginPath();
                for (let step = 0; step <= 28; step += 1) {
                    const progress = step / 28;
                    const px = progress * width;
                    const wave = Math.sin(progress * Math.PI * (1.6 + index * .22) + t * 7 + blob.phase);
                    const secondary = Math.cos(progress * Math.PI * 3.2 - t * 4 + blob.phase) * height * .08;
                    const py = height * (blob.y + wave * .23) + secondary + driftY * .3;
                    if (step === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                const ribbon = ctx.createLinearGradient(0, 0, width, height);
                ribbon.addColorStop(0, `rgba(${red}, ${green}, ${blue}, 0)`);
                ribbon.addColorStop(.45, `rgba(${Math.min(255, red + 45)}, ${Math.min(255, green + 38)}, ${Math.min(255, blue + 30)}, .20)`);
                ribbon.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
                ctx.strokeStyle = ribbon;
                ctx.lineWidth = index % 2 === 0 ? 2.2 : 1.2;
                ctx.shadowColor = `rgba(${red}, ${green}, ${blue}, .45)`;
                ctx.shadowBlur = 17;
                ctx.stroke();
            });
            ctx.restore();

            const sheen = ctx.createLinearGradient(0, 0, width, height);
            sheen.addColorStop(0, "rgba(225, 255, 255, .04)");
            sheen.addColorStop(.45, "rgba(108, 205, 244, .01)");
            sheen.addColorStop(1, "rgba(7, 13, 35, .25)");
            ctx.fillStyle = sheen;
            ctx.fillRect(0, 0, width, height);
        };

        const animateAurora = (time) => {
            if (!auroraRunning || overlay.hidden) return;
            drawAurora(time);
            if (!reduceMotion) auroraFrame = window.requestAnimationFrame(animateAurora);
        };

        const startAurora = () => {
            if (!canvas) return;
            if (!canvasContext) canvasContext = canvas.getContext("2d", { alpha: false });
            if (!canvasContext) return;
            auroraRunning = true;
            resizeAurora();
            if (!reduceMotion) auroraFrame = window.requestAnimationFrame(animateAurora);
        };

        const stopAurora = () => {
            auroraRunning = false;
            if (auroraFrame) window.cancelAnimationFrame(auroraFrame);
            auroraFrame = 0;
        };

        window.addEventListener("resize", () => {
            if (auroraRunning) resizeAurora();
        }, { passive: true });

        // If dashboard markup is re-rendered and the profile control is removed,
        // no global click interception has been installed to disturb the page.
    });
})();
