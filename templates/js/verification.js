document.addEventListener("DOMContentLoaded", () => {

    /* =====================================================
       ELEMENTS
       ===================================================== */

    const form = document.getElementById("verificationForm");
    const wrapper = document.getElementById("codeInputWrapper");
    const cluster = document.getElementById("codeCluster");
    const inputs = [...document.querySelectorAll(".code-input")];
    const hiddenCode = document.getElementById("verificationCode");

    const errorBox = document.getElementById("verificationError");
    const errorText = document.getElementById("verificationErrorText");

    const resendButton = document.getElementById("resendCode");
    const verifyButton = document.getElementById("verifyButton");
    const verifyButtonText = verifyButton?.querySelector(".verify-button-text");

    if (
        !form ||
        !wrapper ||
        !cluster ||
        inputs.length !== 6 ||
        !hiddenCode ||
        !errorBox ||
        !errorText ||
        !verifyButton
    ) {
        console.error("MoviPilot verification UI could not initialize.");
        return;
    }


    /* =====================================================
       HELPERS
       ===================================================== */

    const wait = (milliseconds) =>
        new Promise((resolve) => window.setTimeout(resolve, milliseconds));

    const getCode = () => inputs.map((input) => input.value).join("");

    const isCompleteCode = (code) => /^\d{6}$/.test(code);

    function syncHiddenCode() {
        hiddenCode.value = getCode();
    }

    function updateButtonState() {
        if (wrapper.classList.contains("checking")) {
            verifyButton.disabled = true;
            return;
        }

        verifyButton.disabled = !isCompleteCode(getCode());
    }

    function clearError() {
        errorBox.classList.remove("visible", "show");
        wrapper.classList.remove("error", "shake");
    }

    function showError(message) {
        errorText.textContent = message;
        errorBox.classList.add("visible");
        errorBox.classList.add("show");
        wrapper.classList.add("error");
    }

    function resetStatusVisuals() {
        wrapper.classList.remove("checking", "failure", "success");
    }

    function resetSuccessCheck() {
        const checkPath = wrapper.querySelector(".status-check path");

        if (checkPath) {
            checkPath.style.animation = "none";
            void checkPath.getBoundingClientRect();
            checkPath.style.animation = "";
        }
    }

    function clearMergePositions() {
        inputs.forEach((input) => {
            input.style.removeProperty("--merge-x");
        });
    }


    /* =====================================================
       MERGE POSITION CALCULATION
       ===================================================== */

    function calculateMergePositions() {
        const wrapperRect = wrapper.getBoundingClientRect();
        const centerX = wrapperRect.left + wrapperRect.width / 2;

        inputs.forEach((input) => {
            const inputRect = input.getBoundingClientRect();
            const inputCenter = inputRect.left + inputRect.width / 2;
            const distance = centerX - inputCenter;

            input.style.setProperty("--merge-x", `${distance}px`);
        });
    }


    /* =====================================================
       BUTTON STATES
       ===================================================== */

    function setButtonLoading() {
        verifyButton.disabled = true;
        verifyButton.classList.add("loading");
        verifyButton.classList.remove("success-state");

        if (verifyButtonText) {
            verifyButtonText.textContent = "Checking code...";
        }
    }

    function setButtonSuccess() {
        verifyButton.disabled = true;
        verifyButton.classList.remove("loading");
        verifyButton.classList.add("success-state");

        if (verifyButtonText) {
            verifyButtonText.textContent = "Code verified";
        }
    }

    function restoreButton() {
        verifyButton.classList.remove("loading", "success-state");

        if (verifyButtonText) {
            verifyButtonText.textContent = "Verify email";
        }

        updateButtonState();
    }


    /* =====================================================
       CHECKING STATE
       ===================================================== */

    function startCheckingState() {
        clearError();
        calculateMergePositions();

        inputs.forEach((input) => {
            input.disabled = true;
        });

        if (resendButton) {
            resendButton.disabled = true;
        }

        setButtonLoading();
        resetSuccessCheck();

        /*
         * Add the class only after the browser has the real
         * positions. This is what makes the six boxes travel
         * into the exact center instead of jumping.
         */
        requestAnimationFrame(() => {
            wrapper.classList.add("checking");
        });
    }


    /* =====================================================
       FAILURE ANIMATION
       ===================================================== */

    async function animateFailure(message) {
        /* Keep the rejection spinner visible briefly. */
        wrapper.classList.add("failure");
        await wait(420);

        /*
         * Removing checking lets the boxes spread back to their
         * original positions while the status circle contracts.
         */
        wrapper.classList.remove("checking", "failure", "success");

        await wait(520);

        inputs.forEach((input) => {
            input.disabled = false;
            input.value = "";
            input.classList.remove("filled");
        });

        clearMergePositions();
        syncHiddenCode();

        wrapper.classList.add("error");

        /* Force the shake animation to restart every time. */
        wrapper.classList.remove("shake");
        void wrapper.offsetWidth;
        wrapper.classList.add("shake");

        await wait(560);

        wrapper.classList.remove("shake");

        showError(
            message ||
            "The verification code is incorrect. Please try again."
        );

        restoreButton();

        if (resendButton) {
            resendButton.disabled = false;
        }

        inputs[0].focus();
    }


    /* =====================================================
       SUCCESS ANIMATION
       ===================================================== */

    async function animateSuccess(redirectURL) {
        wrapper.classList.add("success");
        setButtonSuccess();

        /* Give the checkmark enough time to draw cleanly. */
        await wait(1090);

        window.location.assign(
            redirectURL || "/reset-password"
        );
    }


    /* =====================================================
       OTP INPUTS
       ===================================================== */

    inputs.forEach((input, index) => {

        input.addEventListener("input", () => {
            if (wrapper.classList.contains("checking")) {
                return;
            }

            clearError();

            const digits = input.value.replace(/\D/g, "");

            /*
             * Some mobile browsers can autofill all six digits
             * into one OTP box. Spread those digits automatically.
             */
            if (digits.length > 1) {
                const available = digits.slice(0, inputs.length - index);

                available.split("").forEach((digit, offset) => {
                    const target = inputs[index + offset];

                    if (target) {
                        target.value = digit;
                        target.classList.add("filled");
                    }
                });

                input.value = available.charAt(0) || "";

                const focusIndex = Math.min(
                    index + available.length,
                    inputs.length - 1
                );

                inputs[focusIndex].focus();
            } else {
                input.value = digits.slice(0, 1);

                if (input.value) {
                    input.classList.add("filled");

                    if (index < inputs.length - 1) {
                        inputs[index + 1].focus();
                    }
                } else {
                    input.classList.remove("filled");
                }
            }

            syncHiddenCode();
            updateButtonState();
        });


        input.addEventListener("keydown", (event) => {
            if (wrapper.classList.contains("checking")) {
                event.preventDefault();
                return;
            }

            if (event.key === "Backspace") {
                if (input.value) {
                    input.value = "";
                    input.classList.remove("filled");
                    syncHiddenCode();
                    updateButtonState();
                    return;
                }

                if (index > 0) {
                    event.preventDefault();

                    inputs[index - 1].value = "";
                    inputs[index - 1].classList.remove("filled");
                    inputs[index - 1].focus();

                    syncHiddenCode();
                    updateButtonState();
                }
            }

            if (event.key === "ArrowLeft" && index > 0) {
                event.preventDefault();
                inputs[index - 1].focus();
            }

            if (event.key === "ArrowRight" && index < inputs.length - 1) {
                event.preventDefault();
                inputs[index + 1].focus();
            }

            if (
                event.key === " " ||
                event.key === "e" ||
                event.key === "E"
            ) {
                event.preventDefault();
            }
        });


        input.addEventListener("paste", (event) => {
            if (wrapper.classList.contains("checking")) {
                event.preventDefault();
                return;
            }

            event.preventDefault();

            const pasted = (
                event.clipboardData?.getData("text") || ""
            )
                .replace(/\D/g, "")
                .slice(0, 6);

            if (!pasted) {
                return;
            }

            inputs.forEach((box, boxIndex) => {
                box.value = pasted[boxIndex] || "";
                box.classList.toggle("filled", Boolean(box.value));
            });

            syncHiddenCode();
            updateButtonState();

            const focusIndex = Math.min(
                pasted.length,
                inputs.length - 1
            );

            inputs[focusIndex].focus();
            clearError();
        });


        input.addEventListener("focus", () => {
            if (!wrapper.classList.contains("checking")) {
                clearError();
            }
        });
    });


    /* =====================================================
       FORM SUBMISSION
       ===================================================== */

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (wrapper.classList.contains("checking")) {
            return;
        }

        const code = getCode();
        syncHiddenCode();

        if (!isCompleteCode(code)) {
            showError("Please enter the complete 6-digit verification code.");

            wrapper.classList.remove("shake");
            void wrapper.offsetWidth;
            wrapper.classList.add("shake");

            window.setTimeout(() => {
                wrapper.classList.remove("shake");
            }, 560);

            const firstEmpty = inputs.find((input) => !input.value);

            if (firstEmpty) {
                firstEmpty.focus();
            }

            return;
        }

        startCheckingState();

        /* Make the checking animation visible even on very fast responses. */
        const checkingStartedAt = performance.now();

        try {
            const responsePromise = fetch("/verify-code", {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded; charset=UTF-8",
                    Accept: "application/json"
                },
                body: new URLSearchParams({
                    verification_code: code
                }).toString()
            });

            const response = await responsePromise;

            let data;

            try {
                data = await response.json();
            } catch {
                throw new Error("The server returned an unexpected response.");
            }

            const elapsed = performance.now() - checkingStartedAt;
            const minimumCheckingTime = 900;

            if (elapsed < minimumCheckingTime) {
                await wait(minimumCheckingTime - elapsed);
            }

            if (!response.ok || !data.success) {
                throw new Error(
                    data?.error ||
                    "The verification code is invalid or has expired."
                );
            }

            await animateSuccess(
                data.redirect || "/reset-password"
            );

        } catch (error) {
            console.error(
                "MoviPilot verification request failed:",
                error
            );

            await animateFailure(
                error.message ||
                "The verification code is invalid or has expired."
            );
        }
    });


    /* =====================================================
       RESEND CODE
       ===================================================== */

    let resendTimer = null;

    function startResendCooldown(seconds = 30) {
        if (!resendButton) {
            return;
        }

        let remaining = seconds;

        resendButton.disabled = true;
        resendButton.classList.add("cooldown");
        resendButton.textContent = `Resend in ${remaining}s`;

        window.clearInterval(resendTimer);

        resendTimer = window.setInterval(() => {
            remaining -= 1;

            if (remaining <= 0) {
                window.clearInterval(resendTimer);
                resendButton.disabled = false;
                resendButton.classList.remove("cooldown");
                resendButton.textContent = "Resend code";
                return;
            }

            resendButton.textContent = `Resend in ${remaining}s`;
        }, 1000);
    }

    if (resendButton) {
        resendButton.addEventListener("click", async () => {
            if (
                resendButton.disabled ||
                wrapper.classList.contains("checking")
            ) {
                return;
            }

            const email = form.dataset.email?.trim();

            if (!email) {
                showError(
                    "Your verification session has expired. Please request a new code."
                );
                return;
            }

            resendButton.disabled = true;
            resendButton.textContent = "Sending...";
            clearError();

            try {
                const response = await fetch("/forgot-password", {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/x-www-form-urlencoded; charset=UTF-8",
                        Accept: "application/json"
                    },
                    body: new URLSearchParams({ email }).toString()
                });

                let data;

                try {
                    data = await response.json();
                } catch {
                    throw new Error("The server returned an unexpected response.");
                }

                if (!response.ok || !data.success) {
                    throw new Error(
                        data?.error ||
                        "We couldn't resend the verification code."
                    );
                }

                inputs.forEach((input) => {
                    input.value = "";
                    input.classList.remove("filled");
                });

                syncHiddenCode();
                updateButtonState();

                resendButton.textContent = "Code sent ✓";
                await wait(700);

                startResendCooldown(30);
                inputs[0].focus();

            } catch (error) {
                console.error(
                    "MoviPilot resend request failed:",
                    error
                );

                resendButton.disabled = false;
                resendButton.textContent = "Resend code";

                showError(
                    error.message ||
                    "We couldn't resend the verification code."
                );
            }
        });
    }


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    resetStatusVisuals();
    clearMergePositions();
    syncHiddenCode();
    updateButtonState();

    setTimeout(() => {
        inputs[0].focus();
    }, 500);
});